pub usingnamespace @import("./webcore/response.zig");
pub usingnamespace @import("./webcore/encoding.zig");
pub usingnamespace @import("./webcore/streams.zig");

const JSC = @import("../jsc.zig");
const std = @import("std");
const bun = @import("../global.zig");

pub const Lifetime = enum {
    clone,
    transfer,
    share,
    /// When reading from a fifo like STDIN/STDERR
    temporary,
};

pub const Alert = struct {
    pub const Class = JSC.NewClass(
        void,
        .{ .name = "alert" },
        .{
            .@"call" = .{ .rfn = call },
        },
        .{},
    );

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
    pub fn call(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        arguments: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        var stdout = std.io.getStdOut();
        const has_message = arguments.len != 0 and arguments[0] != null;

        // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
        if (has_message) {
            const message = arguments[0].?.value().toSlice(ctx.ptr(), bun.default_allocator);

            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            stdout.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return.
                return JSC.JSValue.jsUndefined().asObjectRef();
            };
        }

        stdout.writeAll(if (has_message) " [Enter]" else "Alert [Enter] ") catch {
            // 1. If we cannot show simple dialogs for this, then return.
            return JSC.JSValue.jsUndefined().asObjectRef();
        };

        // 6. Invoke WebDriver BiDi user prompt opened with this, "alert", and message.
        // *  Not pertinent to use their complex system in a server context.

        // 7. Optionally, pause while waiting for the user to acknowledge the message.
        var stdin = std.io.getStdIn();
        var reader = stdin.reader();
        while (true) {
            const byte = reader.readByte() catch break;
            if (byte == '\n') break;
        }

        // 8. Invoke WebDriver BiDi user prompt closed with this and true.
        // *  Again, not necessary in a server context.

        return JSC.JSValue.jsUndefined().asObjectRef();
    }
};

pub const Confirm = struct {
    pub const Class = JSC.NewClass(
        void,
        .{ .name = "confirm" },
        .{
            .@"call" = .{ .rfn = call },
        },
        .{},
    );

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-confirm
    pub fn call(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        arguments: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        var stdout = std.io.getStdOut();
        const has_message = arguments.len != 0 and arguments[0] != null;

        if (has_message) {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = arguments[0].?.value().toSlice(ctx.ptr(), bun.default_allocator);

            stdout.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return false.
                return JSC.JSValue.jsBoolean(false).asObjectRef();
            };
        }

        // 4. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to respond with a positive or negative
        //    response.
        stdout.writeAll(if (has_message) " [y/N] " else "Confirm [y/N] ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return JSC.JSValue.jsBoolean(false).asObjectRef();
        };

        // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
        // *  Not relevant in a server context.

        // 6. Pause until the user responds either positively or negatively.
        var stdin = std.io.getStdIn();
        var reader = stdin.reader();

        const first_byte = reader.readByte() catch {
            return JSC.JSValue.jsBoolean(false).asObjectRef();
        };

        // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
        //    the user responded positively or false otherwise.
        // *  Not relevant in a server context.

        switch (first_byte) {
            '\n' => return JSC.JSValue.jsBoolean(false).asObjectRef(),
            'y' => {
                const next_byte = reader.readByte() catch {
                    // They may have said yes, but the stdin is invalid.
                    return JSC.JSValue.jsBoolean(false).asObjectRef();
                };

                if (next_byte == '\n') {
                    // 8. If the user responded positively, return true;
                    //    otherwise, the user responded negatively: return false.
                    return JSC.JSValue.jsBoolean(true).asObjectRef();
                }
            },
            else => {},
        }

        while (reader.readByte()) |b| {
            if (b == '\n') break;
        } else |_| {}

        // 8. If the user responded positively, return true; otherwise, the user
        //    responded negatively: return false.
        return JSC.JSValue.jsBoolean(false).asObjectRef();
    }
};

