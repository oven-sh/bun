use crate::node::BlobOrStringOrBuffer as JSArgument;
use bun_collections::VecExt as _;
use bun_core::OwnedString;
use bun_jsc::{
    self as jsc, CallFrame, ErrorCode, JSGlobalObject, JSPromise, JSPropertyIterator, JSValue,
    JsRef, JsResult, Local, Scope,
};

use super::js_valkey::{JSValkeyClient, SubscriptionCtx};
use super::protocol_jsc as protocol;
use super::valkey;
use super::valkey_command_body::{Args as CommandArgs, Command, Meta as CommandMeta};

type Slice = bun_jsc::ZigStringSlice;

/// Reinterpret an ASCII byte-string literal as `&str` for the
/// `throw_invalid_argument_type` family (which take `&'static str`).
/// SAFETY: every command/method name passed to the `cmd_*!` macros is a
/// static ASCII byte-string literal, so it is always valid UTF-8.
#[inline(always)]
const fn bname(b: &'static [u8]) -> &'static str {
    // SAFETY: every caller passes a `b"..."` ASCII literal (command/method
    // names from the `cmd_*!` macros), which is guaranteed valid UTF-8.
    unsafe { core::str::from_utf8_unchecked(b) }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

fn require_not_subscriber(this: &JSValkeyClient, function_name: &[u8]) -> JsResult<()> {
    if this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{} cannot be called while in subscriber mode.",
                    bstr::BStr::new(function_name)
                ),
            )
            .throw());
    }
    Ok(())
}

fn require_subscriber(this: &JSValkeyClient, function_name: &[u8]) -> JsResult<()> {
    if !this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{} can only be called while in subscriber mode.",
                    bstr::BStr::new(function_name)
                ),
            )
            .throw());
    }
    Ok(())
}

fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<JSArgument>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }

    if value.is_number() {
        // Allow numbers to be passed as strings.
        let str = value.to_js_string(global)?;
        return JSArgument::from_js_maybe_file(global, str.to_js(), true);
    }

    JSArgument::from_js_maybe_file(global, value, false)
}

/// Shim around `protocol::valkey_error_to_js` that:
/// 1. accepts whatever error type `JSValkeyClient::send` currently returns
///    (presently `crate::Error`) and
///    converts it to `RedisError` so the user-visible error code matches the
///    real failure variant, and
/// 2. wraps the resulting `JSValue` in `Ok` for use in `JsResult<JSValue>`
///    host functions.
#[inline]
fn send_err_to_js(global: &JSGlobalObject, message: &str, err: &crate::Error) -> JsResult<JSValue> {
    use bun_valkey::valkey_protocol::RedisError;
    let redis_err = err.name().parse().unwrap_or(RedisError::ConnectionClosed);
    Ok(protocol::valkey_error_to_js(global, message, redis_err))
}

/// `JSValkeyClient::send` returns a `*mut JSPromise`; route through the
/// `opaque_ffi!` ZST accessor instead of an open-coded raw deref.
#[inline]
fn promise_to_js(p: *mut JSPromise) -> JSValue {
    JSPromise::opaque_ref(p).to_js()
}

/// Shared epilog for every Valkey prototype method: build a `Command`,
/// `this.send()` it, and convert the result to a `JsResult<JSValue>` —
/// `Ok(promise.toJS())` on success, a JS-side Redis error value on failure.
///
/// All 7 `cmd_*!` macros and ~24 hand-written methods (`get`, `getBuffer`,
/// `set`, `incr`, `decr`, `exists`, `expire`, `ttl`, `srem`, `sadd`,
/// `sismember`, `hmget`, `hincrby`, `hset`, `smove`, `publish`,
/// `send_unsubscribe_request_and_cleanup`, …) duplicated this 15-line block
/// byte-identically; the only per-caller variation is the args slice, the
/// `meta` flags, and the error-message prefix.
#[inline]
fn send_cmd(
    this: &JSValkeyClient,
    global: &JSGlobalObject,
    this_js: JSValue,
    command: &[u8],
    args: CommandArgs<'_>,
    meta: CommandMeta,
    err_msg: &str,
) -> JsResult<JSValue> {
    match this.send(
        global,
        this_js,
        &Command {
            command,
            args,
            meta,
        },
    ) {
        Ok(p) => Ok(promise_to_js(p)),
        Err(err) => send_err_to_js(global, err_msg, &err),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// compile: command generators
// ──────────────────────────────────────────────────────────────────────────

pub(crate) mod compile {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
    pub(crate) enum ClientStateRequirement {
        /// The client must not be a subscriber (not in subscription mode).
        NotSubscriber,
        /// We don't care about the client state (subscriber or not).
        DontCare,
    }

    pub(crate) fn test_correct_state<const REQ: ClientStateRequirement>(
        this: &JSValkeyClient,
        js_client_prototype_function_name: &[u8],
    ) -> JsResult<()> {
        match REQ {
            ClientStateRequirement::NotSubscriber => {
                require_not_subscriber(this, js_client_prototype_function_name)
            }
            ClientStateRequirement::DontCare => Ok(()),
        }
    }
}

// Note: each command-shape generator is a `macro_rules!` that emits a
// `#[bun_jsc::host_fn(method)]` inside the `impl JSValkeyClient` block:
// cmd_noargs! (), cmd_key! (key: RedisKey),
// cmd_key_varargs! (key: RedisKey, ...args: RedisKey[]),
// cmd_key_value! (key: RedisKey, value: RedisValue),
// cmd_key_value_value2! (key: RedisKey, value: RedisValue, value2: RedisValue),
// cmd_strings_varargs! (...strings: string[]),
// cmd_key_value_varargs! (key: RedisKey, value: RedisValue, ...args: RedisValue)

macro_rules! cmd_noargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&[]),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_key {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg0_name,
                    "string or buffer",
                ));
            };
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&[key]),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_key_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            if frame.argument(0).is_undefined_or_null() {
                return Err(global.throw_missing_arguments_value(&[$arg0_name]));
            }

            let arguments = frame.arguments();
            let mut args: Vec<JSArgument> = Vec::with_capacity(arguments.len());

            for arg in arguments {
                if arg.is_undefined_or_null() {
                    continue;
                }

                let Some(another) = from_js(global, *arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        bname($name),
                        "additional arguments",
                        "string or buffer",
                    ));
                };
                args.push(another);
            }
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&args),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_key_value {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg0_name,
                    "string or buffer",
                ));
            };
            let Some(value) = from_js(global, frame.argument(1))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg1_name,
                    "string or buffer",
                ));
            };
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&[key, value]),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_key_value_value2 {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $arg2_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg0_name,
                    "string or buffer",
                ));
            };
            let Some(value) = from_js(global, frame.argument(1))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg1_name,
                    "string or buffer",
                ));
            };
            let Some(value2) = from_js(global, frame.argument(2))? else {
                return Err(global.throw_invalid_argument_type(
                    bname($name),
                    $arg2_name,
                    "string or buffer",
                ));
            };
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&[key, value, value2]),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_strings_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let mut args: Vec<JSArgument> = Vec::with_capacity(frame.arguments().len());

            for arg in frame.arguments() {
                let Some(another) = from_js(global, *arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        bname($name),
                        "additional arguments",
                        "string or buffer",
                    ));
                };
                args.push(another);
            }
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&args),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

