pub usingnamespace @import("./webcore/response.zig");
pub usingnamespace @import("./webcore/encoding.zig");
pub usingnamespace @import("./webcore/streams.zig");
pub usingnamespace @import("./webcore/blob.zig");
pub usingnamespace @import("./webcore/S3Stat.zig");
pub usingnamespace @import("./webcore/S3Client.zig");
pub usingnamespace @import("./webcore/request.zig");
pub usingnamespace @import("./webcore/body.zig");
pub const CookieMap = @import("./webcore/CookieMap.zig").CookieMap;
pub const ObjectURLRegistry = @import("./webcore/ObjectURLRegistry.zig");
const JSC = bun.JSC;
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
pub const AbortSignal = @import("./bindings/bindings.zig").AbortSignal;
pub const JSValue = @import("./bindings/bindings.zig").JSValue;
const Environment = bun.Environment;
const UUID7 = @import("./uuid.zig").UUID7;

pub const Lifetime = enum {
    clone,
    transfer,
    share,
    /// When reading from a fifo like STDIN/STDERR
    temporary,
};

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
fn alert(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
    if (has_message) {
        var state = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = state.get();
        const message = try arguments[0].toSlice(globalObject, allocator);
        defer message.deinit();

        if (message.len > 0) {
            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return.
                return .undefined;
            };
        }
    }

    output.writeAll(if (has_message) " [Enter] " else "Alert [Enter] ") catch {
        // 1. If we cannot show simple dialogs for this, then return.
        return .undefined;
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

    return .undefined;
}

fn confirm(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    if (has_message) {
        var state = std.heap.stackFallback(1024, bun.default_allocator);
        const allocator = state.get();
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        const message = try arguments[0].toSlice(globalObject, allocator);
        defer message.deinit();

        output.writeAll(message.slice()) catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return .false;
        };
    }

    // 4. Show message to the user, treating U+000A LF as a line break,
    //    and ask the user to respond with a positive or negative
    //    response.
    output.writeAll(if (has_message) " [y/N] " else "Confirm [y/N] ") catch {
        // 1. If we cannot show simple dialogs for this, then return false.
        return .false;
    };

    // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
    // *  Not relevant in a server context.
    bun.Output.flush();

    // 6. Pause until the user responds either positively or negatively.
    var stdin = std.io.getStdIn();
    const unbuffered_reader = stdin.reader();
    var buffered = std.io.bufferedReader(unbuffered_reader);
    var reader = buffered.reader();

    const first_byte = reader.readByte() catch {
        return .false;
    };

    // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
    //    the user responded positively or false otherwise.
    // *  Not relevant in a server context.

    switch (first_byte) {
        '\n' => return .false,
        '\r' => {
            const next_byte = reader.readByte() catch {
                // They may have said yes, but the stdin is invalid.
                return .false;
            };
            if (next_byte == '\n') {
                return .false;
            }
        },
        'y', 'Y' => {
            const next_byte = reader.readByte() catch {
                // They may have said yes, but the stdin is invalid.

                return .false;
            };

            if (next_byte == '\n') {
                // 8. If the user responded positively, return true;
                //    otherwise, the user responded negatively: return false.
                return .true;
            } else if (next_byte == '\r') {
                //Check Windows style
                const second_byte = reader.readByte() catch {
                    return .false;
                };
                if (second_byte == '\n') {
                    return .true;
                }
            }
        },
        else => {},
    }

    while (reader.readByte()) |b| {
        if (b == '\n' or b == '\r') break;
    } else |_| {}

    // 8. If the user responded positively, return true; otherwise, the user
    //    responded negatively: return false.
    return .false;
}

