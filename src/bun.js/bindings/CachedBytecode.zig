const std = @import("std");
const bun = @import("bun");

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
            pub fn alloc(ctx: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
                _ = ctx;
                _ = len;
                _ = alignment;
                _ = ret_addr;
                @panic("Unexpectedly called CachedBytecode.alloc");
            }
        }.alloc,
        .free = struct {
            pub fn free(ctx: *anyopaque, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
                _ = buf;
                _ = alignment;
                _ = ret_addr;
                CachedBytecode__deref(@ptrCast(ctx));
            }
        }.free,
        .resize = &std.mem.Allocator.noResize,
        .remap = &std.mem.Allocator.noRemap,
    };

    pub fn allocator(this: *CachedBytecode) std.mem.Allocator {
        return .{
            .ptr = this,
            .vtable = VTable,
        };
    }
};
