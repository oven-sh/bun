use crate::node::BlobOrStringOrBuffer as JSArgument;
use bun_collections::VecExt as _;
use bun_core::OwnedString;
use bun_jsc::{
    self as jsc, CallFrame, ErrorCode, JSGlobalObject, JSPromise, JSPropertyIterator, JSValue,
    JsResult,
};

use super::js_valkey::JSValkeyClient;
use super::protocol_jsc as protocol;
use super::valkey;
use super::command::{Args as CommandArgs, Command, Meta as CommandMeta};
use bun_valkey::valkey_protocol::RedisError;

type Slice = bun_jsc::ZigStringSlice;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline]
fn require_not_subscriber(this: &JSValkeyClient, function_name: &str) -> JsResult<()> {
    if this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{function_name} cannot be called while in subscriber mode.",
                ),
            )
            .throw());
    }
    Ok(())
}

#[inline]
fn require_subscriber(this: &JSValkeyClient, function_name: &str) -> JsResult<()> {
    if !this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{function_name} can only be called while in subscriber mode.",
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

    // `allow_file = true` REJECTS file-backed blobs (see types.rs) — a file blob's
    // `.slice()` is empty, so letting one through would send an empty arg.
    JSArgument::from_js_maybe_file(global, value, true)
}

/// `from_js` + throw-on-`None` for the common `"string or buffer"` case.
fn require_arg(
    global: &JSGlobalObject,
    value: JSValue,
    method: &'static str,
    label: &'static str,
) -> JsResult<JSArgument> {
    from_js(global, value)?
        .ok_or_else(|| global.throw_invalid_argument_type(method, label, "string or buffer"))
}

/// Convert a trailing varargs slice to `JSArgument`s with a single policy:
/// `undefined`/`null`/unsupported values THROW (never silently skip or truncate).
fn collect_varargs(
    global: &JSGlobalObject,
    args: &[JSValue],
    method: &'static str,
    label: &'static str,
) -> JsResult<Vec<JSArgument>> {
    let mut out = Vec::with_capacity(args.len());
    for arg in args {
        let Some(v) = from_js(global, *arg)? else {
            return Err(global.throw_invalid_argument_type(method, label, "string or buffer"));
        };
        out.push(v);
    }
    Ok(out)
}

/// Return a rejected `Promise` wrapping the Redis error as a
/// `JsResult<JSValue>` for host functions.
#[inline]
fn send_err_to_js(
    global: &JSGlobalObject,
    message: impl AsRef<[u8]>,
    err: RedisError,
) -> JsResult<JSValue> {
    let err_value = protocol::valkey_error_to_js(global, message, err);
    Ok(JSPromise::rejected_promise(global, err_value).to_js())
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
/// All `cmd_*!` macros and the hand-written methods route through here; the
/// only per-caller variation is the args slice and the `meta` flags. The
/// error message is derived from `command` so it can never disagree with the
/// command actually sent.
#[inline]
fn send_cmd(
    this: &JSValkeyClient,
    global: &JSGlobalObject,
    command: &[u8],
    args: CommandArgs<'_>,
    meta: CommandMeta,
) -> JsResult<JSValue> {
    match this.send(
        global,
        &Command {
            command,
            args,
            meta,
        },
    ) {
        Ok(p) => Ok(promise_to_js(p)),
        Err(err) => send_err_to_js(
            global,
            format!("Failed to send {} command", bstr::BStr::new(command)),
            err,
        ),
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
        js_client_prototype_function_name: &str,
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
// cmd_strings_varargs! (...strings: string[])

macro_rules! cmd_noargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&[]),
                CommandMeta::default(),
            )
        }
    };
}

macro_rules! cmd_key {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        cmd_key!($fn_name, $name, $command, $arg0_name, $state, CommandMeta::default());
    };
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident, $meta:expr) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let key = require_arg(global, frame.argument(0), $name, $arg0_name)?;
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&[key]),
                $meta,
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

            let key = require_arg(global, frame.argument(0), $name, $arg0_name)?;
            let arguments = frame.arguments();
            let mut args: Vec<JSArgument> = Vec::with_capacity(arguments.len());
            args.push(key);
            args.extend(collect_varargs(global, &arguments[1..], $name, "additional arguments")?);
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&args),
                CommandMeta::default(),
            )
        }
    };
}

macro_rules! cmd_key_value {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $state:ident) => {
        cmd_key_value!($fn_name, $name, $command, $arg0_name, $arg1_name, $state, CommandMeta::default());
    };
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $state:ident, $meta:expr) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let key = require_arg(global, frame.argument(0), $name, $arg0_name)?;
            let value = require_arg(global, frame.argument(1), $name, $arg1_name)?;
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&[key, value]),
                $meta,
            )
        }
    };
}

