use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use std::sync::Arc;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_core::{self, timespec};
use bun_jsc::{
    self as jsc, CallFrame, JSArray, JSGlobalObject, JSMap, JSPromise, JSValue, JsRef, JsResult,
    VirtualMachine,
};
use bun_runtime::api::server_config::SSLConfig;
use bun_runtime::api::Timer;
use bun_str::{self as strings, String as BunString};
use bun_uws as uws;

use super::js_valkey_functions as fns;
use super::valkey;
use super::ValkeyCommand as Command;
use bun_jsc::URL;
use bun_valkey::valkey_protocol as protocol;

bun_output::declare_scope!(RedisJS, visible);
macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(RedisJS, $($args)*) };
}

type Socket = uws::AnySocket;

// ───────────────────────────────────────────────────────────────────────────
// SubscriptionCtx
// ───────────────────────────────────────────────────────────────────────────

pub struct SubscriptionCtx {
    pub is_subscriber: bool,
    pub original_enable_offline_queue: bool,
    pub original_enable_auto_pipelining: bool,
}

// Shorthand alias matching Zig's `const ParentJS = JSValkeyClient.js;`
type ParentJS = jsc::codegen::JSRedisClient;

impl SubscriptionCtx {
    pub fn init(valkey_parent: &mut JSValkeyClient) -> JsResult<Self> {
        let callback_map = JSMap::create(valkey_parent.global_object);
        let parent_this = valkey_parent.this_value.try_get().expect("unreachable");

        ParentJS::gc_set(
            ParentJS::SubscriptionCallbackMap,
            parent_this,
            valkey_parent.global_object,
            callback_map,
        );

        Ok(SubscriptionCtx {
            original_enable_offline_queue: valkey_parent.client.flags.enable_offline_queue,
            original_enable_auto_pipelining: valkey_parent.client.flags.enable_auto_pipelining,
            is_subscriber: false,
        })
    }

