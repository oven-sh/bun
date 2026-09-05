use core::ffi::c_void;

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
use bun_ptr::{AsCtxPtr, BackRef, RefPtr};
use bun_uws as uws;

use super::protocol_jsc;
use super::valkey;
use super::valkey_command_body as command;
use super::valkey_command_body::Command;
use bun_jsc::url::Parsed;
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

#[derive(Default)]
pub struct SubscriptionCtx {
    pub(crate) is_subscriber: bool,
    pub(crate) original_enable_offline_queue: bool,
    pub(crate) original_enable_auto_pipelining: bool,
}

/// The generate-classes.ts output emits a
/// `js_RedisClient` module with snake-case `*_set_cached`/`*_get_cached`
/// free-fns plus `to_js`/`from_js`. Re-exported here as `Js`.
pub use crate::generated_classes::js_RedisClient as Js;

impl SubscriptionCtx {
    pub(crate) fn init(valkey_parent: &JSValkeyClient) -> JsResult<Self> {
        let callback_map = JSMap::create(&valkey_parent.global_object);
        let parent_this = valkey_parent
            .this_value
            .get()
            .try_get()
            .expect("unreachable");

        Js::subscription_callback_map_set_cached(
            parent_this,
            &valkey_parent.global_object,
            callback_map,
        );

        Ok(SubscriptionCtx {
            original_enable_offline_queue: valkey_parent.client.get().flags.enable_offline_queue,
            original_enable_auto_pipelining: valkey_parent
                .client
                .get()
                .flags
                .enable_auto_pipelining,
            is_subscriber: false,
        })
    }
}

/// The subscription bookkeeping that needs the client (its `this` value, poll
/// ref, refcount) lives on the client: `SubscriptionCtx` itself is three flags,
/// and a `&SubscriptionCtx` carries no right to reach the client around it.
impl JSValkeyClient {
    /// `None` while the wrapper is dead but unswept: `finalize()` has not run, socket callbacks still do.
    fn try_subscription_callback_map(&self) -> Option<&mut JSMap> {
        let parent_this = self.this_value.get().try_get()?;
        let value_js = Js::subscription_callback_map_get_cached(parent_this).unwrap();
        // `JSMap` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        // `from_js` returns a non-null heap cell when the slot was set by
        // `init()`; single JS thread.
        let map = JSMap::from_js(value_js).unwrap();
        Some(JSMap::opaque_mut(map.as_ptr()))
    }

    /// For callers that know the wrapper is alive: their `this`, or it has handlers and so is held.
    fn subscription_callback_map(&self) -> &mut JSMap {
        self.try_subscription_callback_map().expect("unreachable")
    }

    /// Zero once the wrapper is gone: the handlers live on it.
    pub(crate) fn channels_subscribed_to_count(&self) -> u32 {
        self.try_subscription_callback_map()
            .map_or(0, |map| map.size())
    }

    /// Whether any subscription handler is registered. Reads the JS wrapper,
    /// so it is false once the wrapper is dead or finalized.
    pub(crate) fn has_subscriptions(&self) -> bool {
        self.channels_subscribed_to_count() > 0
    }