macro_rules! cmd_key_value_value2 {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $arg2_name:literal, $state:ident) => {
        cmd_key_value_value2!($fn_name, $name, $command, $arg0_name, $arg1_name, $arg2_name, $state, CommandMeta::default());
    };
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $arg2_name:literal, $state:ident, $meta:expr) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(
                this, $name,
            )?;

            let key = require_arg(global, frame.argument(0), $name, $arg0_name)?;
            let value = require_arg(global, frame.argument(1), $name, $arg1_name)?;
            let value2 = require_arg(global, frame.argument(2), $name, $arg2_name)?;
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&[key, value, value2]),
                $meta,
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

            let args = collect_varargs(global, frame.arguments(), $name, "additional arguments")?;
            send_cmd(
                this,
                global,
                $command.as_bytes(),
                CommandArgs::Blobs(&args),
                CommandMeta::default(),
            )
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// JSValkeyClient prototype methods
// ──────────────────────────────────────────────────────────────────────────

impl JSValkeyClient {
    #[bun_jsc::host_fn(method)]
    pub fn js_send(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let command = OwnedString::new(frame.argument(0).to_bun_string(global)?);

        let args_array = frame.argument(1);
        if !args_array.is_object() || !args_array.is_array() {
            return Err(global.throw_invalid_argument_type("send", "args", "array"));
        }
        let mut iter = args_array.array_iterator(global)?;
        let mut args: Vec<JSArgument> = Vec::with_capacity(iter.len as usize);

        while let Some(arg_js) = iter.next()? {
            args.push(require_arg(global, arg_js, "send", "argument")?);
        }

        let cmd_str = command.to_utf8_without_ref();
        send_cmd(
            this,
            global,
            cmd_str.slice(),
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    cmd_key!(get, "get", "GET", "key", NotSubscriber);
    cmd_key!(
        get_buffer,
        "getBuffer",
        "GET",
        "key",
        NotSubscriber,
        CommandMeta::RETURN_AS_BUFFER | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );

    #[bun_jsc::host_fn(method)]
    pub fn set(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "set")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "set", "key")?);

        let Some(value) = from_js(global, frame.argument(1))? else {
            return Err(global.throw_invalid_argument_type(
                "set",
                "value",
                "string or buffer or number",
            ));
        };
        args.push(value);

        if args_view.len() > 2 {
            args.extend(collect_varargs(global, &args_view[2..], "set", "arguments")?);
        }

        send_cmd(
            this,
            global,
            b"SET",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    cmd_key!(incr, "incr", "INCR", "key", NotSubscriber);
    cmd_key!(decr, "decr", "DECR", "key", NotSubscriber);
    cmd_key!(
        exists,
        "exists",
        "EXISTS",
        "key",
        NotSubscriber,
        CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );
    // Hand-written (not `cmd_key_value!`) to keep the client-side
    // `validate_integer_range` guard + default-0-when-undefined for `seconds`.
    #[bun_jsc::host_fn(method)]
    pub fn expire(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "expire")?;

        let key = require_arg(global, frame.argument(0), "expire", "key")?;

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

        let mut int_buf = bun_core::fmt::ItoaBuf::new();
        let seconds_slice = bun_core::fmt::itoa(&mut int_buf, seconds);
        send_cmd(
            this,
            global,
            b"EXPIRE",
            CommandArgs::Raw(&[key.slice(), seconds_slice]),
            CommandMeta::default(),
        )
    }

    cmd_key!(ttl, "ttl", "TTL", "key", NotSubscriber);

