const std = @import("std");
const _global = @import("../../../global.zig");
const strings = _global.strings;
const string = _global.string;
const AsyncIO = @import("io");
const JSC = @import("../../../jsc.zig");
const PathString = JSC.PathString;
const Environment = _global.Environment;
const C = _global.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
const Buffer = JSC.ArrayBuffer;

const JSGlobalObject = JSC.JSGlobalObject;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;

const BufferStaticFunctionEnum = JSC.Node.DeclEnum(BufferStatic);

fn BufferStatic_wrap(comptime FunctionEnum: BufferStaticFunctionEnum) NodeFSFunction {
    const Function = @field(BufferStatic, @tagName(BufferStaticFunctionEnum));
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.TypeInfo.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.args.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.args[1].arg_type.?;
    const FormattedName = comptime [1]u8{std.ascii.toUpper(@tagName(BufferStaticFunctionEnum)[0])} ++ @tagName(BufferStaticFunctionEnum)[1..];
    const Result = JSC.JSValue;

    const NodeBindingClosure = struct {
        pub fn bind(
            _: void,
            ctx: JSC.C.JSContextRef,
            _: JSC.C.JSObjectRef,
            _: JSC.C.JSObjectRef,
            arguments: []const JSC.C.JSValueRef,
            exception: JSC.C.ExceptionRef,
        ) JSC.C.JSValueRef {
            var slice = ArgumentsSlice.init(@ptrCast([*]const JSC.JSValue, arguments.ptr)[0..arguments.len]);

            defer {
                // TODO: fix this
                for (arguments) |arg| {
                    JSC.C.JSValueUnprotect(ctx, arg);
                }
                slice.arena.deinit();
            }

            const args = if (comptime Arguments != void)
                (Arguments.fromJS(ctx, &slice, exception) orelse return null)
            else
                Arguments{};
            if (exception.* != null) return null;

            const result: Result = Function(
                ctx.ptr(),
                args,
                exception,
            );
            if (exception.* != null) {
                return null;
            }

            return result.asObjectRef();
        }
    };

    return NodeBindingClosure.bind;
}

pub const BufferStatic = struct {
    pub const Arguments = struct {
        pub const Alloc = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Alloc {}
        };
        pub const AllocUnsafe = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?AllocUnsafe {}
        };
        pub const AllocUnsafeSlow = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?AllocUnsafeSlow {}
        };
        pub const Compare = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Compare {}
        };
        pub const Concat = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Concat {}
        };
        pub const IsEncoding = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?IsEncoding {}
        };
    };
    pub fn alloc(globalThis: *JSGlobalObject, args: Arguments.Alloc, exception: JSC.C.ExceptionRef) JSC.JSValue {}
    pub fn allocUnsafe(globalThis: *JSGlobalObject, args: Arguments.AllocUnsafe, exception: JSC.C.ExceptionRef) JSC.JSValue {}
    pub fn allocUnsafeSlow(globalThis: *JSGlobalObject, args: Arguments.AllocUnsafeSlow, exception: JSC.C.ExceptionRef) JSC.JSValue {}
    pub fn compare(globalThis: *JSGlobalObject, args: Arguments.Compare, exception: JSC.C.ExceptionRef) JSC.JSValue {}
    pub fn concat(globalThis: *JSGlobalObject, args: Arguments.Concat, exception: JSC.C.ExceptionRef) JSC.JSValue {}
    pub fn isEncoding(globalThis: *JSGlobalObject, args: Arguments.IsEncoding, exception: JSC.C.ExceptionRef) JSC.JSValue {}

    pub const Class = JSC.NewClass(
        void,
        .{ .name = "Buffer" },
        .{
            .alloc = .{ .name = "alloc", .rfn = BufferStatic_wrap(.alloc) },
            .allocUnsafe = .{ .name = "allocUnsafe", .rfn = BufferStatic_wrap(.allocUnsafe) },
            .allocUnsafeSlow = .{ .name = "allocUnsafeSlow", .rfn = BufferStatic_wrap(.allocUnsafeSlow) },
            .compare = .{ .name = "compare", .rfn = BufferStatic_wrap(.compare) },
            .concat = .{ .name = "concat", .rfn = BufferStatic_wrap(.concat) },
            .isEncoding = .{ .name = "isEncoding", .rfn = BufferStatic_wrap(.isEncoding) },
        },
        .{ ._poolSize = .{ .name = "_poolSize", .get = .{ .name = "get", .rfn = BufferStatic.getPoolSize }, .set = .{ .name = "set", .rfn = BufferStatic.setPoolSize } } },
    );
};

