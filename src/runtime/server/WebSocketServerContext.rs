use core::ffi::c_void;

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_core::comptime_string_map::ComptimeStringMap as _;
use bun_uws as uws;
use bun_uws_sys::h2 as uws_h2;

pub(crate) struct WebSocketServerContext {
    pub(crate) handler: Handler,

    pub(crate) max_payload_length: u32, // default 16MB
    pub(crate) max_lifetime: u16,
    pub(crate) idle_timeout: u16, // default 2 minutes
    pub(crate) compression: i32,
    pub(crate) backpressure_limit: u32, // default 16MB
    pub(crate) send_pings_automatically: bool,
    pub(crate) reset_idle_timeout_on_send: bool,
    pub(crate) close_on_backpressure_limit: bool,
}

pub(crate) struct Handler {
    pub(crate) on_open: JSValue,
    pub(crate) on_message: JSValue,
    pub on_close: JSValue,
    pub(crate) on_drain: JSValue,
    pub(crate) on_error: JSValue,
    pub(crate) on_ping: JSValue,
    pub(crate) on_pong: JSValue,

    pub(crate) app: Option<*mut c_void>,
    pub(crate) h2_app: Option<*mut uws_h2::App>,
    /// Type-erased backref to the owning `NewServer`, set alongside `app`
    /// in `set_routes` (so it is in place before any socket can upgrade and
    /// refreshed whenever a reload installs a new context).
    /// `ServerWebSocket::init` reads it to write the server JS wrapper into the
    /// per-socket `m_server` traced slot (keeping the wrapper, and the `m_ws*`
    /// handler slots it carries, reachable while any socket is connected), and
    /// `ServerWebSocket` open/close events route the live-socket accounting
    /// through it.
    pub(crate) server: Option<super::AnyServer>,

    // Always set manually.
    // LIFETIMES.tsv = STATIC (vm) / JSC_BORROW (global_object) — both outlive the handler.
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>,
    pub(crate) global_object: bun_ptr::BackRef<JSGlobalObject>,
    /// The context of the script that gave these handlers: a websocket event is dispatched inside it.
    pub(crate) context: bun_jsc::ContextId,

    /// used by publish()
    pub(crate) flags: HandlerFlags,
}

/// Copy-only view used across a potentially re-entrant JavaScript callback.
/// `server.reload()` updates the stable Handler slot in place, so no `&Handler`
/// may remain live while user code runs. The callback being invoked is rooted
/// by the server wrapper until the call starts and by JSC's call frame while it
/// runs. Only the old error callback needs an explicit pin across a re-entrant
/// reload because it can still be invoked after the primary callback returns.
#[derive(Clone, Copy)]
pub(crate) struct HandlerSnapshot {
    pub(crate) on_open: JSValue,
    pub(crate) on_message: JSValue,
    pub(crate) on_close: JSValue,
    pub(crate) on_drain: JSValue,
    pub(crate) on_error: JSValue,
    pub(crate) on_ping: JSValue,
    pub(crate) on_pong: JSValue,
    pub(crate) server: Option<super::AnyServer>,
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>,
    pub(crate) global_object: bun_ptr::BackRef<JSGlobalObject>,
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
    #[inline]
    pub(crate) fn snapshot(&self) -> HandlerSnapshot {
        HandlerSnapshot {
            on_open: self.on_open,
            on_message: self.on_message,
            on_close: self.on_close,
            on_drain: self.on_drain,
            on_error: self.on_error,
            on_ping: self.on_ping,
            on_pong: self.on_pong,
            server: self.server,
            vm: self.vm,
            global_object: self.global_object,
        }
    }

    /// `global_object` is a `BackRef` set by the server before any websocket
    /// connection exists; the global outlives every `ServerWebSocket`.
    #[inline]
    pub(crate) fn global_object(&self) -> &JSGlobalObject {
        self.global_object.get()
    }