    fn parent(&mut self) -> &mut JSValkeyClient {
        // SAFETY: self points to JSValkeyClient._subscription_ctx (intrusive backref).
        unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(JSValkeyClient, _subscription_ctx))
                .cast::<JSValkeyClient>())
        }
    }

    fn subscription_callback_map(&mut self) -> &mut JSMap {
        let parent_this = self.parent().this_value.try_get().expect("unreachable");
        let value_js =
            ParentJS::gc_get(ParentJS::SubscriptionCallbackMap, parent_this).unwrap();
        JSMap::from_js(value_js).unwrap()
    }

    /// Get the total number of channels that this subscription context is subscribed to.
    pub fn channels_subscribed_to_count(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> JsResult<u32> {
        let count = self.subscription_callback_map().size(global_object)?;
        Ok(count)
    }

    /// Test whether this context has any subscriptions. It is mandatory to
    /// guard deinit with this function.
    pub fn has_subscriptions(&mut self, global_object: &JSGlobalObject) -> JsResult<bool> {
        Ok(self.channels_subscribed_to_count(global_object)? > 0)
    }

    pub fn clear_receive_handlers(
        &mut self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
    ) -> JsResult<()> {
        let map = self.subscription_callback_map();
        let _ = map.remove(global_object, channel_name)?;
        Ok(())
    }

    pub fn clear_all_receive_handlers(
        &mut self,
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
    pub fn remove_receive_handler(
        &mut self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> Result<Option<usize>, bun_core::Error> {
        // TODO(port): narrow error set
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

        Ok(Some(new_length))
    }

    /// Add a handler for receiving messages on a specific channel
    pub fn upsert_receive_handler(
        &mut self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        callback: JSValue,
    ) -> JsResult<()> {
        let _guard = scopeguard::guard((), |_| {
            self.parent().on_new_subscription_callback_insert();
        });
        // TODO(port): the Zig used `defer` (always-run). scopeguard runs on drop, equivalent here.
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
        &mut self,
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
        &mut self,
        global_object: &JSGlobalObject,
        channel_name: JSValue,
        args: &[JSValue],
    ) -> JsResult<()> {
        let Some(callbacks) = self.get_callbacks(global_object, channel_name)? else {
            debug!(
                "No callbacks found for channel {}",
                channel_name.as_string().get_zig_string(global_object)
            );
            return Ok(());
        };

        if cfg!(debug_assertions) {
            debug_assert!(callbacks.is_array());
        }

        let vm = VirtualMachine::get();
        let event_loop = vm.event_loop();
        event_loop.enter();
        let _exit = scopeguard::guard((), |_| event_loop.exit());

        // After we go through every single callback, we will have to update the poll ref.
        // The user may, for example, unsubscribe in the callbacks, or even stop the client.
        let _update = scopeguard::guard((), |_| self.parent().update_poll_ref());

        // If callbacks is an array, iterate and call each one
        let mut iter = callbacks.array_iterator(global_object)?;
        while let Some(callback) = iter.next()? {
            if cfg!(debug_assertions) {
                debug_assert!(callback.is_callable());
            }
            event_loop.run_callback(callback, global_object, JSValue::UNDEFINED, args);
        }
        Ok(())
    }

    /// Return whether the subscription context is ready to be deleted by the JS garbage collector.
    pub fn is_deletable(&mut self, global_object: &JSGlobalObject) -> JsResult<bool> {
        // The user may request .close(), in which case we can dispose of the subscription object.
        // If that is the case, finalized will be true. Otherwise, we should treat the object as
        // disposable if there are no active subscriptions.
        Ok(self.parent().client.flags.finalized || !self.has_subscriptions(global_object)?)
    }

    // TODO(port): cannot be Drop — takes global_object param. Kept as explicit method.
    pub fn deinit(&mut self, global_object: &JSGlobalObject) {
        if cfg!(debug_assertions) {
            let go = self.parent().global_object;
            debug_assert!(self.is_deletable(go).expect("unreachable"));
        }

        if let Some(parent_this) = self.parent().this_value.try_get() {
            ParentJS::gc_set(
                ParentJS::SubscriptionCallbackMap,
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
#[bun_jsc::JsClass]
pub struct JSValkeyClient {
    pub client: valkey::ValkeyClient,
    pub global_object: &'static JSGlobalObject,
    pub this_value: JsRef,
    pub poll_ref: KeepAlive,

    pub _subscription_ctx: SubscriptionCtx,
    /// `us_ssl_ctx_t` for `tls: { …custom CA… }`. `tls: true` borrows
    /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this null.
    pub _secure: Option<*mut uws::SslCtx>,

    pub timer: Timer::EventLoopTimer,
    pub reconnect_timer: Timer::EventLoopTimer,
    pub ref_count: Cell<u32>,
}

// Codegen alias: `pub const js = jsc.Codegen.JSRedisClient;`
pub type Js = jsc::codegen::JSRedisClient;
// `toJS`/`fromJS`/`fromJSDirect` are provided by #[bun_jsc::JsClass] codegen.

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` → intrusive refcount.
pub type RefCount = bun_ptr::IntrusiveRc<JSValkeyClient>;

impl JSValkeyClient {
    #[inline]
    pub fn ref_(&self) {
        RefCount::ref_(self);
    }
    #[inline]
    pub fn deref(&self) {
        RefCount::deref(self);
    }
    #[inline]
    pub fn new(init: JSValkeyClient) -> *mut JSValkeyClient {
        // bun.TrivialNew(@This()) → Box::into_raw(Box::new(init))
        Box::into_raw(Box::new(init))
    }

    // Factory function to create a new Valkey client from JS
    #[bun_jsc::host_fn]
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
        let vm = global_object.bun_vm();

        let url_str = if arguments.len() >= 1 && !arguments[0].is_undefined_or_null() {
            arguments[0].to_bun_string(global_object)?
        } else if let Some(url) = vm
            .transpiler
            .env
            .get(b"REDIS_URL")
            .or_else(|| vm.transpiler.env.get(b"VALKEY_URL"))
        {
            BunString::init(url)
        } else {
            BunString::static_(b"valkey://localhost:6379")
        };
        // `defer url_str.deref();` — bun_str::String drops on scope exit.
        let mut fallback_url_buf = [0u8; 2048];

        // Parse and validate the URL using URL.zig's fromString which returns null for invalid URLs
        // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
        // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
        // the case right now and I do not understand why. It will take some work in JSC to
        // understand why this is happening, but since I need to uncork valkey, I'm adding this as
        // a stop-gap.
        let parsed_url = 'get_url: {
            let url_slice = url_str.to_utf8();
            let url_byte_slice = url_slice.slice();

            if url_byte_slice.is_empty() {
                return Err(global_object.throw_invalid_arguments("Invalid URL format"));
            }

            if strings::strings::contains(url_byte_slice, b"://") {
                break 'get_url match URL::from_string(&url_str) {
                    Some(u) => u,
                    None => {
                        return Err(global_object.throw_invalid_arguments("Invalid URL format"))
                    }
                };
            }

            let corrected_url = 'get_url_slice: {
                use std::io::Write;
                let mut cursor = &mut fallback_url_buf[..];
                let start_len = cursor.len();
                // TODO(port): bufPrintZ NUL-terminates; we don't need the NUL here since we
                // immediately re-parse via fromUTF8.
                if write!(&mut cursor, "valkey://").is_err()
                    || cursor.write_all(url_byte_slice).is_err()
                {
                    return Err(global_object.throw_invalid_arguments("URL is too long."));
                }
                let written = start_len - cursor.len();
                break 'get_url_slice &fallback_url_buf[..written];
            };

            match URL::from_utf8(corrected_url) {
                Some(u) => u,
                None => return Err(global_object.throw_invalid_arguments("Invalid URL format")),
            }
        };
        // `defer parsed_url.deinit();` — Drop on scope exit.

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
                None => return Err(global_object.throw(
                    "Expected url protocol to be one of redis, valkey, rediss, valkeys, redis+tls, redis+unix, redis+tls+unix",
                )),
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
            valkey::Protocol::StandaloneTls | valkey::Protocol::Standalone => {
                hostname_utf8.slice()
            }
            valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                // For unix sockets, the path is in the pathname
                if pathname_utf8.slice().is_empty() {
                    return Err(global_object.throw_invalid_arguments(
                        "Expected unix socket path after valkey+unix:// or valkey+tls+unix://",
                    ));
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
                        return Err(global_object.throw_invalid_arguments(
                            "Port 0 is not valid for TCP connections",
                        ));
                    }
                    if port_value > 65535 {
                        return Err(global_object.throw_invalid_arguments(
                            "Invalid port number in URL. Port must be a number between 0 and 65535",
                        ));
                    }
                    break 'brk u16::try_from(port_value).unwrap();
                }
            }
        };

        let options = if arguments.len() >= 2
            && !arguments[1].is_undefined_or_null()
            && arguments[1].is_object()
        {
            Options::from_js(global_object, arguments[1])?
        } else {
            valkey::Options::default()
        };

        // Copy strings into a persistent buffer since the URL object will be deinitialized
        let mut connection_strings: Box<[u8]> = Box::default();
        let mut username: &[u8] = b"";
        let mut password: &[u8] = b"";
        let mut hostname: &[u8] = b"";

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
            username = b.append(username_utf8.slice());
            password = b.append(password_utf8.slice());
            hostname = b.append(hostname_slice);
            b.move_to_slice(&mut connection_strings);
            // TODO(port): username/password/hostname are slices into connection_strings; in Rust
            // these need to be raw `*const [u8]` or rebased indices to avoid the self-borrow.
        }

        // Parse database number from pathname (e.g., "/1" -> database 1)
        let database: u32 = if pathname_utf8.slice().len() > 1 {
            // SAFETY: pathname is ASCII digits if it parses; from_utf8 is fine here for parseInt.
            core::str::from_utf8(&pathname_utf8.slice()[1..])
                .ok()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0)
        } else {
            0
        };

        bun_core::analytics::Features::valkey_inc(1);

        // SAFETY: _subscription_ctx is initialized later by `create()`.
        let subscription_ctx_uninit: SubscriptionCtx = unsafe { core::mem::zeroed() };
        // TODO(port): Zig used `undefined` for _subscription_ctx; using zeroed POD here.

        Ok(JSValkeyClient::new(JSValkeyClient {
            ref_count: Cell::new(1),
            _subscription_ctx: subscription_ctx_uninit,
            client: valkey::ValkeyClient {
                vm,
                address: match uri {
                    valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                        valkey::Address::Unix(hostname)
                    }
                    _ => valkey::Address::Host(valkey::HostAddress { host: hostname, port }),
                },
                protocol: uri,
                username,
                password,
                in_flight: Default::default(),
                queue: Default::default(),
                status: valkey::Status::Disconnected,
                connection_strings,
                socket: Socket::SocketTCP(uws::SocketTCP {
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
                allocator: (), // TODO(port): allocator param dropped (global mimalloc)
                flags: valkey::Flags {
                    enable_auto_reconnect: options.enable_auto_reconnect,
                    enable_offline_queue: options.enable_offline_queue,
                    enable_auto_pipelining: options.enable_auto_pipelining,
                    ..Default::default()
                },
                max_retries: options.max_retries,
                connection_timeout_ms: options.connection_timeout_ms,
                idle_timeout_interval_ms: options.idle_timeout_ms,
                ..Default::default()
            },
            global_object,
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::default(),
            _secure: None,
            timer: Timer::EventLoopTimer {
                tag: Timer::Tag::ValkeyConnectionTimeout,
                next: timespec::EPOCH,
                ..Default::default()
            },
            reconnect_timer: Timer::EventLoopTimer {
                tag: Timer::Tag::ValkeyConnectionReconnect,
                next: timespec::EPOCH,
                ..Default::default()
            },
        }))
    }

    pub fn create(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        js_this: JSValue,
    ) -> JsResult<*mut JSValkeyClient> {
        let new_client_ptr = JSValkeyClient::create_no_js_no_pubsub(global_object, arguments)?;
        // SAFETY: just allocated above
        let new_client = unsafe { &mut *new_client_ptr };

        // Initially, we only need to hold a weak reference to the JS object.
        new_client.this_value = JsRef::init_weak(js_this);

        // Need to associate the subscription context, after the JS ref has been populated.
        new_client._subscription_ctx = SubscriptionCtx::init(new_client)?;

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
        let vm = global_object.bun_vm();

        // Make a copy of connection_strings to avoid double-free
        let connection_strings_copy: Box<[u8]> =
            Box::<[u8]>::from(&self.client.connection_strings[..]);

        // Note that there is no need to copy username, password and address since the copies live
        // within the connection_strings buffer.
        let base_ptr = self.client.connection_strings.as_ptr();
        let new_base = connection_strings_copy.as_ptr();
        let username = bun_core::memory::rebase_slice(self.client.username, base_ptr, new_base);
        let password = bun_core::memory::rebase_slice(self.client.password, base_ptr, new_base);
        let orig_hostname = self.client.address.hostname();
        let hostname = bun_core::memory::rebase_slice(orig_hostname, base_ptr, new_base);
        // TODO: we could ref count it instead of cloning it
        let tls: valkey::TLS = self.client.tls.clone();

        // SAFETY: zeroed POD for placeholder _subscription_ctx
        let subscription_ctx_uninit: SubscriptionCtx = unsafe { core::mem::zeroed() };

        Ok(JSValkeyClient::new(JSValkeyClient {
            ref_count: Cell::new(1),
            _subscription_ctx: subscription_ctx_uninit,
            client: valkey::ValkeyClient {
                vm,
                address: match self.client.protocol {
                    valkey::Protocol::StandaloneUnix | valkey::Protocol::StandaloneTlsUnix => {
                        valkey::Address::Unix(hostname)
                    }
                    _ => valkey::Address::Host(valkey::HostAddress {
                        host: hostname,
                        port: self.client.address.host().port,
                    }),
                },
                protocol: self.client.protocol,
                username,
                password,
                in_flight: Default::default(),
                queue: Default::default(),
                status: valkey::Status::Disconnected,
                connection_strings: connection_strings_copy,
                socket: Socket::SocketTCP(uws::SocketTCP {
                    socket: uws::InternalSocket::Detached,
                }),
                tls,
                database: self.client.database,
                allocator: (), // TODO(port): allocator param dropped
                flags: valkey::Flags {
                    // Because this starts in the disconnected state, we need to reset some flags.
                    is_authenticated: false,
                    // If the user manually closed the connection, then duplicating a closed client
                    // means the new client remains finalized.
                    is_manually_closed: self.client.flags.is_manually_closed,
                    enable_offline_queue: if self._subscription_ctx.is_subscriber {
                        self._subscription_ctx.original_enable_offline_queue
                    } else {
                        self.client.flags.enable_offline_queue
                    },
                    needs_to_open_socket: true,
                    enable_auto_reconnect: self.client.flags.enable_auto_reconnect,
                    is_reconnecting: false,
                    enable_auto_pipelining: if self._subscription_ctx.is_subscriber {
                        self._subscription_ctx.original_enable_auto_pipelining
                    } else {
                        self.client.flags.enable_auto_pipelining
                    },
                    // Duplicating a finalized client means it stays finalized.
                    finalized: self.client.flags.finalized,
                    ..Default::default()
                },
                max_retries: self.client.max_retries,
                connection_timeout_ms: self.client.connection_timeout_ms,
                idle_timeout_interval_ms: self.client.idle_timeout_interval_ms,
                ..Default::default()
            },
            global_object,
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::default(),
            _secure: None,
            timer: Timer::EventLoopTimer {
                tag: Timer::Tag::ValkeyConnectionTimeout,
                next: timespec::EPOCH,
                ..Default::default()
            },
            reconnect_timer: Timer::EventLoopTimer {
                tag: Timer::Tag::ValkeyConnectionReconnect,
                next: timespec::EPOCH,
                ..Default::default()
            },
        }))
    }

    pub fn add_subscription(&mut self) {
        debug!(
            "addSubscription: entering, current subscriber state: {}",
            self._subscription_ctx.is_subscriber
        );
        debug_assert!(self.client.status == valkey::Status::Connected);
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        if !self._subscription_ctx.is_subscriber {
            self._subscription_ctx.original_enable_offline_queue =
                self.client.flags.enable_offline_queue;
            self._subscription_ctx.original_enable_auto_pipelining =
                self.client.flags.enable_auto_pipelining;
            debug!("addSubscription: calling updatePollRef");
            self.update_poll_ref();
        }

        self._subscription_ctx.is_subscriber = true;
        debug!(
            "addSubscription: exiting, new subscriber state: {}",
            self._subscription_ctx.is_subscriber
        );
    }

    pub fn remove_subscription(&mut self) {
        debug!(
            "removeSubscription: entering, has subscriptions: {}",
            self._subscription_ctx
                .has_subscriptions(self.global_object)
                .unwrap_or(false)
        );
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        // This is the last subscription, restore original flags
        if !self
            ._subscription_ctx
            .has_subscriptions(self.global_object)
            .unwrap_or(false)
        {
            self.client.flags.enable_offline_queue =
                self._subscription_ctx.original_enable_offline_queue;
            self.client.flags.enable_auto_pipelining =
                self._subscription_ctx.original_enable_auto_pipelining;
            self._subscription_ctx.is_subscriber = false;
            debug!("removeSubscription: calling updatePollRef");
            self.update_poll_ref();
        }
        debug!("removeSubscription: exiting");
    }

    pub fn get_or_create_subscription_ctx(&mut self) -> JsResult<&mut SubscriptionCtx> {
        // TODO(port): Zig treats _subscription_ctx as Optional here but the field is not
        // optional in the struct definition above. Preserving the apparent intent: if already
        // initialized (is_subscriber path), return it; else (re)init.
        // Original: `if (this._subscription_ctx) |*ctx| { return ctx; }`
        // We can't pattern-match a non-Option in Rust; mirror the connected-state side effects.

        // Save the original flag values and create a new subscription context
        // (Zig passed extra args to SubscriptionCtx.init that don't exist on the fn — preserved
        // as-is via the standard init.)
        self._subscription_ctx = SubscriptionCtx::init(self)?;

        // We need to make sure we disable the offline queue, but we actually want to make sure
        // that our HELLO message goes through first. Consequently, we only disable the offline
        // queue if we're already connected.
        if self.client.status == valkey::Status::Connected {
            self.client.flags.enable_offline_queue = false;
        }

        self.client.flags.enable_auto_pipelining = false;

        Ok(&mut self._subscription_ctx)
    }

    pub fn is_subscriber(&self) -> bool {
        self._subscription_ctx.is_subscriber
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.client.status == valkey::Status::Connected)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let len = self.client.write_buffer.len() + self.client.read_buffer.len();
        JSValue::js_number(len)
    }

    pub fn do_connect(
        &mut self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        // If already connected, resolve immediately
        if self.client.status == valkey::Status::Connected {
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
        self.client.flags.is_manually_closed = false;
        // Explicit connect() should also clear the sticky `failed` flag so the
        // client can recover after prior connection attempts exhausted retries.
        // Without this, every subsequent command rejects with "Connection has
        // failed" forever — see https://github.com/oven-sh/bun/issues/29925.
        self.client.flags.failed = false;
        let _update = scopeguard::guard((), |_| self.update_poll_ref());

        if self.client.flags.needs_to_open_socket {
            self.poll_ref.ref_(self.client.vm);

            if let Err(err) = self.connect() {
                self.poll_ref.unref(self.client.vm);
                self.client.flags.needs_to_open_socket = true;
                let err_value = global_object
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!(" {} connecting to Valkey", err.name()),
                    )
                    .to_js();
                let event_loop = self.client.vm.event_loop();
                event_loop.enter();
                let _exit = scopeguard::guard((), |_| event_loop.exit());
                promise_ptr.reject(global_object, err_value)?;
                return Ok(promise);
            }

            self.reset_connection_timeout();
            return Ok(promise);
        }

        match self.client.status {
            valkey::Status::Disconnected => {
                self.client.flags.is_reconnecting = true;
                self.client.retry_attempts = 0;
                self.reconnect();
            }
            _ => {}
        }

        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_connect(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.do_connect(global_object, callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_disconnect(
        &mut self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.client.status == valkey::Status::Disconnected {
            return Ok(JSValue::UNDEFINED);
        }
        self.client.disconnect();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_connect(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        if let Some(value) = Js::onconnect_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_connect(
        &mut self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        Js::onconnect_set_cached(this_value, global_object, value);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_close(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        if let Some(value) = Js::onclose_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_close(
        &mut self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        Js::onclose_set_cached(this_value, global_object, value);
    }

    /// Safely add a timer with proper reference counting and event loop keepalive
    fn add_timer(&mut self, timer: *mut Timer::EventLoopTimer, next_timeout_ms: u32) {
        // PORT NOTE: reshaped for borrowck — `timer` aliases a field of self, so use raw ptr.
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        // SAFETY: caller passes &mut self.timer or &mut self.reconnect_timer
        let timer_ref = unsafe { &mut *timer };

        // If the timer is already active, we need to remove it first
        if timer_ref.state == Timer::State::ACTIVE {
            self.remove_timer(timer);
        }

        // Skip if timeout is zero
        if next_timeout_ms == 0 {
            return;
        }

        // Store VM reference to use later
        let vm = self.client.vm;

        // Set up timer and add to event loop
        let timer_ref = unsafe { &mut *timer };
        timer_ref.next = timespec::ms_from_now(
            timespec::ClockSource::AllowMockedTime,
            i64::from(next_timeout_ms),
        );
        vm.timer.insert(timer_ref);
        self.ref_();
    }

    /// Safely remove a timer with proper reference counting and event loop keepalive
    fn remove_timer(&mut self, timer: *mut Timer::EventLoopTimer) {
        // SAFETY: caller passes a field of self
        let timer_ref = unsafe { &mut *timer };
        if timer_ref.state == Timer::State::ACTIVE {
            // Store VM reference to use later
            let vm = self.client.vm;

            // Remove the timer from the event loop
            vm.timer.remove(timer_ref);

            // self.add_timer() adds a reference to 'self' when the timer is
            // alive which is balanced here.
            self.deref();
        }
    }

    fn reset_connection_timeout(&mut self) {
        let interval = self.client.get_timeout_interval();

        // First remove existing timer if active
        if self.timer.state == Timer::State::ACTIVE {
            let t = &mut self.timer as *mut _;
            self.remove_timer(t);
        }

        // Add new timer if interval is non-zero
        if interval > 0 {
            let t = &mut self.timer as *mut _;
            self.add_timer(t, interval);
        }
    }

    pub fn disable_connection_timeout(&mut self) {
        if self.timer.state == Timer::State::ACTIVE {
            let t = &mut self.timer as *mut _;
            self.remove_timer(t);
        }
        self.timer.state = Timer::State::CANCELLED;
    }

    pub fn on_connection_timeout(&mut self) {
        debug!("onConnectionTimeout");

        // Mark timer as fired
        self.timer.state = Timer::State::FIRED;

        // Increment ref to ensure 'self' stays alive throughout the function
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());
        if self.client.flags.failed {
            return;
        }

        if self.client.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        let mut buf = [0u8; 128];
        match self.client.status {
            valkey::Status::Connected => {
                use std::io::Write;
                let mut cur = &mut buf[..];
                let start = cur.len();
                write!(
                    &mut cur,
                    "Idle timeout reached after {}ms",
                    self.client.idle_timeout_interval_ms
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
                    self.client.connection_timeout_ms
                )
                .expect("unreachable");
                let len = start - cur.len();
                let msg = &buf[..len];
                let _ = self.client_fail(msg, protocol::RedisError::ConnectionTimeout);
                // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn on_reconnect_timer(&mut self) {
        debug!("Reconnect timer fired, attempting to reconnect");

        // Mark timer as fired and store important values before doing any derefs
        self.reconnect_timer.state = Timer::State::FIRED;

        // Increment ref to ensure 'self' stays alive throughout the function
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        // Execute reconnection logic
        self.reconnect();
    }

    pub fn reconnect(&mut self) {
        if !self.client.flags.is_reconnecting {
            return;
        }

        let vm = self.client.vm;

        if vm.is_shutting_down() {
            #[cold]
            fn cold() {}
            cold();
            return;
        }

        // Ref to keep this alive during the reconnection
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        // Ref the poll to keep event loop alive during connection
        self.poll_ref.disable();
        self.poll_ref = KeepAlive::default();
        self.poll_ref.ref_(vm);

        if let Err(err) = self.connect() {
            self.fail_with_js_value(
                self.global_object
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!("{} reconnecting", err.name()),
                    )
                    .to_js(),
            );
            self.poll_ref.disable();
            return;
        }

        // Reset the socket timeout
        self.reset_connection_timeout();
    }

    // Callback for when Valkey client connects
    pub fn on_valkey_connect(&mut self, value: &mut protocol::RESPValue) -> jsc::JsTerminatedResult<()> {
        debug_assert!(self.client.status == valkey::Status::Connected);
        // we should always have a strong reference to the object here
        debug_assert!(self.this_value.is_strong());

        let _defer = scopeguard::guard((), |_| {
            self.client.on_writable();
            // update again after running the callback
            self.update_poll_ref();
        });
        let global_object = self.global_object;
        let event_loop = self.client.vm.event_loop();
        event_loop.enter();
        let _exit = scopeguard::guard((), |_| event_loop.exit());

        if let Some(this_value) = self.this_value.try_get() {
            let hello_value: JSValue = 'js_hello: {
                match value.to_js(global_object) {
                    Ok(v) => break 'js_hello v,
                    Err(err) => {
                        // TODO: how should we handle this? old code ignore the exception instead
                        // of cleaning it up. Now we clean it up, and behave the same as old code.
                        let _ = global_object.take_exception(err);
                        break 'js_hello JSValue::UNDEFINED;
                    }
                }
            };
            Js::hello_set_cached(this_value, global_object, hello_value);
            // Call onConnect callback if defined by the user
            if let Some(on_connect) = Js::onconnect_get_cached(this_value) {
                let js_value = this_value;
                js_value.ensure_still_alive();
                global_object.queue_microtask(on_connect, &[js_value, hello_value]);
            }

            if let Some(promise) = Js::connection_promise_get_cached(this_value) {
                Js::connection_promise_set_cached(this_value, global_object, JSValue::ZERO);
                let js_promise = promise.as_promise().unwrap();
                if self.client.flags.connection_promise_returns_client {
                    debug!("Resolving connection promise with client instance");
                    js_promise.resolve(global_object, this_value)?;
                } else {
                    debug!("Resolving connection promise with HELLO response");
                    js_promise.resolve(global_object, hello_value)?;
                }
                self.client.flags.connection_promise_returns_client = false;
            }
        }
        Ok(())
    }

    /// Invoked when the Valkey client receives a new listener.
    ///
    /// `SubscriptionCtx` will invoke this to communicate that it has added a new listener.
    pub fn on_new_subscription_callback_insert(&mut self) {
        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        self.client.on_writable();
        self.update_poll_ref();
    }

    pub fn on_valkey_subscribe(&mut self, value: &mut protocol::RESPValue) {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.is_strong());

        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        let _ = value;

        self.client.on_writable();
        self.update_poll_ref();
    }

    pub fn on_valkey_unsubscribe(&mut self) -> JsResult<()> {
        debug_assert!(self.is_subscriber());
        debug_assert!(self.this_value.is_strong());

        self.client.on_writable();
        self.update_poll_ref();
        Ok(())
    }

    pub fn on_valkey_message(&mut self, value: &mut [protocol::RESPValue]) {
        if !self.is_subscriber() {
            debug!("onMessage called but client is not in subscriber mode");
            return;
        }

        let global_object = self.global_object;
        let event_loop = self.client.vm.event_loop();
        event_loop.enter();
        let _exit = scopeguard::guard((), |_| event_loop.exit());

        // The message push should be an array with [channel, message]
        if value.len() < 2 {
            debug!("Message array has insufficient elements: {}", value.len());
            return;
        }

        // Extract channel and message
        let Ok(channel_value) = value[0].to_js(global_object) else {
            debug!("Failed to convert channel to JS");
            return;
        };
        let Ok(message_value) = value[1].to_js(global_object) else {
            debug!("Failed to convert message to JS");
            return;
        };

        // Invoke callbacks for this channel with message and channel as arguments
        if self
            ._subscription_ctx
            .invoke_callbacks(global_object, channel_value, &[message_value, channel_value])
            .is_err()
        {
            return;
        }

        self.client.on_writable();
        self.update_poll_ref();
    }

    // Callback for when Valkey client needs to reconnect
    pub fn on_valkey_reconnect(&mut self) {
        // Schedule reconnection using our safe timer methods
        if self.reconnect_timer.state == Timer::State::ACTIVE {
            let t = &mut self.reconnect_timer as *mut _;
            self.remove_timer(t);
        }

        let delay_ms = self.client.get_reconnect_delay();
        if delay_ms > 0 {
            let t = &mut self.reconnect_timer as *mut _;
            self.add_timer(t, delay_ms);
        }
    }

    // Callback for when Valkey client closes
    pub fn on_valkey_close(&mut self) -> jsc::JsTerminatedResult<()> {
        let global_object = self.global_object;

        let _defer = scopeguard::guard((), |_| {
            // Update poll reference to allow garbage collection of disconnected clients
            self.update_poll_ref();
            self.deref();
        });

        let Some(this_jsvalue) = self.this_value.try_get() else {
            return Ok(());
        };
        this_jsvalue.ensure_still_alive();

        // Create an error value
        let error_value = protocol::valkey_error_to_js(
            global_object,
            b"Connection closed",
            protocol::RedisError::ConnectionClosed,
        );

        let loop_ = self.client.vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

        if !this_jsvalue.is_undefined() {
            if let Some(promise) = Js::connection_promise_get_cached(this_jsvalue) {
                Js::connection_promise_set_cached(this_jsvalue, global_object, JSValue::ZERO);
                promise.as_promise().unwrap().reject(global_object, error_value)?;
            }
        }

        // Call onClose callback if it exists
        if let Some(on_close) = Js::onclose_get_cached(this_jsvalue) {
            if let Err(e) = on_close.call(global_object, this_jsvalue, &[error_value]) {
                global_object.report_active_exception_as_unhandled(e);
            }
        }
        Ok(())
    }

    // Callback for when Valkey client times out
    pub fn on_valkey_timeout(&mut self) {
        let _ = self.client_fail(b"Connection timeout", protocol::RedisError::ConnectionClosed);
    }

    pub fn client_fail(
        &mut self,
        message: &[u8],
        err: protocol::RedisError,
    ) -> jsc::JsTerminatedResult<()> {
        self.client.fail(message, err)
    }

    pub fn fail_with_js_value(&mut self, value: JSValue) {
        let Some(this_value) = self.this_value.try_get() else {
            return;
        };
        let global_object = self.global_object;
        if let Some(on_close) = Js::onclose_get_cached(this_value) {
            let loop_ = self.client.vm.event_loop();
            loop_.enter();
            let _exit = scopeguard::guard((), |_| loop_.exit());
            if let Err(e) = on_close.call(global_object, this_value, &[value]) {
                global_object.report_active_exception_as_unhandled(e);
            }
        }
    }

    fn close_socket_next_tick(&mut self) {
        if self.client.socket.is_closed() {
            return;
        }

        self.ref_();
        // socket close can potentially call JS so we need to enqueue the deinit
        struct Holder {
            // LIFETIMES.tsv: SHARED → Arc<JSValkeyClient>
            // TODO(port): JSValkeyClient uses an *intrusive* RefCount; the Zig code does
            // `this.ref()` before storing the raw `*JSValkeyClient` and `self.ctx.deref()` in
            // run(). Arc<> here would double the refcounting scheme. Phase B should likely use
            // `*mut JSValkeyClient` (BACKREF) and keep the explicit ref/deref pair.
            ctx: Arc<JSValkeyClient>,
            task: jsc::AnyTask,
        }
        impl Holder {
            fn run(self_: *mut Holder) {
                // SAFETY: allocated via Box::into_raw below; reclaimed here.
                let self_ = unsafe { Box::from_raw(self_) };
                // TODO(port): with Arc, mutable access requires interior mutability.
                // Preserving original semantics: close client then deref.
                // SAFETY: single-threaded; intrusive ref guarantees liveness.
                let ctx = Arc::as_ptr(&self_.ctx) as *mut JSValkeyClient;
                unsafe {
                    (*ctx).client.close();
                    (*ctx).deref();
                }
                // self_ dropped here (Box freed).
            }
        }
        // TODO(port): `Arc::from_raw(self)` is wrong for an intrusive-rc payload; placeholder.
        let holder = Box::into_raw(Box::new(Holder {
            ctx: unsafe { Arc::from_raw(self as *const JSValkeyClient) },
            task: jsc::AnyTask::default(), // overwritten below
        }));
        // SAFETY: holder just allocated
        unsafe {
            (*holder).task = jsc::AnyTask::new::<Holder>(Holder::run, holder);
        }

        self.client.vm.enqueue_task(jsc::Task::init(unsafe { &mut (*holder).task }));
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen finalize on the mutator thread.
        let this = unsafe { &mut *this };
        let _d = scopeguard::guard((), |_| this.deref());

        this.stop_timers();
        this.this_value.finalize();
        this.client.flags.finalized = true;
        this.close_socket_next_tick();
        // We do not need to free the subscription context here because we're
        // guaranteed to have freed it by virtue of the fact that we are
        // garbage collected now and the subscription context holds a reference
        // to us. If we still had a subscription context, we would never be
        // garbage collected.
        debug_assert!(!this._subscription_ctx.is_subscriber);
    }

    pub fn stop_timers(&mut self) {
        // Use safe timer removal methods to ensure proper reference counting
        if self.timer.state == Timer::State::ACTIVE {
            let t = &mut self.timer as *mut _;
            self.remove_timer(t);
        }
        if self.reconnect_timer.state == Timer::State::ACTIVE {
            let t = &mut self.reconnect_timer as *mut _;
            self.remove_timer(t);
        }
    }

    fn connect(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.client.flags.needs_to_open_socket = false;
        let vm = self.client.vm;

        self.ref_();
        let _d = scopeguard::guard((), |_| self.deref());

        let is_tls = self.client.tls != valkey::TLS::None;
        let group = if is_tls {
            vm.rare_data().valkey_group(vm, true)
        } else {
            vm.rare_data().valkey_group(vm, false)
        };
        let ssl_ctx: Option<*mut uws::SslCtx> = match &mut self.client.tls {
            valkey::TLS::None => None,
            valkey::TLS::Enabled => Some(vm.rare_data().default_client_ssl_ctx()),
            valkey::TLS::Custom(custom) => 'brk: {
                // Reuse across reconnect — the SSL_CTX is the only thing the
                // old `_socket_ctx` cache existed to preserve.
                if self._secure.is_none() {
                    let mut err = uws::create_bun_socket_error_t::None;
                    // Per-VM weak cache: a `duplicate()`'d client (or any
                    // other client with the same config) hits the same
                    // `SSL_CTX*` instead of rebuilding.
                    match vm.rare_data().ssl_ctx_cache().get_or_create(custom, &mut err) {
                        Some(ctx) => self._secure = Some(ctx),
                        None => {
                            self.client.flags.enable_auto_reconnect = false;
                            self.client_fail(
                                b"Failed to create TLS context",
                                protocol::RedisError::ConnectionClosed,
                            )?;
                            self.client.on_valkey_close()?;
                            self.client.status = valkey::Status::Disconnected;
                            return Ok(());
                        }
                    }
                }
                break 'brk Some(self._secure.unwrap());
            }
        };

        self.ref_();
        // Balance the ref above if connect() throws — the caller (e.g. send())
        // only knows to clean up its own state, not the keep-alive ref.
        let errdefer_deref = scopeguard::guard((), |_| self.deref());
        self.client.status = valkey::Status::Connecting;
        self.update_poll_ref();
        let errdefer_status = scopeguard::guard((), |_| {
            self.client.status = valkey::Status::Disconnected;
            self.update_poll_ref();
        });
        self.client.socket = self
            .client
            .address
            .connect(&mut self.client, group, ssl_ctx, is_tls)?;
        // Disarm errdefers on success.
        scopeguard::ScopeGuard::into_inner(errdefer_status);
        scopeguard::ScopeGuard::into_inner(errdefer_deref);
        Ok(())
    }

    pub fn send(
        &mut self,
        global_this: &JSGlobalObject,
        _this_value: JSValue,
        command: &Command,
    ) -> Result<*mut JSPromise, bun_core::Error> {
        // TODO(port): narrow error set
        if self.client.flags.needs_to_open_socket {
            #[cold]
            fn cold() {}
            cold();

            if let Err(err) = self.connect() {
                self.client.flags.needs_to_open_socket = true;
                let err_value = global_this
                    .err(
                        jsc::ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION,
                        format_args!(" {} connecting to Valkey", err.name()),
                    )
                    .to_js();
                let promise = JSPromise::create(global_this);
                let event_loop = self.client.vm.event_loop();
                event_loop.enter();
                let _exit = scopeguard::guard((), |_| event_loop.exit());
                promise.reject(global_this, err_value)?;
                return Ok(promise);
            }
            self.reset_connection_timeout();
        }

        let _update = scopeguard::guard((), |_| self.update_poll_ref());
        self.client.send(global_this, command)
    }

    // Getter for memory cost - useful for diagnostics
    pub fn memory_cost(&self) -> usize {
        // TODO(markovejnovic): This is most-likely wrong because I didn't know better.
        let mut memory_cost: usize = core::mem::size_of::<JSValkeyClient>();

        // Add size of all internal buffers
        memory_cost += self.client.write_buffer.byte_list.cap as usize;
        memory_cost += self.client.read_buffer.byte_list.cap as usize;

        // Add queue sizes
        memory_cost +=
            self.client.in_flight.count * core::mem::size_of::<valkey::command::PromisePair>();
        for command in self.client.queue.readable_slice(0) {
            memory_cost += command.serialized_data.len();
        }
        memory_cost += self.client.queue.count * core::mem::size_of::<valkey::command::Entry>();
        memory_cost
    }

    // Called by IntrusiveRc when ref_count hits 0.
    fn deinit(this: *mut JSValkeyClient) {
        // SAFETY: last ref dropped; exclusive access.
        let this = unsafe { &mut *this };
        debug_assert!(this.client.socket.is_closed());
        if let Some(s) = this._secure {
            // SAFETY: SSL_CTX is C-refcounted; this releases our ref.
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
        this.client.deinit(None);
        this.poll_ref.disable();
        this.stop_timers();
        RefCount::assert_no_refs(this);

        // bun.destroy(this) → reclaim the Box allocated in `new()`.
        // SAFETY: `this` was created via Box::into_raw in `new()`.
        drop(unsafe { Box::from_raw(this as *mut JSValkeyClient) });
    }

    /// Keep the event loop alive, or don't keep it alive
    ///
    /// This requires this_value to be alive.
    pub fn update_poll_ref(&mut self) {
        // TODO(markovejnovic): This function is such a crazy cop out. We really
        // should be treating valkey as a state machine, with well-defined
        // state and modes in which it tracks and manages its own lifecycle.
        // This is a mess beyond belief and it is incredibly fragile.
        let has_pending_commands = self.client.has_any_pending_commands();

        // isDeletable may throw an exception, and if it does, we have to assume
        // that the object still has references. Best we can do is hope nothing
        // catastrophic happens.
        //
        // Once the JS wrapper has been finalized, the subscription callback map
        // (stored on the JS object) is gone. Reading it would hit `unreachable`
        // in `subscriptionCallbackMap()` because `this_value.tryGet()` returns
        // null for a finalized ref. Short-circuit here: a finalized client has
        // no subscriptions by definition.
        let subs_deletable: bool = self.client.flags.finalized
            || !self
                ._subscription_ctx
                .has_subscriptions(self.global_object)
                .unwrap_or(false);

        let has_activity =
            has_pending_commands || !subs_deletable || self.client.flags.is_reconnecting;

        // There's a couple cases to handle here:
        if has_activity || self.client.status == valkey::Status::Connecting {
            // If we currently have pending activity or we are connecting, we need to keep the
            // event loop alive.
            self.poll_ref.ref_(self.client.vm);
        } else {
            // There is no pending activity so it is safe to remove the event loop.
            self.poll_ref.unref(self.client.vm);
        }

        if self.this_value.is_empty() {
            return;
        }

        // Orthogonal to this, we need to manage the strong reference to the JS object.
        match self.client.status {
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
                self.this_value.upgrade(self.global_object);
            }
            valkey::Status::Disconnected => {
                // If we're disconnected, we need to check if we have any pending activity.
                if has_activity {
                    debug!("upgrading this_value since there is pending activity");
                    // If we have pending activity, we need to keep the object alive.
                    self.this_value.upgrade(self.global_object);
                } else {
                    debug!("downgrading this_value since there is no pending activity");
                    // If we don't have any pending activity, we can drop the strong reference.
                    self.this_value.downgrade();
                }
            }
        }
    }
}

// Re-export all command host fns from js_valkey_functions.
// (Zig: `pub const X = fns.X;` × ~160)
pub use fns::{
    append, bitcount, blmove, blmpop, blpop, brpop, brpoplpush, bzmpop, bzpopmax, bzpopmin, copy,
    decr, decrby, del, dump, duplicate, exists, expire, expireat, expiretime, get, get_buffer,
    getbit, getdel, getex, getrange, getset, hdel, hexists, hexpire, hexpireat, hexpiretime, hget,
    hgetall, hgetdel, hgetex, hincrby, hincrbyfloat, hkeys, hlen, hmget, hmset, hpersist, hpexpire,
    hpexpireat, hpexpiretime, hpttl, hrandfield, hscan, hset, hsetex, hsetnx, hstrlen, httl,
    hvals, incr, incrby, incrbyfloat, js_send, keys, lindex, linsert, llen, lmove, lmpop, lpop,
    lpos, lpush, lpushx, lrange, lrem, lset, ltrim, mget, mset, msetnx, persist, pexpire,
    pexpireat, pexpiretime, pfadd, ping, psetex, psubscribe, pttl, publish, pubsub, punsubscribe,
    randomkey, rename, renamenx, rpop, rpoplpush, rpush, rpushx, sadd, scan, scard, script, sdiff,
    sdiffstore, select, set, setbit, setex, setnx, setrange, sinter, sintercard, sinterstore,
    sismember, smembers, smismember, smove, spop, spublish, srandmember, srem, sscan, strlen,
    subscribe, substr, sunion, sunionstore, touch, ttl, r#type, unlink, unsubscribe, zadd, zcard,
    zcount, zdiff, zdiffstore, zincrby, zinter, zintercard, zinterstore, zlexcount, zmpop, zmscore,
    zpopmax, zpopmin, zrandmember, zrange, zrangebylex, zrangebyscore, zrangestore, zrank, zrem,
    zremrangebylex, zremrangebyrank, zremrangebyscore, zrevrange, zrevrangebylex, zrevrangebyscore,
    zrevrank, zscan, zscore, zunion, zunionstore,
};

// ───────────────────────────────────────────────────────────────────────────
// SocketHandler
// ───────────────────────────────────────────────────────────────────────────

/// Referenced by `dispatch.zig` (kind = `.valkey[_tls]`).
pub struct SocketHandler<const SSL: bool>;

impl<const SSL: bool> SocketHandler<SSL> {
    type SocketType = uws::NewSocketHandler<SSL>;

    fn _socket(s: Self::SocketType) -> Socket {
        if SSL {
            Socket::SocketTLS(s)
        } else {
            Socket::SocketTCP(s)
        }
    }

    pub fn on_open(
        this: &mut JSValkeyClient,
        socket: Self::SocketType,
    ) -> jsc::JsTerminatedResult<()> {
        this.client.socket = Self::_socket(socket);
        this.client.on_open(Self::_socket(socket))
    }

    fn on_handshake_(
        this: &mut JSValkeyClient,
        _socket: impl core::any::Any, // anytype
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> jsc::JsTerminatedResult<()> {
        debug!(
            "onHandshake: {} error={} reason={} code={}",
            success,
            ssl_error.error_no,
            if !ssl_error.reason.is_null() {
                // SAFETY: NUL-terminated C string from BoringSSL
                bstr::BStr::new(unsafe { core::ffi::CStr::from_ptr(ssl_error.reason) }.to_bytes())
            } else {
                bstr::BStr::new(b"no reason")
            },
            if !ssl_error.code.is_null() {
                // SAFETY: NUL-terminated C string from BoringSSL
                bstr::BStr::new(unsafe { core::ffi::CStr::from_ptr(ssl_error.code) }.to_bytes())
            } else {
                bstr::BStr::new(b"no code")
            },
        );
        let handshake_success = success == 1;
        this.ref_();
        let _d = scopeguard::guard((), |_| this.deref());
        let _update = scopeguard::guard((), |_| this.update_poll_ref());
        let vm = this.client.vm;
        if handshake_success {
            if this.client.tls.reject_unauthorized(vm) {
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
                let ssl_ptr: *mut boringssl::c::SSL =
                    this.client.socket.get_native_handle().cast();
                // SAFETY: SSL_get_servername returns null or NUL-terminated.
                let mut hostname: &[u8] = if let Some(servername) =
                    unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0).as_ref() }
                {
                    // SAFETY: NUL-terminated
                    unsafe { core::ffi::CStr::from_ptr(servername as *const _ as *const _) }
                        .to_bytes()
                } else {
                    match &this.client.address {
                        valkey::Address::Host(h) => h.host,
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
                    && !boringssl::check_server_identity(ssl_ptr, hostname)
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
            this.client.start()?;
        } else {
            // if we are here is because the server rejected us, and the error_no is the cause of
            // this no matter if reject_unauthorized is false, because we were disconnected by the
            // server
            return Self::fail_handshake_with_verify_error(this, vm, &ssl_error);
        }
        Ok(())
    }

    fn fail_handshake_with_verify_error(
        this: &mut JSValkeyClient,
        vm: &VirtualMachine,
        ssl_error: &uws::us_bun_verify_error_t,
    ) -> jsc::JsTerminatedResult<()> {
        let ssl_js_value = match ssl_error.to_js(this.global_object) {
            Ok(v) => v,
            Err(err) => match err {
                e if e == jsc::JsError::Terminated => return Err(jsc::JsError::Terminated),
                e if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                _ /* JSError */ => {
                    // Clear any pending exception since we can't convert it to JS,
                    // but still fail-close the connection so we never fall through
                    // to the authenticated state after a rejected handshake.
                    this.global_object.clear_exception();
                    this.client.flags.is_authenticated = false;
                    this.client.flags.is_manually_closed = true;
                    this.client.close();
                    return Ok(());
                }
            },
        };
        Self::fail_handshake(this, vm, ssl_js_value)
    }

    fn fail_handshake(
        this: &mut JSValkeyClient,
        vm: &VirtualMachine,
        err_value: JSValue,
    ) -> jsc::JsTerminatedResult<()> {
        this.client.flags.is_authenticated = false;
        let loop_ = vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());
        this.client.flags.is_manually_closed = true;
        let _close = scopeguard::guard((), |_| this.client.close());
        this.client.fail_with_js_value(this.global_object, err_value)
    }

    // `pub const onHandshake = if (ssl) onHandshake_ else null;`
    // TODO(port): conditional associated const fn pointer; Phase B can specialize via
    // `if SSL { Some(Self::on_handshake_) } else { None }` at registration site.
    pub const ON_HANDSHAKE: Option<
        fn(
            &mut JSValkeyClient,
            (),
            i32,
            uws::us_bun_verify_error_t,
        ) -> jsc::JsTerminatedResult<()>,
    > = if SSL {
        // TODO(port): cannot directly cast generic-anytype fn here; placeholder.
        None
    } else {
        None
    };

    pub fn on_close(
        this: &mut JSValkeyClient,
        _socket: Self::SocketType,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) {
        // No need to deref since this.client.on_close() invokes on_valkey_close which does deref.

        debug!("Socket closed.");
        this.ref_();
        // Ensure the socket pointer is updated.
        this.client.socket = Socket::SocketTCP(uws::SocketTCP::detached());
        let _defer = scopeguard::guard((), |_| {
            this.client.status = valkey::Status::Disconnected;
            this.update_poll_ref();
            this.deref();
        });

        let _ = this.client.on_close(); // TODO: properly propagate exception upwards
    }

    pub fn on_end(this: &mut JSValkeyClient, socket: Self::SocketType) {
        let _ = this;
        let _ = socket;

        // Half-opened sockets are not allowed.
        // usockets will always call onClose after onEnd in this case so we don't need to do
        // anything here
    }

    pub fn on_connect_error(
        this: &mut JSValkeyClient,
        _socket: Self::SocketType,
        _code: i32,
    ) -> jsc::JsTerminatedResult<()> {
        // Ensure the socket pointer is updated.
        this.client.socket = Socket::SocketTCP(uws::SocketTCP::detached());
        this.ref_();
        let _defer = scopeguard::guard((), |_| {
            this.client.status = valkey::Status::Disconnected;
            this.update_poll_ref();
            this.deref();
        });

        this.client.on_close()
    }

    pub fn on_timeout(this: &mut JSValkeyClient, socket: Self::SocketType) {
        debug!("Socket timed out.");

        this.client.socket = Self::_socket(socket);
        // Handle socket timeout
    }

    pub fn on_data(this: &mut JSValkeyClient, socket: Self::SocketType, data: &[u8]) {
        // Ensure the socket pointer is updated.
        this.client.socket = Self::_socket(socket);

        this.ref_();
        let _d = scopeguard::guard((), |_| this.deref());
        let _ = this.client.on_data(data); // TODO: properly propagate exception upwards
        this.update_poll_ref();
    }

    pub fn on_writable(this: &mut JSValkeyClient, socket: Self::SocketType) {
        this.client.socket = Self::_socket(socket);
        this.ref_();
        let _d = scopeguard::guard((), |_| this.deref());
        this.client.on_writable();
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
    ) -> Result<valkey::Options, bun_core::Error> {
        // TODO(port): narrow error set
        let mut this = valkey::Options {
            enable_auto_pipelining: !bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING
                .get(),
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
                if let Some(ssl_config) =
                    SSLConfig::from_js(global_object.bun_vm(), global_object, tls)?
                {
                    this.tls = valkey::TLS::Custom(ssl_config);
                } else {
                    return Err(global_object
                        .throw_invalid_argument_type("tls", "tls", "object")
                        .into());
                }
            } else {
                return Err(global_object
                    .throw_invalid_argument_type("tls", "tls", "boolean or object")
                    .into());
            }
        }

        Ok(this)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/js_valkey.zig (1674 lines)
//   confidence: medium
//   todos:      17
//   notes:      Holder.ctx Arc<> from LIFETIMES.tsv conflicts with intrusive RefCount; scopeguard closures capture &mut self (borrowck reshaping needed in Phase B); ValkeyClient/Address/Flags struct shapes assumed; ON_HANDSHAKE const-fn-ptr needs specialization.
// ──────────────────────────────────────────────────────────────────────────
