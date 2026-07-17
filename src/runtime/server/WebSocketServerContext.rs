use core::ffi::c_void;

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_uws as uws;

pub struct WebSocketServerContext {
    // Set provisionally in `on_create`; the server overwrites it on
    // adoption. LIFETIMES.tsv = JSC_BORROW — the global outlives the context.
    pub global_object: bun_ptr::BackRef<JSGlobalObject>,
    pub handler: Handler,

    pub max_payload_length: u32, // default 16MB
    pub max_lifetime: u16,
    pub idle_timeout: u16, // default 2 minutes
    pub compression: i32,
    pub backpressure_limit: u32, // default 16MB
    pub send_pings_automatically: bool,
    pub reset_idle_timeout_on_send: bool,
    pub close_on_backpressure_limit: bool,
}

pub struct Handler {
    pub on_open: JSValue,
    pub on_message: JSValue,
    pub on_close: JSValue,
    pub on_drain: JSValue,
    pub on_error: JSValue,
    pub on_ping: JSValue,
    pub on_pong: JSValue,

    pub app: Option<*mut c_void>,
    /// Type-erased backref to the owning `NewServer`, set alongside `app`
    /// in `set_routes` (so it is in place before any socket can upgrade and
    /// refreshed whenever a reload installs a new context).
    /// `ServerWebSocket::init` reads it to write the server JS wrapper into the
    /// per-socket `m_server` traced slot (keeping the wrapper, and the `m_ws*`
    /// handler slots it carries, reachable while any socket is connected), and
    /// `ServerWebSocket` open/close events route the live-socket accounting
    /// through it.
    pub server: Option<super::AnyServer>,

    // Always set manually.
    // LIFETIMES.tsv = STATIC (vm) / JSC_BORROW (global_object) — both outlive the handler.
    pub vm: bun_ptr::BackRef<VirtualMachine>,
    pub global_object: bun_ptr::BackRef<JSGlobalObject>,

    /// used by publish()
    pub flags: HandlerFlags,
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct HandlerFlags: u8 {
        const SSL             = 1 << 0;
        const PUBLISH_TO_SELF = 1 << 1;
        // remaining 6 bits: padding
    }
}

impl Handler {
    /// `global_object` is a `BackRef` set by the server before any websocket
    /// connection exists; the global outlives every `ServerWebSocket`.
    #[inline]
    pub fn global_object(&self) -> &JSGlobalObject {
        self.global_object.get()
    }

    /// `vm` is a `BackRef`; the VM is `'static` per LIFETIMES.tsv (set in
    /// `from_js`).
    #[inline]
    pub fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    /// `on_error` must be copied to a stack local by the caller before any
    /// user JS runs: a re-entrant `ws.close()` on the last socket of a stopped
    /// server can downgrade the wrapper (the sole GC root for `wsOnError`)
    /// mid-handler, so a fresh `self.on_error` read after user JS could be a
    /// freed cell.
    pub fn run_error_callback(
        &self,
        on_error: JSValue,
        vm: &VirtualMachine,
        global_object: &JSGlobalObject,
        error_value: JSValue,
    ) {
        // Termination raised inside the preceding callback.call() cannot be
        // cleared; entering JS again trips executeCallImpl's assertNoException.
        if global_object.has_exception() {
            return;
        }
        if !on_error.is_empty_or_undefined_or_null() {
            let _ = on_error
                .call(global_object, JSValue::UNDEFINED, &[error_value])
                .map_err(|err| self.global_object.report_active_exception_as_unhandled(err));
            return;
        }

        // VirtualMachine is the
        // process-lifetime singleton (LIFETIMES.tsv = STATIC) and is only touched on the JS
        // thread; `uncaught_exception` needs `&mut` to bump counters / set flags. Derive the
        // mutable pointer from the stored BackRef (== `vm`) rather than casting the
        // shared ref, which rustc's invalid_reference_casting lint rejects.
        let _ = vm;
        let mut vm_ref = self.vm;
        // SAFETY: process-lifetime singleton; sole `&mut` on the JS thread.
        let vm_mut = unsafe { vm_ref.get_mut() };
        let _ = vm_mut.uncaught_exception(global_object, error_value, false);
    }

