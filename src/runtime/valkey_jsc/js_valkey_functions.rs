use crate::node::{BlobOrStringOrBuffer as JSArgument, FileBlobs, StringOrBuffer};
use bun_collections::VecExt as _;
use bun_collections::smallvec::SmallVec;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{
    self as jsc, ErrorCode, JSGlobalObject, JSPromise, JSPropertyIterator, JSValue, JsResult,
};

use bun_valkey::command::Reply;

use super::hold::Object;
use super::js_valkey::{JSValkeyClient, js};

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

fn require_not_subscriber(this: &JSValkeyClient, function_name: &str) -> JsResult<()> {
    if this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{} cannot be called while in subscriber mode.",
                    function_name
                ),
            )
            .throw());
    }
    Ok(())
}

fn require_subscriber(this: &JSValkeyClient, function_name: &str) -> JsResult<()> {
    if !this.is_subscriber() {
        // `global_object: GlobalRef` derefs safely (BACKREF — VM-owned global outlives client).
        let global: &JSGlobalObject = &this.global_object;
        return Err(global
            .err(
                ErrorCode::REDIS_INVALID_STATE,
                format_args!(
                    "RedisClient.prototype.{} can only be called while in subscriber mode.",
                    function_name
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
        return JSArgument::from_js_maybe_file(global, str.to_js(), FileBlobs::Reject);
    }

    // Copy the bytes. A later argument's `toString()` can detach this buffer before the command is serialized.
    if let Some(buffer) = value.as_array_buffer(global) {
        let Some(copy) = buffer.try_copy_bytes() else {
            return Err(global.throw_out_of_memory());
        };
        return Ok(Some(JSArgument::StringOrBuffer(StringOrBuffer::owned(
            copy,
        ))));
    }

    JSArgument::from_js_maybe_file(global, value, FileBlobs::Allow)
}

// ──────────────────────────────────────────────────────────────────────────
// Commands: one row for each method, one body for each shape of arguments
// ──────────────────────────────────────────────────────────────────────────

enum ClientStateRequirement {
    /// The client must not be a subscriber (not in subscription mode).
    NotSubscriber,
    /// We don't care about the client state (subscriber or not).
    DontCare,
}

/// What differs between the methods that share a body.
struct Command<Args> {
    method: &'static str,
    wire: &'static str,
    state: ClientStateRequirement,
    reply: Reply,
    args: Args,
}

enum Varargs {
    /// `null` and `undefined` throw.
    Strict,
    /// `null` and `undefined` are left out, after a required first argument of this name.
    KeyThenSkipNullish(&'static str),
}

/// The arguments after a key, without `null` and `undefined`.
struct AfterKey {
    name: &'static str,
    expected: &'static str,
}

impl<Args> Command<Args> {
    fn check_state(&self, client: &JSValkeyClient) -> JsResult<()> {
        match self.state {
            ClientStateRequirement::NotSubscriber => require_not_subscriber(client, self.method),
            ClientStateRequirement::DontCare => Ok(()),
        }
    }

    fn arg(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        field: &'static str,
        expected: &'static str,
    ) -> JsResult<JSArgument> {
        // Not `?`, which compiles to one more copy of the argument.
        match from_js(global, value) {
            Ok(Some(arg)) => Ok(arg),
            Ok(None) => Err(global.throw_invalid_argument_type(self.method, field, expected)),
            Err(err) => Err(err),
        }
    }
}

// `inline(never)`: inlined, a body is compiled again for every row.
impl JSValkeyClient {
    #[inline(never)]
    fn send_fixed<const N: usize>(
        &self,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<[&'static str; N]>,
        values: [JSValue; N],
    ) -> JsResult<JSValue> {
        command.check_state(self)?;

        let mut args: SmallVec<[JSArgument; N]> = SmallVec::new();
        for (value, name) in values.into_iter().zip(command.args) {
            args.push(command.arg(global, value, name, "string or buffer")?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, command.reply))
    }

    #[inline(never)]
    fn send_varargs(
        &self,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<Varargs>,
        values: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let values = JsLocal::to_js_slice(values);
        command.check_state(self)?;

        if let Varargs::KeyThenSkipNullish(name) = command.args
            && values.first().is_none_or(|key| key.is_undefined_or_null())
        {
            return Err(global.throw_missing_arguments_value(&[name]));
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(values.len());
        for &value in values {
            if value.is_undefined_or_null() && !matches!(command.args, Varargs::Strict) {
                continue;
            }
            args.push(command.arg(global, value, "additional arguments", "string or buffer")?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, command.reply))
    }

    #[inline(never)]
    fn send_key_then(
        &self,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<AfterKey>,
        key: JsLocal<'_>,
        values: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        command.check_state(self)?;

        let AfterKey { name, expected } = command.args;
        if values.is_empty() {
            return Err(global.throw(format_args!(
                "{} requires at least a key and one {name}",
                command.wire
            )));
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(1 + values.len());
        args.push(command.arg(global, key.to_js(), "key", "string or buffer")?);
        for &value in JsLocal::to_js_slice(values) {
            if value.is_undefined_or_null() {
                continue;
            }
            args.push(command.arg(global, value, name, expected)?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, command.reply))
    }

    #[inline(never)]
    fn send_hincrby(
        &self,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<()>,
        key: JsLocal<'_>,
        field: JsLocal<'_>,
        increment: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        command.check_state(self)?;

        let text = |value: JsLocal<'_>, field, expected| match value.to_js() {
            value if value.is_undefined_or_null() => {
                Err(global.throw_invalid_argument_type(command.method, field, expected))
            }
            value => value.to_bun_string(global),
        };
        let key = text(key, "key", "string or buffer")?;
        let field = text(field, "field", "string or buffer")?;
        let increment = text(increment, "increment", "number or string")?;

        let args = [key.to_utf8(), field.to_utf8(), increment.to_utf8()];
        Ok(self.send(this, global, command.wire.as_bytes(), &args, command.reply))
    }
}

macro_rules! method {
    (
        $fn_name:ident($($param:ident: $ty:ty),*) => $body:ident($($value:expr),*),
        $name:literal, $command:literal, $state:ident, $reply:ident, $args:expr
    ) => {
        pub(crate) fn $fn_name(
            &self,
            this: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            $($param: $ty,)*
        ) -> JsResult<JSValue> {
            let command = const {
                &Command {
                    method: $name,
                    wire: $command,
                    state: ClientStateRequirement::$state,
                    reply: Reply::$reply,
                    args: $args,
                }
            };
            self.$body(this, cx.global(), command, $($value),*)
        }
    };
}

/// Each argument is `parameter: "name in the error message"`. `"WIRE" -> Bool` names a [`Reply`] other than `Value`.
macro_rules! cmd {
    ($fn_name:ident, $name:literal, $command:literal, $($rest:tt)*) => {
        cmd!($fn_name, $name, $command -> Value, $($rest)*);
    };
    (
        $fn_name:ident, $name:literal, $command:literal -> $reply:ident, $state:ident
        $(, $arg:ident: $arg_name:literal)*
    ) => {
        method!(
            $fn_name($($arg: JsLocal<'_>),*) => send_fixed([$($arg.to_js()),*]),
            $name, $command, $state, $reply, [$($arg_name),*]
        );
    };
}

macro_rules! cmd_key_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        method!(
            $fn_name(args: &[JsLocal<'_>]) => send_varargs(args),
            $name, $command, $state, Value, Varargs::KeyThenSkipNullish($arg0_name)
        );
    };
}

macro_rules! cmd_strings_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(args: &[JsLocal<'_>]) => send_varargs(args),
            $name, $command, $state, Value, Varargs::Strict
        );
    };
}

macro_rules! cmd_key_members {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, members: &[JsLocal<'_>]) => send_key_then(key, members),
            $name, $command, $state, Value,
            AfterKey { name: "member", expected: "string or buffer" }
        );
    };
}

/// A missing count arrives as `undefined`, so these never get the "requires at least" error.
macro_rules! cmd_key_count {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, count: JsLocal<'_>) => send_key_then(key, &[count]),
            $name, $command, $state, Value,
            AfterKey { name: "count", expected: "number or string" }
        );
    };
}

macro_rules! cmd_hincrby {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, field: JsLocal<'_>, increment: JsLocal<'_>)
                => send_hincrby(key, field, increment),
            $name, $command, $state, Value, ()
        );
    };
}

// ──────────────────────────────────────────────────────────────────────────
// JSValkeyClient prototype methods
// ──────────────────────────────────────────────────────────────────────────

impl JSValkeyClient {
    pub(crate) fn js_send(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        command: JsLocal<'_>,
        args: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let command = command.to_js().to_bun_string(global)?;

        let args_array = args.to_js();
        if !args_array.is_object() || !args_array.is_array() {
            return Err(global.throw(format_args!("Arguments must be an array")));
        }
        let mut iter = args_array.array_iterator(global)?;
        let mut args: Vec<JSArgument> = Vec::with_capacity(iter.len as usize);

        while let Some(arg_js) = iter.next()? {
            let Some(v) = from_js(global, arg_js)? else {
                return Err(global.throw_invalid_argument_type(
                    "sendCommand",
                    "argument",
                    "string or buffer",
                ));
            };
            args.push(v);
        }

        Ok(self.send(this, global, command.to_utf8().slice(), &args, Reply::Value))
    }

    cmd!(get, "get", "GET", NotSubscriber, key: "key");
    cmd!(get_buffer, "getBuffer", "GET" -> Buffer, NotSubscriber, key: "key");

    pub(crate) fn set(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        value: JsLocal<'_>,
        options: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "set")?;

        let mut args: Vec<JSArgument> = Vec::with_capacity(2 + options.len());

        let Some(key) = from_js(global, key.to_js())? else {
            return Err(global.throw_invalid_argument_type("set", "key", "string or buffer"));
        };
        args.push(key);

        let Some(value) = from_js(global, value.to_js())? else {
            return Err(global.throw_invalid_argument_type(
                "set",
                "value",
                "string or buffer or number",
            ));
        };
        args.push(value);

        for arg in JsLocal::to_js_slice(options) {
            if arg.is_undefined_or_null() {
                break;
            }
            let Some(v) = from_js(global, *arg)? else {
                return Err(global.throw_invalid_argument_type(
                    "set",
                    "arguments",
                    "string or buffer",
                ));
            };
            args.push(v);
        }

        Ok(self.send(this, global, b"SET", &args, Reply::Value))
    }

    cmd!(incr, "incr", "INCR", NotSubscriber, key: "key");
    cmd!(decr, "decr", "DECR", NotSubscriber, key: "key");
    cmd!(exists, "exists", "EXISTS" -> Bool, NotSubscriber, key: "key");

    pub(crate) fn expire(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        seconds: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "expire")?;

        let Some(key) = from_js(global, key.to_js())? else {
            return Err(global.throw_invalid_argument_type("expire", "key", "string or buffer"));
        };

        let seconds_value = seconds.to_js();
        if seconds_value.is_undefined() {
            return Err(global.throw_invalid_property_type_value(
                b"seconds",
                b"number",
                seconds_value,
            ));
        }
        if seconds_value.is_number() && seconds_value.as_number().is_nan() {
            return Err(global.throw_invalid_property_type_value(
                b"seconds",
                b"integer",
                seconds_value,
            ));
        }

        let seconds = global.validate_integer_range::<i32>(
            seconds_value,
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
        Ok(self.send(
            this,
            global,
            b"EXPIRE",
            &[key.slice(), seconds_slice],
            Reply::Value,
        ))
    }

    cmd!(ttl, "ttl", "TTL", NotSubscriber, key: "key");
    cmd_key_members!(srem, "srem", "SREM", NotSubscriber);
    cmd_key_count!(srandmember, "srandmember", "SRANDMEMBER", NotSubscriber);
    cmd!(smembers, "smembers", "SMEMBERS", NotSubscriber, key: "key");
    cmd_key_count!(spop, "spop", "SPOP", NotSubscriber);
    cmd_key_members!(sadd, "sadd", "SADD", NotSubscriber);
    cmd!(sismember, "sismember", "SISMEMBER" -> Bool, NotSubscriber, key: "key", member: "value");

    // Implement hmget (get multiple values from hash)
    pub(crate) fn hmget(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "hmget")?;

        let fields = JsLocal::to_js_slice(fields);
        let Some(&second_arg) = fields.first() else {
            return Err(global.throw(format_args!("HMGET requires at least a key and one field")));
        };

        let mut args: Vec<JSArgument> = Vec::with_capacity(1 + fields.len());

        let Some(key) = from_js(global, key.to_js())? else {
            return Err(global.throw_invalid_argument_type("hmget", "key", "string or buffer"));
        };
        args.push(key);

        if second_arg.is_array() {
            let array_len = second_arg.get_length(global)?;
            if array_len == 0 {
                return Err(global.throw(format_args!("HMGET requires at least one field")));
            }

            let mut array_iter = second_arg.array_iterator(global)?;
            while let Some(element) = array_iter.next()? {
                let Some(field) = from_js(global, element)? else {
                    return Err(global.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    ));
                };
                args.push(field);
            }
        } else {
            for arg in fields {
                if arg.is_undefined_or_null() {
                    break;
                }
                let Some(field) = from_js(global, *arg)? else {
                    return Err(global.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    ));
                };
                args.push(field);
            }
        }

        Ok(self.send(this, global, b"HMGET", &args, Reply::Value))
    }

    cmd_hincrby!(hincrby, "hincrby", "HINCRBY", NotSubscriber);
    cmd_hincrby!(hincrbyfloat, "hincrbyfloat", "HINCRBYFLOAT", NotSubscriber);

    fn hset_impl(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
        command: &'static str,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, command)?;

        let key = key.to_js().to_bun_string(global)?;

        let fields = JsLocal::to_js_slice(fields);
        let second_arg = fields.first().copied().unwrap_or(JSValue::UNDEFINED);

        let object_iter;
        let mut args: Vec<bun_core::Utf8Bytes<'_>> = Vec::new();

        args.push(key.to_utf8());

        if second_arg.is_object() && !second_arg.is_array() {
            // Pattern 1: Object/Record - hset(key, {field: value, ...})
            let Some(obj) = second_arg.get_object() else {
                return Err(global.throw_invalid_argument_type(command, "fields", "object"));
            };

            object_iter = JSPropertyIterator::init(
                global,
                obj,
                jsc::PropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                },
            )?;

            args.ensure_total_capacity(1 + object_iter.len * 2);

            while let Some((field_name, value)) = object_iter.next()? {
                args.push(field_name.to_utf8());

                args.push(value.to_utf8(global)?);
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
                args.push(field_js.to_utf8(global)?);

                let Some(value_js) = iter.next()? else {
                    return Err(global.throw(format_args!(
                        "Array must have an even number of elements (field-value pairs)"
                    )));
                };
                args.push(value_js.to_utf8(global)?);
            }
        } else {
            // Pattern 2: Variadic - hset(key, field, value, ...)
            if fields.len() < 2 {
                return Err(global.throw(format_args!(
                    "HSET requires at least key, field, and value arguments"
                )));
            }

            if !fields.len().is_multiple_of(2) {
                return Err(global.throw(format_args!(
                    "HSET requires field-value pairs (even number of arguments after key)"
                )));
            }

            args.ensure_total_capacity(1 + fields.len());

            for field_or_value in fields {
                args.push(field_or_value.to_utf8(global)?);
            }
        }

        if args.len() == 1 {
            return Err(global.throw(format_args!("HSET requires at least one field-value pair")));
        }

        Ok(self.send(this, global, command.as_bytes(), &args, Reply::Value))
    }

    pub(crate) fn hset(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        self.hset_impl(this, cx, key, fields, "HSET")
    }

    pub(crate) fn hmset(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        self.hset_impl(this, cx, key, fields, "HMSET")
    }

    cmd_key_varargs!(hdel, "hdel", "HDEL", "key", NotSubscriber);
    cmd_key_varargs!(hrandfield, "hrandfield", "HRANDFIELD", "key", NotSubscriber);
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
    cmd!(
        hsetnx, "hsetnx", "HSETNX" -> Bool, NotSubscriber,
        key: "key", field: "field", value: "value"
    );
    cmd!(hexists, "hexists", "HEXISTS" -> Bool, NotSubscriber, key: "key", field: "field");

    // Implement ping (send a PING command with an optional message)
    pub(crate) fn ping(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        message: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let message: Option<JSArgument> = if !message.to_js().is_undefined_or_null() {
            // Only use the first argument if provided, ignore any additional arguments
            let Some(m) = from_js(global, message.to_js())? else {
                return Err(global.throw_invalid_argument_type(
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
        Ok(self.send(this, global, b"PING", args_slice, Reply::Value))
    }

    cmd!(bitcount, "bitcount", "BITCOUNT", NotSubscriber, key: "key");
    cmd_strings_varargs!(blmove, "blmove", "BLMOVE", NotSubscriber);
    cmd_strings_varargs!(blmpop, "blmpop", "BLMPOP", NotSubscriber);
    cmd_strings_varargs!(blpop, "blpop", "BLPOP", NotSubscriber);
    cmd_strings_varargs!(brpop, "brpop", "BRPOP", NotSubscriber);
    cmd!(
        brpoplpush, "brpoplpush", "BRPOPLPUSH", NotSubscriber,
        source: "source", destination: "destination", timeout: "timeout"
    );
    cmd!(getbit, "getbit", "GETBIT", NotSubscriber, key: "key", offset: "offset");
    cmd!(setbit, "setbit", "SETBIT", NotSubscriber, key: "key", offset: "offset", value: "value");
    cmd!(getrange, "getrange", "GETRANGE", NotSubscriber, key: "key", start: "start", end: "end");
    cmd!(
        setrange, "setrange", "SETRANGE", NotSubscriber,
        key: "key", offset: "offset", value: "value"
    );
    cmd!(dump, "dump", "DUMP", NotSubscriber, key: "key");
    cmd!(expireat, "expireat", "EXPIREAT", NotSubscriber, key: "key", timestamp: "timestamp");
    cmd!(expiretime, "expiretime", "EXPIRETIME", NotSubscriber, key: "key");
    cmd!(getdel, "getdel", "GETDEL", NotSubscriber, key: "key");
    cmd_strings_varargs!(getex, "getex", "GETEX", NotSubscriber);
    cmd!(hgetall, "hgetall", "HGETALL", NotSubscriber, key: "key");
    cmd!(hkeys, "hkeys", "HKEYS", NotSubscriber, key: "key");
    cmd!(hlen, "hlen", "HLEN", NotSubscriber, key: "key");
    cmd!(hvals, "hvals", "HVALS", NotSubscriber, key: "key");
    cmd!(keys, "keys", "KEYS", NotSubscriber, pattern: "key");
    cmd!(lindex, "lindex", "LINDEX", NotSubscriber, key: "key", index: "index");
    cmd_strings_varargs!(linsert, "linsert", "LINSERT", NotSubscriber);
    cmd!(llen, "llen", "LLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(lmove, "lmove", "LMOVE", NotSubscriber);
    cmd_strings_varargs!(lmpop, "lmpop", "LMPOP", NotSubscriber);
    cmd_key_varargs!(lpop, "lpop", "LPOP", "key", NotSubscriber);
    cmd_strings_varargs!(lpos, "lpos", "LPOS", NotSubscriber);
    cmd!(lrange, "lrange", "LRANGE", NotSubscriber, key: "key", start: "start", stop: "stop");
    cmd!(lrem, "lrem", "LREM", NotSubscriber, key: "key", count: "count", element: "element");
    cmd!(lset, "lset", "LSET", NotSubscriber, key: "key", index: "index", element: "element");
    cmd!(ltrim, "ltrim", "LTRIM", NotSubscriber, key: "key", start: "start", stop: "stop");
    cmd!(persist, "persist", "PERSIST", NotSubscriber, key: "key");
    cmd!(pexpire, "pexpire", "PEXPIRE", NotSubscriber, key: "key", milliseconds: "milliseconds");
    cmd!(
        pexpireat, "pexpireat", "PEXPIREAT", NotSubscriber,
        key: "key", milliseconds_timestamp: "milliseconds-timestamp"
    );
    cmd!(pexpiretime, "pexpiretime", "PEXPIRETIME", NotSubscriber, key: "key");
    cmd!(pttl, "pttl", "PTTL", NotSubscriber, key: "key");
    cmd!(randomkey, "randomkey", "RANDOMKEY", NotSubscriber);
    cmd_key_varargs!(rpop, "rpop", "RPOP", "key", NotSubscriber);
    cmd!(
        rpoplpush, "rpoplpush", "RPOPLPUSH", NotSubscriber,
        source: "source", destination: "destination"
    );
    cmd_strings_varargs!(scan, "scan", "SCAN", NotSubscriber);
    cmd!(scard, "scard", "SCARD", NotSubscriber, key: "key");
    cmd_strings_varargs!(sdiff, "sdiff", "SDIFF", NotSubscriber);
    cmd_strings_varargs!(sdiffstore, "sdiffstore", "SDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(sinter, "sinter", "SINTER", NotSubscriber);
    cmd_strings_varargs!(sintercard, "sintercard", "SINTERCARD", NotSubscriber);
    cmd_strings_varargs!(sinterstore, "sinterstore", "SINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(smismember, "smismember", "SMISMEMBER", NotSubscriber);
    cmd_strings_varargs!(sscan, "sscan", "SSCAN", NotSubscriber);
    cmd!(strlen, "strlen", "STRLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(sunion, "sunion", "SUNION", NotSubscriber);
    cmd_strings_varargs!(sunionstore, "sunionstore", "SUNIONSTORE", NotSubscriber);
    cmd!(r#type, "type", "TYPE", NotSubscriber, key: "key");
    cmd!(zcard, "zcard", "ZCARD", NotSubscriber, key: "key");
    cmd!(zcount, "zcount", "ZCOUNT", NotSubscriber, key: "key", min: "min", max: "max");
    cmd!(zlexcount, "zlexcount", "ZLEXCOUNT", NotSubscriber, key: "key", min: "min", max: "max");
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
    cmd!(append, "append", "APPEND", NotSubscriber, key: "key", value: "value");
    cmd!(getset, "getset", "GETSET", NotSubscriber, key: "key", value: "value");
    cmd!(hget, "hget", "HGET", NotSubscriber, key: "key", field: "field");
    cmd!(incrby, "incrby", "INCRBY", NotSubscriber, key: "key", increment: "increment");
    cmd!(
        incrbyfloat, "incrbyfloat", "INCRBYFLOAT", NotSubscriber,
        key: "key", increment: "increment"
    );
    cmd!(decrby, "decrby", "DECRBY", NotSubscriber, key: "key", decrement: "decrement");
    cmd_key_varargs!(lpush, "lpush", "LPUSH", "key", NotSubscriber);
    cmd_key_varargs!(lpushx, "lpushx", "LPUSHX", "key", NotSubscriber);
    cmd!(pfadd, "pfadd", "PFADD", NotSubscriber, key: "key", element: "value");
    cmd_key_varargs!(rpush, "rpush", "RPUSH", "key", NotSubscriber);
    cmd_key_varargs!(rpushx, "rpushx", "RPUSHX", "key", NotSubscriber);
    cmd!(setnx, "setnx", "SETNX", NotSubscriber, key: "key", value: "value");
    cmd!(setex, "setex", "SETEX", NotSubscriber, key: "key", seconds: "seconds", value: "value");
    cmd!(
        psetex, "psetex", "PSETEX", NotSubscriber,
        key: "key", milliseconds: "milliseconds", value: "value"
    );
    cmd!(zscore, "zscore", "ZSCORE", NotSubscriber, key: "key", member: "value");
    cmd!(
        zincrby, "zincrby", "ZINCRBY", NotSubscriber,
        key: "key", increment: "increment", member: "member"
    );
    cmd_key_varargs!(zmscore, "zmscore", "ZMSCORE", "key", NotSubscriber);
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
    cmd!(spublish, "spublish", "SPUBLISH", NotSubscriber, channel: "channel", message: "message");
    cmd!(
        smove, "smove", "SMOVE" -> Bool, NotSubscriber,
        source: "source", destination: "destination", member: "member"
    );
    cmd!(substr, "substr", "SUBSTR", NotSubscriber, key: "key", start: "start", end: "end");
    cmd!(hstrlen, "hstrlen", "HSTRLEN", NotSubscriber, key: "key", field: "field");
    cmd_key_varargs!(zrank, "zrank", "ZRANK", "key", NotSubscriber);
    cmd_strings_varargs!(zrangestore, "zrangestore", "ZRANGESTORE", NotSubscriber);
    cmd_key_varargs!(zrem, "zrem", "ZREM", "key", NotSubscriber);
    cmd!(
        zremrangebylex, "zremrangebylex", "ZREMRANGEBYLEX", NotSubscriber,
        key: "key", min: "min", max: "max"
    );
    cmd!(
        zremrangebyrank, "zremrangebyrank", "ZREMRANGEBYRANK", NotSubscriber,
        key: "key", start: "start", stop: "stop"
    );
    cmd!(
        zremrangebyscore, "zremrangebyscore", "ZREMRANGEBYSCORE", NotSubscriber,
        key: "key", min: "min", max: "max"
    );
    cmd_key_varargs!(zrevrank, "zrevrank", "ZREVRANK", "key", NotSubscriber);
    cmd_strings_varargs!(psubscribe, "psubscribe", "PSUBSCRIBE", DontCare);
    cmd_strings_varargs!(punsubscribe, "punsubscribe", "PUNSUBSCRIBE", DontCare);
    cmd_strings_varargs!(pubsub, "pubsub", "PUBSUB", DontCare);
    cmd_strings_varargs!(copy, "copy", "COPY", NotSubscriber);
    cmd_key_varargs!(unlink, "unlink", "UNLINK", "key", NotSubscriber);
    cmd_key_varargs!(touch, "touch", "TOUCH", "key", NotSubscriber);
    cmd!(rename, "rename", "RENAME", NotSubscriber, key: "key", newkey: "newkey");
    cmd!(renamenx, "renamenx", "RENAMENX", NotSubscriber, key: "key", newkey: "newkey");

    // Bitmap commands
    cmd_strings_varargs!(bitop, "bitop", "BITOP", NotSubscriber);
    cmd_strings_varargs!(bitpos, "bitpos", "BITPOS", NotSubscriber);
    cmd_strings_varargs!(bitfield, "bitfield", "BITFIELD", NotSubscriber);

    // HyperLogLog commands
    cmd_strings_varargs!(pfcount, "pfcount", "PFCOUNT", NotSubscriber);
    cmd_strings_varargs!(pfmerge, "pfmerge", "PFMERGE", NotSubscriber);

    // Geo commands
    cmd_strings_varargs!(geoadd, "geoadd", "GEOADD", NotSubscriber);
    cmd_strings_varargs!(geodist, "geodist", "GEODIST", NotSubscriber);
    cmd_strings_varargs!(geohash, "geohash", "GEOHASH", NotSubscriber);
    cmd_strings_varargs!(geopos, "geopos", "GEOPOS", NotSubscriber);
    cmd_strings_varargs!(geosearch, "geosearch", "GEOSEARCH", NotSubscriber);
    cmd_strings_varargs!(
        geosearchstore,
        "geosearchstore",
        "GEOSEARCHSTORE",
        NotSubscriber
    );

    // Scripting commands
    cmd_strings_varargs!(eval, "eval", "EVAL", NotSubscriber);
    cmd_strings_varargs!(evalsha, "evalsha", "EVALSHA", NotSubscriber);
    cmd_strings_varargs!(fcall, "fcall", "FCALL", NotSubscriber);
    cmd_strings_varargs!(function, "function", "FUNCTION", NotSubscriber);

    // Server / connection commands
    cmd!(dbsize, "dbsize", "DBSIZE", NotSubscriber);
    cmd_strings_varargs!(flushdb, "flushdb", "FLUSHDB", NotSubscriber);
    cmd_strings_varargs!(flushall, "flushall", "FLUSHALL", NotSubscriber);
    cmd_strings_varargs!(info, "info", "INFO", NotSubscriber);
    cmd!(time, "time", "TIME", NotSubscriber);
    cmd!(echo, "echo", "ECHO", NotSubscriber, message: "message");
    cmd!(lastsave, "lastsave", "LASTSAVE", NotSubscriber);
    cmd_strings_varargs!(js_client, "client", "CLIENT", DontCare);
    cmd_strings_varargs!(config, "config", "CONFIG", NotSubscriber);
    cmd_strings_varargs!(debug, "debug", "DEBUG", NotSubscriber);
    cmd_strings_varargs!(command, "command", "COMMAND", NotSubscriber);

    // Generic key commands
    cmd_strings_varargs!(object, "object", "OBJECT", NotSubscriber);
    cmd_strings_varargs!(sort, "sort", "SORT", NotSubscriber);
    cmd!(wait, "wait", "WAIT", NotSubscriber, numreplicas: "numreplicas", timeout: "timeout");
    cmd_strings_varargs!(lcs, "lcs", "LCS", NotSubscriber);

    // Stream commands
    cmd_strings_varargs!(xadd, "xadd", "XADD", NotSubscriber);
    cmd!(xlen, "xlen", "XLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(xrange, "xrange", "XRANGE", NotSubscriber);
    cmd_strings_varargs!(xrevrange, "xrevrange", "XREVRANGE", NotSubscriber);
    cmd_strings_varargs!(xread, "xread", "XREAD", NotSubscriber);
    cmd_strings_varargs!(xreadgroup, "xreadgroup", "XREADGROUP", NotSubscriber);
    cmd_strings_varargs!(xdel, "xdel", "XDEL", NotSubscriber);
    cmd_strings_varargs!(xtrim, "xtrim", "XTRIM", NotSubscriber);
    cmd_strings_varargs!(xack, "xack", "XACK", NotSubscriber);
    cmd_strings_varargs!(xclaim, "xclaim", "XCLAIM", NotSubscriber);
    cmd_strings_varargs!(xautoclaim, "xautoclaim", "XAUTOCLAIM", NotSubscriber);
    cmd_strings_varargs!(xpending, "xpending", "XPENDING", NotSubscriber);
    cmd_strings_varargs!(xinfo, "xinfo", "XINFO", NotSubscriber);
    cmd_strings_varargs!(xgroup, "xgroup", "XGROUP", NotSubscriber);
    cmd_strings_varargs!(xsetid, "xsetid", "XSETID", NotSubscriber);

    pub(crate) fn publish(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        channel: JsLocal<'_>,
        message: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "publish")?;

        let mut args: Vec<JSArgument> = Vec::with_capacity(2);

        for (value, field) in [(channel.to_js(), "channel"), (message.to_js(), "message")] {
            if value.is_string()
                && let Some(arg) = from_js(global, value)?
            {
                args.push(arg);
            } else {
                return Err(global.throw_invalid_argument_type("publish", field, "string"));
            }
        }
        Ok(self.send(this, global, b"PUBLISH", &args, Reply::Value))
    }

    pub(crate) fn subscribe(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        channel: JsLocal<'_>,
        listener: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        // For the dial and the writes ahead of `send()`.
        let _guard = self.ref_guard();

        let (channel_or_many, handler_callback) = (channel.to_js(), listener.to_js());
        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        if !handler_callback.is_callable() {
            return Err(global.throw_invalid_argument_type("subscribe", "listener", "function"));
        }
        if !channel_or_many.is_string() && !channel_or_many.is_array() {
            return Err(global.throw_invalid_argument_type(
                "subscribe",
                "channel",
                "string or array",
            ));
        }

        // The walk below stores each listener as it goes. A client that would
        // reject the SUBSCRIBE outright must not keep the listeners either: a
        // listener with no subscription behind it pins the event loop and the
        // client, and cannot be removed with unsubscribe(). The dial comes
        // after the argument checks, as for every other command, and before
        // the state check, as in `send()`, so a fresh client with the offline
        // queue off is rejected the way get() is: connecting, not never
        // connected.
        self.ensure_dialing(this.into());
        if let Some(error) = self.rejection(global) {
            return Ok(JSPromise::rejected_promise(global, error).to_js());
        }

        // The first argument given is the channel or may be an array of channels.
        if channel_or_many.is_array() {
            if channel_or_many.get_length(global)? == 0 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "subscribe requires at least one channel"
                )));
            }
            redis_channels.ensure_total_capacity(channel_or_many.get_length(global)? as usize);

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
                //
                // This is less-than-ideal, still, because this assumes a happy path. What happens if
                // the SUBSCRIBE command fails? We have no way to roll back the addition of the
                // handler.
                self.upsert_receive_handler(this.into(), global, channel_arg, handler_callback)?;
            }
        } else {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return Err(global.throw_invalid_argument_type("subscribe", "channel", "string"));
            };
            redis_channels.push(channel);

            self.upsert_receive_handler(this.into(), global, channel_or_many, handler_callback)?;
        }

        Ok(self.send(this, global, b"SUBSCRIBE", &redis_channels, Reply::Value))
    }

    pub(crate) fn unsubscribe(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        // Hold a ref so `*self` stays live across the handler-map updates and
        // the `send()` below.
        let _guard = self.ref_guard();

        // Check if we're in subscription mode
        require_subscriber(self, "unsubscribe")?;
        let object = Object::from(this);

        let args_view = JsLocal::to_js_slice(args);

        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        // The first argument can be a channel or an array of channels
        let Some(&channel_or_many) = args_view.first() else {
            // If no arguments, unsubscribe from all channels
            object.clear_all_receive_handlers(global)?;
            return Ok(self.send(this, global, b"UNSUBSCRIBE", &redis_channels, Reply::Value));
        };

        // Two arguments means .unsubscribe(channel, listener) is invoked.
        if let &[_, listener_cb] = args_view {
            // In this case, the first argument is a channel string and the second
            // argument is the handler to remove.
            if !channel_or_many.is_string() {
                return Err(global.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            }

            let channel = channel_or_many;

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

            let remaining_listeners =
                match object.remove_receive_handler(global, channel, listener_cb) {
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
                return Ok(self.send(this, global, b"UNSUBSCRIBE", &redis_channels, Reply::Value));
            }

            // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
            return Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            ));
        }

        if channel_or_many.is_array() {
            if channel_or_many.get_length(global)? == 0 {
                return Err(global.throw_invalid_arguments(format_args!(
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
                    return Err(global.throw_invalid_argument_type(
                        "unsubscribe",
                        "channel",
                        "string",
                    ));
                };
                redis_channels.push(channel);
                // Clear the handlers for this channel
                object.clear_receive_handlers(global, channel_arg)?;
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return Err(global.throw_invalid_argument_type("unsubscribe", "channel", "string"));
            };
            redis_channels.push(channel);
            // Clear the handlers for this channel
            object.clear_receive_handlers(global, channel_or_many)?;
        } else {
            return Err(global.throw_invalid_argument_type(
                "unsubscribe",
                "channel",
                "string or array",
            ));
        }

        // Now send the unsubscribe command and clean up if necessary
        Ok(self.send(this, global, b"UNSUBSCRIBE", &redis_channels, Reply::Value))
    }

    pub(crate) fn duplicate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        // The duplicate is the calling script's, whoever made the original.
        let new_client = js::wrap(self.clone_without_connecting(&cx), global);
        let new_client_js = new_client.to_js();
        if self.get_connected() {
            new_client.connection_promise_returns_client.set(true);
            return Ok(new_client.do_connect(global, (&new_client).into()));
        }

        Ok(JSPromise::resolved_promise_value(global, new_client_js))
    }
}
