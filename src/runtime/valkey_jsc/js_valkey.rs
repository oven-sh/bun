use core::cell::Cell;
use core::ffi::c_void;
use std::rc::Rc;

use crate::socket::{SSLConfig, SSLConfigFromJs};
use crate::webcore::{AutoFlusher, HasAutoFlusher};
use bun_boringssl as boringssl;
use bun_core::{Utf8Bytes, strings};
use bun_event_loop::EventLoopTimer as Timer;
use bun_io::JsKeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, GlobalRef, JSArray, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSValue,
    JsCell, JsResult, Strong,
};
use bun_ptr::{AsCtxPtr, RefPtr};
use bun_uws as uws;

use super::hold::{Dial, Hold, Object, SocketDial};
use super::protocol_jsc::{
    ToJSOptions, resp_value_to_js, resp_value_to_js_with_options, valkey_error_to_js,
};
use super::valkey;
use bun_jsc::url::Parsed;
use bun_valkey::client::{Acked, Attempt, Client, Close, Config, Event, Lost, Reason, Sent};
use bun_valkey::command::Reply;
use bun_valkey::valkey_protocol::{RESPValue, RedisError};

bun_output::define_scoped_log!(debug, RedisJS, visible);

type Socket = uws::AnySocket;

pub(crate) use crate::generated_bindgen::valkey::js_RedisClient as js;