    pub fn from_js(global_object: &JSGlobalObject, object: JSValue) -> JsResult<Handler> {
        let mut handler = Handler {
            on_open: JSValue::ZERO,
            on_message: JSValue::ZERO,
            on_close: JSValue::ZERO,
            on_drain: JSValue::ZERO,
            on_error: JSValue::ZERO,
            on_ping: JSValue::ZERO,
            on_pong: JSValue::ZERO,
            app: None,
            server: None,
            vm: bun_ptr::BackRef::new(VirtualMachine::get()),
            global_object: bun_ptr::BackRef::new(global_object),
            flags: HandlerFlags::empty(),
        };

        let mut valid = false;

        // NOTE: iterate over (key, &mut field) pairs — disjoint field borrows are allowed.
        let pairs: [(&'static str, &mut JSValue); 7] = [
            ("error", &mut handler.on_error),
            ("message", &mut handler.on_message),
            ("open", &mut handler.on_open),
            ("close", &mut handler.on_close),
            ("drain", &mut handler.on_drain),
            ("ping", &mut handler.on_ping),
            ("pong", &mut handler.on_pong),
        ];
        for (i, (key, field)) in pairs.into_iter().enumerate() {
            if let Some(value) = object.get_truthy(global_object, key)? {
                if !value.is_cell() || !value.is_callable() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "websocket expects a function for the '{}' option",
                        key
                    )));
                }
                // Raw value — async-context wrapping is deferred to
                // `NewServer::write_ws_handler_slots` so the wrapped fn is
                // rooted by the wrapper's WriteBarrier slot immediately.
                *field = value;
                if i > 0 {
                    // anything other than "error" is considered valid.
                    valid = true;
                }
            }
        }

        if valid {
            return Ok(handler);
        }

        Err(global_object.throw_invalid_arguments(format_args!(
            "WebSocketServerContext expects a message handler"
        )))
    }
}

impl WebSocketServerContext {
    pub fn to_behavior(&self) -> uws::WebSocketBehavior {
        uws::WebSocketBehavior {
            max_payload_length: self.max_payload_length,
            idle_timeout: self.idle_timeout,
            compression: self.compression,
            max_backpressure: self.backpressure_limit,
            send_pings_automatically: self.send_pings_automatically,
            max_lifetime: self.max_lifetime,
            reset_idle_timeout_on_send: self.reset_idle_timeout_on_send,
            close_on_backpressure_limit: self.close_on_backpressure_limit,
            ..Default::default()
        }
    }
}

bun_core::comptime_string_map! {
    static COMPRESS_TABLE: i32 = {
        b"disable" => 0,
        b"shared" => uws::SHARED_COMPRESSOR,
        b"dedicated" => uws::DEDICATED_COMPRESSOR,
        b"3KB" => uws::DEDICATED_COMPRESSOR_3KB,
        b"4KB" => uws::DEDICATED_COMPRESSOR_4KB,
        b"8KB" => uws::DEDICATED_COMPRESSOR_8KB,
        b"16KB" => uws::DEDICATED_COMPRESSOR_16KB,
        b"32KB" => uws::DEDICATED_COMPRESSOR_32KB,
        b"64KB" => uws::DEDICATED_COMPRESSOR_64KB,
        b"128KB" => uws::DEDICATED_COMPRESSOR_128KB,
        b"256KB" => uws::DEDICATED_COMPRESSOR_256KB,
    };
}

bun_core::comptime_string_map! {
    static DECOMPRESS_TABLE: i32 = {
        b"disable" => 0,
        b"shared" => uws::SHARED_DECOMPRESSOR,
        b"dedicated" => uws::DEDICATED_DECOMPRESSOR,
        b"3KB" => uws::DEDICATED_COMPRESSOR_3KB,
        b"4KB" => uws::DEDICATED_COMPRESSOR_4KB,
        b"8KB" => uws::DEDICATED_COMPRESSOR_8KB,
        b"16KB" => uws::DEDICATED_COMPRESSOR_16KB,
        b"32KB" => uws::DEDICATED_COMPRESSOR_32KB,
        b"64KB" => uws::DEDICATED_COMPRESSOR_64KB,
        b"128KB" => uws::DEDICATED_COMPRESSOR_128KB,
        b"256KB" => uws::DEDICATED_COMPRESSOR_256KB,
    };
}

// The key may be a possibly-UTF-16 ZigString. Derive a UTF-8 view
// first (`to_slice_fast` allocates only for 16-bit-backed strings) so
// UTF-16-backed option strings like `compression: "16KB"` still match.
fn lookup_zig_string<M: bun_core::comptime_string_map::ComptimeStringMap<Value = i32>>(
    table: &M,
    key: &bun_core::ZigString,
) -> Option<i32> {
    let utf8 = key.to_slice_fast();
    table.lookup(utf8.slice()).copied()
}