pub const BufferPrototype = struct {
    const Arguments = struct {
        pub const Compare = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Compare {
                return null;
            }
        };
        pub const Copy = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Copy {
                return null;
            }
        };
        pub const Equals = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Equals {
                return null;
            }
        };
        pub const Fill = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fill {
                return null;
            }
        };
        pub const Includes = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Includes {
                return null;
            }
        };
        pub const IndexOf = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?IndexOf {
                return null;
            }
        };
        pub const LastIndexOf = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?LastIndexOf {
                return null;
            }
        };
        pub const Swap16 = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Swap16 {
                return null;
            }
        };
        pub const Swap32 = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Swap32 {
                return null;
            }
        };
        pub const Swap64 = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Swap64 {
                return null;
            }
        };
        pub const Write = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Write {
                return null;
            }
        };
        pub const Read = struct {
            pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Read {
                return null;
            }
        };

        pub fn WriteInt(comptime kind: Int) type {
            return struct {
                const This = @This();
                const Value = Int.native.get(kind);
            };
        }
        pub fn ReadInt(comptime kind: Int) type {
            return struct {
                const This = @This();
                const Value = Int.native.get(kind);
            };
        }
    };
    pub fn compare(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Compare) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn copy(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Copy) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn equals(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Equals) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn fill(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Fill) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn includes(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Includes) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn indexOf(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.IndexOf) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn lastIndexOf(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.LastIndexOf) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn swap16(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Swap16) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn swap32(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Swap32) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn swap64(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Swap64) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn write(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Write) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }
    pub fn read(this: *Buffer, globalThis: *JSC.JSGlobalObject, args: Arguments.Read) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = args;
        return JSC.JSValue.jsUndefined();
    }

    fn writeIntAny(this: *Buffer, comptime kind: Int, args: Arguments.WriteInt(kind)) JSC.JSValue {}
    fn readIntAny(this: *Buffer, comptime kind: Int, args: Arguments.ReadInt(kind)) JSC.JSValue {}

    pub const Class = JSC.NewClass(
        void,
        .{ .name = "Buffer" },
        .{
            .compare = .{
                .name = "compare",
                .rfn = wrap(BufferPrototype.compare),
            },
            .copy = .{
                .name = "copy",
                .rfn = wrap(BufferPrototype.copy),
            },
            .equals = .{
                .name = "equals",
                .rfn = wrap(BufferPrototype.equals),
            },
            .fill = .{
                .name = "fill",
                .rfn = wrap(BufferPrototype.fill),
            },
            .includes = .{
                .name = "includes",
                .rfn = wrap(BufferPrototype.includes),
            },
            .indexOf = .{
                .name = "indexOf",
                .rfn = wrap(BufferPrototype.indexOf),
            },
            .lastIndexOf = .{
                .name = "lastIndexOf",
                .rfn = wrap(BufferPrototype.lastIndexOf),
            },
            .swap16 = .{
                .name = "swap16",
                .rfn = wrap(BufferPrototype.swap16),
            },
            .swap32 = .{
                .name = "swap32",
                .rfn = wrap(BufferPrototype.swap32),
            },
            .swap64 = .{
                .name = "swap64",
                .rfn = wrap(BufferPrototype.swap64),
            },
            .write = .{
                .name = "write",
                .rfn = wrap(BufferPrototype.write),
            },
            .read = .{
                .name = "read",
                .rfn = wrap(BufferPrototype.read),
            },

            // -- Write --
            .writeBigInt64BE = .{
                .name = "writeBigInt64BE",
                .rfn = writeWrap(Int.BigInt64BE),
            },
            .writeBigInt64LE = .{
                .name = "writeBigInt64LE",
                .rfn = writeWrap(Int.BigInt64LE),
            },
            .writeBigUInt64BE = .{
                .name = "writeBigUInt64BE",
                .rfn = writeWrap(Int.BigUInt64BE),
            },
            .writeBigUInt64LE = .{
                .name = "writeBigUInt64LE",
                .rfn = writeWrap(Int.BigUInt64LE),
            },
            .writeDoubleBE = .{
                .name = "writeDoubleBE",
                .rfn = writeWrap(Int.DoubleBE),
            },
            .writeDoubleLE = .{
                .name = "writeDoubleLE",
                .rfn = writeWrap(Int.DoubleLE),
            },
            .writeFloatBE = .{
                .name = "writeFloatBE",
                .rfn = writeWrap(Int.FloatBE),
            },
            .writeFloatLE = .{
                .name = "writeFloatLE",
                .rfn = writeWrap(Int.FloatLE),
            },
            .writeInt8 = .{
                .name = "writeInt8",
                .rfn = writeWrap(Int.Int8),
            },
            .writeInt16BE = .{
                .name = "writeInt16BE",
                .rfn = writeWrap(Int.Int16BE),
            },
            .writeInt16LE = .{
                .name = "writeInt16LE",
                .rfn = writeWrap(Int.Int16LE),
            },
            .writeInt32BE = .{
                .name = "writeInt32BE",
                .rfn = writeWrap(Int.Int32BE),
            },
            .writeInt32LE = .{
                .name = "writeInt32LE",
                .rfn = writeWrap(Int.Int32LE),
            },
            .writeIntBE = .{
                .name = "writeIntBE",
                .rfn = writeWrap(Int.IntBE),
            },
            .writeIntLE = .{
                .name = "writeIntLE",
                .rfn = writeWrap(Int.IntLE),
            },
            .writeUInt8 = .{
                .name = "writeUInt8",
                .rfn = writeWrap(Int.UInt8),
            },
            .writeUInt16BE = .{
                .name = "writeUInt16BE",
                .rfn = writeWrap(Int.UInt16BE),
            },
            .writeUInt16LE = .{
                .name = "writeUInt16LE",
                .rfn = writeWrap(Int.UInt16LE),
            },
            .writeUInt32BE = .{
                .name = "writeUInt32BE",
                .rfn = writeWrap(Int.UInt32BE),
            },
            .writeUInt32LE = .{
                .name = "writeUInt32LE",
                .rfn = writeWrap(Int.UInt32LE),
            },
            .writeUIntBE = .{
                .name = "writeUIntBE",
                .rfn = writeWrap(Int.UIntBE),
            },
            .writeUIntLE = .{
                .name = "writeUIntLE",
                .rfn = writeWrap(Int.UIntLE),
            },

            // -- Read --
            .readBigInt64BE = .{
                .name = "readBigInt64BE",
                .rfn = readWrap(Int.BigInt64BE),
            },
            .readBigInt64LE = .{
                .name = "readBigInt64LE",
                .rfn = readWrap(Int.BigInt64LE),
            },
            .readBigUInt64BE = .{
                .name = "readBigUInt64BE",
                .rfn = readWrap(Int.BigUInt64BE),
            },
            .readBigUInt64LE = .{
                .name = "readBigUInt64LE",
                .rfn = readWrap(Int.BigUInt64LE),
            },
            .readDoubleBE = .{
                .name = "readDoubleBE",
                .rfn = readWrap(Int.DoubleBE),
            },
            .readDoubleLE = .{
                .name = "readDoubleLE",
                .rfn = readWrap(Int.DoubleLE),
            },
            .readFloatBE = .{
                .name = "readFloatBE",
                .rfn = readWrap(Int.FloatBE),
            },
            .readFloatLE = .{
                .name = "readFloatLE",
                .rfn = readWrap(Int.FloatLE),
            },
            .readInt8 = .{
                .name = "readInt8",
                .rfn = readWrap(Int.Int8),
            },
            .readInt16BE = .{
                .name = "readInt16BE",
                .rfn = readWrap(Int.Int16BE),
            },
            .readInt16LE = .{
                .name = "readInt16LE",
                .rfn = readWrap(Int.Int16LE),
            },
            .readInt32BE = .{
                .name = "readInt32BE",
                .rfn = readWrap(Int.Int32BE),
            },
            .readInt32LE = .{
                .name = "readInt32LE",
                .rfn = readWrap(Int.Int32LE),
            },
            .readIntBE = .{
                .name = "readIntBE",
                .rfn = readWrap(Int.IntBE),
            },
            .readIntLE = .{
                .name = "readIntLE",
                .rfn = readWrap(Int.IntLE),
            },
            .readUInt8 = .{
                .name = "readUInt8",
                .rfn = readWrap(Int.UInt8),
            },
            .readUInt16BE = .{
                .name = "readUInt16BE",
                .rfn = readWrap(Int.UInt16BE),
            },
            .readUInt16LE = .{
                .name = "readUInt16LE",
                .rfn = readWrap(Int.UInt16LE),
            },
            .readUInt32BE = .{
                .name = "readUInt32BE",
                .rfn = readWrap(Int.UInt32BE),
            },
            .readUInt32LE = .{
                .name = "readUInt32LE",
                .rfn = readWrap(Int.UInt32LE),
            },
            .readUIntBE = .{
                .name = "readUIntBE",
                .rfn = readWrap(Int.UIntBE),
            },
            .readUIntLE = .{
                .name = "readUIntLE",
                .rfn = readWrap(Int.UIntLE),
            },
        },
        .{},
    );
};