    // Implement srem (remove value from a set)
    #[bun_jsc::host_fn(method)]
    pub fn srem(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "srem")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("SREM requires at least a key and one member"),
                )
                .throw());
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "srem", "key")?);
        args.extend(collect_varargs(global, &args_view[1..], "srem", "member")?);
        send_cmd(
            this,
            global,
            b"SREM",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    // Implement srandmember (get random member from set)
    #[bun_jsc::host_fn(method)]
    pub fn srandmember(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, "srandmember")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "srandmember", "key")?);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return Err(global.throw_invalid_argument_type(
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
            b"SRANDMEMBER",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    cmd_key!(smembers, "smembers", "SMEMBERS", "key", NotSubscriber);

    // Implement spop (pop a random member from a set)
    #[bun_jsc::host_fn(method)]
    pub fn spop(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "spop")?;

        let args_view = frame.arguments();
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "spop", "key")?);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return Err(global.throw_invalid_argument_type(
                    "spop",
                    "count",
                    "number or string",
                ));
            };
            args.push(count_arg);
        }
        send_cmd(
            this,
            global,
            b"SPOP",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    // Implement sadd (add member to a set)
    #[bun_jsc::host_fn(method)]
    pub fn sadd(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "sadd")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("SADD requires at least a key and one member"),
                )
                .throw());
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "sadd", "key")?);
        args.extend(collect_varargs(global, &args_view[1..], "sadd", "member")?);
        send_cmd(
            this,
            global,
            b"SADD",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    cmd_key_value!(
        sismember,
        "sismember",
        "SISMEMBER",
        "key",
        "member",
        NotSubscriber,
        CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );

    // Implement hmget (get multiple values from hash)
    #[bun_jsc::host_fn(method)]
    pub fn hmget(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, "hmget")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("HMGET requires at least a key and one field"),
                )
                .throw());
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        args.push(require_arg(global, frame.argument(0), "hmget", "key")?);

        let second_arg = frame.argument(1);
        if second_arg.is_array() {
            let array_len = second_arg.get_length(global)?;
            if array_len == 0 {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("HMGET requires at least one field"),
                    )
                    .throw());
            }

            let mut array_iter = second_arg.array_iterator(global)?;
            while let Some(element) = array_iter.next()? {
                args.push(require_arg(global, element, "hmget", "field")?);
            }
        } else {
            args.extend(collect_varargs(global, &args_view[1..], "hmget", "field")?);
        }

        send_cmd(
            this,
            global,
            b"HMGET",
            CommandArgs::Blobs(&args),
            CommandMeta::default(),
        )
    }

    cmd_key_value_value2!(
        hincrby,
        "hincrby",
        "HINCRBY",
        "key",
        "field",
        "increment",
        NotSubscriber
    );
    cmd_key_value_value2!(
        hincrbyfloat,
        "hincrbyfloat",
        "HINCRBYFLOAT",
        "key",
        "field",
        "increment",
        NotSubscriber
    );

    fn hset_impl(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        command: &'static [u8],
        js_name: &'static str,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, js_name)?;

        let key = OwnedString::new(frame.argument(0).to_bun_string(global)?);

        let second_arg = frame.argument(1);

        let mut args: Vec<Slice> = Vec::new();

        args.push(key.to_utf8());

        if second_arg.is_object() && !second_arg.is_array() {
            // Pattern 1: Object/Record - hset(key, {field: value, ...})
            let Some(obj) = second_arg.get_object() else {
                return Err(global.throw_invalid_argument_type(js_name, "fields", "object"));
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

                args.push(object_iter.value.to_slice(global)?);
            }
        } else if second_arg.is_array() {
            // Pattern 3: Array - hmset(key, [field, value, ...])
            let mut iter = second_arg.array_iterator(global)?;
            if iter.len % 2 != 0 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Array must have an even number of elements (field-value pairs)"
                )));
            }

            args.ensure_total_capacity(1 + iter.len as usize);

            while let Some(field_js) = iter.next()? {
                args.push(field_js.to_slice(global)?);

                let Some(value_js) = iter.next()? else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Array must have an even number of elements (field-value pairs)"
                    )));
                };
                args.push(value_js.to_slice(global)?);
            }
        } else {
            // Pattern 2: Variadic - hset(key, field, value, ...)
            let args_count = frame.arguments_count();
            if args_count < 3 {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!(
                            "{} requires at least key, field, and value arguments",
                            bstr::BStr::new(command)
                        ),
                    )
                    .throw());
            }

            let field_value_count = args_count - 1; // Exclude key
            if !field_value_count.is_multiple_of(2) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{} requires field-value pairs (even number of arguments after key)",
                    bstr::BStr::new(command)
                )));
            }

            args.ensure_total_capacity(args_count as usize);

            let mut i: u32 = 1;
            while i < args_count {
                args.push(frame.argument(i as usize).to_slice(global)?);
                i += 1;
            }
        }

        if args.len() == 1 {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!(
                        "{} requires at least one field-value pair",
                        bstr::BStr::new(command)
                    ),
                )
                .throw());
        }

        send_cmd(
            this,
            global,
            command,
            CommandArgs::Slices(&args),
            CommandMeta::default(),
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn hset(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::hset_impl(this, global, frame, b"HSET", "hset")
    }

    #[bun_jsc::host_fn(method)]
    pub fn hmset(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::hset_impl(this, global, frame, b"HMSET", "hmset")
    }

    cmd_key_varargs!(hdel, "hdel", "HDEL", "key", NotSubscriber);
    cmd_key_varargs!(
        hrandfield,
        "hrandfield",
        "HRANDFIELD",
        "key",
        NotSubscriber
    );
    cmd_key_varargs!(hscan, "hscan", "HSCAN", "key", NotSubscriber);
    cmd_strings_varargs!(hgetdel, "hgetdel", "HGETDEL", NotSubscriber);
    cmd_strings_varargs!(hgetex, "hgetex", "HGETEX", NotSubscriber);
    cmd_strings_varargs!(hsetex, "hsetex", "HSETEX", NotSubscriber);
    cmd_strings_varargs!(hexpire, "hexpire", "HEXPIRE", NotSubscriber);
    cmd_strings_varargs!(hexpireat, "hexpireat", "HEXPIREAT", NotSubscriber);
    cmd_strings_varargs!(hexpiretime, "hexpiretime", "HEXPIRETIME", NotSubscriber);
    cmd_strings_varargs!(hpersist, "hpersist", "HPERSIST", NotSubscriber);
    cmd_strings_varargs!(hpexpire, "hpexpire", "HPEXPIRE", NotSubscriber);
    cmd_strings_varargs!(hpexpireat, "hpexpireat", "HPEXPIREAT", NotSubscriber);
    cmd_strings_varargs!(hpexpiretime, "hpexpiretime", "HPEXPIRETIME", NotSubscriber);
    cmd_strings_varargs!(hpttl, "hpttl", "HPTTL", NotSubscriber);
    cmd_strings_varargs!(httl, "httl", "HTTL", NotSubscriber);

    cmd_key_value_value2!(
        hsetnx,
        "hsetnx",
        "HSETNX",
        "key",
        "field",
        "value",
        NotSubscriber,
        CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );
    cmd_key_value!(
        hexists,
        "hexists",
        "HEXISTS",
        "key",
        "field",
        NotSubscriber,
        CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );

    // Implement ping (send a PING command with an optional message)
    #[bun_jsc::host_fn(method)]
    pub fn ping(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let message: Option<JSArgument> = if !frame.argument(0).is_undefined_or_null() {
            // Only use the first argument if provided, ignore any additional arguments
            Some(require_arg(global, frame.argument(0), "ping", "message")?)
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
            b"PING",
            CommandArgs::Blobs(args_slice),
            CommandMeta::default(),
        )
    }

    cmd_key!(bitcount, "bitcount", "BITCOUNT", "key", NotSubscriber);
    cmd_strings_varargs!(blmove, "blmove", "BLMOVE", NotSubscriber);
    cmd_strings_varargs!(blmpop, "blmpop", "BLMPOP", NotSubscriber);
    cmd_strings_varargs!(blpop, "blpop", "BLPOP", NotSubscriber);
    cmd_strings_varargs!(brpop, "brpop", "BRPOP", NotSubscriber);
    cmd_key_value_value2!(
        brpoplpush,
        "brpoplpush",
        "BRPOPLPUSH",
        "source",
        "destination",
        "timeout",
        NotSubscriber
    );
    cmd_key_value!(getbit, "getbit", "GETBIT", "key", "offset", NotSubscriber);
    cmd_key_value_value2!(
        setbit,
        "setbit",
        "SETBIT",
        "key",
        "offset",
        "value",
        NotSubscriber
    );
    cmd_key_value_value2!(
        getrange,
        "getrange",
        "GETRANGE",
        "key",
        "start",
        "end",
        NotSubscriber
    );
    cmd_key_value_value2!(
        setrange,
        "setrange",
        "SETRANGE",
        "key",
        "offset",
        "value",
        NotSubscriber
    );
    cmd_key!(dump, "dump", "DUMP", "key", NotSubscriber);
    cmd_key_value!(
        expireat,
        "expireat",
        "EXPIREAT",
        "key",
        "timestamp",
        NotSubscriber
    );
    cmd_key!(
        expiretime,
        "expiretime",
        "EXPIRETIME",
        "key",
        NotSubscriber
    );
    cmd_key!(getdel, "getdel", "GETDEL", "key", NotSubscriber);
    cmd_strings_varargs!(getex, "getex", "GETEX", NotSubscriber);
    cmd_key!(hgetall, "hgetall", "HGETALL", "key", NotSubscriber);
    cmd_key!(hkeys, "hkeys", "HKEYS", "key", NotSubscriber);
    cmd_key!(hlen, "hlen", "HLEN", "key", NotSubscriber);
    cmd_key!(hvals, "hvals", "HVALS", "key", NotSubscriber);
    cmd_key!(keys, "keys", "KEYS", "key", NotSubscriber);
    cmd_key_value!(lindex, "lindex", "LINDEX", "key", "index", NotSubscriber);
    cmd_strings_varargs!(linsert, "linsert", "LINSERT", NotSubscriber);
    cmd_key!(llen, "llen", "LLEN", "key", NotSubscriber);
    cmd_strings_varargs!(lmove, "lmove", "LMOVE", NotSubscriber);
    cmd_strings_varargs!(lmpop, "lmpop", "LMPOP", NotSubscriber);
    cmd_key_varargs!(lpop, "lpop", "LPOP", "key", NotSubscriber);
    cmd_strings_varargs!(lpos, "lpos", "LPOS", NotSubscriber);
    cmd_key_value_value2!(
        lrange,
        "lrange",
        "LRANGE",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key_value_value2!(
        lrem,
        "lrem",
        "LREM",
        "key",
        "count",
        "element",
        NotSubscriber
    );
    cmd_key_value_value2!(
        lset,
        "lset",
        "LSET",
        "key",
        "index",
        "element",
        NotSubscriber
    );
    cmd_key_value_value2!(
        ltrim,
        "ltrim",
        "LTRIM",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key!(persist, "persist", "PERSIST", "key", NotSubscriber);
    cmd_key_value!(
        pexpire,
        "pexpire",
        "PEXPIRE",
        "key",
        "milliseconds",
        NotSubscriber
    );
    cmd_key_value!(
        pexpireat,
        "pexpireat",
        "PEXPIREAT",
        "key",
        "milliseconds-timestamp",
        NotSubscriber
    );
    cmd_key!(
        pexpiretime,
        "pexpiretime",
        "PEXPIRETIME",
        "key",
        NotSubscriber
    );
    cmd_key!(pttl, "pttl", "PTTL", "key", NotSubscriber);
    cmd_noargs!(randomkey, "randomkey", "RANDOMKEY", NotSubscriber);
    cmd_key_varargs!(rpop, "rpop", "RPOP", "key", NotSubscriber);
    cmd_key_value!(
        rpoplpush,
        "rpoplpush",
        "RPOPLPUSH",
        "source",
        "destination",
        NotSubscriber
    );
    cmd_strings_varargs!(scan, "scan", "SCAN", NotSubscriber);
    cmd_key!(scard, "scard", "SCARD", "key", NotSubscriber);
    cmd_strings_varargs!(sdiff, "sdiff", "SDIFF", NotSubscriber);
    cmd_strings_varargs!(sdiffstore, "sdiffstore", "SDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(sinter, "sinter", "SINTER", NotSubscriber);
    cmd_strings_varargs!(sintercard, "sintercard", "SINTERCARD", NotSubscriber);
    cmd_strings_varargs!(sinterstore, "sinterstore", "SINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(smismember, "smismember", "SMISMEMBER", NotSubscriber);
    cmd_strings_varargs!(sscan, "sscan", "SSCAN", NotSubscriber);
    cmd_key!(strlen, "strlen", "STRLEN", "key", NotSubscriber);
    cmd_strings_varargs!(sunion, "sunion", "SUNION", NotSubscriber);
    cmd_strings_varargs!(sunionstore, "sunionstore", "SUNIONSTORE", NotSubscriber);
    cmd_key!(r#type, "type", "TYPE", "key", NotSubscriber);
    cmd_key!(zcard, "zcard", "ZCARD", "key", NotSubscriber);
    cmd_key_value_value2!(
        zcount,
        "zcount",
        "ZCOUNT",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zlexcount,
        "zlexcount",
        "ZLEXCOUNT",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_varargs!(zpopmax, "zpopmax", "ZPOPMAX", "key", NotSubscriber);
    cmd_key_varargs!(zpopmin, "zpopmin", "ZPOPMIN", "key", NotSubscriber);
    cmd_key_varargs!(
        zrandmember,
        "zrandmember",
        "ZRANDMEMBER",
        "key",
        NotSubscriber
    );
    cmd_strings_varargs!(zrange, "zrange", "ZRANGE", NotSubscriber);
    cmd_strings_varargs!(zrevrange, "zrevrange", "ZREVRANGE", NotSubscriber);
    cmd_strings_varargs!(
        zrangebyscore,
        "zrangebyscore",
        "ZRANGEBYSCORE",
        NotSubscriber
    );
    cmd_strings_varargs!(
        zrevrangebyscore,
        "zrevrangebyscore",
        "ZREVRANGEBYSCORE",
        NotSubscriber
    );
    cmd_key_varargs!(
        zrangebylex,
        "zrangebylex",
        "ZRANGEBYLEX",
        "key",
        NotSubscriber
    );
    cmd_key_varargs!(
        zrevrangebylex,
        "zrevrangebylex",
        "ZREVRANGEBYLEX",
        "key",
        NotSubscriber
    );
    cmd_key_value!(append, "append", "APPEND", "key", "value", NotSubscriber);
    cmd_key_value!(getset, "getset", "GETSET", "key", "value", NotSubscriber);
    cmd_key_value!(hget, "hget", "HGET", "key", "field", NotSubscriber);
    cmd_key_value!(
        incrby,
        "incrby",
        "INCRBY",
        "key",
        "increment",
        NotSubscriber
    );
    cmd_key_value!(
        incrbyfloat,
        "incrbyfloat",
        "INCRBYFLOAT",
        "key",
        "increment",
        NotSubscriber
    );
    cmd_key_value!(
        decrby,
        "decrby",
        "DECRBY",
        "key",
        "decrement",
        NotSubscriber
    );
    cmd_strings_varargs!(lpush, "lpush", "LPUSH", NotSubscriber);
    cmd_strings_varargs!(lpushx, "lpushx", "LPUSHX", NotSubscriber);
    cmd_key_value!(pfadd, "pfadd", "PFADD", "key", "value", NotSubscriber);
    cmd_strings_varargs!(rpush, "rpush", "RPUSH", NotSubscriber);
    cmd_strings_varargs!(rpushx, "rpushx", "RPUSHX", NotSubscriber);
    cmd_key_value!(setnx, "setnx", "SETNX", "key", "value", NotSubscriber);
    cmd_key_value_value2!(
        setex,
        "setex",
        "SETEX",
        "key",
        "seconds",
        "value",
        NotSubscriber
    );
    cmd_key_value_value2!(
        psetex,
        "psetex",
        "PSETEX",
        "key",
        "milliseconds",
        "value",
        NotSubscriber
    );
    cmd_key_value!(zscore, "zscore", "ZSCORE", "key", "value", NotSubscriber);
    cmd_key_value_value2!(
        zincrby,
        "zincrby",
        "ZINCRBY",
        "key",
        "increment",
        "member",
        NotSubscriber
    );
    cmd_strings_varargs!(zmscore, "zmscore", "ZMSCORE", NotSubscriber);
    cmd_strings_varargs!(zadd, "zadd", "ZADD", NotSubscriber);
    cmd_strings_varargs!(zscan, "zscan", "ZSCAN", NotSubscriber);
    cmd_strings_varargs!(zdiff, "zdiff", "ZDIFF", NotSubscriber);
    cmd_strings_varargs!(zdiffstore, "zdiffstore", "ZDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(zinter, "zinter", "ZINTER", NotSubscriber);
    cmd_strings_varargs!(zintercard, "zintercard", "ZINTERCARD", NotSubscriber);
    cmd_strings_varargs!(zinterstore, "zinterstore", "ZINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(zunion, "zunion", "ZUNION", NotSubscriber);
    cmd_strings_varargs!(zunionstore, "zunionstore", "ZUNIONSTORE", NotSubscriber);
    cmd_strings_varargs!(zmpop, "zmpop", "ZMPOP", NotSubscriber);
    cmd_strings_varargs!(bzmpop, "bzmpop", "BZMPOP", NotSubscriber);
    cmd_strings_varargs!(bzpopmin, "bzpopmin", "BZPOPMIN", NotSubscriber);
    cmd_strings_varargs!(bzpopmax, "bzpopmax", "BZPOPMAX", NotSubscriber);
    cmd_key_varargs!(del, "del", "DEL", "key", NotSubscriber);
    cmd_key_varargs!(mget, "mget", "MGET", "key", NotSubscriber);
    cmd_strings_varargs!(mset, "mset", "MSET", NotSubscriber);
    cmd_strings_varargs!(msetnx, "msetnx", "MSETNX", NotSubscriber);
    cmd_strings_varargs!(script, "script", "SCRIPT", NotSubscriber);
    cmd_strings_varargs!(select, "select", "SELECT", NotSubscriber);
    cmd_key_value!(
        spublish,
        "spublish",
        "SPUBLISH",
        "channel",
        "message",
        NotSubscriber
    );

    cmd_key_value_value2!(
        smove,
        "smove",
        "SMOVE",
        "source",
        "destination",
        "member",
        NotSubscriber,
        CommandMeta::RETURN_AS_BOOL | CommandMeta::SUPPORTS_AUTO_PIPELINING
    );

    cmd_key_value_value2!(
        substr,
        "substr",
        "SUBSTR",
        "key",
        "start",
        "end",
        NotSubscriber
    );
    cmd_key_value!(
        hstrlen,
        "hstrlen",
        "HSTRLEN",
        "key",
        "field",
        NotSubscriber
    );
    cmd_key_varargs!(zrank, "zrank", "ZRANK", "key", NotSubscriber);
    cmd_strings_varargs!(zrangestore, "zrangestore", "ZRANGESTORE", NotSubscriber);
    cmd_key_varargs!(zrem, "zrem", "ZREM", "key", NotSubscriber);
    cmd_key_value_value2!(
        zremrangebylex,
        "zremrangebylex",
        "ZREMRANGEBYLEX",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zremrangebyrank,
        "zremrangebyrank",
        "ZREMRANGEBYRANK",
        "key",
        "start",
        "stop",
        NotSubscriber
    );
    cmd_key_value_value2!(
        zremrangebyscore,
        "zremrangebyscore",
        "ZREMRANGEBYSCORE",
        "key",
        "min",
        "max",
        NotSubscriber
    );
    cmd_key_varargs!(zrevrank, "zrevrank", "ZREVRANK", "key", NotSubscriber);
    cmd_strings_varargs!(psubscribe, "psubscribe", "PSUBSCRIBE", DontCare);
    cmd_strings_varargs!(punsubscribe, "punsubscribe", "PUNSUBSCRIBE", DontCare);
    cmd_strings_varargs!(pubsub, "pubsub", "PUBSUB", DontCare);
    cmd_strings_varargs!(copy, "copy", "COPY", NotSubscriber);
    cmd_key_varargs!(unlink, "unlink", "UNLINK", "key", NotSubscriber);
    cmd_key_varargs!(touch, "touch", "TOUCH", "key", NotSubscriber);
    cmd_key_value!(rename, "rename", "RENAME", "key", "newkey", NotSubscriber);
    cmd_key_value!(
        renamenx,
        "renamenx",
        "RENAMENX",
        "key",
        "newkey",
        NotSubscriber
    );

    cmd_key_value!(
        publish,
        "publish",
        "PUBLISH",
        "channel",
        "message",
        NotSubscriber
    );

    #[bun_jsc::host_fn(method)]
    pub fn subscribe(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // `upsert_receive_handler`'s exit guard re-enters `on_writable` /
        // `update_poll_ref` before `send()` is reached; hold a ref so `*this`
        // stays live across those calls.
        let _guard = this.ref_scope();

        let [channel_or_many, handler_callback] = frame.arguments_as_array::<2>();
        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);
        let mut inserted_channels: Vec<JSValue> = Vec::with_capacity(1);

        if !handler_callback.is_callable() {
            return Err(global.throw_invalid_argument_type("subscribe", "listener", "function"));
        }

        // The first argument given is the channel or may be an array of channels.
        if channel_or_many.is_array() {
            let len = channel_or_many.get_length(global)?;
            if len == 0 {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("subscribe requires at least one channel"),
                    )
                    .throw());
            }
            redis_channels.ensure_total_capacity(len as usize);

            let mut array_iter = channel_or_many.array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        "subscribe",
                        "channel",
                        "string",
                    ));
                };
                redis_channels.push(channel);

                // What we do here is add our receive handler. Notice that this doesn't really do anything until the
                // "SUBSCRIBE" command is sent to redis and we get a response.
                this._subscription_ctx.get().upsert_receive_handler(
                    global,
                    channel_arg,
                    handler_callback,
                )?;
                inserted_channels.push(channel_arg);
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return Err(global.throw_invalid_argument_type("subscribe", "channel", "string"));
            };
            redis_channels.push(channel);

            this._subscription_ctx.get().upsert_receive_handler(
                global,
                channel_or_many,
                handler_callback,
            )?;
            inserted_channels.push(channel_or_many);
        } else {
            return Err(global.throw_invalid_argument_type(
                "subscribe",
                "channel",
                "string or array",
            ));
        }

        let command = Command {
            command: b"SUBSCRIBE",
            args: CommandArgs::Blobs(&redis_channels),
            meta: CommandMeta::default() | CommandMeta::SUBSCRIPTION_REQUEST,
        };
        let promise = match this.send(global, &command) {
            Ok(p) => p,
            Err(err) => {
                for ch in &inserted_channels {
                    let _ = this
                        ._subscription_ctx
                        .get()
                        .remove_receive_handler(global, *ch, handler_callback)?;
                }
                return send_err_to_js(global, "Failed to send SUBSCRIBE command", err);
            }
        };

        Ok(promise_to_js(promise))
    }

    #[bun_jsc::host_fn(method)]
    pub fn unsubscribe(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Hold a ref so `*this` stays live across the handler-map updates and
        // the `send()` below.
        let _guard = this.ref_scope();

        // Check if we're in subscription mode
        require_subscriber(this, "unsubscribe")?;

        let args_view = frame.arguments();

        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        // If no arguments, unsubscribe from all channels
        if args_view.is_empty() {
            let command = Command {
                command: b"UNSUBSCRIBE",
                args: CommandArgs::Blobs(&redis_channels),
                meta: CommandMeta::default(),
            };
            return match this.send(global, &command) {
                Ok(p) => {
                    this._subscription_ctx
                        .get()
                        .clear_all_receive_handlers(global)?;
                    Ok(promise_to_js(p))
                }
                Err(err) => send_err_to_js(global, "Failed to send UNSUBSCRIBE command", err),
            };
        }

        // The first argument can be a channel or an array of channels
        let channel_or_many = frame.argument(0);

        // Two arguments means .unsubscribe(channel, listener) is invoked.
        if frame.arguments().len() == 2 {
            // In this case, the first argument is a channel string and the second
            // argument is the handler to remove.
            if !channel_or_many.is_string() {
                return Err(global.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            }

            let channel = channel_or_many;
            let listener_cb = frame.argument(1);

            if !listener_cb.is_callable() {
                return Err(global.throw_invalid_argument_type(
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
                return Err(global.throw_invalid_argument_type("unsubscribe", "channel", "string"));
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
                    return Ok(JSPromise::resolved_promise_value(
                        global,
                        JSValue::UNDEFINED,
                    ));
                }
                Err(e) => return Err(e),
            };

            // In this case, we only want to send the unsubscribe command to redis if there are no more listeners for this
            // channel.
            if remaining_listeners == 0 {
                let command = Command {
                    command: b"UNSUBSCRIBE",
                    args: CommandArgs::Blobs(&redis_channels),
                    meta: CommandMeta::default(),
                };
                return match this.send(global, &command) {
                    Ok(p) => Ok(promise_to_js(p)),
                    Err(err) => {
                        this._subscription_ctx.get().upsert_receive_handler(
                            global,
                            channel,
                            listener_cb,
                        )?;
                        send_err_to_js(global, "Failed to send UNSUBSCRIBE command", err)
                    }
                };
            }

            // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
            return Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            ));
        }

        let mut cleared_channels: Vec<JSValue> = Vec::with_capacity(1);

        if channel_or_many.is_array() {
            let len = channel_or_many.get_length(global)?;
            if len == 0 {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("unsubscribe requires at least one channel"),
                    )
                    .throw());
            }

            redis_channels.reserve((len as usize).saturating_sub(redis_channels.len()));
            // It is an array, so let's iterate over it
            let mut array_iter = channel_or_many.array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        "unsubscribe",
                        "channel",
                        "string",
                    ));
                };
                redis_channels.push(channel);
                cleared_channels.push(channel_arg);
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return Err(global.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            };
            redis_channels.push(channel);
            cleared_channels.push(channel_or_many);
        } else {
            return Err(global.throw_invalid_argument_type(
                "unsubscribe",
                "channel",
                "string or array",
            ));
        }

        let command = Command {
            command: b"UNSUBSCRIBE",
            args: CommandArgs::Blobs(&redis_channels),
            meta: CommandMeta::default(),
        };
        match this.send(global, &command) {
            Ok(p) => {
                for ch in &cleared_channels {
                    this._subscription_ctx
                        .get()
                        .clear_receive_handlers(global, *ch)?;
                }
                Ok(promise_to_js(p))
            }
            Err(err) => send_err_to_js(global, "Failed to send UNSUBSCRIBE command", err),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn duplicate(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let _ = frame;

        let new_client_ptr = this.clone_without_connecting(global)?;
        let new_client_js = JSValkeyClient::ptr_to_js(new_client_ptr, global);
        JSValkeyClient::bind_js(new_client_ptr, new_client_js);
        // SAFETY: clone_without_connecting returns a freshly allocated, leaked
        // JSValkeyClient (heap::alloc); valid for the rest of this scope.
        let new_client: &JSValkeyClient = unsafe { &*new_client_ptr };
        // If the original client is already connected and not manually closed, start connecting the new client.
        if this.client.get().status == valkey::Status::Connected
            && !this.client.get().flags.is_manually_closed
        {
            // Use strong reference during connection to prevent premature GC
            new_client
                .client_mut()
                .flags
                .connection_promise_returns_client = true;
            return new_client.do_connect(global, new_client_js);
        }

        Ok(JSPromise::resolved_promise_value(global, new_client_js))
    }
}
