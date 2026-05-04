use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSPropertyIterator, JSValue, JsRef,
    JsResult, ZigString,
};
use bun_jsc::node::BlobOrStringOrBuffer as JSArgument;
use bun_str::strings;

use super::js_valkey::{JSValkeyClient, SubscriptionCtx};
use bun_valkey::{self as valkey, protocol, Command, CommandArgs, CommandMeta};

type Slice = bun_jsc::ZigStringSlice;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

fn require_not_subscriber(this: &JSValkeyClient, function_name: &[u8]) -> JsResult<()> {
    const FMT_STRING: &str =
        "RedisClient.prototype.{} cannot be called while in subscriber mode.";

    if this.is_subscriber() {
        // TODO(port): ERR(.REDIS_INVALID_STATE, ...) macro equivalent
        return this
            .global_object
            .err_redis_invalid_state(format_args!(
                "RedisClient.prototype.{} cannot be called while in subscriber mode.",
                bstr::BStr::new(function_name)
            ))
            .throw();
    }
    let _ = FMT_STRING;
    Ok(())
}

fn require_subscriber(this: &JSValkeyClient, function_name: &[u8]) -> JsResult<()> {
    const FMT_STRING: &str =
        "RedisClient.prototype.{} can only be called while in subscriber mode.";

    if !this.is_subscriber() {
        // TODO(port): ERR(.REDIS_INVALID_STATE, ...) macro equivalent
        return this
            .global_object
            .err_redis_invalid_state(format_args!(
                "RedisClient.prototype.{} can only be called while in subscriber mode.",
                bstr::BStr::new(function_name)
            ))
            .throw();
    }
    let _ = FMT_STRING;
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

// ──────────────────────────────────────────────────────────────────────────
// compile: comptime command generators
// ──────────────────────────────────────────────────────────────────────────

pub(crate) mod compile {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
    pub enum ClientStateRequirement {
        /// The client must be a subscriber (in subscription mode).
        Subscriber,
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
            ClientStateRequirement::Subscriber => {
                require_subscriber(this, js_client_prototype_function_name)
            }
            ClientStateRequirement::NotSubscriber => {
                require_not_subscriber(this, js_client_prototype_function_name)
            }
            ClientStateRequirement::DontCare => Ok(()),
        }
    }
}

// PORT NOTE: The Zig `compile.@"(...)"(...)` comptime type-generators take
// `comptime []const u8` params (not expressible as Rust const generics on
// stable). Each generator is ported as a `macro_rules!` that emits a
// `#[bun_jsc::host_fn(method)]` inside the `impl JSValkeyClient` block.
// Names: @"()"→cmd_noargs!, @"(key: RedisKey)"→cmd_key!,
// @"(key: RedisKey, ...args: RedisKey[])"→cmd_key_varargs!,
// @"(key: RedisKey, value: RedisValue)"→cmd_key_value!,
// @"(key: RedisKey, value: RedisValue, value2: RedisValue)"→cmd_key_value_value2!,
// @"(...strings: string[])"→cmd_strings_varargs!,
// @"(key: RedisKey, value: RedisValue, ...args: RedisValue)"→cmd_key_value_varargs!

macro_rules! cmd_noargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&[]),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_key {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return global.throw_invalid_argument_type($name, $arg0_name, "string or buffer");
            };

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&[key]),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_key_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            if frame.argument(0).is_undefined_or_null() {
                return global.throw_missing_arguments_value(&[$arg0_name]);
            }

            let arguments = frame.arguments();
            let mut args: Vec<JSArgument> = Vec::with_capacity(arguments.len());

            for arg in arguments {
                if arg.is_undefined_or_null() {
                    continue;
                }

                let Some(another) = from_js(global, *arg)? else {
                    return global.throw_invalid_argument_type(
                        $name,
                        "additional arguments",
                        "string or buffer",
                    );
                };
                args.push(another);
            }

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&args),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_key_value {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return global.throw_invalid_argument_type($name, $arg0_name, "string or buffer");
            };
            let Some(value) = from_js(global, frame.argument(1))? else {
                return global.throw_invalid_argument_type($name, $arg1_name, "string or buffer");
            };

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&[key, value]),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_key_value_value2 {
    ($fn_name:ident, $name:literal, $command:literal, $arg0_name:literal, $arg1_name:literal, $arg2_name:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let Some(key) = from_js(global, frame.argument(0))? else {
                return global.throw_invalid_argument_type($name, $arg0_name, "string or buffer");
            };
            let Some(value) = from_js(global, frame.argument(1))? else {
                return global.throw_invalid_argument_type($name, $arg1_name, "string or buffer");
            };
            let Some(value2) = from_js(global, frame.argument(2))? else {
                return global.throw_invalid_argument_type($name, $arg2_name, "string or buffer");
            };

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&[key, value, value2]),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_strings_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let mut args: Vec<JSArgument> = Vec::with_capacity(frame.arguments().len());

            for arg in frame.arguments() {
                let Some(another) = from_js(global, *arg)? else {
                    return global.throw_invalid_argument_type(
                        $name,
                        "additional arguments",
                        "string or buffer",
                    );
                };
                args.push(another);
            }

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&args),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

