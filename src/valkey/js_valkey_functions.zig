fn requireNotSubscriber(this: *const JSValkeyClient, function_name: []const u8) bun.JSError!void {
    const fmt_string = "RedisClient.{s} cannot be called while in subscriber mode.";

    if (this.isSubscriber()) {
        return this.globalObject.throw(fmt_string, .{function_name});
    }
}

fn requireSubscriber(this: *const JSValkeyClient, function_name: []const u8) bun.JSError!void {
    const fmt_string = "RedisClient.{s} can only be called while in subscriber mode.";

    if (!this.isSubscriber()) {
        return this.globalObject.throw(fmt_string, .{function_name});
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

pub fn subscribe(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args_view = callframe.arguments();

    if (args_view.len != 2) {
        return globalObject.throwInvalidArguments("subscribe requires two arguments", .{});
    }

    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
    var redis_channels = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), 1);
    defer {
        for (redis_channels.items) |*item| {
            item.deinit();
        }
        redis_channels.deinit();
    }

    const handler_callback = callframe.argument(1);
    if (!handler_callback.isCallable()) {
        return globalObject.throwInvalidArgumentType("subscribe", "listener", "function");
    }

    // We now need to register the callback with our subscription context, which may or may not exist.
    var subscription_ctx = this.getOrCreateSubscriptionCtxEnteringSubscriptionMode();

    // The first argument given is the channel or may be an array of channels.
    const channelOrMany = callframe.argument(0);
    if (channelOrMany.isArray()) {
        if ((try channelOrMany.getLength(globalObject)) == 0) {
            return globalObject.throwInvalidArguments("subscribe requires at least one channel", .{});
        }
        try redis_channels.ensureTotalCapacity(try channelOrMany.getLength(globalObject));

        var array_iter = try channelOrMany.arrayIterator(globalObject);
        while (try array_iter.next()) |channel_arg| {
            const channel = (try fromJS(globalObject, channel_arg)) orelse {
                return globalObject.throwInvalidArgumentType("subscribe", "channel", "string");
            };
            redis_channels.appendAssumeCapacity(channel);

            try subscription_ctx.upsertReceiveHandler(globalObject, channel_arg, handler_callback);
        }
    } else if (channelOrMany.isString()) {
        // It is a single string channel
        const channel = (try fromJS(globalObject, channelOrMany)) orelse {
            return globalObject.throwInvalidArgumentType("subscribe", "channel", "string");
        };
        redis_channels.appendAssumeCapacity(channel);

        try subscription_ctx.upsertReceiveHandler(globalObject, channelOrMany, handler_callback);
    } else {
        return globalObject.throwInvalidArgumentType("subscribe", "channel", "string or array");
    }

    const command: valkey.Command = .{
        .command = "SUBSCRIBE",
        .args = .{ .args = redis_channels.items },
    };
    const promise = this.send(
        globalObject,
        callframe.this(),
        &command,
    ) catch |err| {
        // If we find an error, we need to clean up the subscription context.
        this.deleteSubscriptionCtx();
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

    // We do not delete the subscription context here, but rather when the
    // onValkeyUnsubscribe callback is invoked.

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
        return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
    }

    // The first argument can be a channel or an array of channels
    const channelOrMany = callframe.argument(0);

    // Get the subscription context
    if (this._subscription_ctx == null) {
        return globalObject.throw("Subscription context not found", .{});
    }

    // Two arguments means .unsubscribe(channel, listener) is invoked.
    if (callframe.arguments().len == 2) {
        // In this case, the first argument is a channel string and the second
        // argument is the handler to remove.
        if (!channelOrMany.isString()) {
            return globalObject.throwInvalidArgumentType(
                "unsubscribe",
                "channel",
                "string",
            );
        }

        const channel = channelOrMany;
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

        const remaining_listeners = this._subscription_ctx.?.removeReceiveHandler(globalObject, channel, listener_cb) catch {
            return globalObject.throw(
                "Failed to remove handler for channel {}",
                .{channel.asString().getZigString(globalObject)},
            );
        } orelse {
            // Listeners weren't present in the first place, so we can return a
            // resolved promise.
            const promise = jsc.JSPromise.create(globalObject);
            promise.resolve(globalObject, .js_undefined);
            return promise.toJS();
        };

        // In this case, we only want to send the unsubscribe command to redis if there are no more listeners for this
        // channel.
        if (remaining_listeners == 0) {
            return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
        }

        // Otherwise, in order to keep the API consistent, we need to return a resolved promise.
        const promise = jsc.JSPromise.create(globalObject);
        promise.resolve(globalObject, .js_undefined);

        return promise.toJS();
    }

    if (channelOrMany.isArray()) {
        if ((try channelOrMany.getLength(globalObject)) == 0) {
            return globalObject.throwInvalidArguments(
                "unsubscribe requires at least one channel",
                .{},
            );
        }

        try redis_channels.ensureTotalCapacity(try channelOrMany.getLength(globalObject));
        // It is an array, so let's iterate over it
        var array_iter = try channelOrMany.arrayIterator(globalObject);
        while (try array_iter.next()) |channel_arg| {
            const channel = (try fromJS(globalObject, channel_arg)) orelse {
                return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string");
            };
            redis_channels.appendAssumeCapacity(channel);
            // Clear the handlers for this channel
            this._subscription_ctx.?.clearReceiveHandlers(globalObject, channel_arg);
        }
    } else if (channelOrMany.isString()) {
        // It is a single string channel
        const channel = (try fromJS(globalObject, channelOrMany)) orelse {
            return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string");
        };
        redis_channels.appendAssumeCapacity(channel);
        // Clear the handlers for this channel
        this._subscription_ctx.?.clearReceiveHandlers(globalObject, channelOrMany);
    } else {
        return globalObject.throwInvalidArgumentType("unsubscribe", "channel", "string or array");
    }

    // Now send the unsubscribe command and clean up if necessary
    return try sendUnsubscribeRequestAndCleanup(this, callframe.this(), globalObject, redis_channels.items);
}

