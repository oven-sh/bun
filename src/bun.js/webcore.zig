pub usingnamespace @import("./webcore/response.zig");
pub usingnamespace @import("./webcore/encoding.zig");
pub usingnamespace @import("./webcore/streams.zig");
pub usingnamespace @import("./webcore/blob.zig");
pub usingnamespace @import("./webcore/request.zig");
pub usingnamespace @import("./webcore/body.zig");
pub const ObjectURLRegistry = @import("./webcore/ObjectURLRegistry.zig");
const JSC = bun.JSC;
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
pub const AbortSignal = @import("./bindings/bindings.zig").AbortSignal;
pub const JSValue = @import("./bindings/bindings.zig").JSValue;
const Environment = bun.Environment;

pub const Lifetime = enum {
    clone,
    transfer,
    share,
    /// When reading from a fifo like STDIN/STDERR
    temporary,
};

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
fn alert(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
    if (has_message) {
        var state = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = state.get();
        const message = arguments[0].toSlice(globalObject, allocator);
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

fn confirm(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    if (has_message) {
        var state = std.heap.stackFallback(1024, bun.default_allocator);
        const allocator = state.get();
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        const message = arguments[0].toSlice(globalObject, allocator);
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
    ) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(3).slice();
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
            const message = arguments[0].toSlice(globalObject, allocator);
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
            const default_string = arguments[1].toSlice(globalObject, allocator);
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
            bun.win32.unsetStdioModeFlags(0, bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT) catch null
        else {};

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
    const BoringSSL = bun.BoringSSL;

    pub const doScryptSync = JSC.wrapInstanceMethod(Crypto, "scryptSync", false);

    pub fn scryptSync(
        globalThis: *JSC.JSGlobalObject,
        password: JSC.Node.StringOrBuffer,
        salt: JSC.Node.StringOrBuffer,
        keylen_value: JSC.JSValue,
        options: ?JSC.JSValue,
    ) JSC.JSValue {
        const password_string = password.slice();
        const salt_string = salt.slice();

        if (keylen_value.isEmptyOrUndefinedOrNull() or !keylen_value.isAnyInt()) {
            const err = globalThis.createInvalidArgs("keylen must be an integer", .{});
            globalThis.throwValue(err);
            return .zero;
        }

        const keylen_int = keylen_value.to(i64);
        if (keylen_int < 0) {
            globalThis.throwValue(globalThis.createRangeError("keylen must be a positive integer", .{}));
            return .zero;
        } else if (keylen_int > 0x7fffffff) {
            globalThis.throwValue(globalThis.createRangeError("keylen must be less than 2^31", .{}));
            return .zero;
        }

        var blockSize: ?usize = null;
        var cost: ?usize = null;
        var parallelization: ?usize = null;
        var maxmem: usize = 32 * 1024 * 1024;
        const keylen = @as(u32, @intCast(@as(i33, @truncate(keylen_int))));

        if (options) |options_value| outer: {
            if (options_value.isUndefined() or options_value == .zero)
                break :outer;

            if (!options_value.isObject()) {
                globalThis.throwValue(globalThis.createInvalidArgs("options must be an object", .{}));
                return .zero;
            }

            if (options_value.getTruthy(globalThis, "cost") orelse options_value.get(globalThis, "N")) |N_value| {
                if (cost != null) return throwInvalidParameter(globalThis);
                const N_int = N_value.to(i64);
                if (N_int < 0 or !N_value.isNumber()) {
                    return throwInvalidParams(
                        globalThis,
                        .RangeError,
                        "Invalid scrypt params\n\n N must be a positive integer\n",
                        .{},
                    );
                } else if (N_int != 0) {
                    cost = @as(usize, @intCast(N_int));
                }
            }

            if (options_value.getTruthy(globalThis, "blockSize") orelse options_value.get(globalThis, "r")) |r_value| {
                if (blockSize != null) return throwInvalidParameter(globalThis);
                const r_int = r_value.to(i64);
                if (r_int < 0 or !r_value.isNumber()) {
                    return throwInvalidParams(
                        globalThis,
                        .RangeError,
                        "Invalid scrypt params\n\n r must be a positive integer\n",
                        .{},
                    );
                } else if (r_int != 0) {
                    blockSize = @as(usize, @intCast(r_int));
                }
            }

            if (options_value.getTruthy(globalThis, "parallelization") orelse options_value.get(globalThis, "p")) |p_value| {
                if (parallelization != null) return throwInvalidParameter(globalThis);
                const p_int = p_value.to(i64);
                if (p_int < 0 or !p_value.isNumber()) {
                    return throwInvalidParams(
                        globalThis,
                        .RangeError,
                        "Invalid scrypt params\n\n p must be a positive integer\n",
                        .{},
                    );
                } else if (p_int != 0) {
                    parallelization = @as(usize, @intCast(p_int));
                }
            }

            if (options_value.getTruthy(globalThis, "maxmem")) |value| {
                const p_int = value.to(i64);
                if (p_int < 0 or !value.isNumber()) {
                    return throwInvalidParams(
                        globalThis,
                        .RangeError,
                        "Invalid scrypt params\n\n N must be a positive integer\n",
                        .{},
                    );
                } else if (p_int != 0) {
                    maxmem = @as(usize, @intCast(p_int));
                }
            }
        }

        if (blockSize == null) blockSize = 8;
        if (cost == null) cost = 16384;
        if (parallelization == null) parallelization = 1;

        if (cost.? < 2 or cost.? > 0x3fffffff) {
            return throwInvalidParams(
                globalThis,
                .RangeError,
                "Invalid scrypt params\n\n N must be greater than 1 and less than 2^30\n",
                .{},
            );
        }

        if (cost.? == 0 or (cost.? & (cost.? - 1)) != 0) {
            return throwInvalidParams(
                globalThis,
                .RangeError,
                "Invalid scrypt params\n\n N must be a power of 2 greater than 1\n",
                .{},
            );
        }

        if (keylen == 0) {
            if ((BoringSSL.EVP_PBE_scrypt(
                null,
                0,
                null,
                0,
                cost.?,
                blockSize.?,
                parallelization.?,
                maxmem,
                null,
                0,
            ) != 1)) {
                return throwInvalidParams(globalThis, .RangeError, "Invalid scrypt params\n", .{});
            }

            return JSC.ArrayBuffer.createEmpty(globalThis, .ArrayBuffer);
        }

        var stackbuf: [1024]u8 = undefined;
        var buf: []u8 = &stackbuf;
        var needs_deinit = false;
        defer if (needs_deinit) globalThis.allocator().free(buf);
        if (keylen > buf.len) {
            // i don't think its a real scenario, but just in case
            buf = globalThis.allocator().alloc(u8, keylen) catch {
                globalThis.throw("Failed to allocate memory", .{});
                return .undefined;
            };
            needs_deinit = true;
        } else {
            buf.len = keylen;
        }

        if (BoringSSL.EVP_PBE_scrypt(
            password_string.ptr,
            password_string.len,
            salt_string.ptr,
            salt_string.len,
            cost.?,
            blockSize.?,
            parallelization.?,
            maxmem,
            buf.ptr,
            keylen,
        ) != 1) {
            return throwInvalidParams(globalThis, .RangeError, "Invalid scrypt params\n", .{});
        }

        return JSC.ArrayBuffer.create(globalThis, buf, .ArrayBuffer);
    }

    fn throwInvalidParameter(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        globalThis.ERR_CRYPTO_SCRYPT_INVALID_PARAMETER("Invalid scrypt parameters", .{}).throw();
        return .zero;
    }

    fn throwInvalidParams(globalThis: *JSC.JSGlobalObject, comptime error_type: @Type(.EnumLiteral), comptime message: [:0]const u8, fmt: anytype) JSC.JSValue {
        if (error_type != .RangeError) @compileError("Error type not added!");
        globalThis.ERR_CRYPTO_INVALID_SCRYPT_PARAMS(message, fmt).throw();
        BoringSSL.ERR_clear_error();
        return .zero;
    }

    pub fn timingSafeEqual(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();

        if (arguments.len < 2) {
            globalThis.throwInvalidArguments("Expected 2 typed arrays but got nothing", .{});
            return .undefined;
        }

        const array_buffer_a = arguments[0].asArrayBuffer(globalThis) orelse {
            globalThis.throwInvalidArguments("Expected typed array but got {s}", .{@tagName(arguments[0].jsType())});
            return .undefined;
        };
        const a = array_buffer_a.byteSlice();

        const array_buffer_b = arguments[1].asArrayBuffer(globalThis) orelse {
            globalThis.throwInvalidArguments("Expected typed array but got {s}", .{@tagName(arguments[1].jsType())});
            return .undefined;
        };
        const b = array_buffer_b.byteSlice();

        const len = a.len;
        if (b.len != len) {
            globalThis.throw("Input buffers must have the same byte length", .{});
            return .undefined;
        }
        return JSC.jsBoolean(len == 0 or bun.BoringSSL.CRYPTO_memcmp(a.ptr, b.ptr, len) == 0);
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
            globalThis.throw("Input buffers must have the same byte length", .{});
            return .zero;
        }

        return JSC.jsBoolean(len == 0 or bun.BoringSSL.CRYPTO_memcmp(a.ptr, b.ptr, len) == 0);
    }

    pub fn getRandomValues(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments = callframe.arguments(1).slice();
        if (arguments.len == 0) {
            globalThis.throwInvalidArguments("Expected typed array but got nothing", .{});
            return .undefined;
        }

        var array_buffer = arguments[0].asArrayBuffer(globalThis) orelse {
            globalThis.throwInvalidArguments("Expected typed array but got {s}", .{@tagName(arguments[0].jsType())});
            return .undefined;
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
                bun.rand(slice);
            },
        }
    }

    pub fn randomUUID(
        _: *@This(),
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) JSC.JSValue {
        const str, var bytes = bun.String.createUninitialized(.latin1, 36);
        defer str.deref();

        const uuid = globalThis.bunVM().rareData().nextUUID();

        uuid.print(bytes[0..36]);
        return str.toJS(globalThis);
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

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) ?*Crypto {
        globalThis.throw("Crypto is not constructable", .{});
        return null;
    }

    pub export fn CryptoObject__create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        var ptr = bun.default_allocator.create(Crypto) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

        return ptr.toJS(globalThis);
    }

    pub usingnamespace JSC.Codegen.JSCrypto;

    comptime {
        if (!JSC.is_bindgen) {
            _ = CryptoObject__create;
        }
    }
};

comptime {
    if (!JSC.is_bindgen) {
        @export(alert, .{ .name = "WebCore__alert" });
        @export(Prompt.call, .{ .name = "WebCore__prompt" });
        @export(confirm, .{ .name = "WebCore__confirm" });
    }
}
