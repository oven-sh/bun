use bun_collections::{ByteVecExt, VecExt};
use core::cell::Cell;
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
use bun_ptr::{AsCtxPtr, BackRef};
use bun_uws as uws;

use super::js_valkey_functions as fns;
use super::protocol_jsc;
use super::valkey;
use super::valkey_command_body as command;
use super::valkey_command_body::Command;
use bun_jsc::url::URL;
use bun_valkey::valkey_protocol as protocol;

/// `bun.JSTerminated!T`
// PORT NOTE: widened to `JsResult<T>` to match `valkey.rs` (Phase A — narrow
// once `ValkeyClient::{fail,on_open,on_close,start}` are tightened to the
// `jsc::JsTerminatedResult` alias from `bun_jsc::event_loop`).
type JsTerminatedResult<T> = jsc::JsResult<T>;

/// Narrow `valkey::ValkeyClient`'s `JsResult<()>` (its local `JsTerminated<T>`
/// alias) back to the spec'd `bun.JSTerminated!void`. The inner client only
/// ever propagates `JsError::Terminated` (originating from `JSPromise::reject`
/// / `resolve`); the other variants are unreachable on this path.
// PORT NOTE: while `JsTerminatedResult` is widened to `JsResult` (see above),
// this is effectively identity-with-OOM-crash. Once both aliases tighten to
// `jsc::JsTerminatedResult`, restore the `JsTerminated::JSTerminated` mapping.
#[inline]
fn narrow_terminated(r: JsResult<()>) -> JsTerminatedResult<()> {
    r.map_err(|e| match e {
        jsc::JsError::Terminated => jsc::JsError::Terminated,
        jsc::JsError::OutOfMemory => bun_core::out_of_memory(),
        // valkey.rs never throws into JS from these paths; treat as terminal.
        jsc::JsError::Thrown => jsc::JsError::Terminated,
    })
}

// ───────────────────────────────────────────────────────────────────────────
// Local shims / extension traits (Phase-D adapt-on-our-side)
// ───────────────────────────────────────────────────────────────────────────

/// Bridge JS-thread `VirtualMachine` to the aio-level `EventLoopCtx` used by
/// `KeepAlive::ref_/unref`. Valkey always runs on the JS event loop.
#[inline]
fn vm_event_loop_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::AllocatorType::Js)
}

/// `AnySocket::isClosed` — dispatches to the inner handler.
trait AnySocketIsClosed {
    fn is_closed(&self) -> bool;
}
impl AnySocketIsClosed for uws::AnySocket {
    #[inline]
    fn is_closed(&self) -> bool {
        match self {
            uws::AnySocket::SocketTcp(s) => s.is_closed(),
            uws::AnySocket::SocketTls(s) => s.is_closed(),
        }
    }
}

/// Scope-guarded `ref/deref` over a raw pointer — sidesteps the
/// `scopeguard`-captures-`&self` borrowck conflict that pervades this file.
/// Mirrors Zig's `defer this.deref()` which had no aliasing restriction.
// R-2: takes `*const` now that every `JSValkeyClient` method is `&self`;
// `deref()` (and `ref_()`) already only need a shared receiver.
#[inline]
fn deref_guard(
    this: *const JSValkeyClient,
) -> scopeguard::ScopeGuard<*const JSValkeyClient, fn(*const JSValkeyClient)> {
    fn drop_fn(p: *const JSValkeyClient) {
        // SAFETY: `p` was a live `&JSValkeyClient` at guard creation; the
        // intrusive `ref_()` taken just before guarantees liveness here.
        unsafe { JSValkeyClient::deref(p.cast_mut()) }
    }
    scopeguard::guard(this, drop_fn as fn(*const JSValkeyClient))
}

bun_output::define_scoped_log!(debug, RedisJS, visible);

type Socket = uws::AnySocket;

// ───────────────────────────────────────────────────────────────────────────
// SubscriptionCtx
// ───────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SubscriptionCtx {
    pub is_subscriber: bool,
    pub original_enable_offline_queue: bool,
    pub original_enable_auto_pipelining: bool,
}

