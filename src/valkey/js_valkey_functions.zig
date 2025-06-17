pub fn jsSend(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const command = try callframe.argument(0).toBunString(globalObject);
    defer command.deref();

    const args_array = callframe.argument(1);
    if (!args_array.isObject() or !args_array.isArray()) {
        return globalObject.throw("Arguments must be an array", .{});
    }
    var iter = try args_array.arrayIterator(globalObject);
    var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, iter.len);
    defer {
        for (args.items) |*item| {
            item.deinit();
        }
        args.deinit();
    }

    while (try iter.next()) |arg_js| {
        args.appendAssumeCapacity(try fromJS(globalObject, arg_js) orelse {
            return globalObject.throwInvalidArgumentType("sendCommand", "argument", "string or buffer");
        });
    }

    const cmd_str = command.toUTF8WithoutRef(bun.default_allocator);
    defer cmd_str.deinit();
    var cmd: Command = .{
        .command = cmd_str.slice(),
        .args = .{ .args = args.items },
        .meta = .{},
    };
    cmd.meta = cmd.meta.check(&cmd);
    // Send command with slices directly
    const promise = this.send(
        globalObject,
        callframe.this(),
        &cmd,
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send command", err);
    };
    return promise.toJS();
}

pub fn get(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("get", "key", "string or buffer");
    };
    defer key.deinit();

    // Send GET command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "GET",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send GET command", err);
    };
    return promise.toJS();
}

pub fn getBuffer(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("getBuffer", "key", "string or buffer");
    };
    defer key.deinit();

    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "GET",
            .args = .{ .args = &.{key} },
            .meta = .{ .return_as_buffer = true },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send GET command", err);
    };
    return promise.toJS();
}

pub fn set(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const args_view = callframe.arguments();
    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
    var args = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), args_view.len);
    defer {
        for (args.items) |*item| {
            item.deinit();
        }
        args.deinit();
    }
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("set", "key", "string or buffer");
    };
    args.appendAssumeCapacity(key);

    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("set", "value", "string or buffer or number");
    };
    args.appendAssumeCapacity(value);

    if (args_view.len > 2) {
        for (args_view[2..]) |arg| {
            if (arg.isUndefinedOrNull()) {
                break;
            }
            args.appendAssumeCapacity(try fromJS(globalObject, arg) orelse {
                return globalObject.throwInvalidArgumentType("set", "arguments", "string or buffer");
            });
        }
    }

    // Send SET command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SET",
            .args = .{ .args = args.items },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SET command", err);
    };

    return promise.toJS();
}

pub fn incr(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("incr", "key", "string or buffer");
    };
    defer key.deinit();

    // Send INCR command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "INCR",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send INCR command", err);
    };
    return promise.toJS();
}

pub fn decr(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("decr", "key", "string or buffer");
    };
    defer key.deinit();

    // Send DECR command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "DECR",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send DECR command", err);
    };
    return promise.toJS();
}

pub fn exists(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("exists", "key", "string or buffer");
    };
    defer key.deinit();

    // Send EXISTS command with special Exists type for boolean conversion
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "EXISTS",
            .args = .{ .args = &.{key} },
            .meta = .{ .return_as_bool = true },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send EXISTS command", err);
    };
    return promise.toJS();
}

pub fn expire(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("expire", "key", "string or buffer");
    };
    defer key.deinit();

    const seconds = try globalObject.validateIntegerRange(callframe.argument(1), i32, 0, .{
        .min = 0,
        .max = 2147483647,
        .field_name = "seconds",
    });

    // Convert seconds to a string
    var int_buf: [64]u8 = undefined;
    const seconds_len = std.fmt.formatIntBuf(&int_buf, seconds, 10, .lower, .{});
    const seconds_slice = int_buf[0..seconds_len];

    // Send EXPIRE command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "EXPIRE",
            .args = .{ .raw = &.{ key.slice(), seconds_slice } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send EXPIRE command", err);
    };
    return promise.toJS();
}

