use crate::node::{BlobOrStringOrBuffer as JSArgument, StringOrBuffer};
use crate::webcore::Blob;
use bun_collections::VecExt as _;
use bun_collections::smallvec::SmallVec;
use bun_core::Utf8Bytes;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{
    self as jsc, ErrorCode, JSGlobalObject, JSPromise, JSPropertyIterator, JSType, JSValue,
    JsResult,
};

use bun_ptr::RefPtr;
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
    if value.is_string_literal() {
        return JSArgument::from_js(global, value);
    }

    if value.is_undefined_or_null() {
        return Ok(None);
    }

    if value.is_number() {
        // Allow numbers to be passed as strings.
        let str = value.to_js_string(global)?;
        return JSArgument::from_js(global, str.to_js());
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

    match JSArgument::from_js(global, value) {
        Ok(Some(JSArgument::Blob(blob))) if blob.is_s3() => {
            Err(global.throw_invalid_arguments(format_args!("S3 blob cannot be used here")))
        }
        arg => arg,
    }
}

/// An argument of a hash write: buffers and Blobs as bytes, anything else as `String(value)`.
#[inline(always)]
fn bytes_or_text(global: &JSGlobalObject, value: JSValue) -> JsResult<Utf8Bytes<'static>> {
    if value.is_object() {
        return object_bytes_or_text(global, value);
    }
    value.to_utf8(global)
}

#[inline(always)]
fn required_bytes_or_text(
    global: &JSGlobalObject,
    value: JSValue,
    method: &'static str,
    field: &'static str,
    expected: &'static str,
) -> JsResult<Utf8Bytes<'static>> {
    if value.is_undefined_or_null() {
        return Err(global.throw_invalid_argument_type(method, field, expected));
    }
    bytes_or_text(global, value)
}

#[inline(never)]
fn object_bytes_or_text(global: &JSGlobalObject, value: JSValue) -> JsResult<Utf8Bytes<'static>> {
    let ty = value.js_type();
    let typed_array = ty.is_typed_array_or_array_buffer() && ty != jsc::JSType::ArrayBuffer;
    match from_js(global, value)? {
        // `String(value)` throws for one that is detached or out of bounds.
        Some(arg) if typed_array && arg.slice().is_empty() => value.to_utf8(global),
        Some(JSArgument::StringOrBuffer(StringOrBuffer::Utf8(bytes))) => Ok(bytes),
        Some(arg) => Ok(Utf8Bytes::Owned(arg.slice().to_vec())),
        None => value.to_utf8(global),
    }
}

/// What follows a nullish option is not sent. That is fine for the `ttl` of `ttl ? "EX" : undefined, ttl`.
#[cold]
fn refuse_to_drop_set_option(global: &JSGlobalObject, dropped: &[JSValue]) -> JsResult<()> {
    const OPTIONS: [&[u8]; 12] = [
        b"NX", b"XX", b"GET", b"KEEPTTL", b"EX", b"PX", b"EXAT", b"PXAT", b"IFEQ", b"IFNE",
        b"IFDEQ", b"IFDNE",
    ];
    for arg in dropped.iter().filter(|arg| arg.is_string_literal()) {
        let text = arg.to_utf8(global)?;
        if let Some(option) = OPTIONS.iter().find(|it| it.eq_ignore_ascii_case(&text)) {
            return Err(global.throw_invalid_arguments(format_args!(
                "set() cannot send {} after a null or undefined argument",
                bstr::BStr::new(option)
            )));
        }
    }
    Ok(())
}

/// What `value` asks for, if it is `{ buffer }`. `binary` is what `true` asks for.
#[inline(always)]
fn reply_option(global: &JSGlobalObject, value: JSValue, binary: Reply) -> JsResult<Option<Reply>> {
    if !value.is_object() {
        return Ok(None);
    }
    let buffer = buffer_option(global, value)?;
    Ok(buffer.map(|buffer| if buffer { binary } else { Reply::Value }))
}

/// For a parameter of its own.
#[inline(always)]
fn reply_option_or(global: &JSGlobalObject, options: JSValue, default: Reply) -> JsResult<Reply> {
    if options.is_undefined() {
        return Ok(default);
    }
    Ok(reply_option(global, options, Reply::Binary)?.unwrap_or(default))
}