// Wrapper functions that check subscriber mode before delegating to compile-generated functions
pub fn bitcount(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("bitcount", "BITCOUNT", "key").call(this, globalObject, callframe);
}

pub fn dump(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("dump", "DUMP", "key").call(this, globalObject, callframe);
}

pub fn expiretime(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("expiretime", "EXPIRETIME", "key").call(this, globalObject, callframe);
}

pub fn getdel(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("getdel", "GETDEL", "key").call(this, globalObject, callframe);
}

pub fn getex(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("getex", "GETEX", "key").call(this, globalObject, callframe);
}

pub fn hgetall(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("hgetall", "HGETALL", "key").call(this, globalObject, callframe);
}

pub fn hkeys(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("hkeys", "HKEYS", "key").call(this, globalObject, callframe);
}

pub fn hlen(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("hlen", "HLEN", "key").call(this, globalObject, callframe);
}

pub fn hvals(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("hvals", "HVALS", "key").call(this, globalObject, callframe);
}

pub fn keys(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("keys", "KEYS", "key").call(this, globalObject, callframe);
}

pub fn llen(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("llen", "LLEN", "key").call(this, globalObject, callframe);
}

pub fn lpop(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("lpop", "LPOP", "key").call(this, globalObject, callframe);
}

pub fn persist(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("persist", "PERSIST", "key").call(this, globalObject, callframe);
}

pub fn pexpiretime(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("pexpiretime", "PEXPIRETIME", "key").call(this, globalObject, callframe);
}

pub fn pttl(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("pttl", "PTTL", "key").call(this, globalObject, callframe);
}

pub fn rpop(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("rpop", "RPOP", "key").call(this, globalObject, callframe);
}

pub fn scard(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("scard", "SCARD", "key").call(this, globalObject, callframe);
}

pub fn strlen(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("strlen", "STRLEN", "key").call(this, globalObject, callframe);
}

pub fn @"type"(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("type", "TYPE", "key").call(this, globalObject, callframe);
}

pub fn zcard(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("zcard", "ZCARD", "key").call(this, globalObject, callframe);
}

pub fn zpopmax(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("zpopmax", "ZPOPMAX", "key").call(this, globalObject, callframe);
}