impl<'a> Object<'a> {
    /// `None` until the first `subscribe()`.
    fn subscription_callback_map(self) -> Option<&'a mut JSMap> {
        let map = JSMap::from_js(js::subscription_callback_map_get_cached(self.to_js())?)?;
        Some(JSMap::opaque_mut(map.as_ptr()))
    }

    fn subscription_count(self) -> u32 {
        self.subscription_callback_map().map_or(0, JSMap::size)
    }

    fn take_connection_promise(self, global: &JSGlobalObject) -> Option<&'a mut JSPromise> {
        let promise = js::connection_promise_take_cached(self.to_js(), global)?;
        promise.as_promise().map(JSPromise::opaque_mut)
    }

    pub(crate) fn clear_receive_handlers(
        self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<()> {
        if let Some(map) = self.subscription_callback_map() {
            map.remove(global_object, channel_name)?;
        }
        Ok(())
    }

    pub(crate) fn clear_all_receive_handlers(self, global_object: &JSGlobalObject) -> JsResult<()> {
        self.subscription_callback_map()
            .map_or(Ok(()), |map| map.clear(global_object))
    }

    /// Remove a specific receive handler.
    ///
    /// Returns: The total number of remaining handlers for this channel, or null if there were no
    /// listeners originally registered.
    ///
    /// Note: This function will empty out the map entry if there are no more handlers registered.
    pub(crate) fn remove_receive_handler(
        self,
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
}

impl JSValkeyClient {
    /// Add a handler for receiving messages on a specific channel
    pub(crate) fn upsert_receive_handler(
        &self,
        object: Object<'_>,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<()> {
        let _guard = scopeguard::guard(self, |this| {
            this.send_next_command();
            this.update_poll_ref(object);
        });
        if object.subscription_callback_map().is_none() {
            let map = JSMap::create(global_object);
            js::subscription_callback_map_set_cached(object.to_js(), global_object, map);
        }
        let Some(map) = object.subscription_callback_map() else {
            return Ok(());
        };
        let mut handlers = map.get(global_object, channel_name)?;
        if handlers.is_undefined() {
            handlers = JSArray::create_empty(global_object, 0)?;
        }
        handlers.push(global_object, callback)?;
        map.set(global_object, channel_name, handlers)
    }

    fn on_message(&self, object: Object<'_>, data: &mut [RESPValue]) -> JsResult<()> {
        let global_object = &self.global_object;
        let [channel, message, ..] = data else {
            return Ok(());
        };
        let channel = resp_value_to_js(channel, global_object)?;
        let message = resp_value_to_js(message, global_object)?;

        let handlers = match object.subscription_callback_map() {
            Some(map) => map.get(global_object, channel)?,
            None => JSValue::UNDEFINED,
        };
        if !handlers.is_undefined() {
            let mut iter = handlers.array_iterator(global_object)?;
            while let Some(callback) = iter.next()? {
                self.vm.event_loop().run_callback(
                    self.context,
                    callback,
                    global_object,
                    JSValue::UNDEFINED,
                    &[message, channel],
                );
            }
        }
        // Ahead of the microtasks that the caller's scope drains.
        self.send_next_command();
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSValkeyClient
// ───────────────────────────────────────────────────────────────────────────

/// Valkey client wrapper for JavaScript
#[derive(bun_ptr::RefCounted)]
pub(crate) struct JSValkeyClient {
    /// Borrowed mutably for one method of its own at a time, and none of them can reach script.
    client: JsCell<Client<JSPromiseStrong>>,
    socket: Cell<Socket>,
    // TODO(markovejnovic): a connected client that nothing refers to stays alive until it is closed.
    dial: SocketDial,
    address: valkey::Address,
    tls: valkey::TLS,
    auto_flusher: AutoFlusher,
    vm: &'static VirtualMachine,
    pub(crate) global_object: GlobalRef,
    poll_ref: JsKeepAlive,

    /// `duplicate()` resolves with the client, `connect()` with the reply to HELLO.
    pub(crate) connection_promise_returns_client: Cell<bool>,
    /// `SSL_CTX` for `tls: { …custom CA… }`. `tls: true` borrows
    /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this null.
    _secure: JsCell<Option<boringssl::c::OwnedSslCtx>>,

    pub(crate) timer: RefCountedTimer<RefPtr<JSValkeyClient>>,
    pub(crate) reconnect_timer: RefCountedTimer<Hold>,
    pub(crate) ref_count: bun_ptr::RefCount<JSValkeyClient>,
    /// The context whose script created the client: every dial, the retries
    /// its own timer starts included, joins that context's sockets.
    context: bun_jsc::ContextId,
}

/// Intrusive [`EventLoopTimer`] slot that owns what keeps
/// [`JSValkeyClient`] alive (`held_ref`) while armed, so [`disarm`] and
/// [`take_fire_ref`] release it exactly once even when the
/// fire/close/reconnect paths re-enter each other.
///
/// [`EventLoopTimer`]: Timer::EventLoopTimer
/// [`disarm`]: Self::disarm
/// [`take_fire_ref`]: Self::take_fire_ref
#[repr(C)]
pub(crate) struct RefCountedTimer<T> {
    // Must be first (offset 0): `dispatch.rs` recovers `*mut JSValkeyClient`
    // from the fired `*const EventLoopTimer` via `offset_of!(.., timer)`.
    event_loop_timer: Timer::OwnedTimer,
    held_ref: JsCell<Option<T>>,
}

const _: () = assert!(core::mem::offset_of!(RefCountedTimer<()>, event_loop_timer) == 0);

impl<T> RefCountedTimer<T> {
    fn new(tag: Timer::Tag) -> Self {
        Self {
            event_loop_timer: Timer::OwnedTimer::init_paused(tag),
            held_ref: JsCell::new(None),
        }
    }

    #[inline]
    fn state(&self) -> Timer::State {
        self.event_loop_timer.state.get()
    }

    /// Insert into the VM timer heap to fire after `ms`, taking the keep-alive
    /// ref if not already held. Disarms first if currently active.
    fn arm(&self, owner: &JSValkeyClient, ms: u32, hold: impl FnOnce() -> T) {
        let _guard = owner.ref_guard();
        if self.state() == Timer::State::ACTIVE {
            self.disarm();
        }
        if ms == 0 {
            return;
        }
        let now = bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            i64::from(ms),
        );
        self.event_loop_timer.next.set(now);
        // SAFETY: the timer is an unlinked field of the boxed `JSValkeyClient`
        // (stable address until disarmed).
        unsafe {
            owner
                .vm
                .timer_insert(Timer::OwnedTimer::node(&raw const self.event_loop_timer))
        };
        if self.held_ref.get().is_none() {
            self.held_ref.set(Some(hold()));
        }
    }

    /// Remove from the VM timer heap and release the keep-alive ref if held.
    fn disarm(&self) {
        self.event_loop_timer.disarm();
        // The caller's ref keeps the client live past this call.
        self.held_ref.set(None);
    }

    /// Mark fired and hand the keep-alive ref (if held) to the callback scope.
    /// Returns `None` when no ref was held, so a stray fire cannot over-release.
    fn take_fire_ref(&self) -> Option<T> {
        self.event_loop_timer.state.set(Timer::State::FIRED);
        self.held_ref.take()
    }
}

impl Drop for JSValkeyClient {
    fn drop(&mut self) {
        debug_assert!(self.timer.held_ref.get().is_none());
        debug_assert!(self.reconnect_timer.held_ref.get().is_none());
        AutoFlusher::unregister_deferred_microtask_with_type(self, self.vm);
        self.ref_count.assert_no_refs();
    }
}

impl HasAutoFlusher for JSValkeyClient {
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        &self.auto_flusher
    }
    unsafe fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: unregistered before `this` is freed.
        let this = unsafe { &*this };
        let _guard = this.ref_guard();
        let has_more = this.client.with_mut(Client::batch);
        this.flush();
        this.auto_flusher.registered.set(has_more);
        has_more
    }
}

