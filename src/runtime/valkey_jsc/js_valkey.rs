use core::ffi::c_void;
use core::ptr::NonNull;

use crate::socket::{SSLConfig, SSLConfigFromJs};
use bun_boringssl as boringssl;
use bun_core::{String as BunString, strings};
use bun_event_loop::EventLoopTimer as Timer;
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSArray, JSGlobalObject, JSMap, JSPromise, JSValue, JsCell,
    JsRef, JsResult,
};
use bun_ptr::{AsCtxPtr, BackRef, ScopedRef};
use bun_uws as uws;

use super::protocol_jsc;
use super::valkey;
use super::command;
use super::command::Command;
use bun_jsc::url::URL;
use bun_valkey::valkey_protocol as protocol;

// ───────────────────────────────────────────────────────────────────────────
// Local shims / extension traits (adapt-on-our-side)
// ───────────────────────────────────────────────────────────────────────────

/// Bridge JS-thread `VirtualMachine` to the aio-level `EventLoopCtx` used by
/// `KeepAlive::ref_/unref`. Valkey always runs on the JS event loop.
#[inline]
fn vm_event_loop_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::AllocatorType::Js)
}

bun_output::define_scoped_log!(debug, RedisJS, visible);

type Socket = uws::AnySocket;

// ───────────────────────────────────────────────────────────────────────────
// SubscriptionCtx
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct SavedFlags {
    pub enable_offline_queue: bool,
    pub enable_auto_pipelining: bool,
}

#[derive(Default)]
pub struct SubscriptionCtx {
    /// `Some` while in subscriber mode; holds the flag values to restore on exit.
    pub saved_flags: Option<SavedFlags>,
}

/// The generate-classes.ts output emits a
/// `js_RedisClient` module with snake-case `*_set_cached`/`*_get_cached`
/// free-fns plus `to_js`/`from_js`. Re-exported here as `Js`.
pub use crate::generated_classes::js_RedisClient as Js;

// SAFETY: `SubscriptionCtx` lives at `JSValkeyClient._subscription_ctx`
// (intrusive backref). `JsCell<SubscriptionCtx>` is `#[repr(transparent)]`.
bun_core::impl_field_parent! { SubscriptionCtx => JSValkeyClient._subscription_ctx; fn parent; }

impl SubscriptionCtx {
    pub fn init(valkey_parent: &JSValkeyClient, parent_this: JSValue) -> Self {
        let callback_map = JSMap::create(&valkey_parent.global_object);
        Js::subscription_callback_map_set_cached(
            parent_this,
            &valkey_parent.global_object,
            callback_map,
        );

        SubscriptionCtx { saved_flags: None }
    }

    #[inline]
    pub fn is_subscriber(&self) -> bool {
        self.saved_flags.is_some()
    }

    /// `None` once the JS wrapper has been finalized (or before `init()`).
    fn subscription_callback_map(&self) -> Option<&mut JSMap> {
        let parent_this = self.parent().this_value.get().try_get()?;
        let value_js = Js::subscription_callback_map_get_cached(parent_this)?;
        // `JSMap` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        Some(JSMap::opaque_mut(JSMap::from_js(value_js)?.as_ptr()))
    }

    /// Get the total number of channels that this subscription context is subscribed to.
    pub fn channels_subscribed_to_count(&self, global_object: &JSGlobalObject) -> u32 {
        let Some(map) = self.subscription_callback_map() else {
            return 0;
        };
        match map.size(global_object) {
            Ok(n) => n,
            Err(e) => {
                global_object.report_active_exception_as_unhandled(e);
                0
            }
        }
    }

    /// Test whether this context has any subscriptions. It is mandatory to
    /// guard deinit with this function.
    pub fn has_subscriptions(&self, global_object: &JSGlobalObject) -> bool {
        self.channels_subscribed_to_count(global_object) > 0
    }

