fn requireNotSubscriber(this: *JSValkeyClient, function_name: []const u8) bun.JSError!void {
    const fmt_string = "RedisClient.prototype.{s} cannot be called while in subscriber mode.";

    if (this.isSubscriber()) {
        return this.globalObject.ERR(.REDIS_INVALID_STATE, fmt_string, .{function_name}).throw();
    }
}

fn requireSubscriber(this: *JSValkeyClient, function_name: []const u8) bun.JSError!void {
    const fmt_string = "RedisClient.prototype.{s} can only be called while in subscriber mode.";

    if (!this.isSubscriber()) {
        return this.globalObject.ERR(.REDIS_INVALID_STATE, fmt_string, .{function_name}).throw();
    }
}

pub fn jsSend(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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

pub fn get(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

pub fn getBuffer(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

pub fn set(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

pub fn incr(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

// Implement incrby (increment key by integer value)
pub fn incrby(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("incrby", "key", "string or buffer");
    };
    defer key.deinit();
    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("incrby", "increment", "string or number");
    };
    defer value.deinit();

    // Send INCRBY command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "INCRBY",
            .args = .{ .args = &.{ key, value } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send INCRBY command", err);
    };
    return promise.toJS();
}

pub fn decr(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

// Implement decrby (decrement key by integer value)
pub fn decrby(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
        return globalObject.throwInvalidArgumentType("decrby", "key", "string or buffer");
    };
    defer key.deinit();
    const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
        return globalObject.throwInvalidArgumentType("decrby", "decrement", "string or number");
    };
    defer value.deinit();

    // Send DECRBY command
    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "DECRBY",
            .args = .{ .args = &.{ key, value } },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send DECRBY command", err);
    };
    return promise.toJS();
}

pub fn exists(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

pub fn expire(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

pub fn ttl(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn srem(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn srandmember(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn smembers(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn spop(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn sadd(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn sismember(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn hmget(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
    var args = try std.ArrayList(jsc.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
    defer {
        for (args.items) |item| {
            item.deinit();
        }
        args.deinit();
    }

    args.appendAssumeCapacity(jsc.ZigString.Slice.fromUTF8NeverFree(key.slice()));

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
pub fn hincrby(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn hincrbyfloat(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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
pub fn hmset(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

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

    var args = try std.ArrayList(jsc.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
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
pub fn ping(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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

pub const bitcount = compile.@"(key: RedisKey)"("bitcount", "BITCOUNT", "key", .not_subscriber).call;
pub const dump = compile.@"(key: RedisKey)"("dump", "DUMP", "key", .not_subscriber).call;
pub const expiretime = compile.@"(key: RedisKey)"("expiretime", "EXPIRETIME", "key", .not_subscriber).call;
pub const getdel = compile.@"(key: RedisKey)"("getdel", "GETDEL", "key", .not_subscriber).call;
pub const getex = compile.@"(...strings: string[])"("getex", "GETEX", .not_subscriber).call;
pub const hgetall = compile.@"(key: RedisKey)"("hgetall", "HGETALL", "key", .not_subscriber).call;
pub const hkeys = compile.@"(key: RedisKey)"("hkeys", "HKEYS", "key", .not_subscriber).call;
pub const hlen = compile.@"(key: RedisKey)"("hlen", "HLEN", "key", .not_subscriber).call;
pub const hvals = compile.@"(key: RedisKey)"("hvals", "HVALS", "key", .not_subscriber).call;
pub const keys = compile.@"(key: RedisKey)"("keys", "KEYS", "key", .not_subscriber).call;
pub const llen = compile.@"(key: RedisKey)"("llen", "LLEN", "key", .not_subscriber).call;
pub const lpop = compile.@"(key: RedisKey)"("lpop", "LPOP", "key", .not_subscriber).call;
pub const persist = compile.@"(key: RedisKey)"("persist", "PERSIST", "key", .not_subscriber).call;
pub const pexpiretime = compile.@"(key: RedisKey)"("pexpiretime", "PEXPIRETIME", "key", .not_subscriber).call;
pub const pttl = compile.@"(key: RedisKey)"("pttl", "PTTL", "key", .not_subscriber).call;
pub const rpop = compile.@"(key: RedisKey)"("rpop", "RPOP", "key", .not_subscriber).call;
pub const scard = compile.@"(key: RedisKey)"("scard", "SCARD", "key", .not_subscriber).call;
pub const strlen = compile.@"(key: RedisKey)"("strlen", "STRLEN", "key", .not_subscriber).call;
pub const @"type" = compile.@"(key: RedisKey)"("type", "TYPE", "key", .not_subscriber).call;
pub const zcard = compile.@"(key: RedisKey)"("zcard", "ZCARD", "key", .not_subscriber).call;
pub const zpopmax = compile.@"(key: RedisKey)"("zpopmax", "ZPOPMAX", "key", .not_subscriber).call;
pub const zpopmin = compile.@"(key: RedisKey)"("zpopmin", "ZPOPMIN", "key", .not_subscriber).call;
pub const zrandmember = compile.@"(key: RedisKey)"("zrandmember", "ZRANDMEMBER", "key", .not_subscriber).call;

pub const append = compile.@"(key: RedisKey, value: RedisValue)"("append", "APPEND", "key", "value", .not_subscriber).call;
pub const getset = compile.@"(key: RedisKey, value: RedisValue)"("getset", "GETSET", "key", "value", .not_subscriber).call;
pub const hget = compile.@"(key: RedisKey, value: RedisValue)"("hget", "HGET", "key", "field", .not_subscriber).call;
pub const lpush = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpush", "LPUSH", .not_subscriber).call;
pub const lpushx = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpushx", "LPUSHX", .not_subscriber).call;
pub const pfadd = compile.@"(key: RedisKey, value: RedisValue)"("pfadd", "PFADD", "key", "value", .not_subscriber).call;
pub const rpush = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpush", "RPUSH", .not_subscriber).call;
pub const rpushx = compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpushx", "RPUSHX", .not_subscriber).call;
pub const setnx = compile.@"(key: RedisKey, value: RedisValue)"("setnx", "SETNX", "key", "value", .not_subscriber).call;
pub const zscore = compile.@"(key: RedisKey, value: RedisValue)"("zscore", "ZSCORE", "key", "value", .not_subscriber).call;

pub const del = compile.@"(key: RedisKey, ...args: RedisKey[])"("del", "DEL", "key", .not_subscriber).call;
pub const mget = compile.@"(key: RedisKey, ...args: RedisKey[])"("mget", "MGET", "key", .not_subscriber).call;

pub const script = compile.@"(...strings: string[])"("script", "SCRIPT", .not_subscriber).call;
pub const select = compile.@"(...strings: string[])"("select", "SELECT", .not_subscriber).call;
pub const spublish = compile.@"(...strings: string[])"("spublish", "SPUBLISH", .not_subscriber).call;
pub const smove = compile.@"(...strings: string[])"("smove", "SMOVE", .not_subscriber).call;
pub const substr = compile.@"(...strings: string[])"("substr", "SUBSTR", .not_subscriber).call;
pub const hstrlen = compile.@"(...strings: string[])"("hstrlen", "HSTRLEN", .not_subscriber).call;
pub const zrank = compile.@"(...strings: string[])"("zrank", "ZRANK", .not_subscriber).call;
pub const zrevrank = compile.@"(...strings: string[])"("zrevrank", "ZREVRANK", .not_subscriber).call;
pub const psubscribe = compile.@"(...strings: string[])"("psubscribe", "PSUBSCRIBE", .dont_care).call;
pub const punsubscribe = compile.@"(...strings: string[])"("punsubscribe", "PUNSUBSCRIBE", .dont_care).call;
pub const pubsub = compile.@"(...strings: string[])"("pubsub", "PUBSUB", .dont_care).call;

pub fn publish(
    this: *JSValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);

    const args_view = callframe.arguments();
    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
    var args = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), args_view.len);
    defer {
        for (args.items) |*item| {
            item.deinit();
        }
        args.deinit();
    }

    const arg0 = callframe.argument(0);
    if (!arg0.isString()) {
        return globalObject.throwInvalidArgumentType("publish", "channel", "string");
    }
    const channel = (try fromJS(globalObject, arg0)) orelse unreachable;

    args.appendAssumeCapacity(channel);

    const arg1 = callframe.argument(1);
    if (!arg1.isString()) {
        return globalObject.throwInvalidArgumentType("publish", "message", "string");
    }
    const message = (try fromJS(globalObject, arg1)) orelse unreachable;
    args.appendAssumeCapacity(message);

    const promise = this.send(
        globalObject,
        callframe.this(),
        &.{
            .command = "PUBLISH",
            .args = .{ .args = args.items },
        },
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send PUBLISH command", err);
    };

    return promise.toJS();
}

pub fn subscribe(
    this: *JSValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const channel_or_many, const handler_callback = callframe.argumentsAsArray(2);
    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
    var redis_channels = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), 1);
    defer {
        for (redis_channels.items) |*item| {
            item.deinit();
        }
        redis_channels.deinit();
    }

    if (!handler_callback.isCallable()) {
        return globalObject.throwInvalidArgumentType("subscribe", "listener", "function");
    }

    // The first argument given is the channel or may be an array of channels.
    if (channel_or_many.isArray()) {
        if ((try channel_or_many.getLength(globalObject)) == 0) {
            return globalObject.throwInvalidArguments("subscribe requires at least one channel", .{});
        }
        try redis_channels.ensureTotalCapacity(try channel_or_many.getLength(globalObject));

        var array_iter = try channel_or_many.arrayIterator(globalObject);
        while (try array_iter.next()) |channel_arg| {
            const channel = (try fromJS(globalObject, channel_arg)) orelse {
                return globalObject.throwInvalidArgumentType("subscribe", "channel", "string");
            };
            redis_channels.appendAssumeCapacity(channel);

            // What we do here is add our receive handler. Notice that this doesn't really do anything until the
            // "SUBSCRIBE" command is sent to redis and we get a response.
            //
            // TODO(markovejnovic): This is less-than-ideal, still, because this assumes a happy path. What happens if
            //                      the SUBSCRIBE command fails? We have no way to roll back the addition of the
            //                      handler.
            try this._subscription_ctx.upsertReceiveHandler(globalObject, channel_arg, handler_callback);
        }
    } else if (channel_or_many.isString()) {
        // It is a single string channel
        const channel = (try fromJS(globalObject, channel_or_many)) orelse {
            return globalObject.throwInvalidArgumentType("subscribe", "channel", "string");
        };
        redis_channels.appendAssumeCapacity(channel);

        try this._subscription_ctx.upsertReceiveHandler(globalObject, channel_or_many, handler_callback);
    } else {
        return globalObject.throwInvalidArgumentType("subscribe", "channel", "string or array");
    }

    const command: valkey.Command = .{
        .command = "SUBSCRIBE",
        .args = .{ .args = redis_channels.items },
        .meta = .{
            .subscription_request = true,
        },
    };
    const promise = this.send(
        globalObject,
        callframe.this(),
        &command,
    ) catch |err| {
        // If we catch an error, we need to clean up any handlers we may have added and fall out of subscription mode
        try this._subscription_ctx.clearAllReceiveHandlers(globalObject);
        return protocol.valkeyErrorToJS(globalObject, "Failed to send SUBSCRIBE command", err);
    };

    return promise.toJS();
}

/// Send redis the UNSUBSCRIBE RESP command and clean up anything necessary after the unsubscribe commoand.
///
/// The subscription context must exist when calling this function.
fn sendUnsubscribeRequestAndCleanup(
    this: *JSValkeyClient,
    this_js: jsc.JSValue,
    globalObject: *jsc.JSGlobalObject,
    redis_channels: []JSArgument,
) !jsc.JSValue {
    // Send UNSUBSCRIBE command
    const command: valkey.Command = .{
        .command = "UNSUBSCRIBE",
        .args = .{ .args = redis_channels },
    };
    const promise = this.send(
        globalObject,
        this_js,
        &command,
    ) catch |err| {
        return protocol.valkeyErrorToJS(globalObject, "Failed to send UNSUBSCRIBE command", err);
    };

    return promise.toJS();
}

pub fn unsubscribe(
    this: *JSValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    // Check if we're in subscription mode
    try requireSubscriber(this, @src().fn_name);

    const args_view = callframe.arguments();

    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
    var redis_channels = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), 1);
    defer {
        for (redis_channels.items) |*item| {
            item.deinit();
        }
        redis_channels.deinit();
    }

    // If no arguments, unsubscribe from all channels
    if (args_view.len == 0) {
        try this._subscription_ctx.clearAllReceiveHandlers(globalObject);
        return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
    }

    // The first argument can be a channel or an array of channels
    const channel_or_many = callframe.argument(0);

    // Get the subscription context
    if (!this._subscription_ctx.is_subscriber) {
        return jsc.JSPromise.resolvedPromiseValue(globalObject, .js_undefined);
    }

    // Two arguments means .unsubscribe(channel, listener) is invoked.
    if (callframe.arguments().len == 2) {
        // In this case, the first argument is a channel string and the second
        // argument is the handler to remove.
        if (!channel_or_many.isString()) {
            return globalObject.throwInvalidArgumentType(
                "unsubscribe",
                "channel",
                "string",
            );
        }

        const channel = channel_or_many;
        const listener_cb = callframe.argument(1);

        if (!listener_cb.isCallable()) {
            return globalObject.throwInvalidArgumentType(
                "unsubscribe",
                "listener",
                "function",
            );
        }

        // Populate the redis_channels list with the single channel to
        // unsubscribe from. This s important since this list is used to send
        // the UNSUBSCRIBE command to redis. Without this, we would end up
        // unsubscribing from all channels.
        redis_channels.appendAssumeCapacity((try fromJS(globalObject, channel)) orelse {
            return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string");
        });

        const remaining_listeners = this._subscription_ctx.removeReceiveHandler(
            globalObject,
            channel,
            listener_cb,
        ) catch {
            return globalObject.throw(
                "Failed to remove handler for channel {}",
                .{channel.asString().getZigString(globalObject)},
            );
        } orelse {
            // Listeners weren't present in the first place, so we can return a
            // resolved promise.
            return jsc.JSPromise.resolvedPromiseValue(globalObject, .js_undefined);
        };

        // In this case, we only want to send the unsubscribe command to redis if there are no more listeners for this
        // channel.
        if (remaining_listeners == 0) {
            return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
        }

        // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
        return jsc.JSPromise.resolvedPromiseValue(globalObject, .js_undefined);
    }

    if (channel_or_many.isArray()) {
        if ((try channel_or_many.getLength(globalObject)) == 0) {
            return globalObject.throwInvalidArguments(
                "unsubscribe requires at least one channel",
                .{},
            );
        }

        try redis_channels.ensureTotalCapacity(try channel_or_many.getLength(globalObject));
        // It is an array, so let's iterate over it
        var array_iter = try channel_or_many.arrayIterator(globalObject);
        while (try array_iter.next()) |channel_arg| {
            const channel = (try fromJS(globalObject, channel_arg)) orelse {
                return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string");
            };
            redis_channels.appendAssumeCapacity(channel);
            // Clear the handlers for this channel
            try this._subscription_ctx.clearReceiveHandlers(globalObject, channel_arg);
        }
    } else if (channel_or_many.isString()) {
        // It is a single string channel
        const channel = (try fromJS(globalObject, channel_or_many)) orelse {
            return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string");
        };
        redis_channels.appendAssumeCapacity(channel);
        // Clear the handlers for this channel
        try this._subscription_ctx.clearReceiveHandlers(globalObject, channel_or_many);
    } else {
        return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string or array");
    }

    // Now send the unsubscribe command and clean up if necessary
    return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
}

pub fn duplicate(
    this: *JSValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    _ = callframe;

    var new_client: *JSValkeyClient = try this.cloneWithoutConnecting(globalObject);

    const new_client_js = new_client.toJS(globalObject);
    new_client.this_value = jsc.JSRef.initWeak(new_client_js);
    new_client._subscription_ctx = try SubscriptionCtx.init(new_client);
    // If the original client is already connected and not manually closed, start connecting the new client.
    if (this.client.status == .connected and !this.client.flags.is_manually_closed) {
        // Use strong reference during connection to prevent premature GC
        new_client.client.flags.connection_promise_returns_client = true;
        return try new_client.doConnect(globalObject, new_client_js);
    }

    return jsc.JSPromise.resolvedPromiseValue(globalObject, new_client_js);
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

const compile = struct {
    pub const ClientStateRequirement = enum {
        /// The client must be a subscriber (in subscription mode).
        subscriber,
        /// The client must not be a subscriber (not in subscription mode).
        not_subscriber,
        /// We don't care about the client state (subscriber or not).
        dont_care,
    };

    fn testCorrectState(
        this: *JSValkeyClient,
        js_client_prototype_function_name: []const u8,
        comptime client_state_requirement: ClientStateRequirement,
    ) bun.JSError!void {
        return switch (client_state_requirement) {
            .subscriber => requireSubscriber(this, js_client_prototype_function_name),
            .not_subscriber => requireNotSubscriber(this, js_client_prototype_function_name),
            .dont_care => {},
        };
    }

    pub fn @"(key: RedisKey)"(
        comptime name: []const u8,
        comptime command: []const u8,
        comptime arg0_name: []const u8,
        comptime client_state_requirement: ClientStateRequirement,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
                try testCorrectState(this, name, client_state_requirement);

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
        comptime client_state_requirement: ClientStateRequirement,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
                try testCorrectState(this, name, client_state_requirement);

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
        comptime client_state_requirement: ClientStateRequirement,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
                try testCorrectState(this, name, client_state_requirement);

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
        comptime client_state_requirement: ClientStateRequirement,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
                try testCorrectState(this, name, client_state_requirement);

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
        comptime client_state_requirement: ClientStateRequirement,
    ) type {
        return struct {
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
                try testCorrectState(this, name, client_state_requirement);

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

fn fromJS(globalObject: *jsc.JSGlobalObject, value: JSValue) !?JSArgument {
    if (value.isUndefinedOrNull()) {
        return null;
    }

    if (value.isNumber()) {
        // Allow numbers to be passed as strings.
        const str = try value.toJSString(globalObject);
        return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, str.toJS(), true);
    }

    return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, value, false);
}

const bun = @import("bun");
const std = @import("std");

const JSValkeyClient = @import("./js_valkey.zig").JSValkeyClient;
const SubscriptionCtx = @import("./js_valkey.zig").SubscriptionCtx;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSArgument = jsc.Node.BlobOrStringOrBuffer;
const Slice = jsc.ZigString.Slice;

const valkey = bun.valkey;
const Command = valkey.Command;
const protocol = valkey.protocol;