/// `jsc.Codegen.JSRedisClient` — the generate-classes.ts output now emits a
/// `js_RedisClient` module with snake-case `*_set_cached`/`*_get_cached`
/// free-fns plus `to_js`/`from_js`. Re-exported here as `Js` (mirrors Zig's
/// `pub const js = jsc.Codegen.JSRedisClient`).
pub use crate::generated_classes::js_RedisClient as Js;

// SAFETY: `SubscriptionCtx` lives at `JSValkeyClient._subscription_ctx`
// (intrusive backref). `JsCell<SubscriptionCtx>` is `#[repr(transparent)]`.
bun_core::impl_field_parent! { SubscriptionCtx => JSValkeyClient._subscription_ctx; fn parent; }

impl SubscriptionCtx {
    pub fn init(valkey_parent: &JSValkeyClient) -> JsResult<Self> {
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

    fn subscription_callback_map(&self) -> &mut JSMap {
        let parent_this = self
            .parent()
            .this_value
            .get()
            .try_get()
            .expect("unreachable");
        let value_js = Js::subscription_callback_map_get_cached(parent_this).unwrap();
        // `JSMap` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        // `from_js` returns a non-null heap cell when the slot was set by
        // `init()`; single JS thread.
        JSMap::opaque_mut(JSMap::from_js(value_js).unwrap().as_ptr())
    }

    /// Get the total number of channels that this subscription context is subscribed to.
    pub fn channels_subscribed_to_count(&self, global_object: &JSGlobalObject) -> JsResult<u32> {
        let count = self.subscription_callback_map().size(global_object)?;
        Ok(count)
    }

    /// Test whether this context has any subscriptions. It is mandatory to
    /// guard deinit with this function.
    pub fn has_subscriptions(&self, global_object: &JSGlobalObject) -> JsResult<bool> {
        Ok(self.channels_subscribed_to_count(global_object)? > 0)
    }

    pub fn clear_receive_handlers(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<()> {
        let map = self.subscription_callback_map();
        let _ = map.remove(global_object, channel_name)?;
        Ok(())
    }

    pub fn clear_all_receive_handlers(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        self.subscription_callback_map().clear(global_object)
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
        let map = self.subscription_callback_map();

        let existing = map.get(global_object, channel_name)?;
        if existing.is_undefined_or_null() {
            // Nothing to remove.
            return Ok(None);
        }

        // Existing is guaranteed to be an array of callbacks.
        // This check is necessary because crossing between Zig and C++ is necessary because Zig
        // doesn't know that C++ is side-effect-free.
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
        // PORT NOTE: Zig `defer` ≡ scopeguard-on-drop here.
        let map = self.subscription_callback_map();

        let mut handlers_array: JSValue = JSValue::UNDEFINED;
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

    pub fn get_callbacks(
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
    pub fn invoke_callbacks(
        &self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        args: &[JSValue],
    ) -> JsResult<()> {
        let Some(callbacks) = self.get_callbacks(global_object, channel_name)? else {
            debug!(
                "No callbacks found for channel {}",
                // `JSString` is an `opaque_ffi!` ZST — `opaque_ref` is the safe
                // deref (`as_string()` returns a live cell for string values).
                bun_jsc::JSString::opaque_ref(channel_name.as_string())
                    .get_zig_string(global_object)
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

    /// Return whether the subscription context is ready to be deleted by the JS garbage collector.
    pub fn is_deletable(&self, global_object: &JSGlobalObject) -> JsResult<bool> {
        // The user may request .close(), in which case we can dispose of the subscription object.
        // If that is the case, finalized will be true. Otherwise, we should treat the object as
        // disposable if there are no active subscriptions.
        Ok(self.parent().client.get().flags.finalized || !self.has_subscriptions(global_object)?)
    }

    // PORT NOTE: cannot be Drop — takes global_object param. Exposed as explicit
    // `close` per PORTING.md (never expose `pub fn deinit`).
    pub fn close(&self, global_object: &JSGlobalObject) {
        if cfg!(debug_assertions) {
            let go = self.parent().global_object;
            debug_assert!(self.is_deletable(&go).expect("unreachable"));
        }

        if let Some(parent_this) = self.parent().this_value.get().try_get() {
            Js::subscription_callback_map_set_cached(
                parent_this,
                global_object,
                JSValue::UNDEFINED,
            );
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSValkeyClient
// ───────────────────────────────────────────────────────────────────────────

/// Valkey client wrapper for JavaScript
// PORT NOTE: `#[bun_jsc::JsClass]` is hand-rolled in `mod.rs` (the codegen
// macro's 2-arg `constructor` shim doesn't fit the `js_this` flow here).
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut RedisClient` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. `JsCell` is
// `#[repr(transparent)]`, so `from_field_ptr!`/`owner!` recovery (dispatch.rs,
// `ValkeyClient::parent`) sees identical offsets.
//
// `#[repr(C)]`: declared layout must match the Zig original — `client` MUST be
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
    /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this null.
    pub _secure: Cell<Option<*mut uws::SslCtx>>,

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
    // PORT NOTE: no `#[bun_jsc::host_fn]` here — the free-fn shim it emits
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

    /// Create a Valkey client that does not have an associated JS object nor a SubscriptionCtx.
    ///
    /// This whole client needs a refactor.
    pub fn create_no_js_no_pubsub(
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
                None => BunString::static_(b"valkey://localhost:6379"),
            }
        };
        // `defer url_str.deref();` — bun_core::String drops on scope exit.
        let mut fallback_url_buf = [0u8; 2048];

        // Parse and validate the URL using URL.zig's fromString which returns null for invalid URLs
        // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
        // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
        // the case right now and I do not understand why. It will take some work in JSC to
        // understand why this is happening, but since I need to uncork valkey, I'm adding this as
        // a stop-gap.
        let parsed_url: NonNull<URL> = 'get_url: {
            let url_slice = url_str.to_utf8();
            let url_byte_slice = url_slice.slice();

            if url_byte_slice.is_empty() {
                return Err(
                    global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                );
            }

            if strings::contains(url_byte_slice, b"://") {
                break 'get_url match URL::from_utf8(url_byte_slice) {
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
                // PORT NOTE: bufPrintZ NUL-terminates; we don't need the NUL here since we
                // immediately re-parse via fromUTF8.
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

            match URL::from_utf8(corrected_url) {
                Some(u) => u,
                None => {
                    return Err(
                        global_object.throw_invalid_arguments(format_args!("Invalid URL format"))
                    );
                }
            }
        };
        // SAFETY: `from_utf8` heap-allocates; release on scope exit (Zig: `defer parsed_url.deinit()`).
        let _parsed_url_drop =
            scopeguard::guard(parsed_url, |p| unsafe { URL::destroy(p.as_ptr()) });
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
            // PORT NOTE: in Zig these were `&[u8]` slices into
            // `connection_strings` (self-referential). The Rust `ValkeyClient`
            // owns each field as `Box<[u8]>`, so re-slice from the pointers.
            username = Box::<[u8]>::from(user_sp.slice(&connection_strings));
            password = Box::<[u8]>::from(pass_sp.slice(&connection_strings));
            hostname = Box::<[u8]>::from(host_sp.slice(&connection_strings));
        }

        // Parse database number from pathname (e.g., "/1" -> database 1)
        let database: u32 = if pathname_utf8.slice().len() > 1 {
            bun_core::fmt::parse_int::<u32>(&pathname_utf8.slice()[1..], 10).unwrap_or(0)
        } else {
            0
        };

        bun_core::analytics::Features::VALKEY.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        // PORT NOTE: Zig used `undefined` for _subscription_ctx; initialized later by `create()`.
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
                in_flight: command::promise_pair::Queue::init(),
                queue: command::entry::Queue::init(),
                status: valkey::Status::Disconnected,
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
                retry_attempts: 0,
                auto_flusher: Default::default(),
            }),
            global_object,
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::default()),
            _secure: Cell::new(None),
            timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionTimeout,
            )),
            reconnect_timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionReconnect,
            )),
        }))
    }

    pub fn create(
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
    pub fn clone_without_connecting(
        &self,
        global_object: &JSGlobalObject,
    ) -> Result<*mut JSValkeyClient, bun_alloc::AllocError> {
        let global_object = GlobalRef::from(global_object);
        let vm: &'static VirtualMachine = global_object.bun_vm();

        let client = self.client.get();
        let sub_ctx = self._subscription_ctx.get();

        // PORT NOTE: in Zig, `username`/`password`/`address.hostname` are sub-slices
        // into the single `connection_strings` allocation, so the spec dupes
        // `connection_strings` once and `rebaseSlice`s the sub-slices into the copy.
        // The Rust `ValkeyClient` (see valkey.rs:290-299) instead owns each field
        // as an independent `Box<[u8]>`, so the rebase arithmetic would compute a
        // garbage offset and read OOB. Clone each owned buffer directly.
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
                in_flight: command::promise_pair::Queue::init(),
                queue: command::entry::Queue::init(),
                status: valkey::Status::Disconnected,
                connection_strings: connection_strings_copy,
                socket: Socket::SocketTcp(uws::SocketTCP {
                    socket: uws::InternalSocket::Detached,
                }),
                tls,
                database: client.database,
                flags: valkey::ConnectionFlags {
                    // Because this starts in the disconnected state, we need to reset some flags.
                    is_authenticated: false,
                    // If the user manually closed the connection, then duplicating a closed client
                    // means the new client remains finalized.
                    is_manually_closed: client.flags.is_manually_closed,
                    enable_offline_queue: if sub_ctx.is_subscriber {
                        sub_ctx.original_enable_offline_queue
                    } else {
                        client.flags.enable_offline_queue
                    },
                    needs_to_open_socket: true,
                    enable_auto_reconnect: client.flags.enable_auto_reconnect,
                    is_reconnecting: false,
                    enable_auto_pipelining: if sub_ctx.is_subscriber {
                        sub_ctx.original_enable_auto_pipelining
                    } else {
                        client.flags.enable_auto_pipelining
                    },
                    // Duplicating a finalized client means it stays finalized.
                    finalized: client.flags.finalized,
                    ..Default::default()
                },
                max_retries: client.max_retries,
                connection_timeout_ms: client.connection_timeout_ms,
                idle_timeout_interval_ms: client.idle_timeout_interval_ms,
                write_buffer: Default::default(),
                read_buffer: Default::default(),
                retry_attempts: 0,
                auto_flusher: Default::default(),
            }),
            global_object,
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::default()),
            _secure: Cell::new(None),
            timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionTimeout,
            )),
            reconnect_timer: JsCell::new(Timer::EventLoopTimer::init_paused(
                Timer::Tag::ValkeyConnectionReconnect,
            )),
        }))
    }

    pub fn add_subscription(&self) {
        debug!(
            "addSubscription: entering, current subscriber state: {}",
            self._subscription_ctx.get().is_subscriber
        );
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        self.ref_();
        let _d = deref_guard(self);

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

    pub fn remove_subscription(&self) {
        debug!(
            "removeSubscription: entering, has subscriptions: {}",
            self._subscription_ctx
                .get()
                .has_subscriptions(&self.global_object)
                .unwrap_or(false)
        );
        self.ref_();
        let _d = deref_guard(self);

        // This is the last subscription, restore original flags
        if !self
            ._subscription_ctx
            .get()
            .has_subscriptions(&self.global_object)
            .unwrap_or(false)
        {
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

    pub fn get_or_create_subscription_ctx(&self) -> JsResult<&SubscriptionCtx> {
        // PORT NOTE: Zig treats _subscription_ctx as Optional here but the field is not
        // optional in the struct definition above. Original:
        //   `if (this._subscription_ctx) |*ctx| { return ctx; }`
        // Preserve the return-existing intent so we don't unconditionally reinit.
        if self._subscription_ctx.get().is_subscriber {
            return Ok(self._subscription_ctx.get());
        }

        // Save the original flag values and create a new subscription context
        // (Zig passed extra args to SubscriptionCtx.init that don't exist on the fn — preserved
        // as-is via the standard init.)
        self._subscription_ctx.set(SubscriptionCtx::init(self)?);

        // We need to make sure we disable the offline queue, but we actually want to make sure
        // that our HELLO message goes through first. Consequently, we only disable the offline
        // queue if we're already connected.
        if self.client.get().status == valkey::Status::Connected {
            self.client_mut().flags.enable_offline_queue = false;
        }

        self.client_mut().flags.enable_auto_pipelining = false;

        Ok(self._subscription_ctx.get())
    }

    pub fn is_subscriber(&self) -> bool {
        self._subscription_ctx.get().is_subscriber
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
        self.ref_();
        let _d = deref_guard(self);

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
        if self.client.get().status == valkey::Status::Disconnected {
            return Ok(JSValue::UNDEFINED);
        }
        self.client_mut().disconnect();
        Ok(JSValue::UNDEFINED)
    }

    // PORT NOTE: `onconnect`/`onclose` are declared with `this: true` in
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
        self.ref_();
        let _d = deref_guard(self);

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
        // PORT NOTE: `bun_event_loop::Timespec` is a local stub distinct from
        // `bun_core::Timespec`; convert by fields until B-2 unifies them.
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

        // Increment ref to ensure 'self' stays alive throughout the function
        self.ref_();
        let _d = deref_guard(self);
        if self.client.get().flags.failed {
            return;
        }

        if self.client.get().get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
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
                let _ = self.client_fail(msg, protocol::RedisError::IdleTimeout);
                // TODO: properly propagate exception upwards
            }
            valkey::Status::Disconnected | valkey::Status::Connecting => {
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
                let _ = self.client_fail(msg, protocol::RedisError::ConnectionTimeout);
                // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn on_reconnect_timer(&self) {
        debug!("Reconnect timer fired, attempting to reconnect");

        // Mark timer as fired and store important values before doing any derefs
        self.reconnect_timer
            .with_mut(|t| t.state = Timer::State::FIRED);

        // Increment ref to ensure 'self' stays alive throughout the function
        self.ref_();
        let _d = deref_guard(self);

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
        self.ref_();
        let _d = deref_guard(self);

        // Ref the poll to keep event loop alive during connection
        self.poll_ref.with_mut(|r| {
            r.disable();
            *r = KeepAlive::default();
            r.ref_(vm_event_loop_ctx());
        });

        if let Err(err) = self.connect() {
            self.fail_with_js_value(
                self.global_object
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!("{} reconnecting", err.name()),
                    )
                    .to_js(),
            );
            self.poll_ref.with_mut(|r| r.disable());
            return;
        }

        // Reset the socket timeout
        self.reset_connection_timeout();
    }

    // Callback for when Valkey client connects
    pub fn on_valkey_connect(&self, value: &mut protocol::RESPValue) -> JsTerminatedResult<()> {
        debug_assert!(self.client.get().status == valkey::Status::Connected);
        // we should always have a strong reference to the object here
        debug_assert!(self.this_value.get().is_strong());

        let self_ptr = self.as_ctx_ptr();
        let _defer = scopeguard::guard(self_ptr, |p| unsafe {
            (*p).client_mut().on_writable();
            // update again after running the callback
            (*p).update_poll_ref();
        });
        let global_object = self.global_object;
        let _exit = self.vm().enter_event_loop_scope();

        if let Some(this_value) = self.this_value.get().try_get() {
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
        self.ref_();
        let _d = deref_guard(self);

        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    pub fn on_valkey_subscribe(&self, value: &mut protocol::RESPValue) {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        self.ref_();
        let _d = deref_guard(self);

        let _ = value;

        self.client_mut().on_writable();
        self.update_poll_ref();
    }

    pub fn on_valkey_unsubscribe(&self) -> JsResult<()> {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.get().is_strong());

        self.client_mut().on_writable();
        self.update_poll_ref();
        Ok(())
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
            ._subscription_ctx
            .get()
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
    pub fn on_valkey_reconnect(&self) {
        // Schedule reconnection using our safe timer methods
        if self.reconnect_timer.get().state == Timer::State::ACTIVE {
            self.remove_timer(&self.reconnect_timer);
        }

        let delay_ms = self.client.get().get_reconnect_delay();
        if delay_ms > 0 {
            self.add_timer(&self.reconnect_timer, delay_ms);
        }
    }

    // Callback for when Valkey client closes
    pub fn on_valkey_close(&self) -> JsTerminatedResult<()> {
        let global_object = self.global_object;

        let self_ptr = self.as_ctx_ptr();
        let _defer = scopeguard::guard(self_ptr, |p| unsafe {
            // Update poll reference to allow garbage collection of disconnected clients
            (*p).update_poll_ref();
            JSValkeyClient::deref(p);
        });

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

    // Callback for when Valkey client times out
    pub fn on_valkey_timeout(&self) {
        let _ = self.client_fail(
            b"Connection timeout",
            protocol::RedisError::ConnectionClosed,
        );
    }

    pub fn client_fail(&self, message: &[u8], err: protocol::RedisError) -> JsTerminatedResult<()> {
        narrow_terminated(self.client_mut().fail(message, err))
    }

    pub fn fail_with_js_value(&self, value: JSValue) {
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

        self.ref_();
        // socket close can potentially call JS so we need to enqueue the deinit
        struct Holder {
            // BACKREF — JSValkeyClient is intrusively ref-counted (RefCount + @fieldParentPtr
            // recovery in SubscriptionCtx::parent). The `self.ref_()` above / `(*ctx).deref()`
            // in run() keep it alive across the task hop, exactly as the Zig does.
            // PORT NOTE: LIFETIMES.tsv lists this as SHARED; update to BACKREF.
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
        // Refcounted: `deref_guard` releases the JS wrapper's +1 at scope end;
        // allocation may outlive this call if other refs remain, so hand
        // ownership back to the raw refcount.
        let this: &Self = bun_core::heap::release(self);
        let _d = deref_guard(this);

        this.stop_timers();
        this.this_value.with_mut(|t| t.finalize());
        this.client_mut().flags.finalized = true;
        this.close_socket_next_tick();
        // We do not need to free the subscription context here because we're
        // guaranteed to have freed it by virtue of the fact that we are
        // garbage collected now and the subscription context holds a reference
        // to us. If we still had a subscription context, we would never be
        // garbage collected.
        debug_assert!(!this._subscription_ctx.get().is_subscriber);
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

    fn connect(&self) -> Result<(), bun_core::Error> {
        self.client_mut().flags.needs_to_open_socket = false;

        self.ref_();
        let _d = deref_guard(self);

        let is_tls = self.client.get().tls != valkey::TLS::None;
        // PORT NOTE: `vm.rare_data()` needs `&mut VirtualMachine`; `client.vm`
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

        // PORT NOTE: reshaped for borrowck — the Zig matched on `self.client.tls`
        // and called `self.client_fail`/`on_valkey_close` from inside the arm.
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
            self.client_mut().on_valkey_close()?;
            self.client_mut().status = valkey::Status::Disconnected;
            return Ok(());
        }
        let ssl_ctx: Option<*mut uws::SslCtx> = match &self.client.get().tls {
            valkey::TLS::None => None,
            // SAFETY: `vm_ptr` is the live per-thread VM (see above).
            valkey::TLS::Enabled => {
                Some(unsafe { crate::jsc_hooks::default_client_ssl_ctx(vm_ptr) })
            }
            valkey::TLS::Custom(_) => Some(self._secure.get().unwrap()),
        };

        self.ref_();
        // Balance the ref above if connect() throws — the caller (e.g. send())
        // only knows to clean up its own state, not the keep-alive ref.
        let self_ptr = self.as_ctx_ptr();
        let errdefer_deref =
            scopeguard::guard(self_ptr, |p| unsafe { JSValkeyClient::deref(p) });
        self.client_mut().status = valkey::Status::Connecting;
        self.update_poll_ref();
        let errdefer_status = scopeguard::guard(self_ptr, |p| unsafe {
            (*p).client_mut().status = valkey::Status::Disconnected;
            (*p).update_poll_ref();
        });
        // PORT NOTE: the socket ext slot is typed `ExtSlot<JSValkeyClient>`
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
        // Disarm errdefers on success.
        scopeguard::ScopeGuard::into_inner(errdefer_status);
        scopeguard::ScopeGuard::into_inner(errdefer_deref);
        Ok(())
    }

    pub fn send(
        &self,
        global_this: &JSGlobalObject,
        _this_value: JSValue,
        command: &Command,
    ) -> Result<*mut JSPromise, bun_core::Error> {
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
                promise.reject(global_this, Ok(err_value))?;
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
            * core::mem::size_of::<super::valkey_command::PromisePair>();
        for command in client.queue.readable_slice(0) {
            memory_cost += command.serialized_data.len();
        }
        memory_cost +=
            client.queue.readable_length() * core::mem::size_of::<super::valkey_command::Entry>();
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
            let this_ref = unsafe { &*this };
            debug_assert!(this_ref.client.get().socket.is_closed());
            if let Some(s) = this_ref._secure.get() {
                // SAFETY: SSL_CTX is C-refcounted; this releases our ref.
                unsafe { boringssl::c::SSL_CTX_free(s) };
            }
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

    /// Keep the event loop alive, or don't keep it alive
    ///
    /// This requires this_value to be alive.
    pub fn update_poll_ref(&self) {
        // TODO(markovejnovic): This function is such a crazy cop out. We really
        // should be treating valkey as a state machine, with well-defined
        // state and modes in which it tracks and manages its own lifecycle.
        // This is a mess beyond belief and it is incredibly fragile.
        let has_pending_commands = self.client.get().has_any_pending_commands();

        // isDeletable may throw an exception, and if it does, we have to assume
        // that the object still has references. Best we can do is hope nothing
        // catastrophic happens.
        //
        // Once the JS wrapper has been finalized, the subscription callback map
        // (stored on the JS object) is gone. Reading it would hit `unreachable`
        // in `subscriptionCallbackMap()` because `this_value.tryGet()` returns
        // null for a finalized ref. Short-circuit here: a finalized client has
        // no subscriptions by definition.
        let subs_deletable: bool = self.client.get().flags.finalized
            || !self
                ._subscription_ctx
                .get()
                .has_subscriptions(&self.global_object)
                .unwrap_or(false);

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

// PORT NOTE: Zig's `pub const X = fns.X;` × ~160 binds each command host-fn
// into the JSValkeyClient namespace. In Rust those are already inherent
// methods on `JSValkeyClient` via the `impl JSValkeyClient` block in
// `js_valkey_functions.rs`, so no re-export is needed (and `pub use` of impl
// methods is not legal Rust). Keep `fns` referenced so the sibling module is
// linked into the build.
#[allow(unused_imports)]
use fns as _fns_anchor;

// ───────────────────────────────────────────────────────────────────────────
// SocketHandler
// ───────────────────────────────────────────────────────────────────────────

/// Referenced by `dispatch.zig` (kind = `.valkey[_tls]`).
pub struct SocketHandler<const SSL: bool>;

// PORT NOTE: Zig `const SocketType = uws.NewSocketHandler(ssl)` is an inherent
// associated type, which is unstable in Rust. Use a module-level alias instead
// and refer to it as `SocketType<SSL>` inside the impl.
type SocketType<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn _socket(s: SocketType<SSL>) -> Socket {
        // PORT NOTE: `NewSocketHandler<SSL>` only differs by const generic; the
        // `socket` field is identical. Re-wrap the inner `InternalSocket` into
        // the right `AnySocket` variant.
        if SSL {
            Socket::SocketTls(uws::SocketTLS { socket: s.socket })
        } else {
            Socket::SocketTcp(uws::SocketTCP { socket: s.socket })
        }
    }

    pub fn on_open(this: &JSValkeyClient, socket: SocketType<SSL>) -> JsTerminatedResult<()> {
        this.client_mut().socket = Self::_socket(socket);
        narrow_terminated(this.client_mut().on_open(Self::_socket(socket)))
    }

    pub fn on_handshake_(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsTerminatedResult<()> {
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
        this.ref_();
        let _d = deref_guard(this.as_ctx_ptr());
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
                    // handle is a live `SSL*`; Zig calls `@ptrCast` on it directly.
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
            narrow_terminated(this.client_mut().start())?;
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
    ) -> JsTerminatedResult<()> {
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
                    this.client_mut().flags.is_authenticated = false;
                    this.client_mut().flags.is_manually_closed = true;
                    this.client_mut().close();
                    return Ok(());
                }
            };
        Self::fail_handshake(this, vm, ssl_js_value)
    }

    fn fail_handshake(
        this: &JSValkeyClient,
        _vm: &VirtualMachine,
        err_value: JSValue,
    ) -> JsTerminatedResult<()> {
        this.client_mut().flags.is_authenticated = false;
        let _exit = this.vm().enter_event_loop_scope();
        this.client_mut().flags.is_manually_closed = true;
        let this_br = BackRef::new(this);
        let _close = scopeguard::guard(this_br, |p| p.client_mut().close());
        narrow_terminated(
            this.client_mut()
                .fail_with_js_value(&this.global_object, err_value),
        )
    }

    // `pub const onHandshake = if (ssl) onHandshake_ else null;`
    pub const ON_HANDSHAKE: Option<
        fn(
            &JSValkeyClient,
            SocketType<SSL>,
            i32,
            uws::us_bun_verify_error_t,
        ) -> JsTerminatedResult<()>,
    > = if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) {
        // No need to deref since this.client.on_close() invokes on_valkey_close which does deref.

        debug!("Socket closed.");
        this.ref_();
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        let this_ptr = this.as_ctx_ptr();
        let _defer = scopeguard::guard(this_ptr, |p| unsafe {
            (*p).client_mut().status = valkey::Status::Disconnected;
            (*p).update_poll_ref();
            JSValkeyClient::deref(p);
        });

        let _ = this.client_mut().on_close(); // TODO: properly propagate exception upwards
    }

    pub fn on_end(this: &JSValkeyClient, socket: SocketType<SSL>) {
        let _ = this;
        let _ = socket;

        // Half-opened sockets are not allowed.
        // usockets will always call onClose after onEnd in this case so we don't need to do
        // anything here
    }

    pub fn on_connect_error(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
    ) -> JsTerminatedResult<()> {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Socket::SocketTcp(uws::SocketTCP::detached());
        this.ref_();
        let this_ptr = this.as_ctx_ptr();
        let _defer = scopeguard::guard(this_ptr, |p| unsafe {
            (*p).client_mut().status = valkey::Status::Disconnected;
            (*p).update_poll_ref();
            JSValkeyClient::deref(p);
        });

        narrow_terminated(this.client_mut().on_close())
    }

    pub fn on_timeout(this: &JSValkeyClient, socket: SocketType<SSL>) {
        debug!("Socket timed out.");

        this.client_mut().socket = Self::_socket(socket);
        // Handle socket timeout
    }

    pub fn on_data(this: &JSValkeyClient, socket: SocketType<SSL>, data: &[u8]) {
        // Ensure the socket pointer is updated.
        this.client_mut().socket = Self::_socket(socket);

        this.ref_();
        let _d = deref_guard(this);
        let _ = this.client_mut().on_data(data); // TODO: properly propagate exception upwards
        this.update_poll_ref();
    }

    pub fn on_writable(this: &JSValkeyClient, socket: SocketType<SSL>) {
        this.client_mut().socket = Self::_socket(socket);
        this.ref_();
        let _d = deref_guard(this);
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
    pub fn from_js(
        global_object: &JSGlobalObject,
        options_obj: JSValue,
    ) -> JsResult<valkey::Options> {
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
                    this.tls = valkey::TLS::Custom(ssl_config);
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

// ported from: src/runtime/valkey_jsc/js_valkey.zig