    pub fn clear_receive_handlers(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<()> {
        let Some(map) = self.subscription_callback_map() else {
            return Ok(());
        };
        let _ = map.remove(global_object, channel_name)?;
        Ok(())
    }

    pub fn clear_all_receive_handlers(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        let Some(map) = self.subscription_callback_map() else {
            return Ok(());
        };
        map.clear(global_object)
    }

    /// Remove a specific receive handler.
    ///
    /// Returns: The total number of remaining handlers for this channel, or null if there were no
    /// listeners originally registered.
    ///
    /// Note: This function will empty out the map entry if there are no more handlers registered.
    pub fn remove_receive_handler(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<Option<usize>> {
        let Some(map) = self.subscription_callback_map() else {
            return Ok(None);
        };

        let existing = map.get(global_object, channel_name)?;
        if existing.is_undefined_or_null() {
            // Nothing to remove.
            return Ok(None);
        }

        // Existing is guaranteed to be an array of callbacks.
        if cfg!(debug_assertions) {
            debug_assert!(existing.is_array());
        }

        // TODO(markovejnovic): I can't find a better way to do this... I generate a new array,
        // filtering out the callback we want to remove. This is woefully inefficient for large
        // sets (and surprisingly fast for small sets of callbacks).
        let mut array_it = existing.array_iterator(global_object)?;
        let updated_array = JSArray::create_empty(global_object, 0)?;
        while let Some(iter) = array_it.next()? {
            if iter == callback {
                continue;
            }
            updated_array.push(global_object, iter)?;
        }

        // Otherwise, we have ourselves an array of callbacks. We need to remove the element in the
        // array that matches the callback.
        let _ = map.remove(global_object, channel_name)?;

        // Only populate the map if we have remaining callbacks for this channel.
        let new_length = updated_array.get_length(global_object)?;

        if new_length != 0 {
            map.set(global_object, channel_name, updated_array)?;
        }

        Ok(Some(new_length as usize))
    }

    /// Add a handler for receiving messages on a specific channel
    pub fn upsert_receive_handler(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<()> {
        // `BackRef` (Copy + Deref) detaches the borrow so the guard closure is
        // safe even though intervening JS may re-enter `&self`.
        let parent_br = BackRef::new(self.parent());
        let _guard = scopeguard::guard(parent_br, |p| {
            p.on_new_subscription_callback_insert();
        });
        let Some(map) = self.subscription_callback_map() else {
            return Ok(());
        };

        let existing = map.get(global_object, channel_name)?;
        let handlers_array = if existing.is_undefined_or_null() {
            JSArray::create_empty(global_object, 0)?
        } else {
            debug_assert!(existing.is_array());
            existing
        };

        // Append the new callback to the array
        handlers_array.push(global_object, callback)?;

        // Set the updated array back in the map
        map.set(global_object, channel_name, handlers_array)?;
        Ok(())
    }

    pub fn get_callbacks(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<Option<JSValue>> {
        let Some(map) = self.subscription_callback_map() else {
            return Ok(None);
        };
        let result = map.get(global_object, channel_name)?;
        if result == JSValue::UNDEFINED {
            return Ok(None);
        }
        Ok(Some(result))
    }

    /// Invoke callbacks for a channel with the given arguments
    /// Handles both single callbacks and arrays of callbacks
    pub fn invoke_callbacks(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        args: &[JSValue],
    ) -> JsResult<()> {
        let Some(callbacks) = self.get_callbacks(global_object, channel_name)? else {
            debug!(
                "No callbacks found for channel {}",
                channel_name.to_bun_string(global_object).unwrap_or_default()
            );
            return Ok(());
        };

        if cfg!(debug_assertions) {
            debug_assert!(callbacks.is_array());
        }

        // Callback runs on the JS thread; VM is alive for the duration.
        let vm = VirtualMachine::get();
        let _exit = vm.enter_event_loop_scope();

        // After we go through every single callback, we will have to update the poll ref.
        // The user may, for example, unsubscribe in the callbacks, or even stop the client.
        // `BackRef` (Copy + Deref) detaches the borrow so the guard closure is
        // safe even though intervening JS may re-enter `&self`.
        let parent_br = BackRef::new(self.parent());
        let _update = scopeguard::guard(parent_br, |p| p.update_poll_ref());

        // If callbacks is an array, iterate and call each one
        let mut iter = callbacks.array_iterator(global_object)?;
        while let Some(callback) = iter.next()? {
            if cfg!(debug_assertions) {
                debug_assert!(callback.is_callable());
            }
            // `event_loop_mut()` is the safe accessor for the VM-owned
            // event-loop self-pointer (see `VirtualMachine::event_loop_mut`).
            vm.event_loop_mut()
                .run_callback(callback, global_object, JSValue::UNDEFINED, args);
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSValkeyClient
// ───────────────────────────────────────────────────────────────────────────

/// Valkey client wrapper for JavaScript
// `#[bun_jsc::JsClass]` is hand-rolled in `mod.rs` (the codegen
// macro's 2-arg `constructor` shim doesn't fit the `js_this` flow here).
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut RedisClient` — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. `JsCell` is
// `#[repr(transparent)]`, so `from_field_ptr!`/`owner!` recovery (dispatch.rs,
// `ValkeyClient::parent`) sees identical offsets.
//
// `#[repr(C)]`: `client` MUST be
// at offset 0. `ValkeyClient::parent()` recovers the outer pointer via
// `from_field_ptr!`, but belt-and-suspenders against any path that assumes
// `*mut JSValkeyClient` and `*mut ValkeyClient` alias (the socket ext slot did
// — see `connect()` below).
#[repr(C)]
pub struct JSValkeyClient {
    pub client: JsCell<valkey::ValkeyClient>,
    pub global_object: GlobalRef,
    pub this_value: JsCell<JsRef>,
    pub poll_ref: JsCell<KeepAlive>,

    pub _subscription_ctx: JsCell<SubscriptionCtx>,
    /// `us_ssl_ctx_t` for `tls: { …custom CA… }`. `tls: true` borrows
    /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this `None`.
    pub _secure: JsCell<Option<boringssl::c::OwnedSslCtx>>,

    pub timer: JsCell<Timer::EventLoopTimer>,
    pub reconnect_timer: JsCell<Timer::EventLoopTimer>,
    pub ref_count: bun_ptr::RefCount<JSValkeyClient>,
}

bun_event_loop::impl_timer_owner!(JSValkeyClient;
    from_timer_ptr => timer,
    from_reconnect_timer_ptr => reconnect_timer,
);

// `Js` (= `jsc.Codegen.JSRedisClient`) is re-exported above; `to_js`/`from_js`
// live in that generated module.

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` → intrusive refcount.
impl bun_ptr::RefCounted for JSValkeyClient {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: caller contract — `this` is live.
        unsafe { &raw mut (*this).ref_count }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: last ref dropped; sole owner.
        unsafe { JSValkeyClient::deinit(this) };
    }
}

/// Connection parameters extracted from a `valkey://` / `redis://` URL.
struct ParsedValkeyUrl {
    address: valkey::Address,
    username: Box<[u8]>,
    password: Box<[u8]>,
    database: u32,
    tls_from_scheme: bool,
}

/// Parse a Valkey/Redis connection URL into owned connection parameters.
///
/// Accepts `redis[s]://`, `valkey[s]://`, `*+unix://`, `*+tls://` (see
/// [`valkey::Protocol::MAP`]). A bare `host[:port][/db]` with no scheme is
/// prefixed with `valkey://` before parsing. Throws a JS `TypeError` for
/// malformed URLs / unknown schemes / bad port / bad db index.
fn parse_valkey_url(
    global_object: &JSGlobalObject,
    url_str: &BunString,
) -> JsResult<ParsedValkeyUrl> {
    let mut fallback_url_buf = [0u8; 2048];

    // Parse and validate the URL using `URL::from_string`, which returns null for invalid URLs
    // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
    // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
    // the case right now and I do not understand why. It will take some work in JSC to
    // understand why this is happening, but since I need to uncork valkey, I'm adding this as
    // a stop-gap.
    let parsed_url: NonNull<URL> = 'get_url: {
        let url_slice = url_str.to_utf8();
        let url_byte_slice = url_slice.slice();

        if url_byte_slice.is_empty() {
            return Err(global_object.throw_invalid_arguments(format_args!("Invalid URL format")));
        }

        if strings::contains(url_byte_slice, b"://") {
            break 'get_url match URL::from_utf8(url_byte_slice) {
                Some(u) => u,
                None => {
                    return Err(
                        global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                    );
                }
            };
        }

        let corrected_url = 'get_url_slice: {
            use std::io::Write;
            let mut cursor = &mut fallback_url_buf[..];
            let start_len = cursor.len();
            // No NUL terminator needed here — we immediately re-parse via fromUTF8.
            if write!(&mut cursor, "valkey://").is_err() || cursor.write_all(url_byte_slice).is_err()
            {
                return Err(
                    global_object.throw_invalid_arguments(format_args!("URL is too long."))
                );
            }
            let written = start_len - cursor.len();
            break 'get_url_slice &fallback_url_buf[..written];
        };

        match URL::from_utf8(corrected_url) {
            Some(u) => u,
            None => {
                return Err(
                    global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                );
            }
        }
    };
    // SAFETY: `from_utf8` heap-allocates; release on scope exit.
    let _parsed_url_drop = scopeguard::guard(parsed_url, |p| unsafe { URL::destroy(p.as_ptr()) });
    // `_parsed_url_drop` keeps the heap `URL` live for this scope, so the
    // `BackRef` liveness invariant holds; `Deref` encapsulates the single
    // `NonNull::as_ref` site.
    let parsed_url = bun_ptr::BackRef::from(parsed_url);

    // Extract protocol string
    let protocol_str = parsed_url.protocol();
    let protocol_utf8 = protocol_str.to_utf8();
    // Remove the trailing ':' from protocol (e.g., "redis:" -> "redis")
    let p = protocol_utf8.slice();
    let protocol_slice = if !p.is_empty() && p[p.len() - 1] == b':' {
        &p[..p.len() - 1]
    } else {
        p
    };

    let uri: valkey::Protocol = if !protocol_slice.is_empty() {
        match valkey::Protocol::MAP.get(protocol_slice) {
            Some(v) => *v,
            None => return Err(global_object.throw(format_args!(
                "Expected url protocol to be one of redis, valkey, rediss, valkeys, redis+tls, redis+unix, redis+tls+unix",
            ))),
        }
    } else {
        valkey::Protocol::Standalone
    };

    // Extract all URL components
    let username_str = parsed_url.username();
    let username_utf8 = username_str.to_utf8();

    let password_str = parsed_url.password();
    let password_utf8 = password_str.to_utf8();

    let hostname_str = parsed_url.host();
    let hostname_utf8 = hostname_str.to_utf8();

    let pathname_str = parsed_url.pathname();
    let pathname_utf8 = pathname_str.to_utf8();

    // Determine hostname based on protocol type
    let hostname_slice: &[u8] = if uri.is_unix() {
        // For unix sockets, the path is in the pathname
        if pathname_utf8.slice().is_empty() {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "Expected unix socket path after valkey+unix:// or valkey+tls+unix://",
            )));
        }
        pathname_utf8.slice()
    } else {
        hostname_utf8.slice()
    };

    let port: u16 = if uri.is_unix() {
        0
    } else {
        'brk: {
            let port_value = parsed_url.port();
            // URL.port() returns u32::MAX if port is not set
            if port_value == u32::MAX {
                // No port specified, use default
                break 'brk 6379;
            } else {
                // Port was explicitly specified
                if port_value == 0 {
                    // Port 0 is invalid for TCP connections (though it's allowed for unix sockets)
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Port 0 is not valid for TCP connections",
                    )));
                }
                if port_value > 65535 {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Invalid port number in URL. Port must be a number between 0 and 65535",
                    )));
                }
                break 'brk u16::try_from(port_value).expect("int cast");
            }
        }
    };

    // Copy strings into owned buffers since the URL object will be deinitialized
    let username = Box::<[u8]>::from(username_utf8.slice());
    let password = Box::<[u8]>::from(password_utf8.slice());
    let hostname = Box::<[u8]>::from(hostname_slice);

    // Parse database number from pathname (e.g., "/1" -> database 1)
    let database: u32 = if uri.is_unix() {
        // For unix sockets the pathname is the socket path, not a db index.
        0
    } else {
        let path = pathname_utf8.slice();
        if path.len() > 1 {
            match bun_core::fmt::parse_int::<u32>(&path[1..], 10) {
                Ok(n) => n,
                Err(_) => {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Invalid database number in Redis URL: {}",
                        bun_core::fmt::quote(&path[1..]),
                    )));
                }
            }
        } else {
            0
        }
    };

    Ok(ParsedValkeyUrl {
        address: if uri.is_unix() {
            valkey::Address::Unix(hostname)
        } else {
            valkey::Address::Host {
                host: hostname,
                port,
            }
        },
        username,
        password,
        database,
        tls_from_scheme: uri.is_tls(),
    })
}