impl JSValkeyClient {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    fn new(
        cx: &bun_jsc::JsThread<'_>,
        config: Config,
        address: valkey::Address,
        tls: valkey::TLS,
    ) -> RefPtr<Self> {
        RefPtr::new(JSValkeyClient {
            ref_count: bun_ptr::RefCount::init(),
            client: JsCell::new(Client::new(config)),
            socket: Cell::new(Socket::SocketTcp(uws::SocketTCP::detached())),
            dial: SocketDial::default(),
            address,
            tls,
            auto_flusher: AutoFlusher::default(),
            vm: cx.global().bun_vm(),
            global_object: GlobalRef::from(cx.global()),
            poll_ref: JsKeepAlive::default(),
            connection_promise_returns_client: Cell::new(false),
            _secure: JsCell::new(None),
            timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionTimeout),
            reconnect_timer: RefCountedTimer::new(Timer::Tag::ValkeyConnectionReconnect),
            context: cx.context().id(),
        })
    }

    pub(crate) fn constructor(
        cx: &mut JsScope<'_>,
        url: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<RefPtr<Self>> {
        Self::create_no_js_no_pubsub(&cx.js_thread(), url.to_js(), options.to_js())
    }

    /// Create a Valkey client that does not have an associated JS object.
    pub(crate) fn create_no_js_no_pubsub(
        cx: &bun_jsc::JsThread<'_>,
        url: JSValue,
        options: JSValue,
    ) -> JsResult<RefPtr<JSValkeyClient>> {
        let vm_ref = cx.global().bun_vm();

        let url_slice = if !url.is_undefined_or_null() {
            url.to_utf8(cx.global())?
        } else {
            let env = vm_ref.env_loader();
            Utf8Bytes::Borrowed(
                env.get(b"REDIS_URL")
                    .or_else(|| env.get(b"VALKEY_URL"))
                    .unwrap_or(b"valkey://localhost:6379"),
            )
        };
        let mut fallback_url_buf = [0u8; 2048];

        // Parse and validate the URL using `Parsed::from_utf8`, which returns null for invalid URLs
        // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
        // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
        // the case right now and I do not understand why. It will take some work in JSC to
        // understand why this is happening, but since I need to uncork valkey, I'm adding this as
        // a stop-gap.
        let parsed_url = 'get_url: {
            let url_byte_slice = url_slice.slice();

            if url_byte_slice.is_empty() {
                return Err(cx
                    .global()
                    .throw_invalid_arguments(format_args!("Invalid URL format")));
            }

            if strings::contains(url_byte_slice, b"://") {
                break 'get_url match Parsed::from_utf8(url_byte_slice) {
                    Some(u) => u,
                    None => {
                        return Err(cx
                            .global()
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
                    return Err(cx
                        .global()
                        .throw_invalid_arguments(format_args!("URL is too long.")));
                }
                let written = start_len - cursor.len();
                break 'get_url_slice &fallback_url_buf[..written];
            };

            match Parsed::from_utf8(corrected_url) {
                Some(u) => u,
                None => {
                    return Err(cx
                        .global()
                        .throw_invalid_arguments(format_args!("Invalid URL format")));
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
                None => return Err(cx.global().throw(format_args!(
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
                    return Err(cx.global().throw_invalid_arguments(format_args!(
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
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "Port 0 is not valid for TCP connections",
                        )));
                    }
                    if port_value > 65535 {
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "Invalid port number in URL. Port must be a number between 0 and 65535",
                        )));
                    }
                    break 'brk u16::try_from(port_value).expect("int cast");
                }
            }
        };

        let Options { mut config, tls } = if options.is_object() {
            Options::from_js(cx.global(), options)?
        } else {
            Options::default()
        };

        config.username = username_utf8.slice().into();
        config.password = password_utf8.slice().into();

        // Parse database number from pathname (e.g., "/1" -> database 1)
        config.database = match uri {
            // For unix sockets the pathname is the socket path, not a db index.
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => 0,
            _ => {
                let path = pathname_utf8.slice();
                if path.len() > 1 {
                    match bun_core::fmt::parse_int::<u32>(&path[1..], 10) {
                        Ok(n) => n,
                        Err(_) => {
                            return Err(cx.global().throw_invalid_arguments(format_args!(
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

        let address = match uri {
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                valkey::Address::Unix(hostname_slice.into())
            }
            _ => valkey::Address::Host {
                host: hostname_slice.into(),
                port,
            },
        };
        let tls = match tls {
            valkey::TLS::None if uri.is_tls() => valkey::TLS::Enabled,
            tls => tls,
        };
        Ok(Self::new(cx, config, address, tls))
    }

    pub(crate) fn clone_without_connecting(&self, cx: &bun_jsc::JsThread<'_>) -> RefPtr<Self> {
        let config = self.client.get().config().clone();
        Self::new(cx, config, self.address.clone(), self.tls.clone())
    }

    pub(crate) fn is_subscriber(&self) -> bool {
        self.client.get().is_subscriber()
    }

    pub(crate) fn get_connected(&self) -> bool {
        self.client.get().is_connected()
    }

    pub(crate) fn get_buffered_amount(&self) -> usize {
        self.client.get().buffered_amount()
    }

    pub(crate) fn do_connect(&self, global_object: &JSGlobalObject, object: Object<'_>) -> JSValue {
        let _guard = self.ref_guard();
        let this_value = object.to_js();

        if self.get_connected() {
            return JSPromise::resolved_promise_value(
                global_object,
                js::hello_get_cached(this_value).unwrap_or(JSValue::UNDEFINED),
            );
        }

        if let Some(promise) = js::connection_promise_get_cached(this_value) {
            return promise;
        }

        let promise = JSPromise::create(global_object).to_js();
        js::connection_promise_set_cached(this_value, global_object, promise);

        self.client.with_mut(Client::connect);
        self.ensure_dialing(object);
        self.reconnect(object);
        self.update_poll_ref(object);
        promise
    }

    pub(crate) fn js_connect(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        Ok(self.do_connect(cx.global(), this_value.into()))
    }

    pub(crate) fn close(&self, this: JsWrapper<'_, Self>, _: &mut JsScope<'_>) -> JsResult<()> {
        // The close event releases the socket's ref.
        let _guard = self.ref_guard();

        match self.client.with_mut(Client::close) {
            Close::Nothing => Ok(()),
            Close::Socket => self.close_socket(uws::CloseCode::FastShutdown),
            Close::Retry(attempt) => {
                self.reconnect_timer.disarm();
                self.on_lost(this.into(), attempt, None)
            }
        }
    }

    // Both continue the `Bun.ModuleGraph` whose script set them, whoever's turn of the loop the
    // connection's events arrive in (and nothing, outside a graph).
    pub(crate) fn get_onconnect(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::onconnect_get_cached(this_value.to_js())
            .map_or(JSValue::UNDEFINED, JSValue::without_async_context)
    }
    pub(crate) fn set_onconnect(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let global = cx.global();
        js::onconnect_set_cached(
            this_value.to_js(),
            global,
            value.to_js().with_graph_context_if_needed(global),
        );
    }
    pub(crate) fn get_onclose(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::onclose_get_cached(this_value.to_js())
            .map_or(JSValue::UNDEFINED, JSValue::without_async_context)
    }
    pub(crate) fn set_onclose(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let global = cx.global();
        js::onclose_set_cached(
            this_value.to_js(),
            global,
            value.to_js().with_graph_context_if_needed(global),
        );
    }

    fn reset_connection_timeout(&self) {
        let ms = self.client.get().timeout_ms();
        self.timer.arm(self, ms, || self.ref_guard());
    }

    pub(crate) fn on_connection_timeout(&self) -> JsResult<()> {
        let _guard = self.ref_guard();
        let _timer_ref = self.timer.take_fire_ref();

        let ms = self.client.get().timeout_ms();
        if ms == 0 {
            return Ok(());
        }
        let (what, error) = if self.get_connected() {
            ("Idle", RedisError::IdleTimeout)
        } else {
            ("Connection", RedisError::ConnectionTimeout)
        };
        let message = format!("{what} timeout reached after {ms}ms");
        self.fail(valkey_error_to_js(
            &self.global_object,
            message.as_bytes(),
            error,
        ))
    }

    pub(crate) fn on_reconnect_timer(&self) {
        if let Some(hold) = self.reconnect_timer.take_fire_ref() {
            self.reconnect(hold.object());
        }
    }

    /// The script that created the client is gone (its `Bun.ModuleGraph` was disposed).
    fn context_stopped(&self) -> bool {
        !self.vm.is_context_live(self.context)
    }

    fn reconnect(&self, object: Object<'_>) {
        // `connect()` does not wait for the retry.
        self.reconnect_timer.disarm();
        // The stop phase of a VM that is exiting would only have to close the socket again.
        if !self.vm.is_shutting_down()
            && let Some(attempt) = self.client.with_mut(Client::redial)
        {
            self.dial(object, attempt);
        }
    }

    /// Every command dials first, so none meets a client that never did.
    pub(crate) fn ensure_dialing(&self, object: Object<'_>) {
        if let Some(attempt) = self.client.with_mut(Client::first_dial) {
            bun_core::hint::cold();
            self.dial(object, attempt);
        }
    }

    fn dial(&self, object: Object<'_>, attempt: Attempt) {
        self.update_poll_ref(object);
        let hold = Rc::new(Hold::new(self, object));
        let mut dial = Dial {
            hold,
            attempt,
            failure: None,
        };
        match self.open_socket() {
            Ok(socket) => {
                self.socket.set(socket);
                self.dial.set(dial);
                self.reset_connection_timeout();
                return;
            }
            Err(failure) => dial.failure = failure,
        }
        self.client.with_mut(Client::dial_failed);
        // A turn later: `onclose` may dial, and fail the same way.
        let task = Box::new(ValkeyDeferredClose(dial));
        self.vm
            .event_loop()
            .enqueue_task(jsc::Task::from_boxed(task));
    }

    fn dial_failure(&self, message: &str) -> Strong {
        Strong::create(self.closed_error(message), &self.global_object)
    }

    fn open_socket(&self) -> Result<Socket, Option<Strong>> {
        // What script of a disposed `Bun.ModuleGraph` starts does not start.
        if self.context_stopped() {
            return Err(None);
        }

        let is_tls = !matches!(self.tls, valkey::TLS::None);
        let vm = self.vm;
        let loop_ = vm.uws_loop();
        let context = vm.context_of(self.context);
        let groups = vm.client_socket_groups_in(context);
        let group = if is_tls {
            groups.valkey_group::<true>(loop_)
        } else {
            groups.valkey_group::<false>(loop_)
        };

        let ssl_ctx: Option<*mut uws::SslCtx> = match &self.tls {
            valkey::TLS::None => None,
            valkey::TLS::Enabled => Some(crate::jsc_hooks::default_client_ssl_ctx(vm)),
            valkey::TLS::Custom(custom) => {
                if self._secure.get().is_none() {
                    let mut err = uws::create_bun_socket_error_t::none;
                    let cache = crate::jsc_hooks::ssl_ctx_cache();
                    self._secure.set(cache.get_or_create(custom, &mut err));
                }
                let Some(secure) = self._secure.get() else {
                    let failure = self.dial_failure("Failed to create TLS context");
                    // Only the VM's termination fails a rejection, and that stays pending.
                    let _ = self.fail(failure.get());
                    return Err(Some(failure));
                };
                Some(secure.as_ptr())
            }
        };

        let dialed = self
            .address
            .connect(self.as_ctx_ptr(), group, ssl_ctx, is_tls);
        dialed.map_err(|_| {
            let message = self.address.connect_error(bun_sys::last_error() as i32)?;
            Some(self.dial_failure(&message))
        })
    }

    /// The close event has run when this returns; `Err` when it left a termination pending.
    fn close_socket(&self, code: uws::CloseCode) -> JsResult<()> {
        if self.socket.get().is_closed() {
            return Ok(());
        }
        let socket = self
            .socket
            .replace(Socket::SocketTcp(uws::SocketTCP::detached()));
        socket.close(code);
        // A TLS fast shutdown parks behind ciphertext that a peer that stopped reading never takes.
        if code == uws::CloseCode::FastShutdown && !socket.is_closed() {
            socket.close(uws::CloseCode::Failure);
        }
        if self.global_object.has_exception() {
            Err(bun_jsc::JsError::Thrown)
        } else {
            Ok(())
        }
    }

    /// A write dispatches no socket event.
    fn flush(&self) {
        let output = self.client.get().output();
        if output.is_empty() {
            return;
        }
        let wrote = self.socket.get().write(output);
        if wrote > 0 {
            self.client.with_mut(|client| client.wrote(wrote as usize));
        }
    }

    fn send_next_command(&self) {
        if self.client.with_mut(Client::advance) {
            AutoFlusher::register_deferred_microtask_with_type(self, self.vm);
        }
        self.flush();
    }

    fn start(&self) {
        self.client.with_mut(Client::start);
        self.flush();
    }

    /// What a command is rejected with outright, if it can neither be sent nor wait.
    pub(crate) fn rejection(&self, global: &JSGlobalObject) -> Option<JSValue> {
        let message = self.client.get().rejection()?;
        let error = RedisError::ConnectionClosed;
        Some(valkey_error_to_js(global, message.as_bytes(), error))
    }

    pub(crate) fn send<A: AsRef<[u8]>>(
        &self,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        name: &[u8],
        args: &[A],
        reply: Reply,
    ) -> JSValue {
        let _guard = self.ref_guard();
        let object = Object::from(this);
        self.ensure_dialing(object);

        let mut promise = JSPromiseStrong::init(global);
        let js_promise = promise.value();
        if let Some(error) = self.rejection(global) {
            let _ = promise.reject(global, Ok(error));
        } else {
            match self
                .client
                .with_mut(|client| client.send(name, args, reply, promise))
            {
                Sent::Buffered => self.flush(),
                Sent::Batched => AutoFlusher::register_deferred_microtask_with_type(self, self.vm),
                Sent::Queued => {}
            }
        }
        self.update_poll_ref(object);
        js_promise
    }

    fn read(&self, object: Object<'_>, data: &[u8]) {
        let socket = *self.socket.get().socket();
        let mut input = self.client.with_mut(|client| client.feed(data));
        while let Some(event) = self.client.with_mut(|client| client.next_event(&mut input)) {
            if let Err(err) = self.dispatch(object, event)
                && jsc::task::report_error_or_terminate(self.vm.global(), err).is_err()
            {
                return;
            }
            // Script closed this socket, and may have dialed the next: the rest is not for that one.
            if *self.socket.get().socket() != socket {
                return;
            }
            self.send_next_command();
        }
    }

    fn dispatch(&self, object: Object<'_>, event: Event<JSPromiseStrong>) -> JsResult<()> {
        let global = &self.global_object;
        let _exit = match event {
            Event::Ignored | Event::Broken { .. } => None,
            _ => Some(self.vm.enter_event_loop_scope()),
        };
        match event {
            Event::Ignored | Event::PatternMessage => Ok(()),
            Event::Broken { message, error } => {
                debug!("failed: {}: {:?}", bstr::BStr::new(&message), error);
                self.fail(valkey_error_to_js(global, &message, error))
            }
            Event::Connected(mut hello) => self.on_connected(object, &mut hello),
            Event::Resolved {
                mut promise,
                mut value,
                as_buffer: return_as_buffer,
            } => {
                let options = ToJSOptions { return_as_buffer };
                let value = resp_value_to_js_with_options(&mut value, global, options);
                promise.settle(global, value)
            }
            Event::Rejected {
                mut promise,
                message,
            } => {
                let error = valkey_error_to_js(global, &message, RedisError::ServerError);
                promise.reject(global, Ok(error))
            }
            Event::Message(mut data) => self.on_message(object, &mut data),
            Event::Subscribed(acked) => {
                let count = object.subscription_count();
                self.on_acked(acked, JSValue::js_number(f64::from(count)))
            }
            Event::Unsubscribed(acked) => {
                if object.subscription_count() == 0 {
                    self.client.with_mut(Client::leave_subscriber_mode);
                }
                self.on_acked(acked, JSValue::UNDEFINED)
            }
        }
    }

    fn on_acked(&self, acked: Acked<JSPromiseStrong>, for_channel: JSValue) -> JsResult<()> {
        let global = &self.global_object;
        // Ahead of the microtasks that the caller's scope drains.
        self.send_next_command();
        match acked {
            Acked::Nobody => Ok(()),
            Acked::Channel(mut promise) => promise.resolve(global, for_channel),
            Acked::Raw(mut promise, mut push) => {
                promise.settle(global, resp_value_to_js(&mut push, global))
            }
        }
    }

    fn on_connected(&self, object: Object<'_>, hello: &mut RESPValue) -> JsResult<()> {
        // Now counting idle time, not connect time.
        self.reset_connection_timeout();

        let global_object = &self.global_object;
        let this_value = object.to_js();
        let hello = match resp_value_to_js(hello, global_object) {
            Ok(hello) => hello,
            Err(err) if global_object.has_pending_termination_exception() => return Err(err),
            Err(err) => {
                let exception = global_object.take_exception(err);
                let error = exception.to_error().unwrap_or(exception);
                self.connection_promise_returns_client.set(false);
                let rejected = match object.take_connection_promise(global_object) {
                    Some(promise) => promise.reject(global_object, Ok(error)),
                    None => Ok(()),
                };
                let failed = self.fail(error);
                return rejected.and(failed);
            }
        };
        js::hello_set_cached(this_value, global_object, hello);
        if let Some(on_connect) = js::onconnect_get_cached(this_value)
            .filter(|handler| handler.without_async_context().is_callable())
        {
            global_object.queue_microtask(on_connect, &[this_value, hello]);
        }

        if let Some(promise) = object.take_connection_promise(global_object) {
            let returns_client = self.connection_promise_returns_client.replace(false);
            promise.resolve(
                global_object,
                if returns_client { this_value } else { hello },
            )?;
        }
        Ok(())
    }

    /// A rejection fails once the VM's termination is pending; the rest still has to go.
    fn reject_all(&self, promises: Vec<JSPromiseStrong>, error: JSValue) -> JsResult<()> {
        let mut result = Ok(());
        for mut promise in promises {
            let rejected = promise.reject(&self.global_object, Ok(error));
            result = result.and(rejected);
        }
        result
    }

    fn closed_error(&self, message: &str) -> JSValue {
        let error = RedisError::ConnectionClosed;
        valkey_error_to_js(&self.global_object, message.as_bytes(), error)
    }

    fn fail(&self, error: JSValue) -> JsResult<()> {
        let Some(pending) = self.client.with_mut(Client::fail) else {
            return Ok(());
        };
        self.dial.fail(Strong::create(error, &self.global_object));
        let rejected = self.reject_all(pending, error);
        // The one code whose close event has run when the call returns.
        let closed = self.close_socket(uws::CloseCode::Failure);
        rejected.and(closed)
    }

    fn on_socket_closed(&self) -> JsResult<()> {
        let Some(dial) = self.dial.take() else {
            return Ok(());
        };
        self.socket
            .set(Socket::SocketTcp(uws::SocketTCP::detached()));
        self.on_lost(dial.hold.object(), dial.attempt, dial.failure.as_ref())
    }

    fn on_lost(
        &self,
        object: Object<'_>,
        attempt: Attempt,
        failure: Option<&Strong>,
    ) -> JsResult<()> {
        let _update = UpdatePollRefOnDrop(self, object);
        AutoFlusher::unregister_deferred_microtask_with_type(self, self.vm);
        let owner_is_gone = self.context_stopped();
        let lost = self
            .client
            .with_mut(|client| client.lost(attempt, owner_is_gone));
        // It bounded the attempt that just ended.
        self.timer.disarm();
        let closed = || self.closed_error("Connection closed");
        match lost {
            Lost::ForGood { reason, pending } => {
                let failure = || failure.map_or_else(closed, Strong::get);
                let error = match reason {
                    Reason::Requested => closed(),
                    Reason::Final => failure(),
                    Reason::RetriesUsedUp => {
                        let error = self.closed_error("Max reconnection attempts reached");
                        error.put_non_enumerable(&self.global_object, b"cause", failure());
                        error
                    }
                };
                self.reject_all(pending, error)?;
                self.on_closed(object, error)
            }
            Lost::Retry {
                delay_ms,
                in_flight,
            } => {
                if !in_flight.is_empty() {
                    self.reject_all(in_flight, closed())?;
                }
                debug!("reconnect in {}ms", delay_ms);
                self.reconnect_timer
                    .arm(self, delay_ms, || Hold::new(self, object));
                Ok(())
            }
        }
    }

    fn on_closed(&self, object: Object<'_>, error: JSValue) -> JsResult<()> {
        let global_object = &self.global_object;
        let this_value = object.to_js();
        if global_object.has_exception() {
            // `onclose` cannot be entered on top of what is already unwinding.
            return Err(bun_jsc::JsError::Thrown);
        }

        let _exit = self.vm.enter_event_loop_scope();

        if let Some(promise) = object.take_connection_promise(global_object) {
            promise.reject(global_object, Ok(error))?;
        }
        if let Some(on_close) = js::onclose_get_cached(this_value)
            .filter(|handler| handler.without_async_context().is_callable())
        {
            on_close.call(global_object, this_value, &[error])?;
        }
        Ok(())
    }

    /// For the VM's teardown, which closes sockets first. A collection finds neither timer armed.
    pub(crate) fn finalize(&self) {
        debug_assert!(self.dial.hold().is_none());
        self.timer.disarm();
        self.reconnect_timer.disarm();
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.client.get().memory_cost()
    }

    /// Keep the event loop alive, or don't keep it alive.
    fn update_poll_ref(&self, object: Object<'_>) {
        let client = self.client.get();
        let is_idle = client.is_connected()
            && !client.has_pending_commands()
            && object.subscription_count() == 0;
        if client.is_active() && !is_idle {
            self.poll_ref.ref_(bun_io::js_vm_ctx());
        } else {
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// SocketHandler
// ───────────────────────────────────────────────────────────────────────────

struct UpdatePollRefOnDrop<'a>(&'a JSValkeyClient, Object<'a>);

impl Drop for UpdatePollRefOnDrop<'_> {
    fn drop(&mut self) {
        self.0.update_poll_ref(self.1);
    }
}

/// uWS socket-event handler for the Valkey client (kind = `.valkey[_tls]`).
pub(crate) struct SocketHandler<const SSL: bool>;

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

    pub(crate) fn on_open(this: &JSValkeyClient, socket: SocketType<SSL>) {
        if SSL {
            if this.tls.reject_unauthorized(this.vm) {
                socket.set_inline_reject();
            }
            // RFC 6066 section 3: an IP literal is not sent as SNI.
            let sni = Self::configured_hostname(this);
            if !sni.is_empty()
                && !bun_core::ip_address::is_ip_host(sni)
                && let Some(ssl) = socket.ssl_mut()
            {
                ssl.set_servername(&bun_core::ZBox::from_bytes(sni));
            }
        }
        this.socket.set(Self::socket(socket));
        if !SSL {
            this.start();
        }
    }

    /// `on_handshake`'s name check, asked inside the handshake.
    pub(crate) fn server_identity(
        this: &JSValkeyClient,
        ssl: &mut boringssl::c::SSL,
    ) -> boringssl::ServerIdentity {
        let rejects = this.tls.reject_unauthorized(this.vm);
        let hostname = rejects.then(|| Self::configured_hostname(this));
        boringssl::server_identity(ssl, hostname)
    }

    /// The SNI and the name to match: `tls.serverName`, else the URL host. Empty for a unix socket with neither.
    fn configured_hostname(this: &JSValkeyClient) -> &[u8] {
        let hostname = match (this.tls.server_name(), &this.address) {
            (Some(server_name), _) => server_name,
            (None, valkey::Address::Host { host, .. }) => &host[..],
            (None, valkey::Address::Unix(_)) => b"",
        };
        // URL.host() keeps the brackets of an IPv6 literal ("[::1]"); without them it matches IP SAN entries.
        bun_core::ip_address::strip_ipv6_brackets(hostname)
    }

    fn fail_handshake_with_altname_error(this: &JSValkeyClient, hostname: &[u8]) -> JsResult<()> {
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
        Self::fail_handshake(this, err)
    }

    pub(crate) fn on_handshake(
        this: &JSValkeyClient,
        socket: SocketType<SSL>,
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
        // uSockets reports a handshake that our own close cut short.
        if this.client.get().is_ending() {
            return Ok(());
        }
        let handshake_success = success == 1;
        let Some(hold) = this.dial.hold() else {
            return Ok(());
        };
        let _update = UpdatePollRefOnDrop(this, hold.object());
        let ssl_ptr: *mut boringssl::c::SSL = socket.ssl().unwrap_or(core::ptr::null_mut());
        if handshake_success {
            if this.tls.reject_unauthorized(this.vm) {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    // Certificate chain validation failed.
                    return Self::fail_handshake_with_verify_error(this, &ssl_error);
                }

                // Certificate chain is valid; verify the hostname matches the
                // certificate.
                let hostname = Self::configured_hostname(this);
                // With no `SSL*` there is no certificate to match: fail closed.
                let identity_ok = hostname.is_empty()
                    || (!ssl_ptr.is_null()
                        && uws::check_server_identity(
                            // SAFETY: non-null, so the dispatched socket's live `SSL*`.
                            unsafe { &mut *ssl_ptr },
                            hostname,
                        ));
                if !identity_ok {
                    return Self::fail_handshake_with_altname_error(this, hostname);
                }
            }
            this.start();
        } else if let Some(in_flight) = this.client.with_mut(Client::session_broke) {
            // uSockets closes the socket next. No scope: script sees these once it has.
            let global = &this.global_object;
            let error = crate::socket::uws_jsc::verify_error_to_js(&ssl_error, global);
            this.dial.fail(Strong::create(error, global));
            return this.reject_all(in_flight, error);
        } else if ssl_error.error_no == uws::us_bun_verify_error_t::HOSTNAME_MISMATCH {
            // The same check, made inside the handshake (`server_identity`).
            let hostname = Self::configured_hostname(this);
            return Self::fail_handshake_with_altname_error(this, hostname);
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
            crate::socket::uws_jsc::verify_error_to_js(ssl_error, &this.global_object);
        Self::fail_handshake(this, ssl_js_value)
    }

    fn fail_handshake(this: &JSValkeyClient, err_value: JSValue) -> JsResult<()> {
        let _exit = this.vm.enter_event_loop_scope();
        this.fail(err_value)
    }

    pub(crate) const ON_HANDSHAKE: Option<
        fn(&JSValkeyClient, SocketType<SSL>, i32, uws::us_bun_verify_error_t) -> JsResult<()>,
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub(crate) fn on_close(
        this: &JSValkeyClient,
        _socket: SocketType<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        debug!("Socket closed.");
        this.on_socket_closed()
    }

    /// Half-open sockets are not allowed: the close event follows.
    pub(crate) fn on_end(_: &JSValkeyClient, _: SocketType<SSL>) {}

    pub(crate) fn on_connect_error(
        this: &JSValkeyClient,
        socket: SocketType<SSL>,
        code: i32,
    ) -> JsResult<()> {
        let message = match socket.dns_error() {
            0 => this.address.connect_error(code),
            code => this.address.lookup_error(code),
        };
        if let Some(message) = message {
            this.dial.fail(this.dial_failure(&message));
        }
        this.on_socket_closed()
    }

    pub(crate) fn on_timeout(_: &JSValkeyClient, _: SocketType<SSL>) {}

    pub(crate) fn on_data(this: &JSValkeyClient, socket: SocketType<SSL>, data: &[u8]) {
        debug_assert!(*this.socket.get().socket() == socket.socket);
        let Some(hold) = this.dial.hold() else {
            return;
        };
        this.read(hold.object(), data);
        if this.get_connected() {
            this.reset_connection_timeout();
        }
        this.update_poll_ref(hold.object());
    }

    pub(crate) fn on_writable(this: &JSValkeyClient, socket: SocketType<SSL>) {
        debug_assert!(*this.socket.get().socket() == socket.socket);
        let Some(hold) = this.dial.hold() else {
            return;
        };
        this.send_next_command();
        this.update_poll_ref(hold.object());
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────

// Parse JavaScript options into Valkey client options
#[derive(Default)]
struct Options {
    config: Config,
    tls: valkey::TLS,
}

impl Options {
    fn from_js(global_object: &JSGlobalObject, options_obj: JSValue) -> JsResult<Options> {
        let mut this = Options::default();
        this.config.enable_auto_pipelining =
            !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING
                .get()
                .unwrap_or(false);

        if let Some(idle_timeout) =
            options_obj.get_optional_int::<u32>(global_object, "idleTimeout")?
        {
            this.config.idle_timeout_ms = idle_timeout;
        }

        if let Some(connection_timeout) =
            options_obj.get_optional_int::<u32>(global_object, "connectionTimeout")?
        {
            this.config.connection_timeout_ms = connection_timeout;
        }

        if let Some(auto_reconnect) =
            options_obj.get_if_property_exists(global_object, "autoReconnect")?
        {
            this.config.enable_auto_reconnect = auto_reconnect.to_boolean();
        }

        if let Some(max_retries) =
            options_obj.get_optional_int::<u32>(global_object, "maxRetries")?
        {
            this.config.max_retries = max_retries;
        }

        if let Some(enable_offline_queue) =
            options_obj.get_if_property_exists(global_object, "enableOfflineQueue")?
        {
            this.config.enable_offline_queue = enable_offline_queue.to_boolean();
        }

        if let Some(enable_auto_pipelining) =
            options_obj.get_if_property_exists(global_object, "enableAutoPipelining")?
        {
            this.config.enable_auto_pipelining = enable_auto_pipelining.to_boolean();
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
                    SSLConfig::from_js(global_object.bun_vm(), global_object, tls, false)?
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

/// The close event of a dial that gave no socket.
pub(crate) struct ValkeyDeferredClose(Dial);

impl ValkeyDeferredClose {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) {
        let dial = self.0;
        let this: &JSValkeyClient = &dial.hold.client;
        // (A socket's close event arrives inside the client's context; so does this one.)
        let _context = this.vm.enter_context(this.context);
        crate::dispatch::fold(this.on_lost(
            dial.hold.object(),
            dial.attempt,
            dial.failure.as_ref(),
        ));
    }
}

impl bun_event_loop::BoxedTask for ValkeyDeferredClose {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ValkeyDeferredClose;
    /// The VM is going away: `on_lost` would run `onclose`.
    fn release_unrun(self: Box<Self>) {
        self.0.hold.client.poll_ref.disable();
    }
    /// `run` enters the client's, stopped or not.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