pub const Prompt = struct {
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

            const byte: u8 = try reader.readByte();

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
            const byte: u8 = try reader.readByte();

            if (byte == delimiter) {
                return;
            }

            try array_list.append(byte);
        }
    }

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
    pub fn call(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const arguments = callframe.arguments_old(3).slice();
        var state = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = state.get();
        var output = bun.Output.writer();
        const has_message = arguments.len != 0;
        const has_default = arguments.len >= 2;
        // 4. Set default to the result of optionally truncating default.
        // *  We don't really need to do this.
        const default = if (has_default) arguments[1] else .null;

        if (has_message) {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = try arguments[0].toSlice(globalObject, allocator);
            defer message.deinit();

            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return null.
                return .null;
            };
        }

        // 4. Set default to the result of optionally truncating default.

        // 5. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to either respond with a string value or
        //    abort. The response must be defaulted to the value given by
        //    default.
        output.writeAll(if (has_message) " " else "Prompt ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return .false;
        };

        if (has_default) {
            const default_string = try arguments[1].toSlice(globalObject, allocator);
            defer default_string.deinit();

            output.print("[{s}] ", .{default_string.slice()}) catch {
                // 1. If we cannot show simple dialogs for this, then return false.
                return .false;
            };
        }

        // 6. Invoke WebDriver BiDi user prompt opened with this, "prompt" and message.
        // *  Not relevant in a server context.
        bun.Output.flush();

        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.win32.updateStdioModeFlags(0, .{ .unset = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT }) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.windows.SetConsoleMode(bun.win32.STDIN_FD.cast(), mode);
            }
        };

        // 7. Pause while waiting for the user's response.
        const reader = bun.Output.buffered_stdin.reader();
        var second_byte: ?u8 = null;
        const first_byte = reader.readByte() catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return .null;
        };

        if (first_byte == '\n') {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return default;
        } else if (first_byte == '\r') {
            const second = reader.readByte() catch return .null;
            second_byte = second;
            if (second == '\n') return default;
        }

        var input = std.ArrayList(u8).initCapacity(allocator, 2048) catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return .null;
        };
        defer input.deinit();

        input.appendAssumeCapacity(first_byte);
        if (second_byte) |second| input.appendAssumeCapacity(second);

        // All of this code basically just first tries to load the input into a
        // buffer of size 2048. If that is too small, then increase the buffer
        // size to 4096. If that is too small, then just dynamically allocate
        // the rest.
        readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 2048) catch |e| {
            if (e != error.StreamTooLong) {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return .null;
            }

            input.ensureTotalCapacity(4096) catch {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return .null;
            };

            readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 4096) catch |e2| {
                if (e2 != error.StreamTooLong) {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return .null;
                }

                readUntilDelimiterArrayListInfinity(reader, &input, '\n') catch {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return .null;
                };
            };
        };

        if (input.items.len > 0 and input.items[input.items.len - 1] == '\r') {
            input.items.len -= 1;
        }

        if (comptime Environment.allow_assert) {
            bun.assert(input.items.len > 0);
            bun.assert(input.items[input.items.len - 1] != '\r');
        }

        // 8. Let result be null if the user aborts, or otherwise the string
        //    that the user responded with.
        var result = JSC.ZigString.init(input.items);
        result.markUTF8();

        // 9. Invoke WebDriver BiDi user prompt closed with this, false if
        //    result is null or true otherwise, and result.
        // *  Too complex for server context.

        // 9. Return result.
        return result.toJS(globalObject);
    }
};