pub fn zpopmin(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("zpopmin", "ZPOPMIN", "key").call(this, globalObject, callframe);
}

pub fn zrandmember(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey)"("zrandmember", "ZRANDMEMBER", "key").call(this, globalObject, callframe);
}

pub fn append(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue)"("append", "APPEND", "key", "value").call(this, globalObject, callframe);
}
pub fn getset(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue)"("getset", "GETSET", "key", "value").call(this, globalObject, callframe);
}
pub fn lpush(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpush", "LPUSH").call(this, globalObject, callframe);
}
pub fn lpushx(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpushx", "LPUSHX").call(this, globalObject, callframe);
}
pub fn pfadd(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue)"("pfadd", "PFADD", "key", "value").call(this, globalObject, callframe);
}
pub fn rpush(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpush", "RPUSH").call(this, globalObject, callframe);
}
pub fn rpushx(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpushx", "RPUSHX").call(this, globalObject, callframe);
}
pub fn setnx(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue)"("setnx", "SETNX", "key", "value").call(this, globalObject, callframe);
}
pub fn zscore(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, value: RedisValue)"("zscore", "ZSCORE", "key", "value").call(this, globalObject, callframe);
}

pub fn del(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, ...args: RedisKey[])"("del", "DEL", "key").call(this, globalObject, callframe);
}
pub fn mget(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(key: RedisKey, ...args: RedisKey[])"("mget", "MGET", "key").call(this, globalObject, callframe);
}

pub fn script(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("script", "SCRIPT").call(this, globalObject, callframe);
}
pub fn select(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("select", "SELECT").call(this, globalObject, callframe);
}
pub fn spublish(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("spublish", "SPUBLISH").call(this, globalObject, callframe);
}
pub fn smove(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("smove", "SMOVE").call(this, globalObject, callframe);
}
pub fn substr(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("substr", "SUBSTR").call(this, globalObject, callframe);
}
pub fn hstrlen(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("hstrlen", "HSTRLEN").call(this, globalObject, callframe);
}
pub fn zrank(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("zrank", "ZRANK").call(this, globalObject, callframe);
}
pub fn zrevrank(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    try requireNotSubscriber(this, @src().fn_name);
    return compile.@"(...strings: string[])"("zrevrank", "ZREVRANK").call(this, globalObject, callframe);
}

pub fn duplicate(
    this: *JSValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    // We ignore the arguments if the user provided any.
    _ = callframe;

    var new_client: *JSValkeyClient = try this.cloneWithoutConnecting();
    var new_client_js = new_client.toJS(globalObject);
    new_client.this_value = jsc.JSRef.initWeak(new_client_js);

    // If the original client is already connected and not manually closed, start connecting the new client.
    if (this.client.status == .connected and !this.client.flags.is_manually_closed) {
        new_client.client.flags.connection_promise_returns_client = true;
        new_client_js.protect();
        return try new_client.doConnect(globalObject, new_client_js);
    }

    // Otherwise, we create a dummy promise to yield the unconnected client.
    const promise = jsc.JSPromise.create(globalObject);
    promise.resolve(globalObject, new_client_js);
    return promise.toJS();
}

pub const psubscribe = compile.@"(...strings: string[])"("psubscribe", "PSUBSCRIBE").call;
pub const punsubscribe = compile.@"(...strings: string[])"("punsubscribe", "PUNSUBSCRIBE").call;
pub const pubsub = compile.@"(...strings: string[])"("pubsub", "PUBSUB").call;

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
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
            pub fn call(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
        const str = value.toString(globalObject);
        if (globalObject.hasException()) {
            @branchHint(.unlikely);
            return error.JSError;
        }

        return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, str.toJS(), true);
    }

    return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, value, false);
}

const bun = @import("bun");
const std = @import("std");
const JSValkeyClient = @import("./js_valkey.zig").JSValkeyClient;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSArgument = jsc.Node.BlobOrStringOrBuffer;
const Slice = jsc.ZigString.Slice;

const valkey = bun.valkey;
const Command = valkey.Command;
const protocol = valkey.protocol;
