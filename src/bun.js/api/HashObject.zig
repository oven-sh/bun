const HashObject = @This();

pub const wyhash = hashWrap(std.hash.Wyhash);
pub const adler32 = hashWrap(std.hash.Adler32);
/// Use hardware-accelerated CRC32 from zlib
pub const crc32 = hashWrap(struct {
    pub fn hash(seed: u32, bytes: []const u8) u32 {
        // zlib takes a 32-bit length, so chunk large inputs to avoid truncation.
        var crc: u64 = seed;
        var offset: usize = 0;
        while (offset < bytes.len) {
            const remaining = bytes.len - offset;
            const max_len: usize = std.math.maxInt(u32);
            const chunk_len: u32 = if (remaining > max_len) @intCast(max_len) else @intCast(remaining);
            crc = bun.zlib.crc32(crc, bytes.ptr + offset, chunk_len);
            offset += chunk_len;
        }
        return @intCast(crc);
    }
});
pub const cityHash32 = hashWrap(std.hash.CityHash32);
pub const cityHash64 = hashWrap(std.hash.CityHash64);
pub const xxHash32 = hashWrap(struct {
    pub fn hash(seed: u32, bytes: []const u8) u32 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        return std.hash.XxHash32.hash(seed, bytes);
    }
});
pub const xxHash64 = hashWrap(struct {
    pub fn hash(seed: u64, bytes: []const u8) u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        return std.hash.XxHash64.hash(seed, bytes);
    }
});
pub const xxHash3 = hashWrap(struct {
    pub fn hash(seed: u32, bytes: []const u8) u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        return std.hash.XxHash3.hash(seed, bytes);
    }
});
pub const murmur32v2 = hashWrap(std.hash.murmur.Murmur2_32);
pub const murmur32v3 = hashWrap(std.hash.murmur.Murmur3_32);
pub const murmur64v2 = hashWrap(std.hash.murmur.Murmur2_64);
pub const rapidhash = hashWrap(bun.deprecated.RapidHash);

pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const function = jsc.JSFunction.create(globalThis, "hash", wyhash, 1, .{});
    const fns = comptime .{
        "wyhash",
        "adler32",
        "crc32",
        "cityHash32",
        "cityHash64",
        "xxHash32",
        "xxHash64",
        "xxHash3",
        "murmur32v2",
        "murmur32v3",
        "murmur64v2",
        "rapidhash",
    };
    inline for (fns) |name| {
        const value = jsc.JSFunction.create(globalThis, name, @field(HashObject, name), 1, .{});
        function.put(globalThis, comptime ZigString.static(name), value);
    }

    return function;
}

fn hashWrap(comptime Hasher_: anytype) jsc.JSHostFnZig {
    return struct {
        const Hasher = Hasher_;
        pub fn hash(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(2).slice();
            var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
            defer args.deinit();

            var input: []const u8 = "";
            var input_slice = ZigString.Slice.empty;
            defer input_slice.deinit();
            if (args.nextEat()) |arg| {
                if (arg.as(jsc.WebCore.Blob)) |blob| {
                    // TODO: files
                    input = blob.sharedView();
                } else {
                    switch (arg.jsTypeLoose()) {
                        .ArrayBuffer,
                        .Int8Array,
                        .Uint8Array,
                        .Uint8ClampedArray,
                        .Int16Array,
                        .Uint16Array,
                        .Int32Array,
                        .Uint32Array,
                        .Float16Array,
                        .Float32Array,
                        .Float64Array,
                        .BigInt64Array,
                        .BigUint64Array,
                        .DataView,
                        => {
                            var array_buffer = arg.asArrayBuffer(globalThis) orelse {
                                return globalThis.throwInvalidArguments("ArrayBuffer conversion error", .{});
                            };
                            input = array_buffer.byteSlice();
                        },
                        else => {
                            input_slice = try arg.toSlice(globalThis, bun.default_allocator);
                            input = input_slice.slice();
                        },
                    }
                }
            }

            // std.hash has inconsistent interfaces
            //
            const Function = if (@hasDecl(Hasher, "hashWithSeed")) Hasher.hashWithSeed else Hasher.hash;
            var function_args: std.meta.ArgsTuple(@TypeOf(Function)) = undefined;
            if (comptime std.meta.fields(std.meta.ArgsTuple(@TypeOf(Function))).len == 1) {
                return jsc.JSValue.jsNumber(Function(input));
            } else {
                var seed: u64 = 0;
                if (args.nextEat()) |arg| {
                    if (arg.isNumber() or arg.isBigInt()) {
                        seed = arg.toUInt64NoTruncate();
                    }
                }
                if (comptime bun.trait.isNumber(@TypeOf(function_args[0]))) {
                    function_args[0] = @as(@TypeOf(function_args[0]), @truncate(seed));
                    function_args[1] = input;
                } else {
                    function_args[0] = input;
                    function_args[1] = @as(@TypeOf(function_args[1]), @truncate(seed));
                }

                const value = @call(.auto, Function, function_args);

                if (@TypeOf(value) == u32) {
                    return jsc.JSValue.jsNumber(@as(u32, @bitCast(value)));
                }
                return jsc.JSValue.fromUInt64NoTruncate(globalThis, value);
            }
        }
    }.hash;
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