macro_rules! cmd_key_value_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let mut args: Vec<JSArgument> = Vec::with_capacity(frame.arguments().len());

            for arg in frame.arguments() {
                if arg.is_undefined_or_null() {
                    continue;
                }

                let Some(another) = from_js(global, *arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        bname($name),
                        "additional arguments",
                        "string or buffer",
                    ));
                };
                args.push(another);
            }
            send_cmd(
                this,
                global,
                frame.this(),
                $command.as_bytes(),
                CommandArgs::Args(&args),
                CommandMeta::default(),
                concat!("Failed to send ", $command),
            )
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// JSValkeyClient prototype methods
// ──────────────────────────────────────────────────────────────────────────

impl JSValkeyClient {
    #[bun_jsc::host_fn(method, scoped)]
    pub fn js_send<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let command = OwnedString::new(frame.scoped_argument(scope, 0).to_bun_string(scope)?);

        let args_array = frame.argument(1);
        if !args_array.is_object() || !args_array.is_array() {
            return Err(scope.throw(format_args!("Arguments must be an array")));
        }
        let mut iter = args_array.array_iterator(global)?;
        let mut args: Vec<JSArgument> = Vec::with_capacity(iter.len as usize);

        while let Some(arg_js) = iter.next()? {
            let Some(v) = from_js(global, arg_js)? else {
                return Err(scope.throw_invalid_argument_type(
                    "sendCommand",
                    "argument",
                    "string or buffer",
                ));
            };
            args.push(v);
        }

