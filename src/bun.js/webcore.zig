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
        var output = bun.Output.writer();
        const has_message = arguments.len != 0;

        // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
        if (has_message) {
            const allocator = std.heap.stackFallback(2048, bun.default_allocator).get();
            const message = arguments[0].?.value().toSlice(ctx.ptr(), allocator);
            defer message.deinit();

            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return.
                return JSC.JSValue.jsUndefined().asObjectRef();
            };
        }

        output.writeAll(if (has_message) " [Enter] " else "Alert [Enter] ") catch {
            // 1. If we cannot show simple dialogs for this, then return.
            return JSC.JSValue.jsUndefined().asObjectRef();
        };

        // 6. Invoke WebDriver BiDi user prompt opened with this, "alert", and message.
        // *  Not pertinent to use their complex system in a server context.
        bun.Output.flush();

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
        var output = bun.Output.writer();
        const has_message = arguments.len != 0;

        if (has_message) {
            const allocator = std.heap.stackFallback(1024, bun.default_allocator).get();
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = arguments[0].?.value().toSlice(ctx.ptr(), allocator);
            defer message.deinit();

            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return false.
                return JSC.JSValue.jsBoolean(false).asObjectRef();
            };
        }

        // 4. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to respond with a positive or negative
        //    response.
        output.writeAll(if (has_message) " [y/N] " else "Confirm [y/N] ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return JSC.JSValue.jsBoolean(false).asObjectRef();
        };

        // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
        // *  Not relevant in a server context.
        bun.Output.flush();

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
            'y', 'Y' => {
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

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to only append
    /// and assume capacity.
    pub fn readUntilDelimiterArrayListAppendAssumeCapacity(
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

            array_list.appendAssumeCapacity(byte);
        }
    }

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to always append
    /// and not resize.
    fn readUntilDelimiterArrayListInfinity(
        reader: anytype,
        array_list: *std.ArrayList(u8),
        delimiter: u8,
    ) !void {
        while (true) {
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
        var allocator = std.heap.stackFallback(2048, bun.default_allocator).get();
        var output = bun.Output.writer();
        const has_message = arguments.len != 0;
        const has_default = arguments.len >= 2;
        // 4. Set default to the result of optionally truncating default.
        // *  We don't really need to do this.
        const default = if (has_default) arguments[1] else JSC.JSValue.jsNull().asObjectRef();

        if (has_message) {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = arguments[0].?.value().toSlice(ctx.ptr(), allocator);
            defer message.deinit();

            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return null.
                return JSC.JSValue.jsNull().asObjectRef();
            };
        }

        // 4. Set default to the result of optionally truncating default.

        // 5. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to either respond with a string value or
        //    abort. The response must be defaulted to the value given by
        //    default.
        output.writeAll(if (has_message) " " else "Prompt ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return JSC.JSValue.jsBoolean(false).asObjectRef();
        };

        if (has_default) {
            const default_string = arguments[1].?.value().toSlice(ctx.ptr(), allocator);
            defer default_string.deinit();

            output.print("[{s}] ", .{default_string.slice()}) catch {
                // 1. If we cannot show simple dialogs for this, then return false.
                return JSC.JSValue.jsBoolean(false).asObjectRef();
            };
        }

        // 6. Invoke WebDriver BiDi user prompt opened with this, "prompt" and message.
        // *  Not relevant in a server context.
        bun.Output.flush();

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

        var input = std.ArrayList(u8).initCapacity(allocator, 2048) catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return JSC.JSValue.jsNull().asObjectRef();
        };
        defer input.deinit();

        input.appendAssumeCapacity(first_byte);

        // All of this code basically just first tries to load the input into a
        // buffer of size 2048. If that is too small, then increase the buffer
        // size to 4096. If that is too small, then just dynamically allocate
        // the rest.
        readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 2048) catch |e| {
            if (e != error.StreamTooLong) {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return JSC.JSValue.jsNull().asObjectRef();
            }

            input.ensureTotalCapacity(4096) catch {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return JSC.JSValue.jsNull().asObjectRef();
            };

            readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 4096) catch |e2| {
                if (e2 != error.StreamTooLong) {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return JSC.JSValue.jsNull().asObjectRef();
                }

                readUntilDelimiterArrayListInfinity(reader, &input, '\n') catch {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return JSC.JSValue.jsNull().asObjectRef();
                };
            };
        };

        // 8. Let result be null if the user aborts, or otherwise the string
        //    that the user responded with.
        var result = JSC.ZigString.init(input.items);
        result.markUTF8();

        // 9. Invoke WebDriver BiDi user prompt closed with this, false if
        //    result is null or true otherwise, and result.
        // *  Too complex for server context.

        // 9. Return result.
        return result.toValueGC(ctx.ptr()).asObjectRef();
    }
};

