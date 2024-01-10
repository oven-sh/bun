const bun = @import("root").bun;
const std = @import("std");

pub const brotli_alloc_func = ?*const fn (?*anyopaque, usize) callconv(.C) ?*anyopaque;
pub const brotli_free_func = ?*const fn (?*anyopaque, ?*anyopaque) callconv(.C) void;
pub const struct_BrotliSharedDictionaryStruct = opaque {};
pub const BrotliSharedDictionary = struct_BrotliSharedDictionaryStruct;
pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub const BROTLI_SHARED_DICTIONARY_SERIALIZED: c_int = 1;
pub const enum_BrotliSharedDictionaryType = c_uint;
pub const BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;
extern fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliSharedDictionary;
extern fn BrotliSharedDictionaryDestroyInstance(dict: ?*BrotliSharedDictionary) void;
extern fn BrotliSharedDictionaryAttach(dict: ?*BrotliSharedDictionary, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8) c_int;
pub const BROTLI_MODE_GENERIC: c_int = 0;
pub const BROTLI_MODE_TEXT: c_int = 1;
pub const BROTLI_MODE_FONT: c_int = 2;
pub const BrotliEncoderMode = enum(c_uint) {
    generic = 0,
    text = 1,
    font = 2,
};
pub const BROTLI_OPERATION_PROCESS: c_int = 0;
pub const BROTLI_OPERATION_FLUSH: c_int = 1;
pub const BROTLI_OPERATION_FINISH: c_int = 2;
pub const BROTLI_OPERATION_EMIT_METADATA: c_int = 3;

pub const BROTLI_PARAM_MODE: c_int = 0;
pub const BROTLI_PARAM_QUALITY: c_int = 1;
pub const BROTLI_PARAM_LGWIN: c_int = 2;
pub const BROTLI_PARAM_LGBLOCK: c_int = 3;
pub const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: c_int = 4;
pub const BROTLI_PARAM_SIZE_HINT: c_int = 5;
pub const BROTLI_PARAM_LARGE_WINDOW: c_int = 6;
pub const BROTLI_PARAM_NPOSTFIX: c_int = 7;
pub const BROTLI_PARAM_NDIRECT: c_int = 8;
pub const BROTLI_PARAM_STREAM_OFFSET: c_int = 9;
pub const BrotliEncoderParameter = enum(c_uint) {
    mode = 0,
    quality = 1,
    lgwin = 2,
    lgblock = 3,
    disable_literal_context_modeling = 4,
    size_hint = 5,
    large_window = 6,
    npostfix = 7,
    ndirect = 8,
    stream_offset = 9,
};
pub const BrotliEncoder = opaque {
    pub const Operation = enum(c_uint) {
        process = 0,
        flush = 1,
        finish = 2,
        emit_metadata = 3,
    };

    extern fn BrotliEncoderSetParameter(state: *BrotliEncoder, param: BrotliEncoderParameter, value: u32) c_int;
    extern fn BrotliEncoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) *BrotliEncoder;
    extern fn BrotliEncoderDestroyInstance(state: *BrotliEncoder) void;
    pub const struct_BrotliEncoderPreparedDictionaryStruct = opaque {};
    pub const BrotliEncoderPreparedDictionary = struct_BrotliEncoderPreparedDictionaryStruct;
    extern fn BrotliEncoderPrepareDictionary(@"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8, quality: c_int, alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) *BrotliEncoderPreparedDictionary;
    extern fn BrotliEncoderDestroyPreparedDictionary(dictionary: *BrotliEncoderPreparedDictionary) void;
    extern fn BrotliEncoderAttachPreparedDictionary(state: *BrotliEncoder, dictionary: ?*const BrotliEncoderPreparedDictionary) c_int;
    extern fn BrotliEncoderMaxCompressedSize(input_size: usize) usize;
    extern fn BrotliEncoderCompress(quality: c_int, lgwin: c_int, mode: BrotliEncoderMode, input_size: usize, input_buffer: [*]const u8, encoded_size: *usize, encoded_buffer: [*]u8) c_int;
    extern fn BrotliEncoderCompressStream(state: *BrotliEncoder, op: Operation, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_out: ?[*]u8, total_out: ?*usize) c_int;
    extern fn BrotliEncoderIsFinished(state: *BrotliEncoder) c_int;
    extern fn BrotliEncoderHasMoreOutput(state: *BrotliEncoder) c_int;
    extern fn BrotliEncoderTakeOutput(state: *BrotliEncoder, size: *usize) ?[*]const u8;
    extern fn BrotliEncoderEstimatePeakMemoryUsage(quality: c_int, lgwin: c_int, input_size: usize) usize;
    extern fn BrotliEncoderGetPreparedDictionarySize(dictionary: ?*const BrotliEncoderPreparedDictionary) usize;
    extern fn BrotliEncoderVersion() u32;

    pub fn createInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.C) ?*BrotliEncoder {
        return BrotliEncoderCreateInstance(alloc_func, free_func, @"opaque");
    }

    pub fn destroyInstance(state: *BrotliEncoder) callconv(.C) void {
        return BrotliEncoderDestroyInstance(state);
    }

    pub fn hasMoreOutput(state: *BrotliEncoder) callconv(.C) bool {
        return BrotliEncoderHasMoreOutput(state) > 0;
    }

    pub fn takeOutput(state: *BrotliEncoder) []const u8 {
        var size: usize = 0;
        if (BrotliEncoderTakeOutput(state, &size)) |ptr| {
            return ptr[0..size];
        }

        return "";
    }

    pub const CompressionResult = struct {
        success: bool = false,
        has_more: bool = false,
        output: []const u8 = "",
    };

    // https://github.com/google/brotli/blob/2ad58d8603294f5ee33d23bb725e0e6a17c1de50/go/cbrotli/writer.go#L23-L40
    pub fn compressStream(state: *BrotliEncoder, op: Operation, data: []const u8) CompressionResult {
        var available_in = data.len;
        var next_in: ?[*]const u8 = data.ptr;

        var available_out: usize = 0;

        var result = CompressionResult{};

        result.success = BrotliEncoderCompressStream(state, op, &available_in, &next_in, &available_out, null, null) > 0;

        if (result.success) {
            result.output = takeOutput(state);
        }

        result.has_more = BrotliEncoderHasMoreOutput(state) > 0;

        return result;
    }

    pub fn setParameter(state: *BrotliEncoder, param: BrotliEncoderParameter, value: u32) bool {
        return BrotliEncoderSetParameter(state, param, value) > 0;
    }
};

pub const SHARED_BROTLI_MIN_DICTIONARY_WORD_LENGTH = 4;
pub const SHARED_BROTLI_MAX_DICTIONARY_WORD_LENGTH = 31;
pub const SHARED_BROTLI_NUM_DICTIONARY_CONTEXTS = 64;
pub const SHARED_BROTLI_MAX_COMPOUND_DICTS = 15;
pub const BROTLI_MIN_WINDOW_BITS = 10;
pub const BROTLI_MAX_WINDOW_BITS = 24;
pub const BROTLI_LARGE_MAX_WINDOW_BITS = 30;
pub const BROTLI_MIN_INPUT_BLOCK_BITS = 16;
pub const BROTLI_MAX_INPUT_BLOCK_BITS = 24;
pub const BROTLI_MIN_QUALITY = 0;
pub const BROTLI_MAX_QUALITY = 11;
pub const BROTLI_DEFAULT_QUALITY = 11;
pub const BROTLI_DEFAULT_WINDOW = 22;
pub const BROTLI_DEFAULT_MODE = BROTLI_MODE_GENERIC;