pub fn ttl(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("ttl", "key", "string or buffer");
    };
    defer key.deinit();

    // Send TTL command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "TTL",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send TTL command", err);
    };
    return promise.toJS();
}

// Implement srem (remove value from a set)
pub fn srem(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("srem", "key", "string or buffer");
    };
    defer key.deinit();
    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("srem", "value", "string or buffer");
    };
    defer value.deinit();

    // Send SREM command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SREM",
            .args = .{ .args = &.{ key, value } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SREM command", err);
    };
    return promise.toJS();
}

// Implement srandmember (get random member from set)
pub fn srandmember(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("srandmember", "key", "string or buffer");
    };
    defer key.deinit();

    // Send SRANDMEMBER command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SRANDMEMBER",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SRANDMEMBER command", err);
    };
    return promise.toJS();
}

// Implement smembers (get all members of a set)
pub fn smembers(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("smembers", "key", "string or buffer");
    };
    defer key.deinit();

    // Send SMEMBERS command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SMEMBERS",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SMEMBERS command", err);
    };
    return promise.toJS();
}

// Implement spop (pop a random member from a set)
pub fn spop(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("spop", "key", "string or buffer");
    };
    defer key.deinit();

    // Send SPOP command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SPOP",
            .args = .{ .args = &.{key} },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SPOP command", err);
    };
    return promise.toJS();
}

// Implement sadd (add member to a set)
pub fn sadd(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("sadd", "key", "string or buffer");
    };
    defer key.deinit();
    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("sadd", "value", "string or buffer");
    };
    defer value.deinit();

    // Send SADD command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SADD",
            .args = .{ .args = &.{ key, value } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SADD command", err);
    };
    return promise.toJS();
}

// Implement sismember (check if value is member of a set)
pub fn sismember(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("sismember", "key", "string or buffer");
    };
    defer key.deinit();
    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("sismember", "value", "string or buffer");
    };
    defer value.deinit();

    // Send SISMEMBER command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "SISMEMBER",
            .args = .{ .args = &.{ key, value } },
            .meta = .{ .return_as_bool = true },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SISMEMBER command", err);
    };
    return promise.toJS();
}

// Implement hmget (get multiple values from hash)
pub fn hmget(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("hmget", "key", "string or buffer");
    };
    defer key.deinit();

    // Get field array argument
    const fields_array = callframe.argument(1);
    if (!fields_array.isObject() or !fields_array.isArray()) {
        return globalObject.throw("Fields must be an array", .{});
    }

    var iter = try fields_array.arrayIterator(globalObject);
    var args = try std.ArrayList(JSC.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
    defer {
        for (args.items) |item| {
            item.deinit();
        }
        args.deinit();
    }

    args.appendAssumeCapacity(JSC.ZigString.Slice.fromUTF8NeverFree(key.slice()));

    // Add field names as arguments
    while (try iter.next()) |field_js| {
        const field_str = try field_js.toBunString(globalObject);
        defer field_str.deref();

        const field_slice = field_str.toUTF8WithoutRef(bun.default_allocator);
        args.appendAssumeCapacity(field_slice);
    }

    // Send HMGET command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "HMGET",
            .args = .{ .slices = args.items },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send HMGET command", err);
    };
    return promise.toJS();
}

// Implement hincrby (increment hash field by integer value)
pub fn hincrby(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = try callframe.argument(0).toBunString(globalObject);
    defer key.deref();
    const field = try callframe.argument(1).toBunString(globalObject);
    defer field.deref();
    const value = try callframe.argument(2).toBunString(globalObject);
    defer value.deref();

    const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
    defer key_slice.deinit();
    const field_slice = field.toUTF8WithoutRef(bun.default_allocator);
    defer field_slice.deinit();
    const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
    defer value_slice.deinit();

    // Send HINCRBY command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "HINCRBY",
            .args = .{ .slices = &.{ key_slice, field_slice, value_slice } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send HINCRBY command", err);
    };
    return promise.toJS();
}