const Int = enum {
    BigInt64BE,
    BigInt64LE,
    BigUInt64BE,
    BigUInt64LE,
    DoubleBE,
    DoubleLE,
    FloatBE,
    FloatLE,
    Int8,
    Int16BE,
    Int16LE,
    Int32BE,
    Int32LE,
    IntBE,
    IntLE,
    UInt8,
    UInt16BE,
    UInt16LE,
    UInt32BE,
    UInt32LE,
    UIntBE,
    UIntLE,

    const NativeMap = std.EnumArray(Int, type);
    pub const native: NativeMap = brk: {
        var map = NativeMap.initUndefined();
        map.set(.BigInt64BE, i64);
        map.set(.BigInt64LE, i64);
        map.set(.BigUInt64BE, u64);
        map.set(.BigUInt64LE, u64);
        map.set(.DoubleBE, f64);
        map.set(.DoubleLE, f64);
        map.set(.FloatBE, f32);
        map.set(.FloatLE, f32);
        map.set(.Int8, i8);
        map.set(.Int16BE, i16);
        map.set(.Int16LE, i16);
        map.set(.Int32BE, u32);
        map.set(.Int32LE, u32);
        map.set(.IntBE, i32);
        map.set(.IntLE, i32);
        map.set(.UInt8, u8);
        map.set(.UInt16BE, u16);
        map.set(.UInt16LE, u16);
        map.set(.UInt32BE, u32);
        map.set(.UInt32LE, u32);
        map.set(.UIntBE, u32);
        map.set(.UIntLE, u32);
        break :brk map;
    };
};