        let cmd_str = command.to_utf8_without_ref();
        let mut cmd = Command {
            command: cmd_str.slice(),
            args: CommandArgs::Args(&args),
            meta: CommandMeta::default(),
        };
        // Note: reshaped for borrowck (cmd.meta = cmd.meta.check(&cmd))
        let checked_meta = cmd.meta.check(&cmd);
        cmd.meta = checked_meta;
        // Send command with slices directly
        let promise = match this.send(global, frame.this(), &cmd) {
            Ok(p) => p,
            Err(err) => {
                return send_err_to_js(global, "Failed to send command", &err)
                    .map(|v| scope.local(v));
            }
        };
        Ok(scope.local(promise_to_js(promise)))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn get<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"get")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("get", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"GET",
            CommandArgs::Args(&[key]),
            CommandMeta::default(),
            "Failed to send GET command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn get_buffer<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"getBuffer")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("getBuffer", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"GET",
            CommandArgs::Args(&[key]),
            CommandMeta::RETURN_AS_BUFFER | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send GET command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn set<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"set")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("set", "key", "string or buffer"));
        };
        args.push(key);

        let Some(value) = from_js(global, frame.argument(1))? else {
            return Err(scope.throw_invalid_argument_type(
                "set",
                "value",
                "string or buffer or number",
            ));
        };
        args.push(value);

        if args_view.len() > 2 {
            for arg in &args_view[2..] {
                if arg.is_undefined_or_null() {
                    break;
                }
                let Some(v) = from_js(global, *arg)? else {
                    return Err(scope.throw_invalid_argument_type(
                        "set",
                        "arguments",
                        "string or buffer",
                    ));
                };
                args.push(v);
            }
        }

        send_cmd(
            this,
            global,
            frame.this(),
            b"SET",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send SET command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn incr<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"incr")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("incr", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"INCR",
            CommandArgs::Args(&[key]),
            CommandMeta::default(),
            "Failed to send INCR command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn decr<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"decr")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("decr", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"DECR",
            CommandArgs::Args(&[key]),
            CommandMeta::default(),
            "Failed to send DECR command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn exists<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"exists")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("exists", "key", "string or buffer"));
        };
        // Send EXISTS command with special Exists type for boolean conversion
        send_cmd(
            this,
            global,
            frame.this(),
            b"EXISTS",
            CommandArgs::Args(&[key]),
            CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send EXISTS command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn expire<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"expire")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("expire", "key", "string or buffer"));
        };

        let seconds = global.validate_integer_range::<i32>(
            frame.argument(1),
            0,
            jsc::IntegerRange {
                min: 0,
                max: 2147483647,
                field_name: b"seconds",
                ..Default::default()
            },
        )?;

        // Convert seconds to a string
        let mut int_buf = bun_core::fmt::ItoaBuf::new();
        let seconds_slice = bun_core::fmt::itoa(&mut int_buf, seconds);
        send_cmd(
            this,
            global,
            frame.this(),
            b"EXPIRE",
            CommandArgs::Raw(&[key.slice(), seconds_slice]),
            CommandMeta::default(),
            "Failed to send EXPIRE command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn ttl<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"ttl")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("ttl", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"TTL",
            CommandArgs::Args(&[key]),
            CommandMeta::default(),
            "Failed to send TTL command",
        )
        .map(|v| scope.local(v))
    }

    // Implement srem (remove value from a set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn srem<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"srem")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(scope.throw(format_args!("SREM requires at least a key and one member")));
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("srem", "key", "string or buffer"));
        };
        args.push(key);

        for arg in &args_view[1..] {
            if arg.is_undefined_or_null() {
                break;
            }
            let Some(value) = from_js(global, *arg)? else {
                return Err(scope.throw_invalid_argument_type(
                    "srem",
                    "member",
                    "string or buffer",
                ));
            };
            args.push(value);
        }
        send_cmd(
            this,
            global,
            frame.this(),
            b"SREM",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send SREM command",
        )
        .map(|v| scope.local(v))
    }

    // Implement srandmember (get random member from set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn srandmember<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"srandmember")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type(
                "srandmember",
                "key",
                "string or buffer",
            ));
        };
        args.push(key);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return Err(scope.throw_invalid_argument_type(
                    "srandmember",
                    "count",
                    "number or string",
                ));
            };
            args.push(count_arg);
        }
        send_cmd(
            this,
            global,
            frame.this(),
            b"SRANDMEMBER",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send SRANDMEMBER command",
        )
        .map(|v| scope.local(v))
    }

    // Implement smembers (get all members of a set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn smembers<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"smembers")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("smembers", "key", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"SMEMBERS",
            CommandArgs::Args(&[key]),
            CommandMeta::default(),
            "Failed to send SMEMBERS command",
        )
        .map(|v| scope.local(v))
    }

    // Implement spop (pop a random member from a set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn spop<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"spop")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("spop", "key", "string or buffer"));
        };
        args.push(key);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return Err(scope.throw_invalid_argument_type("spop", "count", "number or string"));
            };
            args.push(count_arg);
        }
        send_cmd(
            this,
            global,
            frame.this(),
            b"SPOP",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send SPOP command",
        )
        .map(|v| scope.local(v))
    }

    // Implement sadd (add member to a set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn sadd<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"sadd")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(scope.throw(format_args!("SADD requires at least a key and one member")));
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("sadd", "key", "string or buffer"));
        };
        args.push(key);

        for arg in &args_view[1..] {
            if arg.is_undefined_or_null() {
                break;
            }
            let Some(value) = from_js(global, *arg)? else {
                return Err(scope.throw_invalid_argument_type(
                    "sadd",
                    "member",
                    "string or buffer",
                ));
            };
            args.push(value);
        }
        send_cmd(
            this,
            global,
            frame.this(),
            b"SADD",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send SADD command",
        )
        .map(|v| scope.local(v))
    }

    // Implement sismember (check if value is member of a set)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn sismember<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"sismember")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("sismember", "key", "string or buffer"));
        };
        let Some(value) = from_js(global, frame.argument(1))? else {
            return Err(scope.throw_invalid_argument_type(
                "sismember",
                "value",
                "string or buffer",
            ));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"SISMEMBER",
            CommandArgs::Args(&[key, value]),
            CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send SISMEMBER command",
        )
        .map(|v| scope.local(v))
    }

    // Implement hmget (get multiple values from hash)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn hmget<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"hmget")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(scope.throw(format_args!("HMGET requires at least a key and one field")));
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("hmget", "key", "string or buffer"));
        };
        args.push(key);

        let second_arg = frame.argument(1);
        if second_arg.is_array() {
            let array_len = second_arg.get_length(global)?;
            if array_len == 0 {
                return Err(scope.throw(format_args!("HMGET requires at least one field")));
            }

            let mut array_iter = second_arg.array_iterator(global)?;
            while let Some(element) = array_iter.next()? {
                let Some(field) = from_js(global, element)? else {
                    return Err(scope.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    ));
                };
                args.push(field);
            }
        } else {
            for arg in &args_view[1..] {
                if arg.is_undefined_or_null() {
                    break;
                }
                let Some(field) = from_js(global, *arg)? else {
                    return Err(scope.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    ));
                };
                args.push(field);
            }
        }

        send_cmd(
            this,
            global,
            frame.this(),
            b"HMGET",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send HMGET command",
        )
        .map(|v| scope.local(v))
    }

    // Implement hincrby (increment hash field by integer value)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn hincrby<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"hincrby")?;

        let key = OwnedString::new(frame.scoped_argument(scope, 0).to_bun_string(scope)?);
        let field = OwnedString::new(frame.scoped_argument(scope, 1).to_bun_string(scope)?);
        let value = OwnedString::new(frame.scoped_argument(scope, 2).to_bun_string(scope)?);

        let key_slice = key.to_utf8_without_ref();
        let field_slice = field.to_utf8_without_ref();
        let value_slice = value.to_utf8_without_ref();

        send_cmd(
            this,
            global,
            frame.this(),
            b"HINCRBY",
            CommandArgs::Slices(&[key_slice, field_slice, value_slice]),
            CommandMeta::default(),
            "Failed to send HINCRBY command",
        )
        .map(|v| scope.local(v))
    }

    // Implement hincrbyfloat (increment hash field by float value)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn hincrbyfloat<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"hincrbyfloat")?;

        let key = OwnedString::new(frame.scoped_argument(scope, 0).to_bun_string(scope)?);
        let field = OwnedString::new(frame.scoped_argument(scope, 1).to_bun_string(scope)?);
        let value = OwnedString::new(frame.scoped_argument(scope, 2).to_bun_string(scope)?);

        let key_slice = key.to_utf8_without_ref();
        let field_slice = field.to_utf8_without_ref();
        let value_slice = value.to_utf8_without_ref();

        send_cmd(
            this,
            global,
            frame.this(),
            b"HINCRBYFLOAT",
            CommandArgs::Slices(&[key_slice, field_slice, value_slice]),
            CommandMeta::default(),
            "Failed to send HINCRBYFLOAT command",
        )
        .map(|v| scope.local(v))
    }

    fn hset_impl(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        command: &'static [u8],
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, command)?;

        let key = OwnedString::new(frame.argument(0).to_bun_string(global)?);

        let second_arg = frame.argument(1);

        let mut args: Vec<Slice> = Vec::new();

        args.push(key.to_utf8());

        if second_arg.is_object() && !second_arg.is_array() {
            // Pattern 1: Object/Record - hset(key, {field: value, ...})
            let Some(obj) = second_arg.get_object() else {
                return Err(global.throw_invalid_argument_type(bname(command), "fields", "object"));
            };

            let mut object_iter = JSPropertyIterator::init(
                global,
                obj,
                jsc::PropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                },
            )?;

            args.ensure_total_capacity(1 + object_iter.len * 2);

            while let Some(field_name) = object_iter.next()? {
                let field_slice = field_name.to_utf8();
                args.push(field_slice);

                let value_str = object_iter.value.to_bun_string(global)?;
                args.push(value_str.to_utf8());
                // `to_utf8()` already bumped
                // (or copied) the ref the slice needs, so release ours now.
                value_str.deref();
            }
        } else if second_arg.is_array() {
            // Pattern 3: Array - hmset(key, [field, value, ...])
            let mut iter = second_arg.array_iterator(global)?;
            if iter.len % 2 != 0 {
                return Err(global.throw(format_args!(
                    "Array must have an even number of elements (field-value pairs)"
                )));
            }

            args.ensure_total_capacity(1 + iter.len as usize);

            while let Some(field_js) = iter.next()? {
                let field_str = field_js.to_bun_string(global)?;
                args.push(field_str.to_utf8());
                field_str.deref();

                let Some(value_js) = iter.next()? else {
                    return Err(global.throw(format_args!(
                        "Array must have an even number of elements (field-value pairs)"
                    )));
                };
                let value_str = value_js.to_bun_string(global)?;
                args.push(value_str.to_utf8());
                value_str.deref();
            }
        } else {
            // Pattern 2: Variadic - hset(key, field, value, ...)
            let args_count = frame.arguments_count();
            if args_count < 3 {
                return Err(global.throw(format_args!(
                    "HSET requires at least key, field, and value arguments"
                )));
            }

            let field_value_count = args_count - 1; // Exclude key
            if !field_value_count.is_multiple_of(2) {
                return Err(global.throw(format_args!(
                    "HSET requires field-value pairs (even number of arguments after key)"
                )));
            }

            args.ensure_total_capacity(args_count as usize);

            let mut i: u32 = 1;
            while i < args_count {
                let arg_str = frame.argument(i as usize).to_bun_string(global)?;
                args.push(arg_str.to_utf8());
                arg_str.deref();
                i += 1;
            }
        }

        if args.len() == 1 {
            return Err(global.throw(format_args!("HSET requires at least one field-value pair")));
        }

        let msg = if command == b"HSET" {
            "Failed to send HSET command"
        } else {
            "Failed to send HMSET command"
        };
        send_cmd(
            this,
            global,
            frame.this(),
            command,
            CommandArgs::Slices(&args),
            CommandMeta::default(),
            msg,
        )
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn hset<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        Self::hset_impl(this, scope.unscoped_global(), frame, b"HSET").map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn hmset<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        Self::hset_impl(this, scope.unscoped_global(), frame, b"HMSET").map(|v| scope.local(v))
    }

    cmd_key_varargs!(hdel, b"hdel", "HDEL", "key", NotSubscriber);
    cmd_key_varargs!(
        hrandfield,
        b"hrandfield",
        "HRANDFIELD",
        "key",
        NotSubscriber
    );
    cmd_key_varargs!(hscan, b"hscan", "HSCAN", "key", NotSubscriber);
    cmd_strings_varargs!(hgetdel, b"hgetdel", "HGETDEL", NotSubscriber);
    cmd_strings_varargs!(hgetex, b"hgetex", "HGETEX", NotSubscriber);
    cmd_strings_varargs!(hsetex, b"hsetex", "HSETEX", NotSubscriber);
    cmd_strings_varargs!(hexpire, b"hexpire", "HEXPIRE", NotSubscriber);
    cmd_strings_varargs!(hexpireat, b"hexpireat", "HEXPIREAT", NotSubscriber);
    cmd_strings_varargs!(hexpiretime, b"hexpiretime", "HEXPIRETIME", NotSubscriber);
    cmd_strings_varargs!(hpersist, b"hpersist", "HPERSIST", NotSubscriber);
    cmd_strings_varargs!(hpexpire, b"hpexpire", "HPEXPIRE", NotSubscriber);
    cmd_strings_varargs!(hpexpireat, b"hpexpireat", "HPEXPIREAT", NotSubscriber);
    cmd_strings_varargs!(hpexpiretime, b"hpexpiretime", "HPEXPIRETIME", NotSubscriber);
    cmd_strings_varargs!(hpttl, b"hpttl", "HPTTL", NotSubscriber);
    cmd_strings_varargs!(httl, b"httl", "HTTL", NotSubscriber);

    #[bun_jsc::host_fn(method, scoped)]
    pub fn hsetnx<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"hsetnx")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("hsetnx", "key", "string or buffer"));
        };
        let Some(field) = from_js(global, frame.argument(1))? else {
            return Err(scope.throw_invalid_argument_type("hsetnx", "field", "string or buffer"));
        };
        let Some(value) = from_js(global, frame.argument(2))? else {
            return Err(scope.throw_invalid_argument_type("hsetnx", "value", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"HSETNX",
            CommandArgs::Args(&[key, field, value]),
            CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send HSETNX command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn hexists<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"hexists")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("hexists", "key", "string or buffer"));
        };

        let Some(field) = from_js(global, frame.argument(1))? else {
            return Err(scope.throw_invalid_argument_type("hexists", "field", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"HEXISTS",
            CommandArgs::Args(&[key, field]),
            CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send HEXISTS command",
        )
        .map(|v| scope.local(v))
    }

    // Implement ping (send a PING command with an optional message)
    #[bun_jsc::host_fn(method, scoped)]
    pub fn ping<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let arg0 = frame.scoped_argument(scope, 0);
        let message: Option<JSArgument> = if !arg0.is_undefined_or_null() {
            // Only use the first argument if provided, ignore any additional arguments
            let Some(m) = from_js(global, arg0.unscoped())? else {
                return Err(scope.throw_invalid_argument_type(
                    "ping",
                    "message",
                    "string or buffer",
                ));
            };
            Some(m)
        } else {
            None
        };
        let args_slice: &[JSArgument] = match &message {
            Some(m) => core::slice::from_ref(m),
            None => &[],
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"PING",
            CommandArgs::Args(args_slice),
            CommandMeta::default(),
            "Failed to send PING command",
        )
        .map(|v| scope.local(v))
    }

    cmd_key!(bitcount, b"bitcount", "BITCOUNT", "key", NotSubscriber);
    cmd_strings_varargs!(blmove, b"blmove", "BLMOVE", NotSubscriber);
    cmd_strings_varargs!(blmpop, b"blmpop", "BLMPOP", NotSubscriber);
    cmd_strings_varargs!(blpop, b"blpop", "BLPOP", NotSubscriber);
    cmd_strings_varargs!(brpop, b"brpop", "BRPOP", NotSubscriber);
    cmd_key_value_value2!(
        brpoplpush,
        b"brpoplpush",
        "BRPOPLPUSH",
        "source",
        "destination",
        "timeout",
        NotSubscriber
    );
    cmd_key_value!(getbit, b"getbit", "GETBIT", "key", "offset", NotSubscriber);
    cmd_key_value_value2!(
        setbit,
        b"setbit",
        "SETBIT",
        "key",
        "offset",
        "value",
        NotSubscriber
    );
    cmd_key_value_value2!(
        getrange,
        b"getrange",
        "GETRANGE",
        "key",
        "start",
        "end",
        NotSubscriber
    );
    cmd_key_value_value2!(
        setrange,
        b"setrange",
        "SETRANGE",
        "key",
        "offset",
        "value",
        NotSubscriber
    );
    cmd_key!(dump, b"dump", "DUMP", "key", NotSubscriber);
    cmd_key_value!(
        expireat,
        b"expireat",
        "EXPIREAT",
        "key",
        "timestamp",
        NotSubscriber
    );
    cmd_key!(
        expiretime,
        b"expiretime",
        "EXPIRETIME",
        "key",
        NotSubscriber
    );
    cmd_key!(getdel, b"getdel", "GETDEL", "key", NotSubscriber);
    cmd_strings_varargs!(getex, b"getex", "GETEX", NotSubscriber);
    cmd_key!(hgetall, b"hgetall", "HGETALL", "key", NotSubscriber);
    cmd_key!(hkeys, b"hkeys", "HKEYS", "key", NotSubscriber);
    cmd_key!(hlen, b"hlen", "HLEN", "key", NotSubscriber);
    cmd_key!(hvals, b"hvals", "HVALS", "key", NotSubscriber);
    cmd_key!(keys, b"keys", "KEYS", "key", NotSubscriber);
    cmd_key_value!(lindex, b"lindex", "LINDEX", "key", "index", NotSubscriber);
    cmd_strings_varargs!(linsert, b"linsert", "LINSERT", NotSubscriber);
    cmd_key!(llen, b"llen", "LLEN", "key", NotSubscriber);
    cmd_strings_varargs!(lmove, b"lmove", "LMOVE", NotSubscriber);
    cmd_strings_varargs!(lmpop, b"lmpop", "LMPOP", NotSubscriber);
    cmd_key_varargs!(lpop, b"lpop", "LPOP", "key", NotSubscriber);
    cmd_strings_varargs!(lpos, b"lpos", "LPOS", NotSubscriber);
    cmd_key_value_value2!(
        lrange,
        b"lrange",
        "LRANGE",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key_value_value2!(
        lrem,
        b"lrem",
        "LREM",
        "key",
        "count",
        "element",
        NotSubscriber
    );
    cmd_key_value_value2!(
        lset,
        b"lset",
        "LSET",
        "key",
        "index",
        "element",
        NotSubscriber
    );
    cmd_key_value_value2!(
        ltrim,
        b"ltrim",
        "LTRIM",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key!(persist, b"persist", "PERSIST", "key", NotSubscriber);
    cmd_key_value!(
        pexpire,
        b"pexpire",
        "PEXPIRE",
        "key",
        "milliseconds",
        NotSubscriber
    );
    cmd_key_value!(
        pexpireat,
        b"pexpireat",
        "PEXPIREAT",
        "key",
        "milliseconds-timestamp",
        NotSubscriber
    );
    cmd_key!(
        pexpiretime,
        b"pexpiretime",
        "PEXPIRETIME",
        "key",
        NotSubscriber
    );
    cmd_key!(pttl, b"pttl", "PTTL", "key", NotSubscriber);
    cmd_noargs!(randomkey, b"randomkey", "RANDOMKEY", NotSubscriber);
    cmd_key_varargs!(rpop, b"rpop", "RPOP", "key", NotSubscriber);
    cmd_key_value!(
        rpoplpush,
        b"rpoplpush",
        "RPOPLPUSH",
        "source",
        "destination",
        NotSubscriber
    );
    cmd_strings_varargs!(scan, b"scan", "SCAN", NotSubscriber);
    cmd_key!(scard, b"scard", "SCARD", "key", NotSubscriber);
    cmd_strings_varargs!(sdiff, b"sdiff", "SDIFF", NotSubscriber);
    cmd_strings_varargs!(sdiffstore, b"sdiffstore", "SDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(sinter, b"sinter", "SINTER", NotSubscriber);
    cmd_strings_varargs!(sintercard, b"sintercard", "SINTERCARD", NotSubscriber);
    cmd_strings_varargs!(sinterstore, b"sinterstore", "SINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(smismember, b"smismember", "SMISMEMBER", NotSubscriber);
    cmd_strings_varargs!(sscan, b"sscan", "SSCAN", NotSubscriber);
    cmd_key!(strlen, b"strlen", "STRLEN", "key", NotSubscriber);
    cmd_strings_varargs!(sunion, b"sunion", "SUNION", NotSubscriber);
    cmd_strings_varargs!(sunionstore, b"sunionstore", "SUNIONSTORE", NotSubscriber);
    cmd_key!(r#type, b"type", "TYPE", "key", NotSubscriber);
    cmd_key!(zcard, b"zcard", "ZCARD", "key", NotSubscriber);
    cmd_key_value_value2!(
        zcount,
        b"zcount",
        "ZCOUNT",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zlexcount,
        b"zlexcount",
        "ZLEXCOUNT",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_varargs!(zpopmax, b"zpopmax", "ZPOPMAX", "key", NotSubscriber);
    cmd_key_varargs!(zpopmin, b"zpopmin", "ZPOPMIN", "key", NotSubscriber);
    cmd_key_varargs!(
        zrandmember,
        b"zrandmember",
        "ZRANDMEMBER",
        "key",
        NotSubscriber
    );
    cmd_strings_varargs!(zrange, b"zrange", "ZRANGE", NotSubscriber);
    cmd_strings_varargs!(zrevrange, b"zrevrange", "ZREVRANGE", NotSubscriber);
    cmd_strings_varargs!(
        zrangebyscore,
        b"zrangebyscore",
        "ZRANGEBYSCORE",
        NotSubscriber
    );
    cmd_strings_varargs!(
        zrevrangebyscore,
        b"zrevrangebyscore",
        "ZREVRANGEBYSCORE",
        NotSubscriber
    );
    cmd_key_varargs!(
        zrangebylex,
        b"zrangebylex",
        "ZRANGEBYLEX",
        "key",
        NotSubscriber
    );
    cmd_key_varargs!(
        zrevrangebylex,
        b"zrevrangebylex",
        "ZREVRANGEBYLEX",
        "key",
        NotSubscriber
    );
    cmd_key_value!(append, b"append", "APPEND", "key", "value", NotSubscriber);
    cmd_key_value!(getset, b"getset", "GETSET", "key", "value", NotSubscriber);
    cmd_key_value!(hget, b"hget", "HGET", "key", "field", NotSubscriber);
    cmd_key_value!(
        incrby,
        b"incrby",
        "INCRBY",
        "key",
        "increment",
        NotSubscriber
    );
    cmd_key_value!(
        incrbyfloat,
        b"incrbyfloat",
        "INCRBYFLOAT",
        "key",
        "increment",
        NotSubscriber
    );
    cmd_key_value!(
        decrby,
        b"decrby",
        "DECRBY",
        "key",
        "decrement",
        NotSubscriber
    );
    cmd_key_value_varargs!(lpush, b"lpush", "LPUSH", NotSubscriber);
    cmd_key_value_varargs!(lpushx, b"lpushx", "LPUSHX", NotSubscriber);
    cmd_key_value!(pfadd, b"pfadd", "PFADD", "key", "value", NotSubscriber);
    cmd_key_value_varargs!(rpush, b"rpush", "RPUSH", NotSubscriber);
    cmd_key_value_varargs!(rpushx, b"rpushx", "RPUSHX", NotSubscriber);
    cmd_key_value!(setnx, b"setnx", "SETNX", "key", "value", NotSubscriber);
    cmd_key_value_value2!(
        setex,
        b"setex",
        "SETEX",
        "key",
        "seconds",
        "value",
        NotSubscriber
    );
    cmd_key_value_value2!(
        psetex,
        b"psetex",
        "PSETEX",
        "key",
        "milliseconds",
        "value",
        NotSubscriber
    );
    cmd_key_value!(zscore, b"zscore", "ZSCORE", "key", "value", NotSubscriber);
    cmd_key_value_value2!(
        zincrby,
        b"zincrby",
        "ZINCRBY",
        "key",
        "increment",
        "member",
        NotSubscriber
    );
    cmd_key_value_varargs!(zmscore, b"zmscore", "ZMSCORE", NotSubscriber);
    cmd_strings_varargs!(zadd, b"zadd", "ZADD", NotSubscriber);
    cmd_strings_varargs!(zscan, b"zscan", "ZSCAN", NotSubscriber);
    cmd_strings_varargs!(zdiff, b"zdiff", "ZDIFF", NotSubscriber);
    cmd_strings_varargs!(zdiffstore, b"zdiffstore", "ZDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(zinter, b"zinter", "ZINTER", NotSubscriber);
    cmd_strings_varargs!(zintercard, b"zintercard", "ZINTERCARD", NotSubscriber);
    cmd_strings_varargs!(zinterstore, b"zinterstore", "ZINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(zunion, b"zunion", "ZUNION", NotSubscriber);
    cmd_strings_varargs!(zunionstore, b"zunionstore", "ZUNIONSTORE", NotSubscriber);
    cmd_strings_varargs!(zmpop, b"zmpop", "ZMPOP", NotSubscriber);
    cmd_strings_varargs!(bzmpop, b"bzmpop", "BZMPOP", NotSubscriber);
    cmd_strings_varargs!(bzpopmin, b"bzpopmin", "BZPOPMIN", NotSubscriber);
    cmd_strings_varargs!(bzpopmax, b"bzpopmax", "BZPOPMAX", NotSubscriber);
    cmd_key_varargs!(del, b"del", "DEL", "key", NotSubscriber);
    cmd_key_varargs!(mget, b"mget", "MGET", "key", NotSubscriber);
    cmd_strings_varargs!(mset, b"mset", "MSET", NotSubscriber);
    cmd_strings_varargs!(msetnx, b"msetnx", "MSETNX", NotSubscriber);
    cmd_strings_varargs!(script, b"script", "SCRIPT", NotSubscriber);
    cmd_strings_varargs!(select, b"select", "SELECT", NotSubscriber);
    cmd_key_value!(
        spublish,
        b"spublish",
        "SPUBLISH",
        "channel",
        "message",
        NotSubscriber
    );

    #[bun_jsc::host_fn(method, scoped)]
    pub fn smove<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"smove")?;

        let Some(source) = from_js(global, frame.argument(0))? else {
            return Err(scope.throw_invalid_argument_type("smove", "source", "string or buffer"));
        };
        let Some(destination) = from_js(global, frame.argument(1))? else {
            return Err(scope.throw_invalid_argument_type(
                "smove",
                "destination",
                "string or buffer",
            ));
        };
        let Some(member) = from_js(global, frame.argument(2))? else {
            return Err(scope.throw_invalid_argument_type("smove", "member", "string or buffer"));
        };
        send_cmd(
            this,
            global,
            frame.this(),
            b"SMOVE",
            CommandArgs::Args(&[source, destination, member]),
            CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING,
            "Failed to send SMOVE command",
        )
        .map(|v| scope.local(v))
    }

    cmd_key_value_value2!(
        substr,
        b"substr",
        "SUBSTR",
        "key",
        "start",
        "end",
        NotSubscriber
    );
    cmd_key_value!(
        hstrlen,
        b"hstrlen",
        "HSTRLEN",
        "key",
        "field",
        NotSubscriber
    );
    cmd_key_varargs!(zrank, b"zrank", "ZRANK", "key", NotSubscriber);
    cmd_strings_varargs!(zrangestore, b"zrangestore", "ZRANGESTORE", NotSubscriber);
    cmd_key_varargs!(zrem, b"zrem", "ZREM", "key", NotSubscriber);
    cmd_key_value_value2!(
        zremrangebylex,
        b"zremrangebylex",
        "ZREMRANGEBYLEX",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zremrangebyrank,
        b"zremrangebyrank",
        "ZREMRANGEBYRANK",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zremrangebyscore,
        b"zremrangebyscore",
        "ZREMRANGEBYSCORE",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_varargs!(zrevrank, b"zrevrank", "ZREVRANK", "key", NotSubscriber);
    cmd_strings_varargs!(psubscribe, b"psubscribe", "PSUBSCRIBE", DontCare);
    cmd_strings_varargs!(punsubscribe, b"punsubscribe", "PUNSUBSCRIBE", DontCare);
    cmd_strings_varargs!(pubsub, b"pubsub", "PUBSUB", DontCare);
    cmd_strings_varargs!(copy, b"copy", "COPY", NotSubscriber);
    cmd_key_varargs!(unlink, b"unlink", "UNLINK", "key", NotSubscriber);
    cmd_key_varargs!(touch, b"touch", "TOUCH", "key", NotSubscriber);
    cmd_key_value!(rename, b"rename", "RENAME", "key", "newkey", NotSubscriber);
    cmd_key_value!(
        renamenx,
        b"renamenx",
        "RENAMENX",
        "key",
        "newkey",
        NotSubscriber
    );

    #[bun_jsc::host_fn(method, scoped)]
    pub fn publish<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        require_not_subscriber(this, b"publish")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let arg0 = frame.scoped_argument(scope, 0);
        if !arg0.is_string() {
            return Err(scope.throw_invalid_argument_type("publish", "channel", "string"));
        }
        let channel = from_js(global, arg0.unscoped())?.expect("unreachable");

        args.push(channel);

        let arg1 = frame.scoped_argument(scope, 1);
        if !arg1.is_string() {
            return Err(scope.throw_invalid_argument_type("publish", "message", "string"));
        }
        let message = from_js(global, arg1.unscoped())?.expect("unreachable");
        args.push(message);
        send_cmd(
            this,
            global,
            frame.this(),
            b"PUBLISH",
            CommandArgs::Args(&args),
            CommandMeta::default(),
            "Failed to send PUBLISH command",
        )
        .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn subscribe<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        // `upsert_receive_handler`'s exit guard re-enters `on_writable` /
        // `update_poll_ref` before `send()` is reached; hold a ref so `*this`
        // stays live across those calls.
        let _guard = this.ref_scope();

        let global = scope.unscoped_global();
        let arguments = frame.scoped_arguments::<2>(scope);
        let (channel_or_many, handler_callback) = (arguments.ptr[0], arguments.ptr[1]);
        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        if !handler_callback.is_callable() {
            return Err(scope.throw_invalid_argument_type("subscribe", "listener", "function"));
        }

        // The first argument given is the channel or may be an array of channels.
        if channel_or_many.is_array() {
            if channel_or_many.unscoped().get_length(global)? == 0 {
                return Err(scope.throw_invalid_arguments(format_args!(
                    "subscribe requires at least one channel"
                )));
            }
            redis_channels
                .ensure_total_capacity(channel_or_many.unscoped().get_length(global)? as usize);

            let mut array_iter = channel_or_many.unscoped().array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return Err(scope.throw_invalid_argument_type(
                        "subscribe",
                        "channel",
                        "string",
                    ));
                };
                redis_channels.push(channel);

                // What we do here is add our receive handler. Notice that this doesn't really do anything until the
                // "SUBSCRIBE" command is sent to redis and we get a response.
                //
                // This is less-than-ideal, still, because this assumes a happy path. What happens if
                // the SUBSCRIBE command fails? We have no way to roll back the addition of the
                // handler.
                this._subscription_ctx.get().upsert_receive_handler(
                    global,
                    channel_arg,
                    handler_callback.unscoped(),
                )?;
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many.unscoped())? else {
                return Err(scope.throw_invalid_argument_type("subscribe", "channel", "string"));
            };
            redis_channels.push(channel);

            this._subscription_ctx.get().upsert_receive_handler(
                global,
                channel_or_many.unscoped(),
                handler_callback.unscoped(),
            )?;
        } else {
            return Err(scope.throw_invalid_argument_type(
                "subscribe",
                "channel",
                "string or array",
            ));
        }

        let command = Command {
            command: b"SUBSCRIBE",
            args: CommandArgs::Args(&redis_channels),
            meta: CommandMeta::default() | CommandMeta::SUBSCRIPTION_REQUEST,
        };
        let promise = match this.send(global, frame.this(), &command) {
            Ok(p) => p,
            Err(err) => {
                // If we catch an error, we need to clean up any handlers we may have added and fall out of subscription mode
                this._subscription_ctx
                    .get()
                    .clear_all_receive_handlers(global)?;
                return send_err_to_js(global, "Failed to send SUBSCRIBE command", &err)
                    .map(|v| scope.local(v));
            }
        };

        Ok(scope.local(promise_to_js(promise)))
    }

    /// Send redis the UNSUBSCRIBE RESP command and clean up anything necessary after the unsubscribe commoand.
    ///
    /// The subscription context must exist when calling this function.
    fn send_unsubscribe_request_and_cleanup(
        this: &Self,
        this_js: JSValue,
        global: &JSGlobalObject,
        redis_channels: &[JSArgument],
    ) -> JsResult<JSValue> {
        send_cmd(
            this,
            global,
            this_js,
            b"UNSUBSCRIBE",
            CommandArgs::Args(redis_channels),
            CommandMeta::default(),
            "Failed to send UNSUBSCRIBE command",
        )
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn unsubscribe<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        // Hold a ref so `*this` stays live across the handler-map updates and
        // the `send()` below.
        let _guard = this.ref_scope();

        let global = scope.unscoped_global();
        // Check if we're in subscription mode
        require_subscriber(this, b"unsubscribe")?;

        let args_view = frame.arguments();

        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        // If no arguments, unsubscribe from all channels
        if args_view.is_empty() {
            this._subscription_ctx
                .get()
                .clear_all_receive_handlers(global)?;
            return Self::send_unsubscribe_request_and_cleanup(
                this,
                frame.this(),
                global,
                &redis_channels,
            )
            .map(|v| scope.local(v));
        }

        // The first argument can be a channel or an array of channels
        let channel_or_many = frame.argument(0);

        // Get the subscription context
        if !this._subscription_ctx.get().is_subscriber {
            return Ok(scope.local(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            )));
        }

        // Two arguments means .unsubscribe(channel, listener) is invoked.
        if frame.arguments().len() == 2 {
            // In this case, the first argument is a channel string and the second
            // argument is the handler to remove.
            if !channel_or_many.is_string() {
                return Err(scope.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            }

            let channel = channel_or_many;
            let listener_cb = frame.argument(1);

            if !listener_cb.is_callable() {
                return Err(scope.throw_invalid_argument_type(
                    "unsubscribe",
                    "listener",
                    "function",
                ));
            }

            // Populate the redis_channels list with the single channel to
            // unsubscribe from. This s important since this list is used to send
            // the UNSUBSCRIBE command to redis. Without this, we would end up
            // unsubscribing from all channels.
            let Some(ch) = from_js(global, channel)? else {
                return Err(scope.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            };
            redis_channels.push(ch);

            let remaining_listeners = match this._subscription_ctx.get().remove_receive_handler(
                global,
                channel,
                listener_cb,
            ) {
                Ok(Some(n)) => n,
                Ok(None) => {
                    // Listeners weren't present in the first place, so we can return a
                    // resolved promise.
                    return Ok(scope.local(JSPromise::resolved_promise_value(
                        global,
                        JSValue::UNDEFINED,
                    )));
                }
                Err(e) => return Err(e),
            };

            // In this case, we only want to send the unsubscribe command to redis if there are no more listeners for this
            // channel.
            if remaining_listeners == 0 {
                return Self::send_unsubscribe_request_and_cleanup(
                    this,
                    frame.this(),
                    global,
                    &redis_channels,
                )
                .map(|v| scope.local(v));
            }

            // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
            return Ok(scope.local(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            )));
        }

        if channel_or_many.is_array() {
            if channel_or_many.get_length(global)? == 0 {
                return Err(scope.throw_invalid_arguments(format_args!(
                    "unsubscribe requires at least one channel"
                )));
            }

            redis_channels.reserve(
                (channel_or_many.get_length(global)? as usize).saturating_sub(redis_channels.len()),
            );
            // It is an array, so let's iterate over it
            let mut array_iter = channel_or_many.array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return Err(scope.throw_invalid_argument_type(
                        "unsubscribe",
                        "channel",
                        "string",
                    ));
                };
                redis_channels.push(channel);
                // Clear the handlers for this channel
                this._subscription_ctx
                    .get()
                    .clear_receive_handlers(global, channel_arg)?;
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return Err(scope.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            };
            redis_channels.push(channel);
            // Clear the handlers for this channel
            this._subscription_ctx
                .get()
                .clear_receive_handlers(global, channel_or_many)?;
        } else {
            return Err(scope.throw_invalid_argument_type(
                "unsubscribe",
                "channel",
                "string or array",
            ));
        }

        // Now send the unsubscribe command and clean up if necessary
        Self::send_unsubscribe_request_and_cleanup(this, frame.this(), global, &redis_channels)
            .map(|v| scope.local(v))
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn duplicate<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let _ = frame;

        let new_client_ptr = this.clone_without_connecting(global)?;
        // SAFETY: clone_without_connecting returns a freshly allocated, leaked
        // JSValkeyClient (heap::alloc); valid for the rest of this scope.
        let new_client: &JSValkeyClient = unsafe { &*new_client_ptr };

        let new_client_js = JSValkeyClient::ptr_to_js(new_client_ptr, global);
        new_client.this_value.set(JsRef::init_weak(new_client_js));
        new_client
            ._subscription_ctx
            .set(SubscriptionCtx::init(new_client)?);
        // If the original client is already connected and not manually closed, start connecting the new client.
        if this.client.get().status == valkey::Status::Connected
            && !this.client.get().flags.is_manually_closed
        {
            // Use strong reference during connection to prevent premature GC
            new_client
                .client_mut()
                .flags
                .connection_promise_returns_client = true;
            return new_client
                .do_connect(global, new_client_js)
                .map(|v| scope.local(v));
        }

        Ok(scope.local(JSPromise::resolved_promise_value(global, new_client_js)))
    }

    // script(subcommand: "LOAD", script: RedisValue)
    // select(index: number | string)
    // spublish(shardchannel: RedisValue, message: RedisValue)
    // smove(source: RedisKey, destination: RedisKey, member: RedisValue)
    // substr(key: RedisKey, start: number, end: number)` // Deprecated alias for getrang
    // hstrlen(key: RedisKey, field: RedisValue)
    // zrank(key: RedisKey, member: RedisValue)
    // zrevrank(key: RedisKey, member: RedisValue)
    // zscore(key: RedisKey, member: RedisValue)

    // cluster(subcommand: "KEYSLOT", key: RedisKey)
}