// Implement hincrbyfloat (increment hash field by float value)
pub fn hincrbyfloat(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = try callframe.argument(0).toBunString(globalObject);
    defer key.deref();
    const field = try callframe.argument(1).toBunString(globalObject);
    defer field.deref();
    const value = try callframe.argument(2).toBunString(globalObject);
    defer value.deref();

    const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
    defer key_slice.deinit();
    const field_slice = field.toUTF8WithoutRef(bun.default_allocator);
    defer field_slice.deinit();
    const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
    defer value_slice.deinit();

    // Send HINCRBYFLOAT command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "HINCRBYFLOAT",
            .args = .{ .slices = &.{ key_slice, field_slice, value_slice } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send HINCRBYFLOAT command", err);
    };
    return promise.toJS();
}

// Implement hmset (set multiple values in hash)
pub fn hmset(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const key = try callframe.argument(0).toBunString(globalObject);
    defer key.deref();

    // For simplicity, let's accept a list of alternating keys and values
    const array_arg = callframe.argument(1);
    if (!array_arg.isObject() or !array_arg.isArray()) {
        return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
    }

    var iter = try array_arg.arrayIterator(globalObject);
    if (iter.len % 2 != 0) {
        return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
    }

    var args = try std.ArrayList(JSC.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
    defer {
        for (args.items) |item| {
            item.deinit();
        }
        args.deinit();
    }

    // Add key as first argument
    const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
    defer key_slice.deinit();
    args.appendAssumeCapacity(key_slice);

    // Add field-value pairs
    while (try iter.next()) |field_js| {
        // Add field name
        const field_str = try field_js.toBunString(globalObject);
        defer field_str.deref();
        const field_slice = field_str.toUTF8WithoutRef(bun.default_allocator);
        args.appendAssumeCapacity(field_slice);

        // Add value
        if (try iter.next()) |value_js| {
            const value_str = try value_js.toBunString(globalObject);
            defer value_str.deref();
            const value_slice = value_str.toUTF8WithoutRef(bun.default_allocator);
            args.appendAssumeCapacity(value_slice);
        } else {
            return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
        }
    }

    // Send HMSET command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "HMSET",
            .args = .{ .slices = args.items },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send HMSET command", err);
    };
    return promise.toJS();
}

// Implement ping (send a PING command with an optional message)
pub fn ping(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    var message_buf: [1]JSArgument = undefined;
    var args_slice: []JSArgument = &.{};

    if (!callframe.argument(0).isUndefinedOrNull()) {
        // Only use the first argument if provided, ignore any additional arguments
        const message = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("ping", "message", "string or buffer");
        };
        message_buf[0] = message;
        args_slice = message_buf[0..1];
    }
    defer {
        for (args_slice) |*item| {
            item.deinit();
        }
    }

    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "PING",
            .args = .{ .args = args_slice },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send PING command", err);
    };
    return promise.toJS();
}