/// Takes `{ buffer }` off the end.
#[inline(always)]
fn split_reply_option<'a>(
    global: &JSGlobalObject,
    values: &'a [JSValue],
    binary: Reply,
) -> JsResult<(&'a [JSValue], Reply)> {
    if let [rest @ .., last] = trim_nullish_end(values)
        && let Some(reply) = reply_option(global, *last, binary)?
    {
        return Ok((rest, reply));
    }
    Ok((values, Reply::Value))
}

#[inline(never)]
fn buffer_option(global: &JSGlobalObject, object: JSValue) -> JsResult<Option<bool>> {
    let ty = object.js_type();
    let is_sent = ty.is_array_buffer_like() || ty.is_string_like() || ty == JSType::DOMWrapper;
    if is_sent || ty.is_array() {
        return Ok(None);
    }
    let name = jsc::CommonString::Buffer;
    let buffer = match object.get_common_string(global, name)? {
        Some(buffer) => {
            crate::node::validators::validate_boolean(global, buffer, "options.buffer")?
        }
        None if object.has_own_property_value(global, name.to_js(global))? => false,
        None => return Ok(None),
    };
    // A filter or an expiry in there would not be sent.
    let mut keys = object.keys(global)?.array_iterator(global)?;
    while let Some(key) = keys.next()? {
        let key = key.to_bun_string(global)?;
        if !key.eq_ascii(b"buffer") {
            return Err(global.throw_invalid_arguments(format_args!(
                "Unknown option \"{key}\" beside \"buffer\""
            )));
        }
    }
    Ok(Some(buffer))
}

fn trim_nullish_end(mut values: &[JSValue]) -> &[JSValue] {
    while let [rest @ .., last] = values
        && last.is_undefined_or_null()
    {
        values = rest;
    }
    values
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
    /// For `{ buffer: true }`, if the method looks for it among its arguments.
    binary: Option<Reply>,
    args: Args,
}