pub const Crypto = struct {
    const UUID = @import("./uuid.zig");
    const BoringSSL = @import("boringssl");
    pub const Class = JSC.NewClass(
        void,
        .{ .name = "crypto" },
        .{
            .getRandomValues = JSC.DOMCall("Crypto", @This(), "getRandomValues", JSC.JSValue, JSC.DOMEffect.top),
            .randomUUID = JSC.DOMCall("Crypto", @This(), "randomUUID", *JSC.JSString, JSC.DOMEffect.top),
        },
        .{},
    );
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
        globalThis: *JSC.JSGlobalObject,
        _: JSC.JSValue,
        arguments: []const JSC.JSValue,
    ) JSC.JSValue {
        if (arguments.len == 0) {
            globalThis.throwInvalidArguments("Expected typed array but got nothing", .{});
            return JSC.JSValue.jsUndefined();
        }

        var array_buffer = arguments[0].asArrayBuffer(globalThis) orelse {
            globalThis.throwInvalidArguments("Expected typed array but got {s}", .{@tagName(arguments[0].jsType())});
            return JSC.JSValue.jsUndefined();
        };
        var slice = array_buffer.byteSlice();

        randomData(globalThis, slice.ptr, slice.len);

        return arguments[0];
    }

    pub fn getRandomValuesWithoutTypeChecks(
        globalThis: *JSC.JSGlobalObject,
        _: *anyopaque,
        array: *JSC.JSUint8Array,
    ) callconv(.C) JSC.JSValue {
        var slice = array.slice();
        randomData(globalThis, slice.ptr, slice.len);
        return @intToEnum(JSC.JSValue, @bitCast(i64, @ptrToInt(array)));
    }

    fn randomData(
        globalThis: *JSC.JSGlobalObject,
        ptr: [*]u8,
        len: usize,
    ) void {
        var slice = ptr[0..len];

        switch (slice.len) {
            0 => {},
            // 512 bytes or less we reuse from the same cache as UUID generation.
            1...JSC.RareData.EntropyCache.size / 8 => {
                std.mem.copy(u8, slice, globalThis.bunVM().rareData().entropySlice(slice.len));
            },
            else => {
                bun.rand(slice);
            },
        }
    }

    pub fn randomUUID(
        globalThis: *JSC.JSGlobalObject,
        _: JSC.JSValue,
        _: []const JSC.JSValue,
    ) JSC.JSValue {
        var out: [36]u8 = undefined;
        const uuid: UUID = .{
            .bytes = globalThis.bunVM().rareData().nextUUID(),
        };
        uuid.print(&out);
        return JSC.ZigString.init(&out).toValueGC(globalThis);
    }

    pub fn randomUUIDWithoutTypeChecks(
        globalThis: *JSC.JSGlobalObject,
        _: *anyopaque,
    ) callconv(.C) JSC.JSValue {
        var out: [36]u8 = undefined;
        const uuid: UUID = .{
            .bytes = globalThis.bunVM().rareData().nextUUID(),
        };
        uuid.print(&out);
        return JSC.ZigString.init(&out).toValueGC(globalThis);
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
};
