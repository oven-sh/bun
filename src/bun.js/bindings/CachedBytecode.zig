pub const CachedBytecode = opaque {
    extern fn generateCachedModuleByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode, error_loc: *i32, error_message: *bun.String) bool;
    extern fn generateCachedCommonJSProgramByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode, error_loc: *i32, error_message: *bun.String) bool;

    pub fn generateForESM(sourceProviderURL: *bun.String, input: []const u8) GenerateResult {
        var this: ?*CachedBytecode = null;

        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        var error_loc: i32 = -1;
        var error_message: bun.String = .empty;
        if (generateCachedModuleByteCodeFromSourceCode(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this, &error_loc, &error_message)) {
            return .{ .result = .{ .bytecode = input_code_ptr.?[0..input_code_size], .cached_bytecode = this.? } };
        }

        return .{ .err = .{ .loc = .from(error_loc), .message = error_message } };
    }

    pub fn generateForCJS(sourceProviderURL: *bun.String, input: []const u8) GenerateResult {
        var this: ?*CachedBytecode = null;
        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        var error_loc: i32 = -1;
        var error_message: bun.String = .empty;
        if (generateCachedCommonJSProgramByteCodeFromSourceCode(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this, &error_loc, &error_message)) {
            return .{ .result = .{ .bytecode = input_code_ptr.?[0..input_code_size], .cached_bytecode = this.? } };
        }

        return .{ .err = .{ .loc = .from(error_loc), .message = error_message } };
    }

    extern "c" fn CachedBytecode__deref(this: *CachedBytecode) void;
    pub fn deref(this: *CachedBytecode) void {
        return CachedBytecode__deref(this);
    }

    const GenerateResult = union(enum) {
        result: Result,
        err: Error,

        const Result = struct {
            cached_bytecode: *CachedBytecode,
            bytecode: []const u8,
        };

        const Error = struct {
            loc: bun.logger.Loc,
            message: bun.String,
        };
    };

    pub fn generate(format: bun.options.Format, input: []const u8, source_provider_url: *bun.String) GenerateResult {
        return switch (format) {
            .esm => generateForESM(source_provider_url, input),
            .cjs => generateForCJS(source_provider_url, input),
            else => .{ .err = .{ .loc = .none, .message = .empty } },
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

    pub fn isInstance(allocator_: std.mem.Allocator) bool {
        return allocator_.vtable == VTable;
    }
};

const bun = @import("bun");
const std = @import("std");