enum Varargs {
    /// `null` and `undefined` throw.
    Strict,
    /// `null` and `undefined` are left out, after a required first argument of this name.
    KeyThenSkipNullish(&'static str),
    /// The same first argument. `null` and `undefined` are left out at the end and throw ahead of another argument.
    KeyThenTrimNullish(&'static str),
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
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<[&'static str; N]>,
        values: [JSValue; N],
        options: JSValue,
    ) -> JsResult<JSValue> {
        command.check_state(self)?;
        let reply = reply_option_or(global, options, command.reply)?;

        let mut args: SmallVec<[JSArgument; N]> = SmallVec::new();
        for (value, name) in values.into_iter().zip(command.args) {
            args.push(command.arg(global, value, name, "string or buffer")?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, reply))
    }

    #[inline(never)]
    fn send_varargs(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<Varargs>,
        values: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        command.check_state(self)?;
        let values = JsLocal::to_js_slice(values);
        let (mut values, reply) = match command.binary {
            Some(binary) => split_reply_option(global, values, binary)?,
            None => (values, command.reply),
        };

        if let Varargs::KeyThenSkipNullish(name) | Varargs::KeyThenTrimNullish(name) = command.args
            && values.first().is_none_or(|key| key.is_undefined_or_null())
        {
            return Err(global.throw_missing_arguments_value(&[name]));
        }
        if let Varargs::KeyThenTrimNullish(_) = command.args {
            values = trim_nullish_end(values);
        }

        let mut args: Vec<JSArgument> = Vec::with_capacity(values.len());
        for &value in values {
            if value.is_undefined_or_null()
                && matches!(command.args, Varargs::KeyThenSkipNullish(_))
            {
                continue;
            }
            args.push(command.arg(global, value, "additional arguments", "string or buffer")?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, reply))
    }

    #[inline(never)]
    fn send_key_then(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<AfterKey>,
        key: JsLocal<'_>,
        values: &[JSValue],
        reply: Reply,
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
        for &value in values {
            if value.is_undefined_or_null() {
                continue;
            }
            args.push(command.arg(global, value, name, expected)?);
        }
        Ok(self.send(this, global, command.wire.as_bytes(), &args, reply))
    }

    /// A missing count stays `undefined`, so these never get the "requires at least" error.
    #[inline(never)]
    fn send_key_count(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<AfterKey>,
        key: JsLocal<'_>,
        count: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        command.check_state(self)?;
        let rest = [count.to_js(), options.to_js()];
        let (rest, reply) = split_reply_option(global, &rest, Reply::Binary)?;
        let count = rest.first().copied().unwrap_or(JSValue::UNDEFINED);
        self.send_key_then(this, global, command, key, &[count], reply)
    }

    #[inline(never)]
    fn send_hincrby(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        global: &JSGlobalObject,
        command: &Command<()>,
        key: JsLocal<'_>,
        field: JsLocal<'_>,
        increment: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        command.check_state(self)?;

        let (method, increment) = (command.method, increment.to_js());
        let arg = |value: JsLocal<'_>, field| {
            required_bytes_or_text(global, value.to_js(), method, field, "string or buffer")
        };
        let (key, field) = (arg(key, "key")?, arg(field, "field")?);
        if increment.is_undefined_or_null() {
            return Err(global.throw_invalid_argument_type(
                method,
                "increment",
                "number or string",
            ));
        }
        let args = [key, field, increment.to_utf8(global)?];
        Ok(self.send(this, global, command.wire.as_bytes(), &args, command.reply))
    }
}

macro_rules! replies {
    () => {
        (Reply::Value, None::<Reply>)
    };
    (ByOption) => {
        (Reply::Value, Some(Reply::Binary))
    };
    (PageByOption) => {
        (Reply::Value, Some(Reply::Page))
    };
    ($reply:ident) => {
        (Reply::$reply, None::<Reply>)
    };
}

macro_rules! method {
    (
        $fn_name:ident($($param:ident: $ty:ty),*) => $body:ident($($value:expr),*),
        $name:literal, $command:literal, $state:ident, [$($reply:ident)?], $args:expr
    ) => {
        pub(crate) fn $fn_name(
            self: &RefPtr<Self>,
            this: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            $($param: $ty,)*
        ) -> JsResult<JSValue> {
            let command = const {
                &Command {
                    method: $name,
                    wire: $command,
                    state: ClientStateRequirement::$state,
                    reply: replies!($($reply)?).0,
                    binary: replies!($($reply)?).1,
                    args: $args,
                }
            };
            self.$body(this, cx.global(), command, $($value),*)
        }
    };
}

/// Each argument is `parameter: "name in the error message"`. `"WIRE" -> Bool` names a [`Reply`] other than `Value`.
/// With `-> ByOption`, the method takes `{ buffer }`.
macro_rules! cmd {
    (
        $fn_name:ident, $name:literal, $command:literal -> ByOption, $state:ident
        $(, $arg:ident: $arg_name:literal)*
    ) => {
        method!(
            $fn_name($($arg: JsLocal<'_>,)* options: JsLocal<'_>)
                => send_fixed([$($arg.to_js()),*], options.to_js()),
            $name, $command, $state, [], [$($arg_name),*]
        );
    };
    ($fn_name:ident, $name:literal, $command:literal, $($rest:tt)*) => {
        cmd!($fn_name, $name, $command -> Value, $($rest)*);
    };
    (
        $fn_name:ident, $name:literal, $command:literal -> $reply:ident, $state:ident
        $(, $arg:ident: $arg_name:literal)*
    ) => {
        method!(
            $fn_name($($arg: JsLocal<'_>),*) => send_fixed([$($arg.to_js()),*], JSValue::UNDEFINED),
            $name, $command, $state, [$reply], [$($arg_name),*]
        );
    };
}

macro_rules! cmd_key_varargs {
    (
        $fn_name:ident, $name:literal, $command:literal $(-> $reply:ident)?, $arg0_name:literal,
        $state:ident
    ) => {
        method!(
            $fn_name(args: &[JsLocal<'_>]) => send_varargs(args),
            $name, $command, $state, [$($reply)?], Varargs::KeyThenSkipNullish($arg0_name)
        );
    };
}

/// For replies that have one element per argument.
macro_rules! cmd_key_positional {
    ($fn_name:ident, $name:literal, $command:literal $(-> $reply:ident)?, $state:ident) => {
        method!(
            $fn_name(args: &[JsLocal<'_>]) => send_varargs(args),
            $name, $command, $state, [$($reply)?], Varargs::KeyThenTrimNullish("key")
        );
    };
}

macro_rules! cmd_strings_varargs {
    ($fn_name:ident, $name:literal, $command:literal $(-> $reply:ident)?, $state:ident) => {
        method!(
            $fn_name(args: &[JsLocal<'_>]) => send_varargs(args),
            $name, $command, $state, [$($reply)?], Varargs::Strict
        );
    };
}

macro_rules! cmd_key_members {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, members: &[JsLocal<'_>])
                => send_key_then(key, JsLocal::to_js_slice(members), Reply::Value),
            $name, $command, $state, [],
            AfterKey { name: "member", expected: "string or buffer" }
        );
    };
}

macro_rules! cmd_key_count {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, count: JsLocal<'_>, options: JsLocal<'_>)
                => send_key_count(key, count, options),
            $name, $command, $state, [],
            AfterKey { name: "count", expected: "number or string" }
        );
    };
}

macro_rules! cmd_hincrby {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        method!(
            $fn_name(key: JsLocal<'_>, field: JsLocal<'_>, increment: JsLocal<'_>)
                => send_hincrby(key, field, increment),
            $name, $command, $state, [], ()
        );
    };
}

// ──────────────────────────────────────────────────────────────────────────
// JSValkeyClient prototype methods
// ──────────────────────────────────────────────────────────────────────────

impl JSValkeyClient {
    pub(crate) fn js_send(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        command: JsLocal<'_>,
        args: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let reply = reply_option_or(global, options.to_js(), Reply::Value)?;
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

        Ok(self.send(this, global, command.to_utf8().slice(), &args, reply))
    }

    cmd!(get, "get", "GET" -> ByOption, NotSubscriber, key: "key");
    cmd!(get_buffer, "getBuffer", "GET" -> Buffer, NotSubscriber, key: "key");

    pub(crate) fn set(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        value: JsLocal<'_>,
        options: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "set")?;
        let options = JsLocal::to_js_slice(options);
        let (options, reply) = split_reply_option(global, options, Reply::Binary)?;

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

        let mut options = options.iter();
        while let Some(arg) = options.next() {
            if arg.is_undefined_or_null() {
                refuse_to_drop_set_option(global, options.as_slice())?;
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

        Ok(self.send(this, global, b"SET", &args, reply))
    }

    cmd!(incr, "incr", "INCR", NotSubscriber, key: "key");
    cmd!(decr, "decr", "DECR", NotSubscriber, key: "key");

    /// `EXISTS` counts its keys and `exists()` answers for one key, so a second key would be dropped.
    #[cold]
    #[inline(never)]
    fn exists_reject_second_key(global: &JSGlobalObject, rest: &[JSValue]) -> JsResult<()> {
        let is_key = |value: &JSValue| {
            value.is_string() || value.as_array_buffer(global).is_some() || value.is::<Blob>()
        };
        // `keys.map(client.exists, client)` passes an index and then the array, so neither is a second key.
        if rest.first().is_some_and(|value| value.is_array()) || rest.iter().any(is_key) {
            return Err(global.throw_invalid_arguments(format_args!(
                "exists takes one key. Use send(\"EXISTS\", keys) to count several keys"
            )));
        }
        Ok(())
    }

    pub(crate) fn exists(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        rest: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "exists")?;

        let Some(key) = from_js(global, key.to_js())? else {
            return Err(global.throw_invalid_argument_type("exists", "key", "string or buffer"));
        };
        if !rest.is_empty() {
            Self::exists_reject_second_key(global, JsLocal::to_js_slice(rest))?;
        }
        Ok(self.send(this, global, b"EXISTS", &[key], Reply::Bool))
    }

    pub(crate) fn expire(
        self: &RefPtr<Self>,
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
    cmd!(smembers, "smembers", "SMEMBERS" -> ByOption, NotSubscriber, key: "key");
    cmd_key_count!(spop, "spop", "SPOP", NotSubscriber);
    cmd_key_members!(sadd, "sadd", "SADD", NotSubscriber);
    cmd!(sismember, "sismember", "SISMEMBER" -> Bool, NotSubscriber, key: "key", member: "value");

    // Implement hmget (get multiple values from hash)
    pub(crate) fn hmget(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "hmget")?;
        let (fields, reply) = match JsLocal::to_js_slice(fields) {
            fields @ [array, options, ..] if array.is_array() => {
                (fields, reply_option_or(global, *options, Reply::Value)?)
            }
            fields => split_reply_option(global, fields, Reply::Binary)?,
        };

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
            for arg in trim_nullish_end(fields) {
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

        Ok(self.send(this, global, b"HMGET", &args, reply))
    }

    cmd_hincrby!(hincrby, "hincrby", "HINCRBY", NotSubscriber);
    cmd_hincrby!(hincrbyfloat, "hincrbyfloat", "HINCRBYFLOAT", NotSubscriber);

    fn hset_impl(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
        method: &'static str,
        command: &'static str,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, method)?;

        let required =
            |value, name| required_bytes_or_text(global, value, method, name, "string or buffer");
        let key = required(key.to_js(), "key")?;

        let fields = JsLocal::to_js_slice(fields);
        let second_arg = fields.first().copied().unwrap_or(JSValue::UNDEFINED);

        let object_iter;
        let mut args: Vec<Utf8Bytes<'_>> = Vec::new();

        if second_arg.is_object()
            && !second_arg.is_array()
            && !second_arg.js_type().is_array_buffer_like()
            && !second_arg.is::<Blob>()
        {
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
            args.push(key);

            while let Some((field_name, value)) = object_iter.next()? {
                args.push(field_name.to_utf8());

                args.push(bytes_or_text(global, value)?);
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
            args.push(key);

            while let Some(field_js) = iter.next()? {
                args.push(required(field_js, "field")?);

                let Some(value_js) = iter.next()? else {
                    return Err(global.throw(format_args!(
                        "Array must have an even number of elements (field-value pairs)"
                    )));
                };
                args.push(bytes_or_text(global, value_js)?);
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
            args.push(key);

            for &[field, value] in fields.as_chunks().0 {
                args.push(required(field, "field")?);
                args.push(bytes_or_text(global, value)?);
            }
        }

        if args.len() == 1 {
            return Err(global.throw(format_args!("HSET requires at least one field-value pair")));
        }

        Ok(self.send(this, global, command.as_bytes(), &args, Reply::Value))
    }

    pub(crate) fn hset(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        self.hset_impl(this, cx, key, fields, "hset", "HSET")
    }

    pub(crate) fn hmset(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key: JsLocal<'_>,
        fields: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        self.hset_impl(this, cx, key, fields, "hmset", "HMSET")
    }

    cmd_key_varargs!(hdel, "hdel", "HDEL", "key", NotSubscriber);
    cmd_key_varargs!(hrandfield, "hrandfield", "HRANDFIELD" -> ByOption, "key", NotSubscriber);
    cmd_key_varargs!(hscan, "hscan", "HSCAN" -> PageByOption, "key", NotSubscriber);
    cmd_strings_varargs!(hgetdel, "hgetdel", "HGETDEL" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(hgetex, "hgetex", "HGETEX" -> ByOption, NotSubscriber);
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
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        message: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let reply = reply_option_or(global, options.to_js(), Reply::Value)?;
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
        Ok(self.send(this, global, b"PING", args_slice, reply))
    }

    cmd!(bitcount, "bitcount", "BITCOUNT", NotSubscriber, key: "key");
    cmd_strings_varargs!(blmove, "blmove", "BLMOVE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(blmpop, "blmpop", "BLMPOP" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(blpop, "blpop", "BLPOP" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(brpop, "brpop", "BRPOP" -> ByOption, NotSubscriber);
    cmd!(
        brpoplpush, "brpoplpush", "BRPOPLPUSH" -> ByOption, NotSubscriber,
        source: "source", destination: "destination", timeout: "timeout"
    );
    cmd!(getbit, "getbit", "GETBIT", NotSubscriber, key: "key", offset: "offset");
    cmd!(setbit, "setbit", "SETBIT", NotSubscriber, key: "key", offset: "offset", value: "value");
    cmd!(getrange, "getrange", "GETRANGE" -> ByOption, NotSubscriber, key: "key", start: "start", end: "end");
    cmd!(
        setrange, "setrange", "SETRANGE", NotSubscriber,
        key: "key", offset: "offset", value: "value"
    );
    cmd!(dump, "dump", "DUMP" -> Binary, NotSubscriber, key: "key");
    cmd!(expireat, "expireat", "EXPIREAT", NotSubscriber, key: "key", timestamp: "timestamp");
    cmd!(expiretime, "expiretime", "EXPIRETIME", NotSubscriber, key: "key");
    cmd!(getdel, "getdel", "GETDEL" -> ByOption, NotSubscriber, key: "key");
    cmd_strings_varargs!(getex, "getex", "GETEX" -> ByOption, NotSubscriber);
    cmd!(hgetall, "hgetall", "HGETALL" -> ByOption, NotSubscriber, key: "key");
    cmd!(hkeys, "hkeys", "HKEYS" -> ByOption, NotSubscriber, key: "key");
    cmd!(hlen, "hlen", "HLEN", NotSubscriber, key: "key");
    cmd!(hvals, "hvals", "HVALS" -> ByOption, NotSubscriber, key: "key");
    cmd!(keys, "keys", "KEYS" -> ByOption, NotSubscriber, pattern: "key");
    cmd!(lindex, "lindex", "LINDEX" -> ByOption, NotSubscriber, key: "key", index: "index");
    cmd_strings_varargs!(linsert, "linsert", "LINSERT", NotSubscriber);
    cmd!(llen, "llen", "LLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(lmove, "lmove", "LMOVE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(lmpop, "lmpop", "LMPOP" -> ByOption, NotSubscriber);
    cmd_key_varargs!(lpop, "lpop", "LPOP" -> ByOption, "key", NotSubscriber);
    cmd_strings_varargs!(lpos, "lpos", "LPOS", NotSubscriber);
    cmd!(lrange, "lrange", "LRANGE" -> ByOption, NotSubscriber, key: "key", start: "start", stop: "stop");
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
    cmd!(randomkey, "randomkey", "RANDOMKEY" -> ByOption, NotSubscriber);
    cmd_key_varargs!(rpop, "rpop", "RPOP" -> ByOption, "key", NotSubscriber);
    cmd!(
        rpoplpush, "rpoplpush", "RPOPLPUSH" -> ByOption, NotSubscriber,
        source: "source", destination: "destination"
    );
    cmd_strings_varargs!(scan, "scan", "SCAN" -> PageByOption, NotSubscriber);
    cmd!(scard, "scard", "SCARD", NotSubscriber, key: "key");
    cmd_strings_varargs!(sdiff, "sdiff", "SDIFF" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(sdiffstore, "sdiffstore", "SDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(sinter, "sinter", "SINTER" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(sintercard, "sintercard", "SINTERCARD", NotSubscriber);
    cmd_strings_varargs!(sinterstore, "sinterstore", "SINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(smismember, "smismember", "SMISMEMBER", NotSubscriber);
    cmd_strings_varargs!(sscan, "sscan", "SSCAN" -> PageByOption, NotSubscriber);
    cmd!(strlen, "strlen", "STRLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(sunion, "sunion", "SUNION" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(sunionstore, "sunionstore", "SUNIONSTORE", NotSubscriber);
    cmd!(r#type, "type", "TYPE", NotSubscriber, key: "key");
    cmd!(zcard, "zcard", "ZCARD", NotSubscriber, key: "key");
    cmd!(zcount, "zcount", "ZCOUNT", NotSubscriber, key: "key", min: "min", max: "max");
    cmd!(zlexcount, "zlexcount", "ZLEXCOUNT", NotSubscriber, key: "key", min: "min", max: "max");
    cmd_key_varargs!(zpopmax, "zpopmax", "ZPOPMAX" -> ByOption, "key", NotSubscriber);
    cmd_key_varargs!(zpopmin, "zpopmin", "ZPOPMIN" -> ByOption, "key", NotSubscriber);
    cmd_key_varargs!(zrandmember, "zrandmember", "ZRANDMEMBER" -> ByOption, "key", NotSubscriber);
    cmd_strings_varargs!(zrange, "zrange", "ZRANGE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(zrevrange, "zrevrange", "ZREVRANGE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(
        zrangebyscore, "zrangebyscore", "ZRANGEBYSCORE" -> ByOption, NotSubscriber
    );
    cmd_strings_varargs!(
        zrevrangebyscore, "zrevrangebyscore", "ZREVRANGEBYSCORE" -> ByOption, NotSubscriber
    );
    cmd_key_varargs!(zrangebylex, "zrangebylex", "ZRANGEBYLEX" -> ByOption, "key", NotSubscriber);
    cmd_key_varargs!(
        zrevrangebylex, "zrevrangebylex", "ZREVRANGEBYLEX" -> ByOption, "key", NotSubscriber
    );
    cmd!(append, "append", "APPEND", NotSubscriber, key: "key", value: "value");
    cmd!(getset, "getset", "GETSET" -> ByOption, NotSubscriber, key: "key", value: "value");
    cmd!(hget, "hget", "HGET" -> ByOption, NotSubscriber, key: "key", field: "field");
    cmd!(incrby, "incrby", "INCRBY", NotSubscriber, key: "key", increment: "increment");
    cmd!(
        incrbyfloat, "incrbyfloat", "INCRBYFLOAT", NotSubscriber,
        key: "key", increment: "increment"
    );
    cmd_key_varargs!(increx, "increx", "INCREX", "key", NotSubscriber);
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
    cmd_key_positional!(zmscore, "zmscore", "ZMSCORE", NotSubscriber);
    cmd_strings_varargs!(zadd, "zadd", "ZADD", NotSubscriber);
    cmd_strings_varargs!(zscan, "zscan", "ZSCAN" -> PageByOption, NotSubscriber);
    cmd_strings_varargs!(zdiff, "zdiff", "ZDIFF" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(zdiffstore, "zdiffstore", "ZDIFFSTORE", NotSubscriber);
    cmd_strings_varargs!(zinter, "zinter", "ZINTER" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(zintercard, "zintercard", "ZINTERCARD", NotSubscriber);
    cmd_strings_varargs!(zinterstore, "zinterstore", "ZINTERSTORE", NotSubscriber);
    cmd_strings_varargs!(zunion, "zunion", "ZUNION" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(zunionstore, "zunionstore", "ZUNIONSTORE", NotSubscriber);
    cmd_strings_varargs!(zmpop, "zmpop", "ZMPOP" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(bzmpop, "bzmpop", "BZMPOP" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(bzpopmin, "bzpopmin", "BZPOPMIN" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(bzpopmax, "bzpopmax", "BZPOPMAX" -> ByOption, NotSubscriber);
    cmd_key_varargs!(del, "del", "DEL", "key", NotSubscriber);
    cmd_key_positional!(mget, "mget", "MGET" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(mset, "mset", "MSET", NotSubscriber);
    cmd_strings_varargs!(msetnx, "msetnx", "MSETNX", NotSubscriber);
    cmd_strings_varargs!(script, "script", "SCRIPT" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(select, "select", "SELECT", NotSubscriber);
    cmd!(spublish, "spublish", "SPUBLISH", NotSubscriber, channel: "channel", message: "message");
    cmd!(
        smove, "smove", "SMOVE" -> Bool, NotSubscriber,
        source: "source", destination: "destination", member: "member"
    );
    cmd!(substr, "substr", "SUBSTR" -> ByOption, NotSubscriber, key: "key", start: "start", end: "end");
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
    cmd_strings_varargs!(pubsub, "pubsub", "PUBSUB" -> ByOption, DontCare);
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
    cmd_strings_varargs!(geosearch, "geosearch", "GEOSEARCH" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(
        geosearchstore,
        "geosearchstore",
        "GEOSEARCHSTORE",
        NotSubscriber
    );

    // Scripting commands
    cmd_strings_varargs!(eval, "eval", "EVAL" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(evalsha, "evalsha", "EVALSHA" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(fcall, "fcall", "FCALL" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(function, "function", "FUNCTION" -> ByOption, NotSubscriber);

    // Server / connection commands
    cmd!(dbsize, "dbsize", "DBSIZE", NotSubscriber);
    cmd_strings_varargs!(flushdb, "flushdb", "FLUSHDB", NotSubscriber);
    cmd_strings_varargs!(flushall, "flushall", "FLUSHALL", NotSubscriber);
    cmd_strings_varargs!(info, "info", "INFO", NotSubscriber);
    cmd!(time, "time", "TIME", NotSubscriber);
    cmd!(echo, "echo", "ECHO" -> ByOption, NotSubscriber, message: "message");
    cmd!(lastsave, "lastsave", "LASTSAVE", NotSubscriber);
    cmd_strings_varargs!(js_client, "client", "CLIENT" -> ByOption, DontCare);
    cmd_strings_varargs!(config, "config", "CONFIG" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(debug, "debug", "DEBUG", NotSubscriber);
    cmd_strings_varargs!(command, "command", "COMMAND" -> ByOption, NotSubscriber);

    // Generic key commands
    cmd_strings_varargs!(object, "object", "OBJECT", NotSubscriber);
    cmd_strings_varargs!(sort, "sort", "SORT" -> ByOption, NotSubscriber);
    cmd!(wait, "wait", "WAIT", NotSubscriber, numreplicas: "numreplicas", timeout: "timeout");
    cmd_strings_varargs!(lcs, "lcs", "LCS" -> ByOption, NotSubscriber);

    // Stream commands
    cmd_strings_varargs!(xadd, "xadd", "XADD", NotSubscriber);
    cmd!(xlen, "xlen", "XLEN", NotSubscriber, key: "key");
    cmd_strings_varargs!(xrange, "xrange", "XRANGE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xrevrange, "xrevrange", "XREVRANGE" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xread, "xread", "XREAD" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xreadgroup, "xreadgroup", "XREADGROUP" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xdel, "xdel", "XDEL", NotSubscriber);
    cmd_strings_varargs!(xtrim, "xtrim", "XTRIM", NotSubscriber);
    cmd_strings_varargs!(xack, "xack", "XACK", NotSubscriber);
    cmd_strings_varargs!(xclaim, "xclaim", "XCLAIM" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xautoclaim, "xautoclaim", "XAUTOCLAIM" -> PageByOption, NotSubscriber);
    cmd_strings_varargs!(xpending, "xpending", "XPENDING" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xinfo, "xinfo", "XINFO" -> ByOption, NotSubscriber);
    cmd_strings_varargs!(xgroup, "xgroup", "XGROUP", NotSubscriber);
    cmd_strings_varargs!(xsetid, "xsetid", "XSETID", NotSubscriber);

    pub(crate) fn publish(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        channel: JsLocal<'_>,
        message: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        require_not_subscriber(self, "publish")?;

        let channel = if channel.to_js().is_string()
            && let Some(channel) = from_js(global, channel.to_js())?
        {
            channel
        } else {
            return Err(global.throw_invalid_argument_type("publish", "channel", "string"));
        };
        let Some(message) = from_js(global, message.to_js())? else {
            return Err(global.throw_invalid_argument_type(
                "publish",
                "message",
                "string or buffer",
            ));
        };
        Ok(self.send(this, global, b"PUBLISH", &[channel, message], Reply::Value))
    }

    pub(crate) fn subscribe(
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        channel: JsLocal<'_>,
        listener: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
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
        self: &RefPtr<Self>,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
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

    pub(crate) fn duplicate(
        &self,
        this: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        // The duplicate is the calling script's, whoever made the original.
        let new_client = self.clone_without_connecting(&cx);
        let wrapper = js::wrap(new_client.clone(), global);
        if let Some(callback) = js::check_server_identity_get_cached(this.to_js()) {
            js::check_server_identity_set_cached(wrapper.to_js(), global, callback);
        }
        if self.get_connected() {
            new_client.connection_promise_returns_client.set(true);
            return Ok(new_client.do_connect(global, (&wrapper).into()));
        }
        Ok(JSPromise::resolved_promise_value(global, wrapper.to_js()))
    }
}