pub const bitcount = compile.@"(key: RedisKey)"("bitcount", "BITCOUNT", "key").call;
pub const dump = compile.@"(key: RedisKey)"("dump", "DUMP", "key").call;
pub const expiretime = compile.@"(key: RedisKey)"("expiretime", "EXPIRETIME", "key").call;
pub const getdel = compile.@"(key: RedisKey)"("getdel", "GETDEL", "key").call;
pub const getex = compile.@"(key: RedisKey)"("getex", "GETEX", "key").call;
pub const hgetall = compile.@"(key: RedisKey)"("hgetall", "HGETALL", "key").call;
pub const hkeys = compile.@"(key: RedisKey)"("hkeys", "HKEYS", "key").call;
pub const hlen = compile.@"(key: RedisKey)"("hlen", "HLEN", "key").call;
pub const hvals = compile.@"(key: RedisKey)"("hvals", "HVALS", "key").call;
pub const keys = compile.@"(key: RedisKey)"("keys", "KEYS", "key").call;
pub const llen = compile.@"(key: RedisKey)"("llen", "LLEN", "key").call;
pub const lpop = compile.@"(key: RedisKey)"("lpop", "LPOP", "key").call;
pub const persist = compile.@"(key: RedisKey)"("persist", "PERSIST", "key").call;
pub const pexpiretime = compile.@"(key: RedisKey)"("pexpiretime", "PEXPIRETIME", "key").call;
pub const pttl = compile.@"(key: RedisKey)"("pttl", "PTTL", "key").call;
pub const rpop = compile.@"(key: RedisKey)"("rpop", "RPOP", "key").call;
pub const scard = compile.@"(key: RedisKey)"("scard", "SCARD", "key").call;
pub const strlen = compile.@"(key: RedisKey)"("strlen", "STRLEN", "key").call;
pub const @"type" = compile.@"(key: RedisKey)"("type", "TYPE", "key").call;
pub const zcard = compile.@"(key: RedisKey)"("zcard", "ZCARD", "key").call;
pub const zpopmax = compile.@"(key: RedisKey)"("zpopmax", "ZPOPMAX", "key").call;
pub const zpopmin = compile.@"(key: RedisKey)"("zpopmin", "ZPOPMIN", "key").call;
pub const zrandmember = compile.@"(key: RedisKey)"("zrandmember", "ZRANDMEMBER", "key").call;

pub const append = compile.@"(key: RedisKey, value: RedisValue)"("append", "APPEND", "key", "value").call;
pub const getset = compile.@"(key: RedisKey, value: RedisValue)"("getset", "GETSET", "key", "value").call;
pub const lpush = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpush", "LPUSH").call;
pub const lpushx = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpushx", "LPUSHX").call;
pub const pfadd = compile.@"(key: RedisKey, value: RedisValue)"("pfadd", "PFADD", "key", "value").call;
pub const rpush = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpush", "RPUSH").call;
pub const rpushx = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpushx", "RPUSHX").call;
pub const setnx = compile.@"(key: RedisKey, value: RedisValue)"("setnx", "SETNX", "key", "value").call;
pub const zscore = compile.@"(key: RedisKey, value: RedisValue)"("zscore", "ZSCORE", "key", "value").call;

pub const del = compile.@"(key: RedisKey, ...args: RedisKey[])"("del", "DEL", "key").call;
pub const mget = compile.@"(key: RedisKey, ...args: RedisKey[])"("mget", "MGET", "key").call;

pub const publish = compile.@"(...strings: string[])"("publish", "PUBLISH").call;
pub const script = compile.@"(...strings: string[])"("script", "SCRIPT").call;
pub const select = compile.@"(...strings: string[])"("select", "SELECT").call;
pub const spublish = compile.@"(...strings: string[])"("spublish", "SPUBLISH").call;
pub const smove = compile.@"(...strings: string[])"("smove", "SMOVE").call;
pub const substr = compile.@"(...strings: string[])"("substr", "SUBSTR").call;
pub const hstrlen = compile.@"(...strings: string[])"("hstrlen", "HSTRLEN").call;
pub const zrank = compile.@"(...strings: string[])"("zrank", "ZRANK").call;
pub const zrevrank = compile.@"(...strings: string[])"("zrevrank", "ZREVRANK").call;
pub const subscribe = compile.@"(...strings: string[])"("subscribe", "SUBSCRIBE").call;
pub const psubscribe = compile.@"(...strings: string[])"("psubscribe", "PSUBSCRIBE").call;
pub const unsubscribe = compile.@"(...strings: string[])"("unsubscribe", "UNSUBSCRIBE").call;
pub const punsubscribe = compile.@"(...strings: string[])"("punsubscribe", "PUNSUBSCRIBE").call;
pub const pubsub = compile.@"(...strings: string[])"("pubsub", "PUBSUB").call;

// publish(channel: RedisValue, message: RedisValue)
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

