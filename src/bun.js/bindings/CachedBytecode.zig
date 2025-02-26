const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const FFI = @import("./FFI.zig");
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const String = bun.String;
const ErrorableString = JSC.ErrorableString;
const JSError = bun.JSError;
const OOM = bun.OOM;

const Api = @import("../../api/schema.zig").Api;

const Bun = JSC.API.Bun;

pub const URL = @import("./URL.zig").URL;
pub const JSGlobalObject = @import("./JSGlobalObject.zig").JSGlobalObject;
pub const VM = @import("./VM.zig").VM;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;
pub const JSObject = @import("./JSObject.zig").JSObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;

pub const CachedBytecode = opaque {
    extern fn generateCachedModuleByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode) bool;
    extern fn generateCachedCommonJSProgramByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode) bool;

    pub fn generateForESM(sourceProviderURL: *bun.String, input: []const u8) ?struct { []const u8, *CachedBytecode } {
        var this: ?*CachedBytecode = null;

        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        if (generateCachedModuleByteCodeFromSourceCode(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this)) {
            return .{ input_code_ptr.?[0..input_code_size], this.? };
        }

        return null;
    }

    pub fn generateForCJS(sourceProviderURL: *bun.String, input: []const u8) ?struct { []const u8, *CachedBytecode } {
        var this: ?*CachedBytecode = null;
        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        if (generateCachedCommonJSProgramByteCodeFromSourceCode(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this)) {
            return .{ input_code_ptr.?[0..input_code_size], this.? };
        }

        return null;
    }

    extern "c" fn CachedBytecode__deref(this: *CachedBytecode) void;
    pub fn deref(this: *CachedBytecode) void {
        return CachedBytecode__deref(this);
    }

    pub fn generate(format: bun.options.Format, input: []const u8, source_provider_url: *bun.String) ?struct { []const u8, *CachedBytecode } {
        return switch (format) {
            .esm => generateForESM(source_provider_url, input),
            .cjs => generateForCJS(source_provider_url, input),
            else => null,
        };
    }

    pub const VTable = &std.mem.Allocator.VTable{
        .alloc = struct {
            pub fn alloc(ctx: *anyopaque, len: usize, ptr_align: u8, ret_addr: usize) ?[*]u8 {
                _ = ctx; // autofix
                _ = len; // autofix
                _ = ptr_align; // autofix
                _ = ret_addr; // autofix
                @panic("Unexpectedly called CachedBytecode.alloc");
            }
        }.alloc,
        .resize = struct {
            pub fn resize(ctx: *anyopaque, buf: []u8, buf_align: u8, new_len: usize, ret_addr: usize) bool {
                _ = ctx; // autofix
                _ = buf; // autofix
                _ = buf_align; // autofix
                _ = new_len; // autofix
                _ = ret_addr; // autofix
                return false;
            }
        }.resize,
        .free = struct {
            pub fn free(ctx: *anyopaque, buf: []u8, buf_align: u8, _: usize) void {
                _ = buf; // autofix
                _ = buf_align; // autofix
                CachedBytecode__deref(@ptrCast(ctx));
            }
        }.free,
    };

    pub fn allocator(this: *CachedBytecode) std.mem.Allocator {
        return .{
            .ptr = this,
            .vtable = VTable,
        };
    }
};
