const Bun = @This();
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const JSC = bun.JSC;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const brotli = bun.brotli;

pub const Brotli = struct {
    fn brotli_alloc_func(ctx: ?*anyopaque, size: usize) callconv(.C) ?*anyopaque {
        _ = ctx;
        return bun.Mimalloc.mi_malloc(size);
    }
    fn brotli_free_func(ctx: ?*anyopaque, ptr: ?*anyopaque) callconv(.C) void {
        _ = ctx;
        return bun.Mimalloc.mi_free(ptr);
    }

    pub const Options = struct {
        pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue, comptime StateType: type) !*StateType {
            if (!value.isObject()) {
                globalObject.throwInvalidArguments("Expected options to be an object", .{});
                return error.JSError;
            }
            var state = if (comptime StateType == brotli.BrotliDecoderState) brotli.BrotliDecoderCreateInstance(brotli_alloc_func, brotli_free_func, null) else brotli.BrotliEncoderCreateInstance(brotli_alloc_func, brotli_free_func, null);
            errdefer {
                if (comptime StateType == brotli.BrotliDecoderState) {
                    brotli.BrotliDecoderDestroyInstance(state);
                } else {
                    brotli.BrotliEncoderDestroyInstance(state);
                }
            }
            const setParamter = if (comptime StateType == brotli.BrotliDecoderState)
                brotli.BrotliDecoderSetParameter
            else
                brotli.BrotliEncoderSetParameter;

            // flush <integer> Default: zlib.constants.BROTLI_OPERATION_PROCESS
            var flush_value = brotli.BROTLI_OPERATION_PROCESS;
            if (try value.getOptional(globalObject, "flush", u32)) |flushy| {
                flush_value = flushy;
            }

            if (setParamter(state, .flush, flush_value) == 0) {
                globalObject.throwInvalidArguments("Invalid flush value", .{});
                return error.JSError;
            }

            // finishFlush <integer> Default: zlib.constants.BROTLI_OPERATION_FINISH
            var finishFlush_value = brotli.BROTLI_OPERATION_FINISH;
            if (try value.getOptional(globalObject, "finishFlush", u32)) |finishFlushy| {
                finishFlush_value = finishFlushy;
            }

            if (setParamter(state, .finishFlush, flush_value) == 0) {
                globalObject.throwInvalidArguments("Invalid finishFlush value", .{});
                return error.JSError;
            }

            // chunkSize <integer> Default: 16 * 1024
            var chunkSize_value = 16 * 1024;
            if (try value.getOptional(globalObject, "chunkSize", u32)) |chunkSizey| {
                chunkSize_value = chunkSizey;
            }

            // params <Object> Key-value object containing indexed Brotli parameters.

            // maxOutputLength <integer> Limits output size when using convenience methods. Default: buffer.kMaxLength

        }
    };
};