pub(crate) fn on_create(
    global_object: &JSGlobalObject,
    object: JSValue,
) -> JsResult<WebSocketServerContext> {
    // Construct the struct with the handler and explicit defaults up front.
    // The top-level `global_object` is provisionally set to the param; the
    // server overwrites it after `on_create` returns anyway.
    let handler = Handler::from_js(global_object, object)?;
    let mut server = WebSocketServerContext {
        global_object: bun_ptr::BackRef::new(global_object),
        handler,
        max_payload_length: 1024 * 1024 * 16, // 16MB
        max_lifetime: 0,
        idle_timeout: 120, // 2 minutes
        compression: 0,
        backpressure_limit: 1024 * 1024 * 16, // 16MB
        send_pings_automatically: true,
        reset_idle_timeout_on_send: true,
        close_on_backpressure_limit: false,
    };

    if let Some(per_message_deflate) = object.get(global_object, "perMessageDeflate")? {
        'getter: {
            if per_message_deflate.is_undefined() {
                break 'getter;
            }

            if per_message_deflate.is_boolean() || per_message_deflate.is_null() {
                if per_message_deflate.to_boolean() {
                    server.compression = uws::SHARED_COMPRESSOR | uws::SHARED_DECOMPRESSOR;
                } else {
                    server.compression = 0;
                }
                break 'getter;
            }

            if !per_message_deflate.is_object() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects perMessageDeflate to be a boolean or an object"
                )));
            }

            if let Some(compression) = per_message_deflate.get_truthy(global_object, "compress")? {
                if compression.is_boolean() {
                    server.compression |= if compression.to_boolean() {
                        uws::SHARED_COMPRESSOR
                    } else {
                        0
                    };
                } else if compression.is_string() {
                    let key = compression.get_zig_string(global_object)?;
                    let Some(v) = lookup_zig_string(&COMPRESS_TABLE, &key) else {
                        return Err(global_object.throw_invalid_arguments(format_args!(
                            "WebSocketServerContext expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\""
                        )));
                    };
                    server.compression |= v;
                } else {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "websocket expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\""
                    )));
                }
            }

            if let Some(compression) =
                per_message_deflate.get_truthy(global_object, "decompress")?
            {
                if compression.is_boolean() {
                    server.compression |= if compression.to_boolean() {
                        uws::SHARED_DECOMPRESSOR
                    } else {
                        0
                    };
                } else if compression.is_string() {
                    let key = compression.get_zig_string(global_object)?;
                    let Some(v) = lookup_zig_string(&DECOMPRESS_TABLE, &key) else {
                        return Err(global_object.throw_invalid_arguments(format_args!(
                            "websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\""
                        )));
                    };
                    server.compression |= v;
                } else {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\""
                    )));
                }
            }
        }
    }

    if let Some(value) = object.get(global_object, "maxPayloadLength")? {
        if !value.is_undefined_or_null() {
            if !value.is_any_int() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects maxPayloadLength to be an integer"
                )));
            }
            server.max_payload_length = value.to_int64().max(0) as u32;
        }
    }

    if let Some(value) = object.get(global_object, "idleTimeout")? {
        if !value.is_undefined_or_null() {
            if !value.is_any_int() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects idleTimeout to be an integer"
                )));
            }

            let mut idle_timeout: u16 = value.to_int64().max(0) as u16;
            if idle_timeout > 960 {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects idleTimeout to be 960 or less"
                )));
            } else if idle_timeout > 0 {
                // uws does not allow idleTimeout to be between (0, 8),
                // since its timer is not that accurate, therefore round up.
                idle_timeout = idle_timeout.max(8);
            }

            server.idle_timeout = idle_timeout;
        }
    }
    if let Some(value) = object.get(global_object, "backpressureLimit")? {
        if !value.is_undefined_or_null() {
            if !value.is_any_int() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects backpressureLimit to be an integer"
                )));
            }

            server.backpressure_limit = value.to_int64().max(0) as u32;
        }
    }

    if let Some(value) = object.get(global_object, "closeOnBackpressureLimit")? {
        if !value.is_undefined_or_null() {
            if !value.is_boolean() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects closeOnBackpressureLimit to be a boolean"
                )));
            }

            server.close_on_backpressure_limit = value.to_boolean();
        }
    }

    if let Some(value) = object.get(global_object, "sendPings")? {
        if !value.is_undefined_or_null() {
            if !value.is_boolean() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects sendPings to be a boolean"
                )));
            }

            server.send_pings_automatically = value.to_boolean();
        }
    }

    if let Some(value) = object.get(global_object, "publishToSelf")? {
        if !value.is_undefined_or_null() {
            if !value.is_boolean() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "websocket expects publishToSelf to be a boolean"
                )));
            }

            server
                .handler
                .flags
                .set(HandlerFlags::PUBLISH_TO_SELF, value.to_boolean());
        }
    }

    Ok(server)
}