    pub(crate) fn clear_receive_handlers(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<()> {
        let map = self.subscription_callback_map();
        let _ = map.remove(global_object, channel_name)?;
        Ok(())
    }

    pub(crate) fn clear_all_receive_handlers(
        &self,
        global_object: &JSGlobalObject,
    ) -> JsResult<()> {
        self.subscription_callback_map().clear(global_object)
    }

    /// Remove a specific receive handler.
    ///
    /// Returns: The total number of remaining handlers for this channel, or null if there were no
    /// listeners originally registered.
    ///
    /// Note: This function will empty out the map entry if there are no more handlers registered.
    pub(crate) fn remove_receive_handler(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<Option<usize>> {
        let map = self.subscription_callback_map();

        let existing = map.get(global_object, channel_name)?;
        if existing.is_undefined_or_null() {
            // Nothing to remove.
            return Ok(None);
        }

        // Existing is guaranteed to be an array of callbacks.
        debug_assert!(existing.is_array());

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
    pub(crate) fn upsert_receive_handler(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<()> {
        // `BackRef` (Copy + Deref) detaches the borrow so the guard closure is
        // safe even though intervening JS may re-enter `&self`.
        let parent_br = BackRef::new(self);
        let _guard = scopeguard::guard(parent_br, |p| {
            p.on_new_subscription_callback_insert();
        });
        let map = self.subscription_callback_map();

        let handlers_array: JSValue;
        let mut is_new_channel = false;
        let existing_handler_arr = map.get(global_object, channel_name)?;
        if existing_handler_arr != JSValue::UNDEFINED {
            debug!("Adding a new receive handler.");
            // Note that we need to cover this case because maps in JSC can return undefined when
            // the key has never been set.
            if existing_handler_arr.is_undefined() {
                // Create a new array if the existing_handler_arr is undefined/null
                handlers_array = JSArray::create_empty(global_object, 0)?;
                is_new_channel = true;
            } else if existing_handler_arr.is_array() {
                // Use the existing array
                handlers_array = existing_handler_arr;
            } else {
                unreachable!();
            }
        } else {
            // No existing_handler_arr exists, create a new array
            handlers_array = JSArray::create_empty(global_object, 0)?;
            is_new_channel = true;
        }
        let _ = is_new_channel;

        // Append the new callback to the array
        handlers_array.push(global_object, callback)?;

        // Set the updated array back in the map
        map.set(global_object, channel_name, handlers_array)?;
        Ok(())
    }

    pub(crate) fn get_callbacks(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<Option<JSValue>> {
        let result = self
            .subscription_callback_map()
            .get(global_object, channel_name)?;
        if result == JSValue::UNDEFINED {
            return Ok(None);
        }
        Ok(Some(result))
    }

    /// Invoke callbacks for a channel with the given arguments
    /// Handles both single callbacks and arrays of callbacks
    pub(crate) fn invoke_callbacks(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        args: &[JSValue],
    ) -> JsResult<()> {
        let Some(callbacks) = self.get_callbacks(global_object, channel_name)? else {
            debug!(
                "No callbacks found for channel {}",
                channel_name.to_js_string_view(global_object)?
            );
            return Ok(());
        };

        debug_assert!(callbacks.is_array());

        // Callback runs on the JS thread; VM is alive for the duration.
        let vm = VirtualMachine::get();
        let _exit = vm.enter_event_loop_scope();

        // After we go through every single callback, we will have to update the poll ref.
        // The user may, for example, unsubscribe in the callbacks, or even stop the client.
        // `BackRef` (Copy + Deref) detaches the borrow so the guard closure is
        // safe even though intervening JS may re-enter `&self`.
        let parent_br = BackRef::new(self);
        let _update = scopeguard::guard(parent_br, |p| p.update_poll_ref());

        // If callbacks is an array, iterate and call each one
        let mut iter = callbacks.array_iterator(global_object)?;
        while let Some(callback) = iter.next()? {
            debug_assert!(callback.is_callable());
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
#[derive(bun_ptr::RefCounted)]
pub struct JSValkeyClient {
    pub(crate) client: JsCell<valkey::ValkeyClient>,
    pub(crate) global_object: GlobalRef,
    pub this_value: JsCell<JsRef>,
    pub poll_ref: JsCell<KeepAlive>,

    pub(crate) _subscription_ctx: JsCell<SubscriptionCtx>,
    /// `SSL_CTX` for `tls: { …custom CA… }`. `tls: true` borrows
    /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this null.
    pub(crate) _secure: JsCell<Option<boringssl::c::OwnedSslCtx>>,

    pub(crate) timer: RefCountedTimer,
    pub(crate) reconnect_timer: RefCountedTimer,
    pub(crate) ref_count: bun_ptr::RefCount<JSValkeyClient>,
}

/// Intrusive [`EventLoopTimer`] slot that owns one strong ref on
/// [`JSValkeyClient`] (`held_ref`) while armed, so [`disarm`] and
/// [`take_fire_ref`] release it exactly once even when the
/// fire/close/reconnect paths re-enter each other.
///
/// [`EventLoopTimer`]: Timer::EventLoopTimer
/// [`disarm`]: Self::disarm
/// [`take_fire_ref`]: Self::take_fire_ref
#[repr(C)]
pub struct RefCountedTimer {
    // Must be first (offset 0): `dispatch.rs` recovers `*mut JSValkeyClient`
    // from the fired `*const EventLoopTimer` via `offset_of!(.., timer)`.
    event_loop_timer: JsCell<Timer::EventLoopTimer>,
    held_ref: JsCell<Option<RefPtr<JSValkeyClient>>>,
}

const _: () = assert!(core::mem::offset_of!(RefCountedTimer, event_loop_timer) == 0);

impl RefCountedTimer {
    fn new(tag: Timer::Tag) -> Self {
        Self {
            event_loop_timer: JsCell::new(Timer::EventLoopTimer::init_paused(tag)),
            held_ref: JsCell::new(None),
        }
    }

    #[inline]
    fn state(&self) -> Timer::State {
        self.event_loop_timer.get().state
    }

    /// Insert into the VM timer heap to fire after `ms`, taking the keep-alive
    /// ref if not already held. Disarms first if currently active.
    fn arm(&self, owner: &JSValkeyClient, ms: u32) {
        let _guard = owner.ref_guard();
        if self.state() == Timer::State::ACTIVE {
            self.disarm(owner);
        }
        if ms == 0 {
            return;
        }
        let now = bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            i64::from(ms),
        );
        self.event_loop_timer.with_mut(|t| {
            t.next = Timer::Timespec {
                sec: now.sec,
                nsec: now.nsec,
            }
        });
        let vm = std::ptr::from_ref::<VirtualMachine>(owner.client.get().vm).cast_mut();
        // SAFETY: `vm` is the live per-thread VM; the timer is an unlinked
        // field of the boxed `JSValkeyClient` (stable address until disarmed).
        unsafe {
            VirtualMachine::timer_insert(
                vm,
                core::ptr::addr_of!(self.event_loop_timer)
                    .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                    .cast_mut(),
            )
        };
        if self.held_ref.get().is_none() {
            self.held_ref.set(Some(owner.ref_guard()));
        }
    }

    /// Remove from the VM timer heap and release the keep-alive ref if held.
    fn disarm(&self, owner: &JSValkeyClient) {
        if self.state() == Timer::State::ACTIVE {
            let vm = std::ptr::from_ref::<VirtualMachine>(owner.client.get().vm).cast_mut();
            // SAFETY: `vm` is the live per-thread VM; the timer is currently
            // linked into the heap (state == ACTIVE checked above).
            unsafe { VirtualMachine::timer_remove(vm, self.event_loop_timer.as_ptr()) };
        }
        // The caller's ref keeps `owner` live past this call.
        self.held_ref.set(None);
    }

    /// Mark fired and hand the keep-alive ref (if held) to the callback scope.
    /// Returns `None` when no ref was held, so a stray fire cannot over-release.
    fn take_fire_ref(&self) -> Option<RefPtr<JSValkeyClient>> {
        self.event_loop_timer
            .with_mut(|t| t.state = Timer::State::FIRED);
        self.held_ref.take()
    }
}

bun_event_loop::impl_timer_owner!(JSValkeyClient;
    from_timer_ptr => timer,
    from_reconnect_timer_ptr => reconnect_timer,
);

// `Js` (= `jsc.Codegen.JSRedisClient`) is re-exported above; `to_js`/`from_js`
// live in that generated module.

impl Drop for JSValkeyClient {
    fn drop(&mut self) {
        debug_assert!(self.client.get().socket.is_closed());
        debug_assert!(self.timer.held_ref.get().is_none());
        debug_assert!(self.reconnect_timer.held_ref.get().is_none());
        self.client_mut().shutdown(None);
        self.poll_ref.with_mut(|r| r.disable());
        self.stop_timers();
        self.ref_count.assert_no_refs();
    }
}

impl JSValkeyClient {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }
    #[inline]
    pub(crate) fn new(init: JSValkeyClient) -> *mut JSValkeyClient {
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
    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        js_this: JSValue,
    ) -> JsResult<*mut JSValkeyClient> {
        Self::create(global_object, callframe.arguments(), js_this)
    }

    /// Create a Valkey client that does not have an associated JS object nor a SubscriptionCtx.
    ///
    /// This whole client needs a refactor.
    pub(crate) fn create_no_js_no_pubsub(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
    ) -> JsResult<*mut JSValkeyClient> {
        let global_object = GlobalRef::from(global_object);
        let vm: &'static VirtualMachine = global_object.bun_vm();
        let vm_ref = vm;

        let url_str = if arguments.len() >= 1 && !arguments[0].is_undefined_or_null() {
            arguments[0].to_bun_string(&global_object)?
        } else {
            let env = vm_ref.env_loader();
            match env.get(b"REDIS_URL").or_else(|| env.get(b"VALKEY_URL")) {
                Some(url) => BunString::borrow_utf8(url),
                None => BunString::static_("valkey://localhost:6379"),
            }
        };
        let mut fallback_url_buf = [0u8; 2048];

        // Parse and validate the URL using `Parsed::from_utf8`, which returns null for invalid URLs
        // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
        // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
        // the case right now and I do not understand why. It will take some work in JSC to
        // understand why this is happening, but since I need to uncork valkey, I'm adding this as
        // a stop-gap.
        let parsed_url = 'get_url: {
            let url_slice = url_str.to_utf8();
            let url_byte_slice = url_slice.slice();

            if url_byte_slice.is_empty() {
                return Err(
                    global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                );
            }

            if strings::contains(url_byte_slice, b"://") {
                break 'get_url match Parsed::from_utf8(url_byte_slice) {
                    Some(u) => u,
                    None => {
                        return Err(global_object
                            .throw_invalid_arguments(format_args!("Invalid URL format")));
                    }
                };
            }

            let corrected_url = 'get_url_slice: {
                use std::io::Write;
                let mut cursor = &mut fallback_url_buf[..];
                let start_len = cursor.len();
                // No NUL terminator needed here — we immediately re-parse via fromUTF8.
                if write!(&mut cursor, "valkey://").is_err()
                    || cursor.write_all(url_byte_slice).is_err()
                {
                    return Err(
                        global_object.throw_invalid_arguments(format_args!("URL is too long."))
                    );
                }
                let written = start_len - cursor.len();
                break 'get_url_slice &fallback_url_buf[..written];
            };

            match Parsed::from_utf8(corrected_url) {
                Some(u) => u,
                None => {
                    return Err(
                        global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                    );
                }
            }
        };

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
        let hostname_slice: &[u8] = match uri {
            valkey::Protocol::StandaloneTls | valkey::Protocol::Standalone => hostname_utf8.slice(),
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                // For unix sockets, the path is in the pathname
                if pathname_utf8.slice().is_empty() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Expected unix socket path after valkey+unix:// or valkey+tls+unix://",
                    )));
                }
                pathname_utf8.slice()
            }
        };

        let port: u16 = match uri {
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => 0,
            _ => 'brk: {
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

        let options = if arguments.len() >= 2
            && !arguments[1].is_undefined_or_null()
            && arguments[1].is_object()
        {
            Options::from_js(&global_object, arguments[1])?
        } else {
            valkey::Options::default()
        };

        // Copy strings into a persistent buffer since the URL object will be deinitialized
        let mut connection_strings: Box<[u8]> = Box::default();
        let mut username: Box<[u8]> = Box::default();
        let mut password: Box<[u8]> = Box::default();
        let mut hostname: Box<[u8]> = Box::default();

        // errdefer free(connection_strings) — handled by Box drop on `?`.

        if !username_utf8.slice().is_empty()
            || !password_utf8.slice().is_empty()
            || !hostname_slice.is_empty()
        {
            let mut b = bun_core::StringBuilder::default();
            b.count(username_utf8.slice());
            b.count(password_utf8.slice());
            b.count(hostname_slice);
            b.allocate()?;
            let user_sp = b.append_count(username_utf8.slice());
            let pass_sp = b.append_count(password_utf8.slice());
            let host_sp = b.append_count(hostname_slice);
            connection_strings = b.move_to_slice();
            // `ValkeyClient` owns each field as an independent
            // `Box<[u8]>`, so re-slice from the pointers.
            username = Box::<[u8]>::from(user_sp.slice(&connection_strings));
            password = Box::<[u8]>::from(pass_sp.slice(&connection_strings));
            hostname = Box::<[u8]>::from(host_sp.slice(&connection_strings));
        }

        // Parse database number from pathname (e.g., "/1" -> database 1)
        let database: u32 = match uri {
            // For unix sockets the pathname is the socket path, not a db index.
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => 0,
            _ => {
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
            }
        };

        bun_core::analytics::Features::VALKEY.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        // `_subscription_ctx` is a placeholder here; properly initialized later by `create()`.
        Ok(JSValkeyClient::new(JSValkeyClient {
            ref_count: bun_ptr::RefCount::init(),
            _subscription_ctx: JsCell::new(SubscriptionCtx::default()),
            client: JsCell::new(valkey::ValkeyClient {
                vm,
                address: match uri {
                    valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                        valkey::Address::Unix(hostname)
                    }
                    _ => valkey::Address::Host {
                        host: hostname,
                        port,
                    },
                },
                protocol: uri,
                username,
                password,
                in_flight: command::promise_pair::Queue::new(),
                queue: command::entry::Queue::new(),
                status: valkey::Status::NeverConnected,
                connection_strings,
                socket: Socket::SocketTcp(uws::SocketTCP {
                    socket: uws::InternalSocket::Detached,
                }),
                tls: if options.tls != valkey::TLS::None {
                    options.tls
                } else if uri.is_tls() {
                    valkey::TLS::Enabled
                } else {
                    valkey::TLS::None
                },
                database,
                flags: valkey::ConnectionFlags {
                    enable_auto_reconnect: options.enable_auto_reconnect,
                    enable_offline_queue: options.enable_offline_queue,
                    enable_auto_pipelining: options.enable_auto_pipelining,
                    ..Default::default()
                },
                max_retries: options.max_retries,
                connection_timeout_ms: options.connection_timeout_ms,
                idle_timeout_interval_ms: options.idle_timeout_ms,
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
            timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionTimeout),
            reconnect_timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionReconnect),
        }))
    }

    pub(crate) fn create(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        js_this: JSValue,
    ) -> JsResult<*mut JSValkeyClient> {
        let new_client_ptr = JSValkeyClient::create_no_js_no_pubsub(global_object, arguments)?;
        // SAFETY: just allocated above
        let new_client = unsafe { &*new_client_ptr };

        // Initially, we only need to hold a weak reference to the JS object.
        new_client.this_value.set(JsRef::init_weak(js_this));

        // Need to associate the subscription context, after the JS ref has been populated.
        new_client
            ._subscription_ctx
            .set(SubscriptionCtx::init(new_client)?);

        Ok(new_client_ptr)
    }

    /// Clone this client while remaining in the initial disconnected state.
    ///
    /// Note that this does not create an object with an associated this_value.
    /// You may need to populate it yourself.
    pub(crate) fn clone_without_connecting(
        &self,
        global_object: &JSGlobalObject,
    ) -> Result<*mut JSValkeyClient, bun_alloc::AllocError> {
        let global_object = GlobalRef::from(global_object);
        let vm: &'static VirtualMachine = global_object.bun_vm();

        let client = self.client.get();
        let sub_ctx = self._subscription_ctx.get();

        // `ValkeyClient` (see valkey.rs:290-299) owns `username`/`password`/
        // `address.hostname` as independent `Box<[u8]>`s rather than sub-slices
        // of the single `connection_strings` allocation, so rebase arithmetic
        // against `connection_strings` would compute a garbage offset and read
        // OOB. Clone each owned buffer directly.
        let connection_strings_copy: Box<[u8]> = Box::<[u8]>::from(&client.connection_strings[..]);
        let username: Box<[u8]> = Box::<[u8]>::from(&client.username[..]);
        let password: Box<[u8]> = Box::<[u8]>::from(&client.password[..]);
        let hostname: Box<[u8]> = Box::<[u8]>::from(client.address.hostname());
        // TODO: we could ref count it instead of cloning it
        let tls: valkey::TLS = match &client.tls {
            valkey::TLS::None => valkey::TLS::None,
            valkey::TLS::Enabled => valkey::TLS::Enabled,
            valkey::TLS::Custom(cfg) => valkey::TLS::Custom(cfg.clone()),
        };

        Ok(JSValkeyClient::new(JSValkeyClient {
            ref_count: bun_ptr::RefCount::init(),
            _subscription_ctx: JsCell::new(SubscriptionCtx::default()),
            client: JsCell::new(valkey::ValkeyClient {
                vm,
                address: match client.protocol {
                    valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                        valkey::Address::Unix(hostname)
                    }
                    _ => valkey::Address::Host {
                        host: hostname,
                        port: match &client.address {
                            valkey::Address::Host { port, .. } => *port,
                            valkey::Address::Unix(_) => unreachable!(),
                        },
                    },
                },
                protocol: client.protocol,
                username,
                password,
                in_flight: command::promise_pair::Queue::new(),
                queue: command::entry::Queue::new(),
                status: valkey::Status::NeverConnected,
                connection_strings: connection_strings_copy,
                socket: Socket::SocketTcp(uws::SocketTCP {
                    socket: uws::InternalSocket::Detached,
                }),
                tls,
                database: client.database,
                flags: valkey::ConnectionFlags {
                    enable_offline_queue: if sub_ctx.is_subscriber {
                        sub_ctx.original_enable_offline_queue
                    } else {
                        client.flags.enable_offline_queue
                    },
                    enable_auto_reconnect: client.flags.enable_auto_reconnect,
                    is_reconnecting: false,
                    enable_auto_pipelining: if sub_ctx.is_subscriber {
                        sub_ctx.original_enable_auto_pipelining
                    } else {
                        client.flags.enable_auto_pipelining
                    },
                    ..Default::default()
                },
                max_retries: client.max_retries,
                connection_timeout_ms: client.connection_timeout_ms,
                idle_timeout_interval_ms: client.idle_timeout_interval_ms,
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
            timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionTimeout),
            reconnect_timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionReconnect),
        }))
    }

    pub(crate) fn add_subscription(&self) {
        debug!(
            "addSubscription: entering, current subscriber state: {}",
            self._subscription_ctx.get().is_subscriber
        );
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        let _guard = self.ref_guard();

        if !self._subscription_ctx.get().is_subscriber {
            let flags = &self.client.get().flags;
            let (q, p) = (flags.enable_offline_queue, flags.enable_auto_pipelining);
            self._subscription_ctx.with_mut(|s| {
                s.original_enable_offline_queue = q;
                s.original_enable_auto_pipelining = p;
            });
            debug!("addSubscription: calling updatePollRef");
            self.update_poll_ref();
        }

        self._subscription_ctx.with_mut(|s| s.is_subscriber = true);
        debug!(
            "addSubscription: exiting, new subscriber state: {}",
            self._subscription_ctx.get().is_subscriber
        );
    }

    pub(crate) fn remove_subscription(&self) {
        debug!(
            "removeSubscription: entering, has subscriptions: {}",
            self.has_subscriptions()
        );
        let _guard = self.ref_guard();

        // This is the last subscription, restore original flags
        if !self.has_subscriptions() {
            let (q, p) = {
                let s = self._subscription_ctx.get();
                (
                    s.original_enable_offline_queue,
                    s.original_enable_auto_pipelining,
                )
            };
            self.client_mut().flags.enable_offline_queue = q;
            self.client_mut().flags.enable_auto_pipelining = p;
            self._subscription_ctx.with_mut(|s| s.is_subscriber = false);
            debug!("removeSubscription: calling updatePollRef");
            self.update_poll_ref();
        }
        debug!("removeSubscription: exiting");
    }

    pub(crate) fn is_subscriber(&self) -> bool {
        self._subscription_ctx.get().is_subscriber
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_connected(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.client.get().status == valkey::Status::Connected)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let client = self.client.get();
        let len = client.write_buffer.len() + client.read_buffer.len();
        JSValue::js_number(f64::from(len))
    }

    pub(crate) fn do_connect(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let _guard = self.ref_guard();

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

        if self.client.get().status == valkey::Status::NeverConnected {
            self.poll_ref.with_mut(|r| r.ref_(vm_event_loop_ctx()));

            if let Err(err) = self.connect() {
                debug!(
                    "first dial failed before a socket was opened: {}",
                    err.name()
                );
                // Settled by the deferred close like a refused dial: the
                // promise, onclose and the retry policy all go through on_close().
                self.close_without_socket_next_tick();
                return Ok(promise);
            }

            self.reset_connection_timeout();
            return Ok(promise);
        }

        match self.client.get().status {
            valkey::Status::Disconnected => {
                self.client_mut().flags.is_reconnecting = true;
                self.client_mut().retry_attempts = 0;
                self.reconnect()?;
            }
            _ => {}
        }

        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn js_connect(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.do_connect(global_object, callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn js_disconnect(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // `disconnect()` -> `close()` can dispatch `on_close` synchronously,
        // which derefs. Hold a ref so `&self` stays live across the call.
        let _guard = self.ref_guard();

        match self.client.get().status {
            valkey::Status::NeverConnected => return Ok(JSValue::UNDEFINED),
            valkey::Status::Disconnected if !self.client.get().flags.is_reconnecting => {
                return Ok(JSValue::UNDEFINED);
            }
            _ => {}
        }
        self.client_mut().disconnect()?;
        Ok(JSValue::UNDEFINED)
    }

    /// Cancels the retry a `Disconnected` client is waiting on and runs the
    /// close path for it, since no socket exists to dispatch a close event.
    pub(crate) fn cancel_reconnect(&self) -> JsResult<()> {
        debug_assert!(self.client.get().status == valkey::Status::Disconnected);
        // The timer's ref goes back with the disarm; there is no socket ref
        // to give back (`connect()` forgets it only once it has a socket) and
        // `on_valkey_close` adopts none. The caller's scoped ref covers the
        // call.
        self.reconnect_timer.disarm(self);
        self.client_mut().on_close()
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

    fn reset_connection_timeout(&self) {
        self.timer
            .arm(self, self.client.get().get_timeout_interval());
    }

    pub(crate) fn on_connection_timeout(&self) -> JsResult<()> {
        debug!("onConnectionTimeout");

        let _guard = self.ref_guard();
        let _timer_ref = self.timer.take_fire_ref();
        if self.client.get().flags.failed {
            return Ok(());
        }

        if self.client.get().get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return Ok(());
        }

        let mut buf = [0u8; 128];
        match self.client.get().status {
            valkey::Status::Connected => {
                use std::io::Write;
                let mut cur = &mut buf[..];
                let start = cur.len();
                write!(
                    &mut cur,
                    "Idle timeout reached after {}ms",
                    self.client.get().idle_timeout_interval_ms
                )
                .expect("unreachable");
                let len = start - cur.len();
                let msg = &buf[..len];
                self.client_fail(msg, protocol::RedisError::IdleTimeout)
            }
            valkey::Status::NeverConnected
            | valkey::Status::Disconnected
            | valkey::Status::Connecting => {
                use std::io::Write;
                let mut cur = &mut buf[..];
                let start = cur.len();
                write!(
                    &mut cur,
                    "Connection timeout reached after {}ms",
                    self.client.get().connection_timeout_ms
                )
                .expect("unreachable");
                let len = start - cur.len();
                let msg = &buf[..len];
                self.client_fail(msg, protocol::RedisError::ConnectionTimeout)
            }
        }
    }

    /// Runs `ValkeyClient::on_close()` for a dial that failed before there was
    /// a socket, so the connect() promise, `onclose`, the retry policy and the
    /// poll ref are handled as for a dial that failed asynchronously. Deferred
    /// because `onclose` may call connect(), and a dial that fails the same way
    /// from in there would otherwise re-enter `on_close()` on the same stack.
    ///
    /// Until the task runs the client is `Connecting`, as it would be with a
    /// dial in flight: JS that runs in between (timers due in the same tick,
    /// or the caller of connect() or of the command that dialled) then gets
    /// the cached promise from connect() instead of a second dial, has its
    /// commands queued for the retry or the rejection, and a disconnect()
    /// marks the close as manual for the task to honour. `update_poll_ref`
    /// keeps the wrapper and the event loop alive for it like a dial would.
    fn close_without_socket_next_tick(&self) {
        self.client_mut().status = valkey::Status::Connecting;
        self.update_poll_ref();
        self.enqueue_deferred_close(DeferredClose::WithoutSocket);
    }

    fn enqueue_deferred_close(&self, what: DeferredClose) {
        let task = jsc::Task::from_boxed(Box::new(ValkeyDeferredClose {
            ctx: self.ref_guard(),
            what,
        }));
        // SAFETY: VM-owned event loop pointer; uniquely accessed on the JS thread.
        unsafe {
            (*self.vm().event_loop()).enqueue_task(task);
        }
    }

    pub(crate) fn on_reconnect_timer(&self) -> JsResult<()> {
        debug!("Reconnect timer fired, attempting to reconnect");

        let _guard = self.ref_guard();
        let _timer_ref = self.reconnect_timer.take_fire_ref();

        // Execute reconnection logic
        self.reconnect()
    }

    pub(crate) fn reconnect(&self) -> JsResult<()> {
        // Whether the retry timer fired or connect() got here first, this is
        // the one dial: a retry still armed would open a second socket.
        self.reconnect_timer.disarm(self);
        if !self.client.get().flags.is_reconnecting {
            return Ok(());
        }
        // A dial (or the deferred close of one that failed outright) is
        // already in flight and owns the retry policy from here.
        if self.client.get().status != valkey::Status::Disconnected
            || !self.client.get().socket.is_closed()
        {
            return Ok(());
        }

        // No reconnecting on a VM that is exiting: its stop phase would only
        // have to close the new socket again.
        if self.vm().is_shutting_down() {
            bun_core::hint::cold();
            return Ok(());
        }

        // Ref to keep this alive during the reconnection
        let _guard = self.ref_guard();

        // Ref the poll to keep event loop alive during connection
        self.poll_ref.with_mut(|r| {
            r.disable();
            *r = KeepAlive::default();
            r.ref_(vm_event_loop_ctx());
        });

        if let Err(err) = self.connect() {
            debug!(
                "reconnect failed before a socket was opened: {}",
                err.name()
            );
            // Same outcome as a dial that fails asynchronously: another retry,
            // or fail() and a settled connect() promise once retries are used up.
            self.close_without_socket_next_tick();
            return Ok(());
        }

        // Reset the socket timeout
        self.reset_connection_timeout();
        Ok(())
    }

    // Callback for when Valkey client connects
    pub(crate) fn on_valkey_connect(&self, value: &mut protocol::RESPValue) -> JsResult<()> {
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        // we should always have a strong reference to the object here
        debug_assert!(self.this_value.get().is_strong());
        // Now counting idle time, not connect time.
        self.reset_connection_timeout();

        let self_ptr = self.as_ctx_ptr();
        let _defer = scopeguard::guard(self_ptr, |p| {
            // SAFETY: `p` was `self.as_ctx_ptr()` at guard creation; the caller
            // holds an intrusive ref across this scope so `*p` is live here.
            unsafe {
                (*p).client_mut().on_writable();
                (*p).update_poll_ref();
            }
        });
        let global_object = self.global_object;
        let _exit = self.vm().enter_event_loop_scope();

        if let Some(this_value) = self.this_value.get().try_get() {
            let hello_value = match protocol_jsc::resp_value_to_js(value, &global_object) {
                Ok(v) => v,
                // The HELLO reply did not convert: that is this connect's failure (a stop just
                // unwinds; the socket entry stands down). Reject the connection promise with the
                // error, then fail and close the connection as a failed handshake does, so the
                // client's state matches the rejected promise.
                Err(err) if global_object.has_pending_termination_exception() => return Err(err),
                Err(err) => {
                    let error = global_object.take_exception(err);
                    let client = self.client_mut();
                    client.flags.connection_promise_returns_client = false;
                    let rejected = match Js::connection_promise_get_cached(this_value) {
                        Some(promise) => {
                            Js::connection_promise_set_cached(
                                this_value,
                                &global_object,
                                JSValue::ZERO,
                            );
                            JSPromise::opaque_mut(promise.as_promise().unwrap())
                                .reject(&global_object, Ok(error))
                        }
                        None => Ok(()),
                    };
                    // `fail_with_js_value` closes the socket itself; a second close here would
                    // hit whatever a connect() from `onclose` just opened.
                    return match rejected {
                        Ok(()) => client.fail_with_js_value(&global_object, error),
                        Err(_) => {
                            client.flags.is_manually_closed = true;
                            let closed = client.close(uws::CloseCode::Failure);
                            rejected.and(closed)
                        }
                    };
                }
            };
            Js::hello_set_cached(this_value, &global_object, hello_value);
            // Call onConnect callback if defined by the user
            if let Some(on_connect) =
                Js::onconnect_get_cached(this_value).filter(|cb| cb.is_callable())
            {
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
    pub(crate) fn on_new_subscription_callback_insert(&self) {
        let _guard = self.ref_guard();

        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    pub(crate) fn on_valkey_subscribe(&self, value: &mut protocol::RESPValue) {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        let _guard = self.ref_guard();

        let _ = value;

        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    pub(crate) fn on_valkey_unsubscribe(&self) -> JsResult<()> {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        self.client_mut().on_writable();
        self.update_poll_ref();
        Ok(())
    }

    pub(crate) fn on_valkey_message(&self, value: &mut [protocol::RESPValue]) {
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
        let Ok(channel_value) = protocol_jsc::resp_value_to_js(&mut value[0], &global_object)
        else {
            debug!("Failed to convert channel to JS");
            return;
        };
        let Ok(message_value) = protocol_jsc::resp_value_to_js(&mut value[1], &global_object)
        else {
            debug!("Failed to convert message to JS");
            return;
        };

        // Invoke callbacks for this channel with message and channel as arguments
        if self
            .invoke_callbacks(
                &global_object,
                channel_value,
                &[message_value, channel_value],
            )
            .is_err()
        {
            return;
        }

        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    // Callback for when Valkey client needs to reconnect
    pub(crate) fn on_valkey_reconnect(&self) {
        // This timer was bounding the attempt that just ended; left armed it
        // fires during the retry delay, and `fail()` then has no socket to
        // close and nothing settles connect(). `reconnect()` arms a new one.
        self.timer.disarm(self);
        self.reconnect_timer
            .arm(self, self.client.get().get_reconnect_delay());
    }

    // Callback for when Valkey client closes
    pub(crate) fn on_valkey_close(&self) -> JsResult<()> {
        let global_object = self.global_object;
        let _defer = scopeguard::guard(BackRef::new(self), |p| p.update_poll_ref());

        // Bounded the attempt that just ended; a dial that fails outright
        // arms no timer of its own, so left armed this one would fire into it.
        self.timer.disarm(self);

        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return Ok(());
        };
        this_jsvalue.ensure_still_alive();
        if global_object.has_exception() {
            // Already unwinding an exception (a caller's, or the worker's termination): it keeps
            // propagating; `onclose` cannot be entered on top of it.
            return Err(bun_jsc::JsError::Thrown);
        }

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
        if let Some(on_close) = Js::onclose_get_cached(this_jsvalue).filter(|cb| cb.is_callable()) {
            on_close.call(&global_object, this_jsvalue, &[error_value])?;
        }
        Ok(())
    }

    // Callback for when Valkey client times out

    pub(crate) fn client_fail(&self, message: &[u8], err: protocol::RedisError) -> JsResult<()> {
        self.client_mut().fail(message, err)
    }

    fn close_socket_next_tick(&self) {
        if self.client.get().socket.is_closed() {
            return;
        }

        // socket close can potentially call JS so we need to enqueue the deinit
        self.enqueue_deferred_close(DeferredClose::Socket);
    }

    pub fn finalize(&self) {
        self.stop_timers();
        self.this_value.with_mut(|t| t.finalize());
        self.client_mut().flags.finalized = true;
        self.close_socket_next_tick();
        // `_subscription_ctx` is three inline bools (no allocation, no GC
        // ref); `is_subscriber` can legitimately still be set here if the
        // server never confirmed UNSUBSCRIBE before disconnect, since
        // `update_poll_ref()` gates on the JS handler map, not this flag.
        // Nothing to release.
    }

    pub(crate) fn stop_timers(&self) {
        self.timer.disarm(self);
        self.reconnect_timer.disarm(self);
    }

    fn connect(&self) -> Result<(), crate::Error> {
        // Overwriting a live socket below would leave its callbacks driving
        // this client alongside the new one's.
        debug_assert!(self.client.get().socket.is_closed());
        if self.client.get().status == valkey::Status::NeverConnected {
            self.client_mut().status = valkey::Status::Disconnected;
        }

        let _guard = self.ref_guard();

        let is_tls = self.client.get().tls != valkey::TLS::None;
        let vm = self.client.get().vm.as_mut();
        let loop_ = vm.uws_loop();
        let group: *mut uws::SocketGroup = if is_tls {
            vm.rare_data().valkey_group::<true>(loop_)
        } else {
            vm.rare_data().valkey_group::<false>(loop_)
        };

        // Populate `_secure` first, then handle the failure branch outside the
        // borrow of `self.client.tls`.
        let tls_ctx_failed = if let valkey::TLS::Custom(ref custom) = self.client.get().tls {
            // Reuse across reconnect — the SSL_CTX is the only thing the
            // old `_socket_ctx` cache existed to preserve.
            if self._secure.get().is_none() {
                let mut err = uws::create_bun_socket_error_t::none;
                // Per-VM weak cache: a `duplicate()`'d client (or any
                // other client with the same config) hits the same
                // `SSL_CTX*` instead of rebuilding.
                let state = crate::jsc_hooks::runtime_state();
                debug_assert!(!state.is_null(), "RuntimeState not installed");
                // SAFETY: per-thread `RuntimeState`; `ssl_ctx_cache` has a
                // stable address for the VM's lifetime, JS-thread-only.
                let cache = unsafe { &mut (*state).ssl_ctx_cache };
                self._secure.set(cache.get_or_create(custom, &mut err));
            }
            self._secure.get().is_none()
        } else {
            false
        };
        if tls_ctx_failed {
            self.client_mut().flags.enable_auto_reconnect = false;
            self.client_fail(
                b"Failed to create TLS context",
                protocol::RedisError::ConnectionClosed,
            )?;
            self.close_without_socket_next_tick();
            return Ok(());
        }
        let ssl_ctx: Option<*mut uws::SslCtx> = match &self.client.get().tls {
            valkey::TLS::None => None,
            valkey::TLS::Enabled => Some(crate::jsc_hooks::default_client_ssl_ctx(vm)),
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
        // Socket keep-alive ref. Forgotten once there is a socket to own it;
        // adopted by the guard at the entry of the socket's close event
        // (`SocketHandler::on_close`, `SocketHandler::on_connect_error`, or
        // `ValkeyClient::close()` for a half-open socket), which is the one
        // event uSockets delivers for every socket this returns.
        let socket_ref = self.ref_guard();
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
        let _ = socket_ref.into_raw();
        Ok(())
    }

    pub(crate) fn send(
        &self,
        global_this: &JSGlobalObject,
        _this_value: JSValue,
        command: &Command,
    ) -> Result<*mut JSPromise, crate::Error> {
        // Keep `*self` alive across re-entrant connect/close paths below;
        // the host-fn shim passes a bare `&self` with no ref of its own.
        let _guard = self.ref_guard();

        self.ensure_dialing();

        let self_br = BackRef::new(self);
        let _update = scopeguard::guard(self_br, |p| p.update_poll_ref());
        self.client_mut().send(global_this, command)
    }

    /// Start the first dial if the client has never connected. Every command
    /// entry point runs this before looking at the client's state, so a
    /// command on a fresh client is queued behind a dial in flight (or
    /// rejected against a dial that already failed), never against
    /// `NeverConnected`.
    pub(crate) fn ensure_dialing(&self) {
        if self.client.get().status != valkey::Status::NeverConnected {
            return;
        }
        bun_core::hint::cold();

        match self.connect() {
            // The command is queued as for a dial in flight; the deferred
            // close then rejects it or a retry sends it, like a refused dial.
            Err(err) => {
                debug!(
                    "first dial failed before a socket was opened: {}",
                    err.name()
                );
                self.close_without_socket_next_tick();
            }
            Ok(()) => self.reset_connection_timeout(),
        }
    }

    // Getter for memory cost - useful for diagnostics
    pub(crate) fn memory_cost(&self) -> usize {
        // TODO(markovejnovic): This is most-likely wrong because I didn't know better.
        let client = self.client.get();
        let mut memory_cost: usize = core::mem::size_of::<JSValkeyClient>();

        // Add size of all internal buffers
        memory_cost += client.write_buffer.byte_list.capacity() as usize;
        memory_cost += client.read_buffer.byte_list.capacity() as usize;

        // Add queue sizes
        memory_cost +=
            client.in_flight.len() * core::mem::size_of::<super::valkey_command::PromisePair>();
        for command in client.queue.iter() {
            memory_cost += command.serialized_data.len();
        }
        memory_cost += client.queue.len() * core::mem::size_of::<super::valkey_command::Entry>();
        memory_cost
    }

    /// Keep the event loop alive, or don't keep it alive. Also valid once the JS wrapper is dead.
    pub(crate) fn update_poll_ref(&self) {
        // TODO(markovejnovic): This function is such a crazy cop out. We really
        // should be treating valkey as a state machine, with well-defined
        // state and modes in which it tracks and manages its own lifecycle.
        // This is a mess beyond belief and it is incredibly fragile.
        let has_pending_commands = self.client.get().has_any_pending_commands();

        let has_activity = has_pending_commands
            || self.has_subscriptions()
            || self.client.get().flags.is_reconnecting;

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
            valkey::Status::NeverConnected | valkey::Status::Disconnected => {
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
    fn socket(s: SocketType<SSL>) -> Socket {
        // `NewSocketHandler<SSL>` only differs by const generic; the
        // `socket` field is identical. Re-wrap the inner `InternalSocket` into
        // the right `AnySocket` variant.
        if SSL {
            Socket::SocketTls(uws::SocketTLS { socket: s.socket })
        } else {
            Socket::SocketTcp(uws::SocketTCP { socket: s.socket })
        }
    }

    pub(crate) fn on_open(this: &JSValkeyClient, socket: SocketType<SSL>) -> JsResult<()> {
        this.client_mut().socket = Self::socket(socket);
        this.client_mut().on_open(Self::socket(socket))
    }

    pub(crate) fn on_handshake(
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
        let _guard = this.ref_guard();
        let _update = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());
        let vm = this.client.get().vm;
        if handshake_success {
            if this.client.get().tls.reject_unauthorized(vm) {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    // Certificate chain validation failed.
                    return Self::fail_handshake_with_verify_error(this, vm, &ssl_error);
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
                    return Self::fail_handshake(this, vm, err);
                }
            }
            this.client_mut().start()?;
        } else {
            // if we are here is because the server rejected us, and the error_no is the cause of
            // this no matter if reject_unauthorized is false, because we were disconnected by the
            // server
            return Self::fail_handshake_with_verify_error(this, vm, &ssl_error);
        }
        Ok(())
    }

    fn fail_handshake_with_verify_error(
        this: &JSValkeyClient,
        vm: &VirtualMachine,
        ssl_error: &uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        let ssl_js_value =
            crate::socket::uws_jsc::verify_error_to_js(ssl_error, &this.global_object);
        Self::fail_handshake(this, vm, ssl_js_value)
    }

    fn fail_handshake(
        this: &JSValkeyClient,
        _vm: &VirtualMachine,
        err_value: JSValue,
    ) -> JsResult<()> {
        let _exit = this.vm().enter_event_loop_scope();
        this.client_mut()
            .fail_with_js_value(&this.global_object, err_value)
    }

    pub(crate) const ON_HANDSHAKE: Option<
        fn(&JSValkeyClient, SocketType<SSL>, i32, uws::us_bun_verify_error_t) -> JsResult<()>,
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub fn on_close(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        debug!("Socket closed.");
        let _guard = this.ref_guard();
        // SAFETY: takes over the keep-alive ref `connect()` handed to this
        // socket; this is its one close event. Released after `_defer` runs,
        // while `_guard` still holds the client.
        let _socket_ref = unsafe { RefPtr::from_raw(this.as_ctx_ptr()) };
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        // Before `on_close()`: it runs `onclose` and settles the connect()
        // promise, and a connect() called from either must see Disconnected.
        this.client_mut().status = valkey::Status::Disconnected;
        let _defer = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());

        this.client_mut().on_close()
    }

    pub(crate) fn on_end(this: &JSValkeyClient, socket: SocketType<SSL>) {
        let _ = this;
        let _ = socket;

        // Half-opened sockets are not allowed.
        // usockets will always call onClose after onEnd in this case so we don't need to do
        // anything here
    }

    pub(crate) fn on_connect_error(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
    ) -> JsResult<()> {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        let _guard = this.ref_guard();
        // SAFETY: as in `on_close`; a dial that fails gets this event instead.
        let _socket_ref = unsafe { RefPtr::from_raw(this.as_ctx_ptr()) };
        this.client_mut().status = valkey::Status::Disconnected;
        let _defer = scopeguard::guard(BackRef::new(this), |p| p.update_poll_ref());

        this.client_mut().on_close()
    }

    pub(crate) fn on_timeout(this: &JSValkeyClient, socket: SocketType<SSL>) {
        debug!("Socket timed out.");

        this.client_mut().socket = Self::socket(socket);
        // Handle socket timeout
    }

    pub(crate) fn on_data(
        this: &JSValkeyClient,
        socket: SocketType<SSL>,
        data: &[u8],
    ) -> JsResult<()> {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Self::socket(socket);

        let _guard = this.ref_guard();
        let result = this.client_mut().on_data(data);
        if this.client.get().status == valkey::Status::Connected {
            this.reset_connection_timeout();
        }
        this.update_poll_ref();
        result
    }

    pub(crate) fn on_writable(this: &JSValkeyClient, socket: SocketType<SSL>) {
        this.client_mut().socket = Self::socket(socket);
        let _guard = this.ref_guard();
        this.client_mut().on_writable();
        this.update_poll_ref();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────

// Parse JavaScript options into Valkey client options
struct Options;

impl Options {
    fn from_js(global_object: &JSGlobalObject, options_obj: JSValue) -> JsResult<valkey::Options> {
        let mut this = valkey::Options {
            enable_auto_pipelining:
                !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING
                    .get()
                    .unwrap_or(false),
            ..Default::default()
        };

        if let Some(idle_timeout) =
            options_obj.get_optional_int::<u32>(global_object, "idleTimeout")?
        {
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

        if let Some(max_retries) =
            options_obj.get_optional_int::<u32>(global_object, "maxRetries")?
        {
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
}

#[derive(Clone, Copy)]
enum DeferredClose {
    /// Close the socket the finalized wrapper left behind.
    Socket,
    /// Run the close path for a dial that never produced a socket
    /// (`close_without_socket_next_tick`).
    WithoutSocket,
}

pub(crate) struct ValkeyDeferredClose {
    /// Keeps the client alive until the task runs or is released.
    ctx: RefPtr<JSValkeyClient>,
    what: DeferredClose,
}

impl ValkeyDeferredClose {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) {
        let this: &JSValkeyClient = &self.ctx;
        match self.what {
            DeferredClose::Socket => {
                crate::dispatch::fold(this.client_mut().close(uws::CloseCode::FastShutdown))
            }
            DeferredClose::WithoutSocket => {
                // Holding Connecting (see `close_without_socket_next_tick`)
                // and the gate in `reconnect()` keep every dial entry out.
                debug_assert!(this.client.get().socket.is_closed());
                // No socket ref to give back: `connect()` forgets it only once
                // it has a socket, and this task exists because it never did.
                this.client_mut().status = valkey::Status::Disconnected;
                let closed = this.client_mut().on_close();
                this.update_poll_ref();
                crate::dispatch::fold(closed);
            }
        }
    }
}

impl bun_event_loop::Taskable for ValkeyDeferredClose {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ValkeyDeferredClose;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — boxed at the enqueue site.
        let task = unsafe { bun_core::heap::take(this) };
        match task.what {
            // Script-free bookkeeping; do it.
            DeferredClose::Socket => task.run(),
            // The VM is going away: `on_close()` would run `onclose`, so only
            // give back what `close_without_socket_next_tick` took.
            DeferredClose::WithoutSocket => {
                task.ctx.poll_ref.with_mut(|r| r.disable());
            }
        }
    }
}