impl JSValkeyClient {
    #[inline]
    pub fn ref_(&self) {
        // SAFETY: `self` is live; intrusive count is interior-mutable.
        unsafe { bun_ptr::RefCount::ref_(std::ptr::from_ref::<Self>(self).cast_mut()) };
    }
    /// Decrement the intrusive refcount; on zero runs [`deinit`](Self::deinit)
    /// which frees the heap allocation. After this returns `this` may dangle.
    ///
    /// Takes a raw pointer (not `&self`) because a `&self` argument would carry
    /// a Stacked Borrows protector for the whole call frame, making the
    /// in-frame deallocation in `deinit` UB ("deallocating while item is
    /// protected"). Callers that hold a live `&Self` and can prove the count
    /// stays > 0 may pass `std::ptr::from_ref(self).cast_mut()`.
    ///
    /// # Safety
    /// `this` must point to a live, `heap`-allocated `JSValkeyClient` and the
    /// caller must own one ref.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { bun_ptr::RefCount::deref(this) };
    }
    /// RAII scoped ref: bumps on construction, derefs on `Drop`. Keeps `*self`
    /// alive across re-entrant connect/close/fail paths.
    #[inline]
    pub fn ref_scope(&self) -> ScopedRef<Self> {
        // SAFETY: `self` is live; the guard's own ref keeps it alive past Drop.
        unsafe { ScopedRef::new(self.as_ctx_ptr()) }
    }
    #[inline]
    pub fn new(init: JSValkeyClient) -> *mut JSValkeyClient {
        // bun.TrivialNew(@This()) → heap::alloc(Box::new(init))
        bun_core::heap::into_raw(Box::new(init))
    }

    /// Convenience accessor for the per-thread JS VM stored on `client`.
    #[inline]
    fn vm(&self) -> &'static VirtualMachine {
        self.client.get().vm
    }

    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// Mutable projection of the inner protocol client through `&self`.
    ///
    /// `ValkeyClient` is the protocol state machine (not itself JS-exposed);
    /// every method on it still takes `&mut self`. This is the single audited
    /// escape hatch — callers must keep the returned borrow short and not hold
    /// it across a call that re-enters JS and re-derives the same client.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(super) fn client_mut(&self) -> &mut valkey::ValkeyClient {
        // SAFETY: R-2 single-JS-thread invariant (see `JsCell` docs). The
        // `&mut` is fresh per call site; reentrancy through
        // `ValkeyClient::parent()` forms a shared `&JSValkeyClient` only.
        unsafe { self.client.get_mut() }
    }

    // Factory function to create a new Valkey client from JS
    // No `#[bun_jsc::host_fn]` here — the free-fn shim it emits
    // calls `constructor(...)` unqualified (fails inside `impl`). Codegen
    // wires the constructor via `RedisClientImpl::constructor` (see
    // generated_classes.rs), which passes the freshly-allocated wrapper cell
    // as `js_this`. `callframe.this()` is *not* the wrapper here — using it
    // would mis-target the cached `subscriptionCallbackMap` slot in
    // `SubscriptionCtx::init`.
    pub fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        js_this: JSValue,
    ) -> JsResult<*mut JSValkeyClient> {
        Self::create(global_object, callframe.arguments(), js_this)
    }

    /// Heap-allocate a fresh client in the initial `Disconnected` state.
    ///
    /// The single construction site for the `JSValkeyClient` struct literal —
    /// shared by both JS construction (`create_no_js_no_pubsub`) and
    /// `.duplicate()` (`clone_without_connecting`). `_subscription_ctx` is a
    /// placeholder here; properly initialized later by [`bind_js`](Self::bind_js).
    #[allow(clippy::too_many_arguments)]
    fn new_disconnected(
        global_object: GlobalRef,
        address: valkey::Address,
        username: Box<[u8]>,
        password: Box<[u8]>,
        database: u32,
        tls: valkey::TLS,
        flags: valkey::ConnectionFlags,
        max_retries: u32,
        connection_timeout_ms: u32,
        idle_timeout_interval_ms: u32,
    ) -> *mut JSValkeyClient {
        let vm: &'static VirtualMachine = global_object.bun_vm();
        JSValkeyClient::new(JSValkeyClient {
            ref_count: bun_ptr::RefCount::init(),
            _subscription_ctx: JsCell::new(SubscriptionCtx::default()),
            client: JsCell::new(valkey::ValkeyClient {
                vm,
                address,
                username,
                password,
                in_flight: command::PromiseQueue::init(),
                queue: command::EntryQueue::init(),
                status: valkey::Status::Disconnected,
                handshake: valkey::Handshake::default(),
                socket: Socket::SocketTcp(uws::SocketTCP {
                    socket: uws::InternalSocket::Detached,
                }),
                tls,
                database,
                flags,
                max_retries,
                connection_timeout_ms,
                idle_timeout_interval_ms,
                write_buffer: Default::default(),
                read_buffer: Default::default(),
                reply_scanner: Default::default(),
                retry_attempts: 0,
                auto_flusher: Default::default(),
            }),
            global_object,
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::default()),
            _secure: JsCell::new(None),
            timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionTimeout,
            )),
            reconnect_timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionReconnect,
            )),
        })
    }

    /// Create a Valkey client that does not have an associated JS object nor a SubscriptionCtx.
    pub fn create_no_js_no_pubsub(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
    ) -> JsResult<*mut JSValkeyClient> {
        let global_object = GlobalRef::from(global_object);
        let vm: &'static VirtualMachine = global_object.bun_vm();

        let url_str = if arguments.len() >= 1 && !arguments[0].is_undefined_or_null() {
            arguments[0].to_bun_string(&global_object)?
        } else {
            let env = vm.env_loader();
            match env.get(b"REDIS_URL").or_else(|| env.get(b"VALKEY_URL")) {
                Some(url) => BunString::borrow_utf8(url),
                None => BunString::static_(b"valkey://localhost:6379"),
            }
        };
        // `defer url_str.deref();` — bun_core::String drops on scope exit.

        let parsed = parse_valkey_url(&global_object, &url_str)?;

        let options = if arguments.len() >= 2
            && !arguments[1].is_undefined_or_null()
            && arguments[1].is_object()
        {
            parse_valkey_options_from_js(&global_object, arguments[1])?
        } else {
            valkey::Options::default()
        };

        let tls = if !options.tls.is_none() {
            options.tls
        } else if parsed.tls_from_scheme {
            valkey::TLS::Enabled
        } else {
            valkey::TLS::None
        };

        bun_core::analytics::Features::VALKEY.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        Ok(Self::new_disconnected(
            global_object,
            parsed.address,
            parsed.username,
            parsed.password,
            parsed.database,
            tls,
            valkey::ConnectionFlags {
                enable_auto_reconnect: options.enable_auto_reconnect,
                enable_offline_queue: options.enable_offline_queue,
                enable_auto_pipelining: options.enable_auto_pipelining,
                ..Default::default()
            },
            options.max_retries,
            options.connection_timeout_ms,
            options.idle_timeout_ms,
        ))
    }

    /// Wire a freshly-allocated client to its JS wrapper: sets `this_value` and
    /// initialises the subscription context (which stores a JSMap on `js_this`).
    /// Must be called exactly once, after `create_no_js_no_pubsub` / `clone_without_connecting`.
    pub fn bind_js(this: *mut Self, js_this: JSValue) {
        // SAFETY: `this` is a fresh heap allocation owned by the caller.
        let this_ref = unsafe { &*this };
        this_ref.this_value.set(JsRef::init_weak(js_this));
        this_ref
            ._subscription_ctx
            .set(SubscriptionCtx::init(this_ref, js_this));
    }

    pub fn create(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        js_this: JSValue,
    ) -> JsResult<*mut JSValkeyClient> {
        let ptr = JSValkeyClient::create_no_js_no_pubsub(global_object, arguments)?;
        JSValkeyClient::bind_js(ptr, js_this);
        Ok(ptr)
    }

    /// Clone this client while remaining in the initial disconnected state.
    ///
    /// Note that this does not create an object with an associated this_value.
    /// You may need to populate it yourself.
    pub fn clone_without_connecting(
        &self,
        global_object: &JSGlobalObject,
    ) -> Result<*mut JSValkeyClient, bun_alloc::AllocError> {
        let client = self.client.get();
        let sub_ctx = self._subscription_ctx.get();

        Ok(Self::new_disconnected(
            GlobalRef::from(global_object),
            client.address.clone(),
            Box::from(&client.username[..]),
            Box::from(&client.password[..]),
            client.database,
            client.tls.clone(),
            valkey::ConnectionFlags {
                // If the user manually closed the connection, then duplicating a closed client
                // means the new client remains finalized.
                is_manually_closed: client.flags.is_manually_closed,
                enable_offline_queue: sub_ctx
                    .saved_flags
                    .map(|s| s.enable_offline_queue)
                    .unwrap_or(client.flags.enable_offline_queue),
                enable_auto_pipelining: sub_ctx
                    .saved_flags
                    .map(|s| s.enable_auto_pipelining)
                    .unwrap_or(client.flags.enable_auto_pipelining),
                enable_auto_reconnect: client.flags.enable_auto_reconnect,
                // Duplicating a finalized client means it stays finalized.
                finalized: client.flags.finalized,
                ..Default::default()
            },
            client.max_retries,
            client.connection_timeout_ms,
            client.idle_timeout_interval_ms,
        ))
    }

    pub fn add_subscription(&self) {
        debug!(
            "addSubscription: entering, current subscriber state: {}",
            self._subscription_ctx.get().is_subscriber()
        );
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        let _guard = self.ref_scope();

        let flags = &self.client.get().flags;
        let (q, p) = (flags.enable_offline_queue, flags.enable_auto_pipelining);
        let entered = self._subscription_ctx.with_mut(|s| {
            if s.saved_flags.is_none() {
                s.saved_flags = Some(SavedFlags {
                    enable_offline_queue: q,
                    enable_auto_pipelining: p,
                });
                true
            } else {
                false
            }
        });
        if entered {
            debug!("addSubscription: calling updatePollRef");
            self.update_poll_ref();
        }
        debug!(
            "addSubscription: exiting, new subscriber state: {}",
            self._subscription_ctx.get().is_subscriber()
        );
    }

    pub fn remove_subscription(&self) {
        debug!(
            "removeSubscription: entering, has subscriptions: {}",
            self._subscription_ctx
                .get()
                .has_subscriptions(&self.global_object)
        );
        let _guard = self.ref_scope();

        // This is the last subscription, restore original flags
        if !self
            ._subscription_ctx
            .get()
            .has_subscriptions(&self.global_object)
        {
            if let Some(saved) = self._subscription_ctx.get().saved_flags {
                self.client_mut().flags.enable_offline_queue = saved.enable_offline_queue;
                self.client_mut().flags.enable_auto_pipelining = saved.enable_auto_pipelining;
                self._subscription_ctx.with_mut(|s| s.saved_flags = None);
            }
            debug!("removeSubscription: calling updatePollRef");
            self.update_poll_ref();
        }
        debug!("removeSubscription: exiting");
    }

    pub fn is_subscriber(&self) -> bool {
        self._subscription_ctx.get().is_subscriber()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.client.get().status == valkey::Status::Connected)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let client = self.client.get();
        let len = client.write_buffer.len() + client.read_buffer.len();
        JSValue::js_number(f64::from(len))
    }

    pub fn do_connect(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let _guard = self.ref_scope();

        // If already connected, resolve immediately
        if self.client.get().status == valkey::Status::Connected {
            return Ok(JSPromise::resolved_promise_value(
                global_object,
                Js::hello_get_cached(this_value).unwrap_or(JSValue::UNDEFINED),
            ));
        }

        if let Some(promise) = Js::connection_promise_get_cached(this_value) {
            return Ok(promise);
        }

        let promise_ptr = JSPromise::create(global_object);
        let promise = promise_ptr.to_js();
        Js::connection_promise_set_cached(this_value, global_object, promise);

        // If was manually closed, reset that flag
        self.client_mut().flags.is_manually_closed = false;
        // Explicit connect() should also clear the sticky `failed` flag so the
        // client can recover after prior connection attempts exhausted retries.
        // Without this, every subsequent command rejects with "Connection has
        // failed" forever — see https://github.com/oven-sh/bun/issues/29925.
        self.client_mut().flags.failed = false;
        let self_br = BackRef::new(self);
        let _update = scopeguard::guard(self_br, |p| p.update_poll_ref());

        if self.client.get().flags.needs_to_open_socket {
            self.poll_ref.with_mut(|r| r.ref_(vm_event_loop_ctx()));

            if let Err(err) = self.connect() {
                self.poll_ref.with_mut(|r| r.unref(vm_event_loop_ctx()));
                self.client_mut().flags.needs_to_open_socket = true;
                let err_value = global_object
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!(" {} connecting to Valkey", err.name()),
                    )
                    .to_js();
                let _exit = self.vm().enter_event_loop_scope();
                promise_ptr.reject(global_object, Ok(err_value))?;
                return Ok(promise);
            }

            self.reset_connection_timeout();
            return Ok(promise);
        }

        match self.client.get().status {
            valkey::Status::Disconnected => {
                self.client_mut().flags.is_reconnecting = true;
                self.client_mut().retry_attempts = 0;
                self.reconnect();
            }
            _ => {}
        }

        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_connect(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.do_connect(global_object, callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_disconnect(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        // `disconnect()` -> `close()` can dispatch `on_close` synchronously,
        // which derefs. Hold a ref so `&self` stays live across the call.
        let _guard = self.ref_scope();

        if self.client.get().status == valkey::Status::Disconnected {
            return Ok(JSValue::UNDEFINED);
        }
        self.client_mut().disconnect();
        Ok(JSValue::UNDEFINED)
    }

    // `onconnect`/`onclose` are declared with `this: true` in
    // valkey.classes.ts, so the codegen thunk passes the JS wrapper cell as
    // `this_value` (between `&self` and `global`). No `host_fn` attribute —
    // the extern "C" shim lives in generated_classes.rs. Setter now returns
    // `()` — `IntoHostSetterReturn for ()` ⇒ `true` at the ABI, identical to
    // the old `-> bool { true }`.
    bun_jsc::cached_prop_hostfns! {
        crate::generated_classes::js_RedisClient;
        (get_on_connect, set_on_connect => onconnect_get_cached, onconnect_set_cached),
        (get_on_close,   set_on_close   => onclose_get_cached, onclose_set_cached),
    }

    /// Safely add a timer with proper reference counting and event loop keepalive
    fn add_timer(&self, timer: &JsCell<Timer::EventLoopTimer>, next_timeout_ms: u32) {
        // `timer` is `&self.timer` or `&self.reconnect_timer`; `JsCell` gives
        // us closure-scoped `&mut` without an open-coded raw deref.
        let _guard = self.ref_scope();

        // If the timer is already active, we need to remove it first
        if timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(timer);
        }

        // Skip if timeout is zero
        if next_timeout_ms == 0 {
            return;
        }

        // Set up timer and add to event loop
        let now = bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::AllowMockedTime,
            i64::from(next_timeout_ms),
        );
        // `bun_event_loop::Timespec` is a local stub distinct from
        // `bun_core::Timespec`; convert by fields until they are unified.
        timer.with_mut(|t| {
            t.next = Timer::Timespec {
                sec: now.sec,
                nsec: now.nsec,
            }
        });
        // `vm.timer.insert(timer)` — `Timer::All` lives in `bun_runtime`;
        // dispatched through `RuntimeHooks` (see VirtualMachine::timer_insert).
        let vm = std::ptr::from_ref::<VirtualMachine>(self.client.get().vm).cast_mut();
        // SAFETY: `vm` is the live per-thread VM; `timer` is an unlinked
        // `EventLoopTimer` field of the boxed `JSValkeyClient` (stable address
        // until `remove_timer`/`stop_timers` unlinks it).
        unsafe { VirtualMachine::timer_insert(vm, timer.as_ptr()) };
        self.ref_();
    }

    /// Safely remove a timer with proper reference counting and event loop keepalive
    fn remove_timer(&self, timer: &JsCell<Timer::EventLoopTimer>) {
        if timer.get().state == Timer::State::ACTIVE {
            // Remove the timer from the event loop
            let vm = std::ptr::from_ref::<VirtualMachine>(self.client.get().vm).cast_mut();
            // SAFETY: `vm` is the live per-thread VM; `timer` is currently
            // linked into the heap (state == ACTIVE checked above).
            unsafe { VirtualMachine::timer_remove(vm, timer.as_ptr()) };

            // self.add_timer() adds a reference to 'self' when the timer is
            // alive which is balanced here.
            // SAFETY: balanced with add_timer's ref_(); count stays > 0 so
            // `&self` remains valid past this call.
            unsafe { JSValkeyClient::deref(std::ptr::from_ref(self).cast_mut()) };
        }
    }

    fn reset_connection_timeout(&self) {
        let interval = self.client.get().get_timeout_interval();

        // First remove existing timer if active
        if self.timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.timer);
        }

        // Add new timer if interval is non-zero
        if interval > 0 {
            self.add_timer(&self.timer, interval);
        }
    }

    pub fn disable_connection_timeout(&self) {
        if self.timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.timer);
        }
        self.timer.with_mut(|t| t.state = Timer::State::CANCELLED);
    }

    pub fn on_connection_timeout(&self) {
        debug!("onConnectionTimeout");

        // Mark timer as fired
        self.timer.with_mut(|t| t.state = Timer::State::FIRED);

        let _guard = self.ref_scope();
        // SAFETY: adopts add_timer's keep-alive ref (remove_timer/stop_timers
        // skip FIRED timers, so this scope is the only releaser).
        let _timer_ref = unsafe { ScopedRef::adopt(self.as_ctx_ptr()) };
        if self.client.get().flags.failed {
            return;
        }

        if self.client.get().get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        match self.client.get().status {
            valkey::Status::Connected => {
                let _ = self.fail_fmt(
                    protocol::RedisError::IdleTimeout,
                    format_args!(
                        "Idle timeout reached after {}ms",
                        self.client.get().idle_timeout_interval_ms
                    ),
                );
                // TODO: properly propagate exception upwards
            }
            valkey::Status::Disconnected | valkey::Status::Connecting => {
                let _ = self.fail_fmt(
                    protocol::RedisError::ConnectionTimeout,
                    format_args!(
                        "Connection timeout reached after {}ms",
                        self.client.get().connection_timeout_ms
                    ),
                );
                // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn on_reconnect_timer(&self) {
        debug!("Reconnect timer fired, attempting to reconnect");

        // Mark timer as fired and store important values before doing any derefs
        self.reconnect_timer
            .with_mut(|t| t.state = Timer::State::FIRED);

        let _guard = self.ref_scope();
        // SAFETY: adopts add_timer's keep-alive ref (remove_timer/stop_timers
        // skip FIRED timers, so this scope is the only releaser).
        let _timer_ref = unsafe { ScopedRef::adopt(self.as_ctx_ptr()) };

        // Execute reconnection logic
        self.reconnect();
    }

    pub fn reconnect(&self) {
        if !self.client.get().flags.is_reconnecting {
            return;
        }

        if self.vm().is_shutting_down() {
            bun_core::hint::cold();
            return;
        }

        // Ref to keep this alive during the reconnection
        let _guard = self.ref_scope();

        // Ref the poll to keep event loop alive during connection
        self.poll_ref.with_mut(|r| {
            r.disable();
            *r = KeepAlive::default();
            r.ref_(vm_event_loop_ctx());
        });

        if let Err(err) = self.connect() {
            let err_js = self
                .global_object
                .err(
                    jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                    format_args!("{} reconnecting", err.name()),
                )
                .to_js();
            let _ = self
                .client_mut()
                .fail_with_js_value(&self.global_object, err_js);
            // Socket is already detached here, so close() above early-returns and
            // on_valkey_close never fires; call the user's onclose directly.
            self.call_onclose_handler(err_js);
            self.poll_ref.with_mut(|r| r.disable());
            return;
        }

        // Reset the socket timeout
        self.reset_connection_timeout();
    }

    // Callback for when Valkey client connects
    pub fn on_valkey_connect(&self, value: &mut protocol::RESPValue) -> JsResult<()> {
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        // we should always have a strong reference to the object here
        debug_assert!(self.this_value.get().is_strong());

        let self_ptr = self.as_ctx_ptr();
        // SAFETY: `p` was `self.as_ctx_ptr()` at guard creation; the caller
        // holds an intrusive ref across this scope so `*p` is live here.
        let _defer = scopeguard::guard(self_ptr, |p| unsafe { (*p).flush_and_update_poll_ref() });
        let global_object = self.global_object;
        let _exit = self.vm().enter_event_loop_scope();

        if let Some(this_value) = self.this_value.get().try_get() {
            let value = core::mem::replace(value, protocol::RESPValue::Null);
            let hello_value: JSValue = 'js_hello: {
                match protocol_jsc::resp_value_to_js(value, &global_object) {
                    Ok(v) => break 'js_hello v,
                    Err(err) => {
                        // TODO: how should we handle this? old code ignore the exception instead
                        // of cleaning it up. Now we clean it up, and behave the same as old code.
                        let _ = global_object.take_exception(err);
                        break 'js_hello JSValue::UNDEFINED;
                    }
                }
            };
            Js::hello_set_cached(this_value, &global_object, hello_value);
            // Call onConnect callback if defined by the user
            if let Some(on_connect) = Js::onconnect_get_cached(this_value) {
                let js_value = this_value;
                js_value.ensure_still_alive();
                global_object.queue_microtask(on_connect, &[js_value, hello_value]);
            }

            if let Some(promise) = Js::connection_promise_get_cached(this_value) {
                Js::connection_promise_set_cached(this_value, &global_object, JSValue::ZERO);
                // `JSPromise` is an `opaque_ffi!` ZST — `opaque_mut` is the
                // safe deref. Cached slot held a valid JSPromise.
                let js_promise = JSPromise::opaque_mut(promise.as_promise().unwrap());
                if self.client.get().flags.connection_promise_returns_client {
                    debug!("Resolving connection promise with client instance");
                    js_promise.resolve(&global_object, this_value)?;
                } else {
                    debug!("Resolving connection promise with HELLO response");
                    js_promise.resolve(&global_object, hello_value)?;
                }
                self.client_mut().flags.connection_promise_returns_client = false;
            }
        }
        Ok(())
    }

    /// Invoked when the Valkey client receives a new listener.
    ///
    /// `SubscriptionCtx` will invoke this to communicate that it has added a new listener.
    pub fn on_new_subscription_callback_insert(&self) {
        let _guard = self.ref_scope();
        self.flush_and_update_poll_ref();
    }

    pub fn on_valkey_subscribe(&self) {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        let _guard = self.ref_scope();
        self.flush_and_update_poll_ref();
    }

    pub fn on_valkey_unsubscribe(&self) {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        self.flush_and_update_poll_ref();
    }

    pub fn on_valkey_message(&self, value: &mut [protocol::RESPValue]) {
        if !self.is_subscriber() {
            debug!("onMessage called but client is not in subscriber mode");
            return;
        }

        let global_object = self.global_object;
        let _exit = self.vm().enter_event_loop_scope();

        // The message push should be an array with [channel, message]
        if value.len() < 2 {
            debug!("Message array has insufficient elements: {}", value.len());
            return;
        }

        // Extract channel and message
        let channel = core::mem::replace(&mut value[0], protocol::RESPValue::Null);
        let channel_value = match protocol_jsc::resp_value_to_js(channel, &global_object) {
            Ok(v) => v,
            Err(e) => {
                global_object.report_active_exception_as_unhandled(e);
                return;
            }
        };
        let message = core::mem::replace(&mut value[1], protocol::RESPValue::Null);
        let message_value = match protocol_jsc::resp_value_to_js(message, &global_object) {
            Ok(v) => v,
            Err(e) => {
                global_object.report_active_exception_as_unhandled(e);
                return;
            }
        };

        // Invoke callbacks for this channel with message and channel as arguments
        if let Err(e) = self._subscription_ctx.get().invoke_callbacks(
            &global_object,
            channel_value,
            &[message_value, channel_value],
        ) {
            global_object.report_active_exception_as_unhandled(e);
            return;
        }

        self.flush_and_update_poll_ref();
    }

    // Callback for when Valkey client needs to reconnect
    pub fn on_valkey_reconnect(&self) {
        // SAFETY: adopts connect()'s socket keep-alive ref for the just-closed
        // socket. Reached only from `ValkeyClient::on_close()`'s reconnect
        // branch, which never calls `on_valkey_close()`, so this scope is the
        // sole releaser. The caller holds its own scoped ref, so count > 0.
        let _socket_ref = unsafe { ScopedRef::adopt(self.as_ctx_ptr()) };

        // Schedule reconnection using our safe timer methods
        if self.reconnect_timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.reconnect_timer);
        }

        let delay_ms = self.client.get().get_reconnect_delay();
        self.add_timer(&self.reconnect_timer, delay_ms);
    }

    // Callback for when Valkey client closes
    pub fn on_valkey_close(&self) -> JsResult<()> {
        let global_object = self.global_object;

        // SAFETY: adopts connect()'s socket keep-alive ref; the caller holds
        // its own scoped ref so count stays > 0 until this drops.
        let _socket_ref = unsafe { ScopedRef::adopt(self.as_ctx_ptr()) };
        let _defer = scopeguard::guard(BackRef::new(self), |p| p.update_poll_ref());

        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return Ok(());
        };
        this_jsvalue.ensure_still_alive();

        // Create an error value
        let error_value = protocol_jsc::valkey_error_to_js(
            &global_object,
            b"Connection closed",
            protocol::RedisError::ConnectionClosed,
        );

        let _exit = self.vm().enter_event_loop_scope();

        if !this_jsvalue.is_undefined() {
            if let Some(promise) = Js::connection_promise_get_cached(this_jsvalue) {
                Js::connection_promise_set_cached(this_jsvalue, &global_object, JSValue::ZERO);
                // `JSPromise` is an `opaque_ffi!` ZST — `opaque_mut` is the
                // safe deref. Cached slot held a valid JSPromise.
                JSPromise::opaque_mut(promise.as_promise().unwrap())
                    .reject(&global_object, Ok(error_value))?;
            }
        }

        // Call onClose callback if it exists
        if let Some(on_close) = Js::onclose_get_cached(this_jsvalue) {
            if let Err(e) = on_close.call(&global_object, this_jsvalue, &[error_value]) {
                global_object.report_active_exception_as_unhandled(e);
            }
        }
        Ok(())
    }

    pub fn client_fail(&self, message: &[u8], err: protocol::RedisError) -> JsResult<()> {
        self.client_mut().fail(message, err)
    }

    fn fail_fmt(&self, err: protocol::RedisError, args: core::fmt::Arguments<'_>) -> JsResult<()> {
        use std::io::Write;
        let mut buf = [0u8; 160];
        let mut cur = &mut buf[..];
        let start = cur.len();
        // Truncation is acceptable for a diagnostic string; ignore the Result.
        let _ = cur.write_fmt(args);
        let len = start - cur.len();
        self.client_fail(&buf[..len], err)
    }

    pub fn call_onclose_handler(&self, value: JSValue) {
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let global_object = self.global_object;
        if let Some(on_close) = Js::onclose_get_cached(this_value) {
            let _exit = self.vm().enter_event_loop_scope();
            if let Err(e) = on_close.call(&global_object, this_value, &[value]) {
                global_object.report_active_exception_as_unhandled(e);
            }
        }
    }

    fn close_socket_next_tick(&self) {
        if self.client.get().socket.is_closed() {
            return;
        }

        // During VM shutdown the event loop won't tick, so the deferred task below
        // would never run; close inline (this_value is cleared, no JS re-entry).
        if self.vm().is_shutting_down() {
            bun_core::hint::cold();
            self.client_mut().close();
            return;
        }

        self.ref_();
        // socket close can potentially call JS so we need to enqueue the deinit
        struct Holder {
            // BACKREF — JSValkeyClient is intrusively ref-counted (RefCount + @fieldParentPtr
            // recovery in SubscriptionCtx::parent). The `self.ref_()` above / `(*ctx).deref()`
            // in run() keep it alive across the task hop.
            ctx: *const JSValkeyClient,
            task: jsc::AnyTask::AnyTask,
        }
        impl Holder {
            fn run(self_: *mut Holder) {
                // SAFETY: allocated via heap::alloc below; reclaimed here.
                let self_ = unsafe { bun_core::heap::take(self_) };
                let ctx = self_.ctx;
                // SAFETY: single-threaded; intrusive ref taken before enqueue guarantees liveness.
                unsafe {
                    (*ctx).client_mut().close();
                    JSValkeyClient::deref(ctx.cast_mut());
                }
                // self_ dropped here (Box freed).
            }
        }
        let holder = bun_core::heap::into_raw(Box::new(Holder {
            ctx: self.as_ctx_ptr(),
            task: jsc::AnyTask::AnyTask::default(), // overwritten below
        }));
        // SAFETY: holder just allocated; closure captures nothing so it coerces
        // to `fn(*mut c_void) -> JsResult<()>`.
        unsafe {
            (*holder).task = jsc::AnyTask::AnyTask {
                ctx: Some(core::ptr::NonNull::new_unchecked(holder.cast::<c_void>())),
                callback: |p: *mut c_void| {
                    Holder::run(p.cast::<Holder>());
                    Ok(())
                },
            };
        }

        // SAFETY: VM-owned event loop pointer; uniquely accessed on the JS thread.
        unsafe {
            (*self.vm().event_loop()).enqueue_task(jsc::Task::init(&raw mut (*holder).task));
        }
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: adopt the JS wrapper's +1 and release it at scope end;
        // allocation may outlive this call if other refs remain, so hand
        // ownership back to the raw refcount.
        let this: &Self = bun_core::heap::release(self);
        // SAFETY: the JS wrapper owned one ref; this scope consumes it.
        let _guard = unsafe { ScopedRef::adopt(this.as_ctx_ptr()) };

        this.stop_timers();
        this.this_value.with_mut(|t| t.finalize());
        this.client_mut().flags.finalized = true;
        this.close_socket_next_tick();
        // `_subscription_ctx` is an inline `Option<SavedFlags>` (no allocation,
        // no GC ref); nothing to release. `update_poll_ref()` gates on the JS
        // handler map, not this flag.
    }

    pub fn stop_timers(&self) {
        // Use safe timer removal methods to ensure proper reference counting
        if self.timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.timer);
        }
        if self.reconnect_timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.reconnect_timer);
        }
    }

    fn connect(&self) -> Result<(), crate::Error> {
        self.client_mut().flags.needs_to_open_socket = false;

        let _guard = self.ref_scope();

        // Socket keep-alive ref, released by on_valkey_close/on_valkey_reconnect.
        // Taken before the TLS-context check so the `tls_ctx_failed` branch's
        // `on_valkey_close()` has a ref to consume instead of over-releasing.
        // Forgotten on success (the socket adopts it).
        let socket_ref = self.ref_scope();

        let is_tls = !self.client.get().tls.is_none();
        // `vm.rare_data()` needs `&mut VirtualMachine`; `client.vm`
        // is `&'static`. Cast through raw — the per-thread VM is single-owner
        // on the JS thread, and `valkey_group` only touches the embedded
        // `SocketGroup` field + `vm.uws_loop()` (disjoint from anything we
        // hold). Same pattern as `Bun__RareData__postgresGroup`.
        let vm_ptr = std::ptr::from_ref::<VirtualMachine>(self.client.get().vm).cast_mut();
        // SAFETY: per-thread VM, accessed from the JS thread; `rare_data()`
        // lazy-inits the box.
        let group: *mut uws::SocketGroup = unsafe {
            let rare = std::ptr::from_mut::<jsc::rare_data::RareData>((*vm_ptr).rare_data());
            if is_tls {
                (*rare).valkey_group::<true>(&*vm_ptr)
            } else {
                (*rare).valkey_group::<false>(&*vm_ptr)
            }
        };

        // Populate `_secure` first, then handle the failure branch outside the
        // borrow of `self.client.tls`.
        let mut tls_err = uws::create_bun_socket_error_t::none;
        let tls_ctx_failed = if let valkey::TLS::Custom(ref custom) = self.client.get().tls {
            // Reuse across reconnect — the SSL_CTX is the only thing the
            // old `_socket_ctx` cache existed to preserve.
            if self._secure.get().is_none() {
                // Per-VM weak cache: a `duplicate()`'d client (or any
                // other client with the same config) hits the same
                // `SSL_CTX*` instead of rebuilding.
                let state = crate::jsc_hooks::runtime_state();
                debug_assert!(!state.is_null(), "RuntimeState not installed");
                // SAFETY: per-thread `RuntimeState`; `ssl_ctx_cache` has a
                // stable address for the VM's lifetime, JS-thread-only.
                let cache = unsafe { &mut (*state).ssl_ctx_cache };
                // SAFETY: `get_or_create` returns a +1-ref `SSL_CTX*` (or null).
                self._secure.set(
                    cache
                        .get_or_create(custom, &mut tls_err)
                        .and_then(|p| unsafe { boringssl::c::OwnedSslCtx::from_raw(p) }),
                );
            }
            self._secure.get().is_none()
        } else {
            false
        };
        if tls_ctx_failed {
            self.client_mut().flags.enable_auto_reconnect = false;
            // JS-side failures here are reported, not `?`-propagated: callers
            // treat `Err` from `connect()` as a socket-connect syscall failure.
            if let Err(e) = self.fail_fmt(
                protocol::RedisError::ConnectionClosed,
                format_args!("Failed to create TLS context ({:?})", tls_err),
            ) {
                self.global_object.report_active_exception_as_unhandled(e);
            }
            // `on_valkey_close()` consumes the socket ref; hand it over so it
            // isn't released twice.
            socket_ref.forget();
            if let Err(e) = self.on_valkey_close() {
                self.global_object.report_active_exception_as_unhandled(e);
            }
            self.client_mut().status = valkey::Status::Disconnected;
            return Ok(());
        }
        let ssl_ctx: Option<*mut uws::SslCtx> = match &self.client.get().tls {
            valkey::TLS::None => None,
            valkey::TLS::Enabled => {
                // SAFETY: `vm_ptr` is the live per-thread VM (see above).
                Some(unsafe { crate::jsc_hooks::default_client_ssl_ctx(vm_ptr) })
            }
            valkey::TLS::Custom(_) => Some(self._secure.get().as_ref().unwrap().as_ptr()),
        };

        self.client_mut().status = valkey::Status::Connecting;
        self.update_poll_ref();
        let errdefer_status = scopeguard::guard(BackRef::new(self), |p| {
            p.client_mut().status = valkey::Status::Disconnected;
            p.update_poll_ref();
        });
        // The socket ext slot is typed `ExtSlot<JSValkeyClient>`
        // (uws_handlers.rs `Valkey<SSL> = NsHandler<JSValkeyClient, …>`); store
        // the OUTER pointer, not the inner `ValkeyClient`, or dispatch will
        // mis-type and re-offset it (`on_open` → `this.client_mut()` adds
        // `offsetof(JSValkeyClient, client)` again → garbage `&mut ValkeyClient`).
        // Reshaped for borrowck — `address` is a field of `client`; go through a
        // raw pointer. `Address::connect` only reads host/path bytes and forwards
        // `owner_ptr` opaquely (no overlapping write).
        let owner_ptr: *mut JSValkeyClient = std::ptr::from_ref::<JSValkeyClient>(self).cast_mut();
        let client_ptr: *mut valkey::ValkeyClient = self.client.as_ptr();
        // SAFETY: `client_ptr` is live; `group` is the lazy-initialised per-VM
        // `SocketGroup` (stable for the VM's lifetime). `ssl_ctx` is a +1-ref
        // BoringSSL `SSL_CTX*` (or None) forwarded opaquely to usockets.
        let socket = unsafe {
            (*client_ptr)
                .address
                .connect(owner_ptr, &mut *group, ssl_ctx, is_tls)
        }?;
        self.client_mut().socket = socket;
        // Disarm on success: the socket now owns the keep-alive ref.
        scopeguard::ScopeGuard::into_inner(errdefer_status);
        socket_ref.forget();
        Ok(())
    }

    pub fn send(
        &self,
        global_this: &JSGlobalObject,
        command: &Command,
    ) -> Result<*mut JSPromise, protocol::RedisError> {
        // Keep `*self` alive across re-entrant connect/close paths below;
        // the host-fn shim passes a bare `&self` with no ref of its own.
        let _guard = self.ref_scope();

        if self.client.get().flags.needs_to_open_socket {
            bun_core::hint::cold();

            if let Err(err) = self.connect() {
                self.client_mut().flags.needs_to_open_socket = true;
                let err_value = global_this
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!(" {} connecting to Valkey", err.name()),
                    )
                    .to_js();
                let promise = JSPromise::create(global_this);
                let _exit = self.vm().enter_event_loop_scope();
                let _ = promise.reject(global_this, Ok(err_value));
                return Ok(promise);
            }
            self.reset_connection_timeout();
        }

        let self_br = BackRef::new(self);
        let _update = scopeguard::guard(self_br, |p| p.update_poll_ref());
        self.client_mut().send(global_this, command)
    }

    // Getter for memory cost - useful for diagnostics
    pub fn memory_cost(&self) -> usize {
        // TODO(markovejnovic): This is most-likely wrong because I didn't know better.
        let client = self.client.get();
        let mut memory_cost: usize = core::mem::size_of::<JSValkeyClient>();

        // Add size of all internal buffers
        memory_cost += client.write_buffer.byte_list.capacity() as usize;
        memory_cost += client.read_buffer.byte_list.capacity() as usize;

        // Add queue sizes
        memory_cost += client.in_flight.readable_length()
            * core::mem::size_of::<super::command::Promise>();
        for command in super::command::iter_entries(&client.queue) {
            memory_cost += command.serialized_data.len();
        }
        memory_cost +=
            client.queue.readable_length() * core::mem::size_of::<super::command::Entry>();
        memory_cost
    }

    // Called by RefCounted::destructor when ref_count hits 0.
    unsafe fn deinit(this: *mut JSValkeyClient) {
        // SAFETY: last ref dropped; exclusive access. The shared borrow is
        // scoped so it ends before we reclaim the Box below — the final
        // `heap::take` must consume the original `*mut` (which carries the
        // allocation's Unique provenance from `Box::into_raw`), not a
        // pointer re-derived from `&Self` (SharedReadOnly under Stacked
        // Borrows, which would make the dealloc-write UB).
        {
            // SAFETY: last ref dropped — sole owner of `*this` (see above).
            let this_ref = unsafe { &*this };
            debug_assert!(this_ref.client.get().socket.is_closed());
            this_ref.client_mut().shutdown(None);
            this_ref.poll_ref.with_mut(|r| r.disable());
            this_ref.stop_timers();
            this_ref.ref_count.assert_no_refs();
        }

        // bun.destroy(this) → reclaim the Box allocated in `new()`.
        // SAFETY: `this` was created via `heap::alloc` in `new()`; the shared
        // borrow above has ended, and `this` is the original raw pointer with
        // its Box-derived write provenance intact.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Flush any buffered outbound writes, then re-evaluate event-loop keep-alive.
    #[inline]
    fn flush_and_update_poll_ref(&self) {
        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    /// Keep the event loop alive, or don't keep it alive
    ///
    /// This requires this_value to be alive.
    pub fn update_poll_ref(&self) {
        // TODO(markovejnovic): This function is such a crazy cop out. We really
        // should be treating valkey as a state machine, with well-defined
        // state and modes in which it tracks and manages its own lifecycle.
        // This is a mess beyond belief and it is incredibly fragile.
        let has_pending_commands = self.client.get().has_any_pending_commands();

        let subs_deletable = !self
            ._subscription_ctx
            .get()
            .has_subscriptions(&self.global_object);

        let has_activity =
            has_pending_commands || !subs_deletable || self.client.get().flags.is_reconnecting;

        // There's a couple cases to handle here:
        if has_activity || self.client.get().status == valkey::Status::Connecting {
            // If we currently have pending activity or we are connecting, we need to keep the
            // event loop alive.
            self.poll_ref.with_mut(|r| r.ref_(vm_event_loop_ctx()));
        } else {
            // There is no pending activity so it is safe to remove the event loop.
            self.poll_ref.with_mut(|r| r.unref(vm_event_loop_ctx()));
        }

        if self.this_value.get().is_empty() {
            return;
        }

        // Orthogonal to this, we need to manage the strong reference to the JS object.
        match self.client.get().status {
            valkey::Status::Connecting | valkey::Status::Connected => {
                // Whenever we're connected, we need to keep the object alive.
                //
                // TODO(markovejnovic): This is a leak.
                // Note this is an intentional leak. Unless the user manually
                // closes the connection, the object will stay alive forever,
                // even if it falls out of scope. This is kind of stupid, since
                // if the object is out of scope, and isn't subscribed upon,
                // how exactly is the user going to call anything on the object?
                //
                // It is 100% safe to drop the strong reference there and let
                // the object be GC'd, but we're not doing that now.
                debug!("upgrading this_value since we are connected/connecting");
                self.this_value.with_mut(|t| t.upgrade(&self.global_object));
            }
            valkey::Status::Disconnected => {
                // If we're disconnected, we need to check if we have any pending activity.
                if has_activity {
                    debug!("upgrading this_value since there is pending activity");
                    // If we have pending activity, we need to keep the object alive.
                    self.this_value.with_mut(|t| t.upgrade(&self.global_object));
                } else {
                    debug!("downgrading this_value since there is no pending activity");
                    // If we don't have any pending activity, we can drop the strong reference.
                    self.this_value.with_mut(|t| t.downgrade());
                }
            }
        }
    }
}

// The ~160 command host-fns are inherent
// methods on `JSValkeyClient` via the `impl JSValkeyClient` block in
// `js_valkey_functions.rs`, so no re-export is needed (and `pub use` of impl
// methods is not legal Rust). Keep `fns` referenced so the sibling module is
// linked into the build.

// ───────────────────────────────────────────────────────────────────────────
// SocketHandler
// ───────────────────────────────────────────────────────────────────────────

/// uWS socket-event handler for the Valkey client (kind = `.valkey[_tls]`).
pub struct SocketHandler<const SSL: bool>;

// Inherent associated types are unstable in Rust, so use a module-level alias
// and refer to it as `SocketType<SSL>` inside the impl.
type SocketType<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn _socket(s: SocketType<SSL>) -> Socket {
        // `NewSocketHandler<SSL>` only differs by const generic; the
        // `socket` field is identical. Re-wrap the inner `InternalSocket` into
        // the right `AnySocket` variant.
        if SSL {
            Socket::SocketTls(uws::SocketTLS { socket: s.socket })
        } else {
            Socket::SocketTcp(uws::SocketTCP { socket: s.socket })
        }
    }

    pub fn on_open(this: &JSValkeyClient, socket: SocketType<SSL>) -> JsResult<()> {
        this.client_mut().socket = Self::_socket(socket);
        this.client_mut().on_open(Self::_socket(socket))
    }

    pub fn on_handshake_(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        debug!(
            "onHandshake: {} error={} reason={} code={}",
            success,
            ssl_error.error_no,
            bstr::BStr::new(
                ssl_error
                    .reason()
                    .map_or(b"no reason" as &[u8], |c| c.to_bytes())
            ),
            bstr::BStr::new(
                ssl_error
                    .code()
                    .map_or(b"no code" as &[u8], |c| c.to_bytes())
            ),
        );
        let handshake_success = success == 1;
        let _guard = this.ref_scope();
        let _update = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());
        if handshake_success {
            let vm = this.client.get().vm;
            if this.client.get().tls.reject_unauthorized(vm) {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    // Certificate chain validation failed.
                    return Self::fail_handshake_with_verify_error(this, &ssl_error);
                }

                // Certificate chain is valid; verify the hostname matches the
                // certificate. Prefer the SNI servername if one was set, otherwise
                // fall back to the host from the connection URL. Unix-domain
                // sockets have no hostname to verify, so skip the identity check
                // for redis+tls+unix:// / valkey+tls+unix:// connections.
                let ssl_ptr: *mut boringssl::c::SSL = this
                    .client
                    .get()
                    .socket
                    .get_native_handle()
                    .unwrap_or(core::ptr::null_mut())
                    .cast();
                // SAFETY: SSL_get_servername returns null or NUL-terminated.
                let mut hostname: &[u8] = if let Some(servername) =
                    unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0).as_ref() }
                {
                    // SAFETY: NUL-terminated
                    unsafe { bun_core::ffi::cstr(std::ptr::from_ref(servername).cast()) }.to_bytes()
                } else {
                    match &this.client.get().address {
                        valkey::Address::Host { host, .. } => &host[..],
                        valkey::Address::Unix(_) => b"",
                    }
                };
                // URL.host() serialises IPv6 literals with surrounding brackets
                // (e.g. "[::1]"). Strip them so checkServerIdentity can recognise
                // the value as an IP and match against IP SAN entries; this
                // mirrors what connectAnon already does before getaddrinfo.
                if hostname.len() >= 2
                    && hostname[0] == b'['
                    && hostname[hostname.len() - 1] == b']'
                {
                    hostname = &hostname[1..hostname.len() - 1];
                }
                if !hostname.is_empty()
                    // SAFETY: in the TLS handshake-success path the socket's native
                    // handle is a live `SSL*`.
                    && !boringssl::check_server_identity(unsafe { &mut *ssl_ptr }, hostname)
                {
                    let err = this
                        .global_object
                        .err(
                            jsc::ErrorCode::TLS_CERT_ALTNAME_INVALID,
                            format_args!(
                                "Hostname/IP does not match certificate's altnames: Host: {}",
                                bstr::BStr::new(hostname)
                            ),
                        )
                        .to_js();
                    return Self::fail_handshake(this, err);
                }
            }
            this.client_mut().start()?;
        } else {
            // if we are here is because the server rejected us, and the error_no is the cause of
            // this no matter if reject_unauthorized is false, because we were disconnected by the
            // server
            return Self::fail_handshake_with_verify_error(this, &ssl_error);
        }
        Ok(())
    }

    fn fail_handshake_with_verify_error(
        this: &JSValkeyClient,
        ssl_error: &uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        let ssl_js_value =
            match crate::socket::uws_jsc::verify_error_to_js(ssl_error, &this.global_object) {
                Ok(v) => v,
                Err(jsc::JsError::Terminated) => return Err(jsc::JsError::Terminated),
                Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(jsc::JsError::Thrown) => {
                    // Clear any pending exception since we can't convert it to
                    // JS, but still fail-close the connection so we never fall
                    // through to the authenticated state after a rejected
                    // handshake.
                    this.global_object.clear_exception();
                    this.client_mut().handshake = valkey::Handshake::AwaitingHello;
                    this.client_mut().flags.is_manually_closed = true;
                    this.client_mut().close();
                    return Ok(());
                }
            };
        Self::fail_handshake(this, ssl_js_value)
    }

    fn fail_handshake(this: &JSValkeyClient, err_value: JSValue) -> JsResult<()> {
        this.client_mut().handshake = valkey::Handshake::AwaitingHello;
        let _exit = this.vm().enter_event_loop_scope();
        this.client_mut().flags.is_manually_closed = true;
        let this_br = BackRef::new(this);
        let _close = scopeguard::guard(this_br, |p| p.client_mut().close());
        this.client_mut()
            .fail_with_js_value(&this.global_object, err_value)
    }

    // `pub const onHandshake = if (ssl) onHandshake_ else null;`
    pub const ON_HANDSHAKE: Option<
        fn(
            &JSValkeyClient,
            SocketType<SSL>,
            i32,
            uws::us_bun_verify_error_t,
        ) -> JsResult<()>,
    > = if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        debug!("Socket closed.");
        let _guard = this.ref_scope();
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        let _defer = scopeguard::guard(BackRef::new(this), |p| {
            p.client_mut().status = valkey::Status::Disconnected;
            p.update_poll_ref();
        });

        this.client_mut().on_close()
    }

    pub fn on_end(_this: &JSValkeyClient, _socket: SocketType<SSL>) -> JsResult<()> {
        // Half-opened sockets are not allowed.
        // usockets will always call onClose after onEnd in this case so we don't need to do
        // anything here
        Ok(())
    }

    pub fn on_connect_error(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        code: i32,
    ) -> JsResult<()> {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        let _guard = this.ref_scope();
        let _defer = scopeguard::guard(BackRef::new(this), |p| {
            p.client_mut().status = valkey::Status::Disconnected;
            p.update_poll_ref();
        });

        this.client_mut().on_connect_error(code)
    }

    pub fn on_timeout(this: &JSValkeyClient, socket: SocketType<SSL>) -> JsResult<()> {
        debug!("Socket timed out.");

        this.client_mut().socket = Self::_socket(socket);
        Ok(())
    }

    pub fn on_data(this: &JSValkeyClient, socket: SocketType<SSL>, data: &[u8]) -> JsResult<()> {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Self::_socket(socket);

        let _guard = this.ref_scope();
        let _update = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());
        this.client_mut().on_data(data)
    }

    pub fn on_writable(this: &JSValkeyClient, socket: SocketType<SSL>) -> JsResult<()> {
        this.client_mut().socket = Self::_socket(socket);
        let _guard = this.ref_scope();
        let _update = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());
        this.client_mut().on_writable();
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────