const compile = struct {
    pub fn @"(key: RedisKey)"(
        comptime name: []const u8,
        comptime command: []const u8,
        comptime arg0_name: []const u8,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
                const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
                    return globalObject.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();

                const promise = this.send(
                    globalObject,
                    callframe.this(),
                    &.{
                        .command = command,
                        .args = .{ .args = &.{key} },
                    },
                ) catch |err| {
                    return protocol.valkeyErrorToJS(globalObject, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(key: RedisKey, ...args: RedisKey[])"(
        comptime name: []const u8,
        comptime command: []const u8,
        comptime arg0_name: []const u8,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
                if (callframe.argument(0).isUndefinedOrNull()) {
                    return globalObject.throwMissingArgumentsValue(&.{arg0_name});
                }

                const arguments = callframe.arguments();
                var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, arguments.len);
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (arguments) |arg| {
                    if (arg.isUndefinedOrNull()) {
                        continue;
                    }

                    const another = (try fromJS(globalObject, arg)) orelse {
                        return globalObject.throwInvalidArgumentType(name, "additional arguments", "string or buffer");
                    };
                    try args.append(another);
                }

                const promise = this.send(
                    globalObject,
                    callframe.this(),
                    &.{
                        .command = command,
                        .args = .{ .args = args.items },
                    },
                ) catch |err| {
                    return protocol.valkeyErrorToJS(globalObject, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }
    pub fn @"(key: RedisKey, value: RedisValue)"(
        comptime name: []const u8,
        comptime command: []const u8,
        comptime arg0_name: []const u8,
        comptime arg1_name: []const u8,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
                const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
                    return globalObject.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();
                const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
                    return globalObject.throwInvalidArgumentType(name, arg1_name, "string or buffer");
                };
                defer value.deinit();

                const promise = this.send(
                    globalObject,
                    callframe.this(),
                    &.{
                        .command = command,
                        .args = .{ .args = &.{ key, value } },
                    },
                ) catch |err| {
                    return protocol.valkeyErrorToJS(globalObject, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(...strings: string[])"(
        comptime name: []const u8,
        comptime command: []const u8,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
                var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, callframe.arguments().len);
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (callframe.arguments()) |arg| {
                    const another = (try fromJS(globalObject, arg)) orelse {
                        return globalObject.throwInvalidArgumentType(name, "additional arguments", "string or buffer");
                    };
                    try args.append(another);
                }

                const promise = this.send(
                    globalObject,
                    callframe.this(),
                    &.{
                        .command = command,
                        .args = .{ .args = args.items },
                    },
                ) catch |err| {
                    return protocol.valkeyErrorToJS(globalObject, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(key: RedisKey, value: RedisValue, ...args: RedisValue)"(
        comptime name: []const u8,
        comptime command: []const u8,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
                var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, callframe.arguments().len);
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (callframe.arguments()) |arg| {
                    if (arg.isUndefinedOrNull()) {
                        continue;
                    }

                    const another = (try fromJS(globalObject, arg)) orelse {
                        return globalObject.throwInvalidArgumentType(name, "additional arguments", "string or buffer");
                    };
                    try args.append(another);
                }

                const promise = this.send(
                    globalObject,
                    callframe.this(),
                    &.{
                        .command = command,
                        .args = .{ .args = args.items },
                    },
                ) catch |err| {
                    return protocol.valkeyErrorToJS(globalObject, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }
};

const JSValkeyClient = @import("./js_valkey.zig").JSValkeyClient;
const bun = @import("bun");
const JSC = bun.JSC;
const valkey = bun.valkey;
const protocol = valkey.protocol;
const JSValue = JSC.JSValue;
const Command = valkey.Command;
const std = @import("std");
const Slice = JSC.ZigString.Slice;

const JSArgument = JSC.Node.BlobOrStringOrBuffer;

fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue) !?JSArgument {
    if (value.isUndefinedOrNull()) {
        return null;
    }

    if (value.isNumber()) {
        // Allow numbers to be passed as strings.
        const str = value.toString(globalObject);
        if (globalObject.hasException()) {
            @branchHint(.unlikely);
            return error.JSError;
        }

        return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, str.toJS(), true);
    }

    return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, value, false);
}