    /// `vm` is a `BackRef`; the VM is `'static` per LIFETIMES.tsv (set in
    /// `from_js`).
    #[inline]
    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    pub(crate) fn from_js(global_object: &JSGlobalObject, object: JSValue) -> JsResult<Handler> {
        let mut handler = Handler {
            on_open: JSValue::ZERO,
            on_message: JSValue::ZERO,
            on_close: JSValue::ZERO,
            on_drain: JSValue::ZERO,
            on_error: JSValue::ZERO,
            on_ping: JSValue::ZERO,
            on_pong: JSValue::ZERO,
            app: None,
            h2_app: None,
            server: None,
            vm: bun_ptr::BackRef::new(VirtualMachine::get()),
            global_object: bun_ptr::BackRef::new(global_object),
            context: global_object.bun_vm().context_of_caller_no_frame().id(),
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

impl HandlerSnapshot {
    #[inline]
    pub(crate) fn global_object(&self) -> &JSGlobalObject {
        self.global_object.get()
    }

    #[inline]
    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    /// Route an error from a WebSocket callback without reading the live
    /// handler slot again after user JavaScript may have reloaded it.
    pub(crate) fn run_error_callback(
        &self,
        global_object: &JSGlobalObject,
        error_value: JSValue,
    ) -> JsResult<()> {
        if global_object.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }
        if !self.on_error.is_empty_or_undefined_or_null() {
            global_object.bun_vm().event_loop_mut().run_callback(
                bun_event_loop::ContextId::NONE,
                self.on_error,
                global_object,
                JSValue::UNDEFINED,
                &[error_value],
            );
            return Ok(());
        }

        let _ =
            VirtualMachine::get()
                .as_mut()
                .uncaught_exception(global_object, error_value, false);
        Ok(())
    }

    #[inline]
    pub(crate) fn protect_error_handler(&self) -> Option<bun_jsc::js_value::Protected> {
        (!self.on_error.is_empty_or_undefined_or_null()).then(|| self.on_error.protected())
    }
}

impl WebSocketServerContext {
    /// Apply reloadable WebSocket options without moving the handler storage.
    /// Existing H1/H2 sockets retain a `BackRef` to `self.handler`, so its
    /// address is a server-lifetime invariant.
    pub(crate) fn update_from(&mut self, replacement: Self) {
        self.handler.on_open = replacement.handler.on_open;
        self.handler.on_message = replacement.handler.on_message;
        self.handler.on_close = replacement.handler.on_close;
        self.handler.on_drain = replacement.handler.on_drain;
        self.handler.on_error = replacement.handler.on_error;
        self.handler.on_ping = replacement.handler.on_ping;
        self.handler.on_pong = replacement.handler.on_pong;
        self.handler.flags = replacement.handler.flags;

        self.max_payload_length = replacement.max_payload_length;
        self.max_lifetime = replacement.max_lifetime;
        self.idle_timeout = replacement.idle_timeout;
        self.compression = replacement.compression;
        self.backpressure_limit = replacement.backpressure_limit;
        self.send_pings_automatically = replacement.send_pings_automatically;
        self.reset_idle_timeout_on_send = replacement.reset_idle_timeout_on_send;
        self.close_on_backpressure_limit = replacement.close_on_backpressure_limit;
    }

    pub(crate) fn to_behavior(&self) -> uws::WebSocketBehavior {
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

pub(crate) fn on_create(
    global_object: &JSGlobalObject,
    object: JSValue,
) -> JsResult<WebSocketServerContext> {
    // Construct the struct with the handler and explicit defaults up front.
    let handler = Handler::from_js(global_object, object)?;
    let mut server = WebSocketServerContext {
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
                    let key = compression.to_js_string_view(global_object)?;
                    let Some(&v) = COMPRESS_TABLE.lookup(key.to_utf8().slice()) else {
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
                    let key = compression.to_js_string_view(global_object)?;
                    let Some(&v) = DECOMPRESS_TABLE.lookup(key.to_utf8().slice()) else {
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