// Parse JavaScript options into Valkey client options
fn parse_valkey_options_from_js(
    global_object: &JSGlobalObject,
    options_obj: JSValue,
) -> JsResult<valkey::Options> {
    let mut this = valkey::Options::default();

    if let Some(idle_timeout) = options_obj.get_optional_int::<u32>(global_object, "idleTimeout")? {
        this.idle_timeout_ms = idle_timeout;
    }

    if let Some(connection_timeout) =
        options_obj.get_optional_int::<u32>(global_object, "connectionTimeout")?
    {
        this.connection_timeout_ms = connection_timeout;
    }

    if let Some(auto_reconnect) =
        options_obj.get_if_property_exists(global_object, "autoReconnect")?
    {
        this.enable_auto_reconnect = auto_reconnect.to_boolean();
    }

    if let Some(max_retries) = options_obj.get_optional_int::<u32>(global_object, "maxRetries")? {
        this.max_retries = max_retries;
    }

    if let Some(enable_offline_queue) =
        options_obj.get_if_property_exists(global_object, "enableOfflineQueue")?
    {
        this.enable_offline_queue = enable_offline_queue.to_boolean();
    }

    if let Some(enable_auto_pipelining) =
        options_obj.get_if_property_exists(global_object, "enableAutoPipelining")?
    {
        this.enable_auto_pipelining = enable_auto_pipelining.to_boolean();
    }

    if let Some(tls) = options_obj.get_if_property_exists(global_object, "tls")? {
        if tls.is_boolean() || tls.is_undefined_or_null() {
            this.tls = if tls.to_boolean() {
                valkey::TLS::Enabled
            } else {
                valkey::TLS::None
            };
        } else if tls.is_object() {
            // SAFETY: `bun_vm()` returns the live per-global VM pointer.
            if let Some(ssl_config) =
                SSLConfig::from_js(global_object.bun_vm(), global_object, tls)?
            {
                this.tls = valkey::TLS::Custom(Box::new(ssl_config));
            } else {
                return Err(global_object.throw_invalid_argument_type("tls", "tls", "object"));
            }
        } else {
            return Err(global_object.throw_invalid_argument_type(
                "tls",
                "tls",
                "boolean or object",
            ));
        }
    }

    Ok(this)
}

impl JSValkeyClient {
    #[inline]
    pub fn ptr_to_js(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
        Js::to_js(ptr, global)
    }
}

bun_jsc::impl_js_class_via_generated!(JSValkeyClient => crate::generated_classes::js_RedisClient);
