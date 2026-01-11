pub const CachedBytecode = opaque {
    extern fn generateCachedModuleByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode) bool;
    extern fn generateCachedCommonJSProgramByteCodeFromSourceCode(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode) bool;
    extern fn generateCachedModuleByteCodeWithMetadata(sourceProviderURL: *bun.String, input_code: [*]const u8, inputSourceCodeSize: usize, outputByteCode: *?[*]u8, outputByteCodeSize: *usize, cached_bytecode: *?*CachedBytecode) bool;
    extern fn validateCachedModuleMetadata(cacheData: [*]const u8, cacheSize: usize) bool;

    pub fn generateForESM(sourceProviderURL: *bun.String, input: []const u8) ?struct { []const u8, *CachedBytecode } {
        var this: ?*CachedBytecode = null;

        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        if (generateCachedModuleByteCodeFromSourceCode(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this)) {
            return .{ input_code_ptr.?[0..input_code_size], this.? };
        }

        return null;
    }

    pub fn generateForESMWithMetadata(sourceProviderURL: *bun.String, input: []const u8) ?struct { []const u8, *CachedBytecode } {
        var this: ?*CachedBytecode = null;

        var input_code_size: usize = 0;
        var input_code_ptr: ?[*]u8 = null;
        if (generateCachedModuleByteCodeWithMetadata(sourceProviderURL, input.ptr, input.len, &input_code_ptr, &input_code_size, &this)) {
            return .{ input_code_ptr.?[0..input_code_size], this.? };
        }

        return null;
    }

    pub fn validateMetadata(cache: []const u8) bool {
        return validateCachedModuleMetadata(cache.ptr, cache.len);
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

    pub fn isInstance(allocator_: std.mem.Allocator) bool {
        return allocator_.vtable == VTable;
    }
};

pub const TestingAPIs = struct {
    pub fn generateForESMWithMetadata(global: *jsc.JSGlobalObject, call_frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const source_url_val = call_frame.argument(0);
        const input_val = call_frame.argument(1);

        if (!source_url_val.isString()) {
            return global.throw("Expected source URL string as first argument", .{});
        }

        if (!input_val.isString()) {
            return global.throw("Expected source code string as second argument", .{});
        }

        var source_url_str = try source_url_val.toSlice(global, bun.default_allocator);
        defer source_url_str.deinit();

        var input_str = try input_val.toSlice(global, bun.default_allocator);
        defer input_str.deinit();

        var source_url_bun = bun.String.init(source_url_str.slice());
        defer source_url_bun.deref();

        const result = CachedBytecode.generateForESMWithMetadata(&source_url_bun, input_str.slice()) orelse {
            return jsc.JSValue.jsNull();
        };

        const cache_data, _ = result;

        // Create a Uint8Array for the cache data (without copying)
        return try jsc.ArrayBuffer.createUint8Array(global, cache_data);
    }

    pub fn validateMetadata(global: *jsc.JSGlobalObject, call_frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const cache_val = call_frame.argument(0);

        const array_buffer = cache_val.asArrayBuffer(global) orelse {
            return global.throw("Expected Uint8Array or ArrayBuffer as first argument", .{});
        };

        const cache_slice = array_buffer.byteSlice();
        return jsc.JSValue.jsBoolean(CachedBytecode.validateMetadata(cache_slice));
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