macro_rules! cmd_key_value_varargs {
    ($fn_name:ident, $name:literal, $command:literal, $state:ident) => {
        #[bun_jsc::host_fn(method)]
        pub fn $fn_name(
            this: &mut Self,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            compile::test_correct_state::<{ compile::ClientStateRequirement::$state }>(this, $name)?;

            let mut args: Vec<JSArgument> = Vec::with_capacity(frame.arguments().len());

            for arg in frame.arguments() {
                if arg.is_undefined_or_null() {
                    continue;
                }

                let Some(another) = from_js(global, *arg)? else {
                    return global.throw_invalid_argument_type(
                        $name,
                        "additional arguments",
                        "string or buffer",
                    );
                };
                args.push(another);
            }

            let promise = match this.send(
                global,
                frame.this(),
                &Command {
                    command: $command,
                    args: CommandArgs::Args(&args),
                    meta: CommandMeta::default(),
                },
            ) {
                Ok(p) => p,
                Err(err) => {
                    return protocol::valkey_error_to_js(
                        global,
                        concat!("Failed to send ", $command),
                        err,
                    )
                }
            };
            Ok(promise.to_js())
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// JSValkeyClient prototype methods
// ──────────────────────────────────────────────────────────────────────────

impl JSValkeyClient {
    #[bun_jsc::host_fn(method)]
    pub fn js_send(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let command = frame.argument(0).to_bun_string(global)?;

        let args_array = frame.argument(1);
        if !args_array.is_object() || !args_array.is_array() {
            return global.throw(format_args!("Arguments must be an array"));
        }
        let mut iter = args_array.array_iterator(global)?;
        let mut args: Vec<JSArgument> = Vec::with_capacity(iter.len as usize);

        while let Some(arg_js) = iter.next()? {
            // PERF(port): was assume_capacity
            let Some(v) = from_js(global, arg_js)? else {
                return global.throw_invalid_argument_type(
                    "sendCommand",
                    "argument",
                    "string or buffer",
                );
            };
            args.push(v);
        }

        let cmd_str = command.to_utf8_without_ref();
        let mut cmd = Command {
            command: cmd_str.slice(),
            args: CommandArgs::Args(&args),
            meta: CommandMeta::default(),
        };
        // PORT NOTE: reshaped for borrowck (cmd.meta = cmd.meta.check(&cmd))
        let checked_meta = cmd.meta.check(&cmd);
        cmd.meta = checked_meta;
        // Send command with slices directly
        let promise = match this.send(global, frame.this(), &cmd) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send command", err);
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn get(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"get")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("get", "key", "string or buffer");
        };

        // Send GET command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"GET",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send GET command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_buffer(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"getBuffer")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("getBuffer", "key", "string or buffer");
        };

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"GET",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta {
                    return_as_buffer: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send GET command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn set(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"set")?;

        let args_view = frame.arguments();
        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("set", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        let Some(value) = from_js(global, frame.argument(1))? else {
            return global.throw_invalid_argument_type(
                "set",
                "value",
                "string or buffer or number",
            );
        };
        // PERF(port): was assume_capacity
        args.push(value);

        if args_view.len() > 2 {
            for arg in &args_view[2..] {
                if arg.is_undefined_or_null() {
                    break;
                }
                // PERF(port): was assume_capacity
                let Some(v) = from_js(global, *arg)? else {
                    return global.throw_invalid_argument_type(
                        "set",
                        "arguments",
                        "string or buffer",
                    );
                };
                args.push(v);
            }
        }

        // Send SET command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SET",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send SET command", err)
            }
        };

        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn incr(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"incr")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("incr", "key", "string or buffer");
        };

        // Send INCR command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"INCR",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send INCR command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn decr(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"decr")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("decr", "key", "string or buffer");
        };

        // Send DECR command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"DECR",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send DECR command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn exists(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"exists")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("exists", "key", "string or buffer");
        };

        // Send EXISTS command with special Exists type for boolean conversion
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"EXISTS",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta {
                    return_as_bool: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send EXISTS command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn expire(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"expire")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("expire", "key", "string or buffer");
        };

        let seconds = global.validate_integer_range::<i32>(
            frame.argument(1),
            0,
            jsc::IntegerRangeOptions {
                min: 0,
                max: 2147483647,
                field_name: "seconds",
            },
        )?;

        // Convert seconds to a string
        // TODO(port): std.fmt.printInt → stack-buffer integer formatting helper
        let mut int_buf = [0u8; 64];
        let seconds_len = bun_core::fmt::print_int(&mut int_buf, seconds);
        let seconds_slice = &int_buf[..seconds_len];

        // Send EXPIRE command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"EXPIRE",
                args: CommandArgs::Raw(&[key.slice(), seconds_slice]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send EXPIRE command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn ttl(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"ttl")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("ttl", "key", "string or buffer");
        };

        // Send TTL command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"TTL",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send TTL command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement srem (remove value from a set)
    #[bun_jsc::host_fn(method)]
    pub fn srem(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"srem")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return global.throw(format_args!("SREM requires at least a key and one member"));
        }

        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("srem", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        for arg in &args_view[1..] {
            if arg.is_undefined_or_null() {
                break;
            }
            let Some(value) = from_js(global, *arg)? else {
                return global.throw_invalid_argument_type("srem", "member", "string or buffer");
            };
            // PERF(port): was assume_capacity
            args.push(value);
        }

        // Send SREM command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SREM",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send SREM command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement srandmember (get random member from set)
    #[bun_jsc::host_fn(method)]
    pub fn srandmember(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"srandmember")?;

        let args_view = frame.arguments();
        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("srandmember", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return global.throw_invalid_argument_type(
                    "srandmember",
                    "count",
                    "number or string",
                );
            };
            // PERF(port): was assume_capacity
            args.push(count_arg);
        }

        // Send SRANDMEMBER command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SRANDMEMBER",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send SRANDMEMBER command",
                    err,
                )
            }
        };
        Ok(promise.to_js())
    }

    // Implement smembers (get all members of a set)
    #[bun_jsc::host_fn(method)]
    pub fn smembers(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"smembers")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("smembers", "key", "string or buffer");
        };

        // Send SMEMBERS command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SMEMBERS",
                args: CommandArgs::Args(&[key]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send SMEMBERS command",
                    err,
                )
            }
        };
        Ok(promise.to_js())
    }

    // Implement spop (pop a random member from a set)
    #[bun_jsc::host_fn(method)]
    pub fn spop(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"spop")?;

        let args_view = frame.arguments();
        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("spop", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        // Optional count argument
        if args_view.len() > 1 && !frame.argument(1).is_undefined_or_null() {
            let Some(count_arg) = from_js(global, frame.argument(1))? else {
                return global.throw_invalid_argument_type("spop", "count", "number or string");
            };
            // PERF(port): was assume_capacity
            args.push(count_arg);
        }

        // Send SPOP command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SPOP",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send SPOP command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement sadd (add member to a set)
    #[bun_jsc::host_fn(method)]
    pub fn sadd(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        require_not_subscriber(this, b"sadd")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return global.throw(format_args!("SADD requires at least a key and one member"));
        }

        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("sadd", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        for arg in &args_view[1..] {
            if arg.is_undefined_or_null() {
                break;
            }
            let Some(value) = from_js(global, *arg)? else {
                return global.throw_invalid_argument_type("sadd", "member", "string or buffer");
            };
            // PERF(port): was assume_capacity
            args.push(value);
        }

        // Send SADD command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SADD",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send SADD command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement sismember (check if value is member of a set)
    #[bun_jsc::host_fn(method)]
    pub fn sismember(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"sismember")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("sismember", "key", "string or buffer");
        };
        let Some(value) = from_js(global, frame.argument(1))? else {
            return global.throw_invalid_argument_type("sismember", "value", "string or buffer");
        };

        // Send SISMEMBER command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SISMEMBER",
                args: CommandArgs::Args(&[key, value]),
                meta: CommandMeta {
                    return_as_bool: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send SISMEMBER command",
                    err,
                )
            }
        };
        Ok(promise.to_js())
    }

    // Implement hmget (get multiple values from hash)
    #[bun_jsc::host_fn(method)]
    pub fn hmget(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"hmget")?;

        let args_view = frame.arguments();
        if args_view.len() < 2 {
            return global.throw(format_args!("HMGET requires at least a key and one field"));
        }

        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("hmget", "key", "string or buffer");
        };
        // PERF(port): was assume_capacity
        args.push(key);

        let second_arg = frame.argument(1);
        if second_arg.is_array() {
            let array_len = second_arg.get_length(global)?;
            if array_len == 0 {
                return global.throw(format_args!("HMGET requires at least one field"));
            }

            let mut array_iter = second_arg.array_iterator(global)?;
            while let Some(element) = array_iter.next()? {
                let Some(field) = from_js(global, element)? else {
                    return global.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    );
                };
                args.push(field);
            }
        } else {
            for arg in &args_view[1..] {
                if arg.is_undefined_or_null() {
                    break;
                }
                let Some(field) = from_js(global, *arg)? else {
                    return global.throw_invalid_argument_type(
                        "hmget",
                        "field",
                        "string or buffer",
                    );
                };
                args.push(field);
            }
        }

        // Send HMGET command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"HMGET",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send HMGET command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement hincrby (increment hash field by integer value)
    #[bun_jsc::host_fn(method)]
    pub fn hincrby(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"hincrby")?;

        let key = frame.argument(0).to_bun_string(global)?;
        let field = frame.argument(1).to_bun_string(global)?;
        let value = frame.argument(2).to_bun_string(global)?;

        let key_slice = key.to_utf8_without_ref();
        let field_slice = field.to_utf8_without_ref();
        let value_slice = value.to_utf8_without_ref();

        // Send HINCRBY command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"HINCRBY",
                args: CommandArgs::Slices(&[key_slice, field_slice, value_slice]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send HINCRBY command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement hincrbyfloat (increment hash field by float value)
    #[bun_jsc::host_fn(method)]
    pub fn hincrbyfloat(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"hincrbyfloat")?;

        let key = frame.argument(0).to_bun_string(global)?;
        let field = frame.argument(1).to_bun_string(global)?;
        let value = frame.argument(2).to_bun_string(global)?;

        let key_slice = key.to_utf8_without_ref();
        let field_slice = field.to_utf8_without_ref();
        let value_slice = value.to_utf8_without_ref();

        // Send HINCRBYFLOAT command
        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"HINCRBYFLOAT",
                args: CommandArgs::Slices(&[key_slice, field_slice, value_slice]),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send HINCRBYFLOAT command",
                    err,
                )
            }
        };
        Ok(promise.to_js())
    }

    // PERF(port): `command` was a comptime []const u8 — demoted to runtime &'static [u8]
    fn hset_impl(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        command: &'static [u8],
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, command)?;

        let key = frame.argument(0).to_bun_string(global)?;

        let second_arg = frame.argument(1);

        let mut args: Vec<Slice> = Vec::new();

        args.push(key.to_utf8());

        if second_arg.is_object() && !second_arg.is_array() {
            // Pattern 1: Object/Record - hset(key, {field: value, ...})
            let Some(obj) = second_arg.get_object() else {
                return global.throw_invalid_argument_type(
                    // TODO(port): command is bytes; throw_invalid_argument_type expects &str
                    core::str::from_utf8(command).unwrap_or("hset"),
                    "fields",
                    "object",
                );
            };

            // TODO(port): JSPropertyIterator comptime config struct → options arg
            let mut object_iter = JSPropertyIterator::init(
                global,
                obj,
                jsc::PropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                },
            )?;

            args.reserve((1 + object_iter.len * 2).saturating_sub(args.len()));

            while let Some(field_name) = object_iter.next()? {
                let field_slice = field_name.to_utf8();
                // PERF(port): was assume_capacity
                args.push(field_slice);

                let value_str = object_iter.value.to_bun_string(global)?;

                let value_slice = value_str.to_utf8();
                // PERF(port): was assume_capacity
                args.push(value_slice);
            }
        } else if second_arg.is_array() {
            // Pattern 3: Array - hmset(key, [field, value, ...])
            let mut iter = second_arg.array_iterator(global)?;
            if iter.len % 2 != 0 {
                return global.throw(format_args!(
                    "Array must have an even number of elements (field-value pairs)"
                ));
            }

            args.reserve((1 + iter.len as usize).saturating_sub(args.len()));

            while let Some(field_js) = iter.next()? {
                let field_str = field_js.to_bun_string(global)?;
                // PERF(port): was assume_capacity
                args.push(field_str.to_utf8());
                drop(field_str);

                let Some(value_js) = iter.next()? else {
                    return global.throw(format_args!(
                        "Array must have an even number of elements (field-value pairs)"
                    ));
                };
                let value_str = value_js.to_bun_string(global)?;
                // PERF(port): was assume_capacity
                args.push(value_str.to_utf8());
                drop(value_str);
            }
        } else {
            // Pattern 2: Variadic - hset(key, field, value, ...)
            let args_count = frame.arguments_count();
            if args_count < 3 {
                return global.throw(format_args!(
                    "HSET requires at least key, field, and value arguments"
                ));
            }

            let field_value_count = args_count - 1; // Exclude key
            if field_value_count % 2 != 0 {
                return global.throw(format_args!(
                    "HSET requires field-value pairs (even number of arguments after key)"
                ));
            }

            args.reserve((args_count as usize).saturating_sub(args.len()));

            let mut i: u32 = 1;
            while i < args_count {
                let arg_str = frame.argument(i).to_bun_string(global)?;
                // PERF(port): was assume_capacity
                args.push(arg_str.to_utf8());
                drop(arg_str);
                i += 1;
            }
        }

        if args.len() == 1 {
            return global.throw(format_args!("HSET requires at least one field-value pair"));
        }

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command,
                args: CommandArgs::Slices(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                let msg = if command == b"HSET" {
                    "Failed to send HSET command"
                } else {
                    "Failed to send HMSET command"
                };
                return protocol::valkey_error_to_js(global, msg, err);
            }
        };

        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn hset(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::hset_impl(this, global, frame, b"HSET")
    }

    #[bun_jsc::host_fn(method)]
    pub fn hmset(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::hset_impl(this, global, frame, b"HMSET")
    }

    cmd_key_varargs!(hdel, b"hdel", "HDEL", "key", NotSubscriber);
    cmd_key_varargs!(hrandfield, b"hrandfield", "HRANDFIELD", "key", NotSubscriber);
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

    #[bun_jsc::host_fn(method)]
    pub fn hsetnx(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"hsetnx")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("hsetnx", "key", "string or buffer");
        };
        let Some(field) = from_js(global, frame.argument(1))? else {
            return global.throw_invalid_argument_type("hsetnx", "field", "string or buffer");
        };
        let Some(value) = from_js(global, frame.argument(2))? else {
            return global.throw_invalid_argument_type("hsetnx", "value", "string or buffer");
        };

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"HSETNX",
                args: CommandArgs::Args(&[key, field, value]),
                meta: CommandMeta {
                    return_as_bool: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send HSETNX command", err)
            }
        };
        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn hexists(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"hexists")?;

        let Some(key) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("hexists", "key", "string or buffer");
        };

        let Some(field) = from_js(global, frame.argument(1))? else {
            return global.throw_invalid_argument_type("hexists", "field", "string or buffer");
        };

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"HEXISTS",
                args: CommandArgs::Args(&[key, field]),
                meta: CommandMeta {
                    return_as_bool: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send HEXISTS command", err)
            }
        };
        Ok(promise.to_js())
    }

    // Implement ping (send a PING command with an optional message)
    #[bun_jsc::host_fn(method)]
    pub fn ping(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // PORT NOTE: reshaped from Zig stack-array + slice pattern to Option<JSArgument>
        let message: Option<JSArgument> = if !frame.argument(0).is_undefined_or_null() {
            // Only use the first argument if provided, ignore any additional arguments
            let Some(m) = from_js(global, frame.argument(0))? else {
                return global.throw_invalid_argument_type("ping", "message", "string or buffer");
            };
            Some(m)
        } else {
            None
        };
        let args_slice: &[JSArgument] = match &message {
            Some(m) => core::slice::from_ref(m),
            None => &[],
        };

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"PING",
                args: CommandArgs::Args(args_slice),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send PING command", err)
            }
        };
        Ok(promise.to_js())
    }

    cmd_key!(bitcount, b"bitcount", "BITCOUNT", "key", NotSubscriber);
    cmd_strings_varargs!(blmove, b"blmove", "BLMOVE", NotSubscriber);
    cmd_strings_varargs!(blmpop, b"blmpop", "BLMPOP", NotSubscriber);
    cmd_strings_varargs!(blpop, b"blpop", "BLPOP", NotSubscriber);
    cmd_strings_varargs!(brpop, b"brpop", "BRPOP", NotSubscriber);
    cmd_key_value_value2!(brpoplpush, b"brpoplpush", "BRPOPLPUSH", "source", "destination", "timeout", NotSubscriber);
    cmd_key_value!(getbit, b"getbit", "GETBIT", "key", "offset", NotSubscriber);
    cmd_key_value_value2!(setbit, b"setbit", "SETBIT", "key", "offset", "value", NotSubscriber);
    cmd_key_value_value2!(getrange, b"getrange", "GETRANGE", "key", "start", "end", NotSubscriber);
    cmd_key_value_value2!(setrange, b"setrange", "SETRANGE", "key", "offset", "value", NotSubscriber);
    cmd_key!(dump, b"dump", "DUMP", "key", NotSubscriber);
    cmd_key_value!(expireat, b"expireat", "EXPIREAT", "key", "timestamp", NotSubscriber);
    cmd_key!(expiretime, b"expiretime", "EXPIRETIME", "key", NotSubscriber);
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
    cmd_key_value_value2!(lrange, b"lrange", "LRANGE", "key", "start", "stop", NotSubscriber);
    cmd_key_value_value2!(lrem, b"lrem", "LREM", "key", "count", "element", NotSubscriber);
    cmd_key_value_value2!(lset, b"lset", "LSET", "key", "index", "element", NotSubscriber);
    cmd_key_value_value2!(ltrim, b"ltrim", "LTRIM", "key", "start", "stop", NotSubscriber);
    cmd_key!(persist, b"persist", "PERSIST", "key", NotSubscriber);
    cmd_key_value!(pexpire, b"pexpire", "PEXPIRE", "key", "milliseconds", NotSubscriber);
    cmd_key_value!(pexpireat, b"pexpireat", "PEXPIREAT", "key", "milliseconds-timestamp", NotSubscriber);
    cmd_key!(pexpiretime, b"pexpiretime", "PEXPIRETIME", "key", NotSubscriber);
    cmd_key!(pttl, b"pttl", "PTTL", "key", NotSubscriber);
    cmd_noargs!(randomkey, b"randomkey", "RANDOMKEY", NotSubscriber);
    cmd_key_varargs!(rpop, b"rpop", "RPOP", "key", NotSubscriber);
    cmd_key_value!(rpoplpush, b"rpoplpush", "RPOPLPUSH", "source", "destination", NotSubscriber);
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
    cmd_key_value_value2!(zcount, b"zcount", "ZCOUNT", "key", "min", "max", NotSubscriber);
    cmd_key_value_value2!(zlexcount, b"zlexcount", "ZLEXCOUNT", "key", "min", "max", NotSubscriber);
    cmd_key_varargs!(zpopmax, b"zpopmax", "ZPOPMAX", "key", NotSubscriber);
    cmd_key_varargs!(zpopmin, b"zpopmin", "ZPOPMIN", "key", NotSubscriber);
    cmd_key_varargs!(zrandmember, b"zrandmember", "ZRANDMEMBER", "key", NotSubscriber);
    cmd_strings_varargs!(zrange, b"zrange", "ZRANGE", NotSubscriber);
    cmd_strings_varargs!(zrevrange, b"zrevrange", "ZREVRANGE", NotSubscriber);
    cmd_strings_varargs!(zrangebyscore, b"zrangebyscore", "ZRANGEBYSCORE", NotSubscriber);
    cmd_strings_varargs!(zrevrangebyscore, b"zrevrangebyscore", "ZREVRANGEBYSCORE", NotSubscriber);
    cmd_key_varargs!(zrangebylex, b"zrangebylex", "ZRANGEBYLEX", "key", NotSubscriber);
    cmd_key_varargs!(zrevrangebylex, b"zrevrangebylex", "ZREVRANGEBYLEX", "key", NotSubscriber);
    cmd_key_value!(append, b"append", "APPEND", "key", "value", NotSubscriber);
    cmd_key_value!(getset, b"getset", "GETSET", "key", "value", NotSubscriber);
    cmd_key_value!(hget, b"hget", "HGET", "key", "field", NotSubscriber);
    cmd_key_value!(incrby, b"incrby", "INCRBY", "key", "increment", NotSubscriber);
    cmd_key_value!(incrbyfloat, b"incrbyfloat", "INCRBYFLOAT", "key", "increment", NotSubscriber);
    cmd_key_value!(decrby, b"decrby", "DECRBY", "key", "decrement", NotSubscriber);
    cmd_key_value_varargs!(lpush, b"lpush", "LPUSH", NotSubscriber);
    cmd_key_value_varargs!(lpushx, b"lpushx", "LPUSHX", NotSubscriber);
    cmd_key_value!(pfadd, b"pfadd", "PFADD", "key", "value", NotSubscriber);
    cmd_key_value_varargs!(rpush, b"rpush", "RPUSH", NotSubscriber);
    cmd_key_value_varargs!(rpushx, b"rpushx", "RPUSHX", NotSubscriber);
    cmd_key_value!(setnx, b"setnx", "SETNX", "key", "value", NotSubscriber);
    cmd_key_value_value2!(setex, b"setex", "SETEX", "key", "seconds", "value", NotSubscriber);
    cmd_key_value_value2!(psetex, b"psetex", "PSETEX", "key", "milliseconds", "value", NotSubscriber);
    cmd_key_value!(zscore, b"zscore", "ZSCORE", "key", "value", NotSubscriber);
    cmd_key_value_value2!(zincrby, b"zincrby", "ZINCRBY", "key", "increment", "member", NotSubscriber);
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
    cmd_key_value!(spublish, b"spublish", "SPUBLISH", "channel", "message", NotSubscriber);

    #[bun_jsc::host_fn(method)]
    pub fn smove(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"smove")?;

        let Some(source) = from_js(global, frame.argument(0))? else {
            return global.throw_invalid_argument_type("smove", "source", "string or buffer");
        };
        let Some(destination) = from_js(global, frame.argument(1))? else {
            return global.throw_invalid_argument_type("smove", "destination", "string or buffer");
        };
        let Some(member) = from_js(global, frame.argument(2))? else {
            return global.throw_invalid_argument_type("smove", "member", "string or buffer");
        };

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"SMOVE",
                args: CommandArgs::Args(&[source, destination, member]),
                meta: CommandMeta {
                    return_as_bool: true,
                    ..Default::default()
                },
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send SMOVE command", err)
            }
        };
        Ok(promise.to_js())
    }

    cmd_key_value_value2!(substr, b"substr", "SUBSTR", "key", "start", "end", NotSubscriber);
    cmd_key_value!(hstrlen, b"hstrlen", "HSTRLEN", "key", "field", NotSubscriber);
    cmd_key_varargs!(zrank, b"zrank", "ZRANK", "key", NotSubscriber);
    cmd_strings_varargs!(zrangestore, b"zrangestore", "ZRANGESTORE", NotSubscriber);
    cmd_key_varargs!(zrem, b"zrem", "ZREM", "key", NotSubscriber);
    cmd_key_value_value2!(zremrangebylex, b"zremrangebylex", "ZREMRANGEBYLEX", "key", "min", "max", NotSubscriber);
    cmd_key_value_value2!(zremrangebyrank, b"zremrangebyrank", "ZREMRANGEBYRANK", "key", "start", "stop", NotSubscriber);
    cmd_key_value_value2!(zremrangebyscore, b"zremrangebyscore", "ZREMRANGEBYSCORE", "key", "min", "max", NotSubscriber);
    cmd_key_varargs!(zrevrank, b"zrevrank", "ZREVRANK", "key", NotSubscriber);
    cmd_strings_varargs!(psubscribe, b"psubscribe", "PSUBSCRIBE", DontCare);
    cmd_strings_varargs!(punsubscribe, b"punsubscribe", "PUNSUBSCRIBE", DontCare);
    cmd_strings_varargs!(pubsub, b"pubsub", "PUBSUB", DontCare);
    cmd_strings_varargs!(copy, b"copy", "COPY", NotSubscriber);
    cmd_key_varargs!(unlink, b"unlink", "UNLINK", "key", NotSubscriber);
    cmd_key_varargs!(touch, b"touch", "TOUCH", "key", NotSubscriber);
    cmd_key_value!(rename, b"rename", "RENAME", "key", "newkey", NotSubscriber);
    cmd_key_value!(renamenx, b"renamenx", "RENAMENX", "key", "newkey", NotSubscriber);

    #[bun_jsc::host_fn(method)]
    pub fn publish(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        require_not_subscriber(this, b"publish")?;

        let args_view = frame.arguments();
        // PERF(port): was stack-fallback
        let mut args: Vec<JSArgument> = Vec::with_capacity(args_view.len());

        let arg0 = frame.argument(0);
        if !arg0.is_string() {
            return global.throw_invalid_argument_type("publish", "channel", "string");
        }
        let channel = from_js(global, arg0)?.expect("unreachable");

        // PERF(port): was assume_capacity
        args.push(channel);

        let arg1 = frame.argument(1);
        if !arg1.is_string() {
            return global.throw_invalid_argument_type("publish", "message", "string");
        }
        let message = from_js(global, arg1)?.expect("unreachable");
        // PERF(port): was assume_capacity
        args.push(message);

        let promise = match this.send(
            global,
            frame.this(),
            &Command {
                command: b"PUBLISH",
                args: CommandArgs::Args(&args),
                meta: CommandMeta::default(),
            },
        ) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(global, "Failed to send PUBLISH command", err)
            }
        };

        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn subscribe(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [channel_or_many, handler_callback] = frame.arguments_as_array::<2>();
        // PERF(port): was stack-fallback
        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        if !handler_callback.is_callable() {
            return global.throw_invalid_argument_type("subscribe", "listener", "function");
        }

        // The first argument given is the channel or may be an array of channels.
        if channel_or_many.is_array() {
            if channel_or_many.get_length(global)? == 0 {
                return global
                    .throw_invalid_arguments(format_args!("subscribe requires at least one channel"));
            }
            redis_channels
                .reserve((channel_or_many.get_length(global)? as usize).saturating_sub(redis_channels.len()));

            let mut array_iter = channel_or_many.array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return global.throw_invalid_argument_type("subscribe", "channel", "string");
                };
                // PERF(port): was assume_capacity
                redis_channels.push(channel);

                // What we do here is add our receive handler. Notice that this doesn't really do anything until the
                // "SUBSCRIBE" command is sent to redis and we get a response.
                //
                // TODO(markovejnovic): This is less-than-ideal, still, because this assumes a happy path. What happens if
                //                      the SUBSCRIBE command fails? We have no way to roll back the addition of the
                //                      handler.
                this._subscription_ctx
                    .upsert_receive_handler(global, channel_arg, handler_callback)?;
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return global.throw_invalid_argument_type("subscribe", "channel", "string");
            };
            // PERF(port): was assume_capacity
            redis_channels.push(channel);

            this._subscription_ctx
                .upsert_receive_handler(global, channel_or_many, handler_callback)?;
        } else {
            return global.throw_invalid_argument_type("subscribe", "channel", "string or array");
        }

        let command = valkey::Command {
            command: b"SUBSCRIBE",
            args: CommandArgs::Args(&redis_channels),
            meta: CommandMeta {
                subscription_request: true,
                ..Default::default()
            },
        };
        let promise = match this.send(global, frame.this(), &command) {
            Ok(p) => p,
            Err(err) => {
                // If we catch an error, we need to clean up any handlers we may have added and fall out of subscription mode
                this._subscription_ctx.clear_all_receive_handlers(global)?;
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send SUBSCRIBE command",
                    err,
                );
            }
        };

        Ok(promise.to_js())
    }

    /// Send redis the UNSUBSCRIBE RESP command and clean up anything necessary after the unsubscribe commoand.
    ///
    /// The subscription context must exist when calling this function.
    fn send_unsubscribe_request_and_cleanup(
        this: &mut Self,
        this_js: JSValue,
        global: &JSGlobalObject,
        redis_channels: &[JSArgument],
    ) -> JsResult<JSValue> {
        // TODO(port): narrow error set
        // Send UNSUBSCRIBE command
        let command = valkey::Command {
            command: b"UNSUBSCRIBE",
            args: CommandArgs::Args(redis_channels),
            meta: CommandMeta::default(),
        };
        let promise = match this.send(global, this_js, &command) {
            Ok(p) => p,
            Err(err) => {
                return protocol::valkey_error_to_js(
                    global,
                    "Failed to send UNSUBSCRIBE command",
                    err,
                );
            }
        };

        Ok(promise.to_js())
    }

    #[bun_jsc::host_fn(method)]
    pub fn unsubscribe(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Check if we're in subscription mode
        require_subscriber(this, b"unsubscribe")?;

        let args_view = frame.arguments();

        // PERF(port): was stack-fallback
        let mut redis_channels: Vec<JSArgument> = Vec::with_capacity(1);

        // If no arguments, unsubscribe from all channels
        if args_view.is_empty() {
            this._subscription_ctx.clear_all_receive_handlers(global)?;
            return Self::send_unsubscribe_request_and_cleanup(
                this,
                frame.this(),
                global,
                &redis_channels,
            );
        }

        // The first argument can be a channel or an array of channels
        let channel_or_many = frame.argument(0);

        // Get the subscription context
        if !this._subscription_ctx.is_subscriber {
            return Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED));
        }

        // Two arguments means .unsubscribe(channel, listener) is invoked.
        if frame.arguments().len() == 2 {
            // In this case, the first argument is a channel string and the second
            // argument is the handler to remove.
            if !channel_or_many.is_string() {
                return global.throw_invalid_argument_type("unsubscribe", "channel", "string");
            }

            let channel = channel_or_many;
            let listener_cb = frame.argument(1);

            if !listener_cb.is_callable() {
                return global.throw_invalid_argument_type("unsubscribe", "listener", "function");
            }

            // Populate the redis_channels list with the single channel to
            // unsubscribe from. This s important since this list is used to send
            // the UNSUBSCRIBE command to redis. Without this, we would end up
            // unsubscribing from all channels.
            // PERF(port): was assume_capacity
            let Some(ch) = from_js(global, channel)? else {
                return global.throw_invalid_argument_type("unsubscribe", "channel", "string");
            };
            redis_channels.push(ch);

            let remaining_listeners = match this
                ._subscription_ctx
                .remove_receive_handler(global, channel, listener_cb)
            {
                Ok(Some(n)) => n,
                Ok(None) => {
                    // Listeners weren't present in the first place, so we can return a
                    // resolved promise.
                    return Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED));
                }
                Err(_) => {
                    // TODO(port): {f} format spec on ZigString
                    return global.throw(format_args!(
                        "Failed to remove handler for channel {}",
                        channel.as_string().get_zig_string(global)
                    ));
                }
            };

            // In this case, we only want to send the unsubscribe command to redis if there are no more listeners for this
            // channel.
            if remaining_listeners == 0 {
                return Self::send_unsubscribe_request_and_cleanup(
                    this,
                    frame.this(),
                    global,
                    &redis_channels,
                );
            }

            // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
            return Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED));
        }

        if channel_or_many.is_array() {
            if channel_or_many.get_length(global)? == 0 {
                return global.throw_invalid_arguments(format_args!(
                    "unsubscribe requires at least one channel"
                ));
            }

            redis_channels.reserve(
                (channel_or_many.get_length(global)? as usize).saturating_sub(redis_channels.len()),
            );
            // It is an array, so let's iterate over it
            let mut array_iter = channel_or_many.array_iterator(global)?;
            while let Some(channel_arg) = array_iter.next()? {
                let Some(channel) = from_js(global, channel_arg)? else {
                    return global.throw_invalid_argument_type("unsubscribe", "channel", "string");
                };
                // PERF(port): was assume_capacity
                redis_channels.push(channel);
                // Clear the handlers for this channel
                this._subscription_ctx
                    .clear_receive_handlers(global, channel_arg)?;
            }
        } else if channel_or_many.is_string() {
            // It is a single string channel
            let Some(channel) = from_js(global, channel_or_many)? else {
                return global.throw_invalid_argument_type("unsubscribe", "channel", "string");
            };
            // PERF(port): was assume_capacity
            redis_channels.push(channel);
            // Clear the handlers for this channel
            this._subscription_ctx
                .clear_receive_handlers(global, channel_or_many)?;
        } else {
            return global.throw_invalid_argument_type("unsubscribe", "channel", "string or array");
        }

        // Now send the unsubscribe command and clean up if necessary
        Self::send_unsubscribe_request_and_cleanup(this, frame.this(), global, &redis_channels)
    }

    #[bun_jsc::host_fn(method)]
    pub fn duplicate(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _ = frame;

        let new_client: &mut JSValkeyClient = this.clone_without_connecting(global)?;

        let new_client_js = new_client.to_js(global);
        new_client.this_value = JsRef::init_weak(new_client_js);
        new_client._subscription_ctx = SubscriptionCtx::init(new_client)?;
        // If the original client is already connected and not manually closed, start connecting the new client.
        if this.client.status == valkey::Status::Connected && !this.client.flags.is_manually_closed {
            // Use strong reference during connection to prevent premature GC
            new_client.client.flags.connection_promise_returns_client = true;
            return new_client.do_connect(global, new_client_js);
        }

        Ok(JSPromise::resolved_promise_value(global, new_client_js))
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/js_valkey_functions.zig (1599 lines)
//   confidence: medium
//   todos:      6
//   notes:      comptime type-generators (`compile.@"..."`) ported as macro_rules!; Command/CommandArgs/CommandMeta field shapes assumed from usage; ERR(.REDIS_INVALID_STATE) and JSPropertyIterator config need Phase B wiring; JSArgument moved into &[...] temporaries — verify Drop semantics match Zig deinit order
// ──────────────────────────────────────────────────────────────────────────