pub const Prompt = struct {
    pub const Class = JSC.NewClass(
        void,
        .{ .name = "prompt" },
        .{
            .@"call" = .{ .rfn = call },
        },
        .{},
    );

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to only append.
    pub fn readUntilDelimiterArrayListAppend(
        reader: anytype,
        array_list: *std.ArrayList(u8),
        delimiter: u8,
        max_size: usize,
    ) !void {
        while (true) {
            if (array_list.items.len == max_size) {
                return error.StreamTooLong;
            }

            var byte: u8 = try reader.readByte();

            if (byte == delimiter) {
                return;
            }

            try array_list.append(byte);
        }
    }

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
    pub fn call(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        arguments: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        var stdout = std.io.getStdOut();
        const has_message = arguments.len != 0 and arguments[0] != null;
        // 4. Set default to the result of optionally truncating default.
        // *  We don't really need to do this.
        const default = if (arguments.len >= 2 and arguments[1] != null) arguments[1] else JSC.JSValue.jsNull().asObjectRef();

        if (has_message) {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = arguments[0].?.value().toSlice(ctx.ptr(), bun.default_allocator);

            stdout.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return null.
                return JSC.JSValue.jsNull().asObjectRef();
            };
        }

        // 4. Set default to the result of optionally truncating default.

        // 5. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to either respond with a string value or
        //    abort. The response must be defaulted to the value given by
        //    default.
        stdout.writeAll(if (has_message) " " else "Prompt ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return JSC.JSValue.jsBoolean(false).asObjectRef();
        };

        // 6. Invoke WebDriver BiDi user prompt opened with this, "prompt" and message.
        // *  Not relevant in a server context.

        // 7. Pause while waiting for the user's response.
        var stdin = std.io.getStdIn();
        var reader = stdin.reader();

        const first_byte = reader.readByte() catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return JSC.JSValue.jsNull().asObjectRef();
        };

        if (first_byte == '\n') {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return default;
        }

        var message = std.ArrayList(u8).initCapacity(bun.default_allocator, 1) catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return JSC.JSValue.jsNull().asObjectRef();
        };

        message.appendAssumeCapacity(first_byte);

        readUntilDelimiterArrayListAppend(reader, &message, '\n', 1027) catch {
            message.deinit();
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return JSC.JSValue.jsNull().asObjectRef();
        };

        // 9. Invoke WebDriver BiDi user prompt closed with this, false if
        //    result is null or true otherwise, and result.
        // *  Too

        // 8. If the user responded positively, return true; otherwise, the user
        //    responded negatively: return false.
        return JSC.ZigString.init(message.toOwnedSlice()).toValue(ctx.ptr()).asObjectRef();
    }
};

pub const Crypto = struct {
    const UUID = @import("./uuid.zig");

    pub const Class = JSC.NewClass(void, .{ .name = "crypto" }, .{
        .getRandomValues = .{
            .rfn = getRandomValues,
        },
        .randomUUID = .{
            .rfn = randomUUID,
        },
    }, .{});
    pub const Prototype = JSC.NewClass(
        void,
        .{ .name = "Crypto" },
        .{
            .call = .{
                .rfn = call,
            },
        },
        .{},
    );

    pub fn getRandomValues(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        arguments: []const JSC.C.JSValueRef,
        exception: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        if (arguments.len == 0) {
            JSC.JSError(JSC.getAllocator(ctx), "Expected typed array but received nothing", .{}, ctx, exception);
            return JSC.JSValue.jsUndefined().asObjectRef();
        }
        var array_buffer = JSC.MarkedArrayBuffer.fromJS(ctx.ptr(), JSC.JSValue.fromRef(arguments[0]), exception) orelse {
            JSC.JSError(JSC.getAllocator(ctx), "Expected typed array", .{}, ctx, exception);
            return JSC.JSValue.jsUndefined().asObjectRef();
        };
        var slice = array_buffer.slice();
        if (slice.len > 0)
            std.crypto.random.bytes(slice);

        return arguments[0];
    }

    pub fn call(
        // this
        _: void,
        _: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.JSValue.jsUndefined().asObjectRef();
    }

    pub fn randomUUID(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        var uuid = UUID.init();
        var out: [128]u8 = undefined;
        var str = std.fmt.bufPrint(&out, "{s}", .{uuid}) catch unreachable;
        return JSC.ZigString.init(str).toValueGC(ctx.ptr()).asObjectRef();
    }
};