pub const Crypto = struct {
    garbage: i32 = 0,
    const BoringSSL = bun.BoringSSL.c;

    fn throwInvalidParameter(globalThis: *JSC.JSGlobalObject) bun.JSError {
        return globalThis.ERR_CRYPTO_SCRYPT_INVALID_PARAMETER("Invalid scrypt parameters", .{}).throw();
    }

    fn throwInvalidParams(globalThis: *JSC.JSGlobalObject, comptime error_type: @Type(.enum_literal), comptime message: [:0]const u8, fmt: anytype) bun.JSError {
        if (error_type != .RangeError) @compileError("Error type not added!");
        BoringSSL.ERR_clear_error();
        return globalThis.ERR_CRYPTO_INVALID_SCRYPT_PARAMS(message, fmt).throw();
    }

    pub fn timingSafeEqual(_: *@This(), global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        return JSC.Node.Crypto.timingSafeEqual(global, callframe);
    }

    pub fn timingSafeEqualWithoutTypeChecks(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        array_a: *JSC.JSUint8Array,
        array_b: *JSC.JSUint8Array,
    ) JSC.JSValue {
        const a = array_a.slice();
        const b = array_b.slice();

        const len = a.len;
        if (b.len != len) {
            return globalThis.ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH("Input buffers must have the same byte length", .{}).throw();
        }

        return JSC.jsBoolean(bun.BoringSSL.c.CRYPTO_memcmp(a.ptr, b.ptr, len) == 0);
    }

    pub fn getRandomValues(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len == 0) {
            return globalThis.throwInvalidArguments("Expected typed array but got nothing", .{});
        }

        var array_buffer = arguments[0].asArrayBuffer(globalThis) orelse {
            return globalThis.throwInvalidArguments("Expected typed array but got {s}", .{@tagName(arguments[0].jsType())});
        };
        const slice = array_buffer.byteSlice();

        randomData(globalThis, slice.ptr, slice.len);

        return arguments[0];
    }

    pub fn getRandomValuesWithoutTypeChecks(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        array: *JSC.JSUint8Array,
    ) JSC.JSValue {
        const slice = array.slice();
        randomData(globalThis, slice.ptr, slice.len);
        return @as(JSC.JSValue, @enumFromInt(@as(i64, @bitCast(@intFromPtr(array)))));
    }

    fn randomData(
        globalThis: *JSC.JSGlobalObject,
        ptr: [*]u8,
        len: usize,
    ) void {
        const slice = ptr[0..len];

        switch (slice.len) {
            0 => {},
            // 512 bytes or less we reuse from the same cache as UUID generation.
            1...JSC.RareData.EntropyCache.size / 8 => {
                bun.copy(u8, slice, globalThis.bunVM().rareData().entropySlice(slice.len));
            },
            else => {
                bun.csprng(slice);
            },
        }
    }

    pub fn randomUUID(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        var str, var bytes = bun.String.createUninitialized(.latin1, 36);

        const uuid = globalThis.bunVM().rareData().nextUUID();

        uuid.print(bytes[0..36]);
        return str.transferToJS(globalThis);
    }

    comptime {
        const Bun__randomUUIDv7 = JSC.toJSHostFunction(Bun__randomUUIDv7_);
        @export(&Bun__randomUUIDv7, .{ .name = "Bun__randomUUIDv7" });
    }
    pub fn Bun__randomUUIDv7_(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.argumentsUndef(2).slice();

        var encoding_value: JSC.JSValue = .undefined;

        const encoding: JSC.Node.Encoding = brk: {
            if (arguments.len > 0) {
                if (arguments[0] != .undefined) {
                    if (arguments[0].isString()) {
                        encoding_value = arguments[0];
                        break :brk try JSC.Node.Encoding.fromJS(encoding_value, globalThis) orelse {
                            return globalThis.ERR_UNKNOWN_ENCODING("Encoding must be one of base64, base64url, hex, or buffer", .{}).throw();
                        };
                    }
                }
            }

            break :brk JSC.Node.Encoding.hex;
        };

        const timestamp: u64 = brk: {
            const timestamp_value: JSC.JSValue = if (encoding_value != .undefined and arguments.len > 1)
                arguments[1]
            else if (arguments.len == 1 and encoding_value == .undefined)
                arguments[0]
            else
                .undefined;

            if (timestamp_value != .undefined) {
                if (timestamp_value.isDate()) {
                    const date = timestamp_value.getUnixTimestamp();
                    break :brk @intFromFloat(@max(0, date));
                }
                break :brk @intCast(try globalThis.validateIntegerRange(timestamp_value, i64, 0, .{ .min = 0, .field_name = "timestamp" }));
            }

            break :brk @intCast(@max(0, std.time.milliTimestamp()));
        };

        const entropy = globalThis.bunVM().rareData().entropySlice(8);

        const uuid = UUID7.init(timestamp, &entropy[0..8].*);

        if (encoding == .hex) {
            var str, var bytes = bun.String.createUninitialized(.latin1, 36);
            uuid.print(bytes[0..36]);
            return str.transferToJS(globalThis);
        }

        return encoding.encodeWithMaxSize(globalThis, 32, &uuid.bytes);
    }

    pub fn randomUUIDWithoutTypeChecks(
        _: *Crypto,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        const str, var bytes = bun.String.createUninitialized(.latin1, 36);
        defer str.deref();

        // randomUUID must have been called already many times before this kicks
        // in so we can skip the rare_data pointer check.
        const uuid = globalThis.bunVM().rare_data.?.nextUUID();

        uuid.print(bytes[0..36]);
        return str.toJS(globalThis);
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*Crypto {
        return JSC.Error.ERR_ILLEGAL_CONSTRUCTOR.throw(globalThis, "Crypto is not constructable", .{});
    }

    pub export fn CryptoObject__create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        var ptr = bun.default_allocator.create(Crypto) catch {
            return globalThis.throwOutOfMemoryValue();
        };

        return ptr.toJS(globalThis);
    }

    pub usingnamespace JSC.Codegen.JSCrypto;

    comptime {
        _ = CryptoObject__create;
    }
};

comptime {
    const js_alert = JSC.toJSHostFunction(alert);
    @export(&js_alert, .{ .name = "WebCore__alert" });
    const js_prompt = JSC.toJSHostFunction(Prompt.call);
    @export(&js_prompt, .{ .name = "WebCore__prompt" });
    const js_confirm = JSC.toJSHostFunction(confirm);
    @export(&js_confirm, .{ .name = "WebCore__confirm" });
}
