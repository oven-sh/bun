// TODO: prefer generating this file via translate_c

pub const brotli_alloc_func = ?*const fn (?*anyopaque, usize) callconv(.c) ?*anyopaque;
pub const brotli_free_func = ?*const fn (?*anyopaque, *anyopaque) callconv(.c) void;
pub const struct_BrotliSharedDictionaryStruct = opaque {};
pub const BrotliSharedDictionary = struct_BrotliSharedDictionaryStruct;
pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub const BROTLI_SHARED_DICTIONARY_SERIALIZED: c_int = 1;
pub const enum_BrotliSharedDictionaryType = c_uint;
pub const BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;
// pub extern fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliSharedDictionary;
// pub extern fn BrotliSharedDictionaryDestroyInstance(dict: ?*BrotliSharedDictionary) void;
// pub extern fn BrotliSharedDictionaryAttach(dict: ?*BrotliSharedDictionary, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*]const u8) c_int;

pub extern fn BrotliDecoderSetParameter(state: *BrotliDecoder, param: c_uint, value: u32) callconv(.c) c_int;
pub extern fn BrotliDecoderAttachDictionary(state: *BrotliDecoder, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*]const u8) callconv(.c) c_int;
pub extern fn BrotliDecoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.c) ?*BrotliDecoder;
pub extern fn BrotliDecoderDestroyInstance(state: *BrotliDecoder) callconv(.c) void;
pub extern fn BrotliDecoderDecompress(encoded_size: usize, encoded_buffer: [*]const u8, decoded_size: *usize, decoded_buffer: [*]u8) callconv(.c) BrotliDecoderResult;
pub extern fn BrotliDecoderDecompressStream(state: *BrotliDecoder, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_out: *?[*]u8, total_out: ?*usize) callconv(.c) BrotliDecoderResult;
pub extern fn BrotliDecoderHasMoreOutput(state: *const BrotliDecoder) callconv(.c) c_int;
pub extern fn BrotliDecoderTakeOutput(state: *BrotliDecoder, size: *usize) callconv(.c) ?[*]const u8;
pub extern fn BrotliDecoderIsUsed(state: *const BrotliDecoder) callconv(.c) c_int;
pub extern fn BrotliDecoderIsFinished(state: *const BrotliDecoder) callconv(.c) c_int;
pub extern fn BrotliDecoderGetErrorCode(state: *const BrotliDecoder) callconv(.c) BrotliDecoderErrorCode2;
pub extern fn BrotliDecoderErrorString(c: BrotliDecoderErrorCode) callconv(.c) ?[*:0]const u8;
pub extern fn BrotliDecoderVersion() callconv(.c) u32;

pub const BrotliDecoder = opaque {
    const BrotliDecoderSetMetadataCallbacks = fn (state: *BrotliDecoder, start_func: brotli_decoder_metadata_start_func, chunk_func: brotli_decoder_metadata_chunk_func, @"opaque": ?*anyopaque) callconv(.c) void;
    const brotli_decoder_metadata_start_func = ?*const fn (?*anyopaque, usize) callconv(.c) void;
    const brotli_decoder_metadata_chunk_func = ?*const fn (?*anyopaque, [*]const u8, usize) callconv(.c) void;

    pub fn setParameter(state: *BrotliDecoder, param: BrotliDecoderParameter, value: u32) callconv(.c) bool {
        return BrotliDecoderSetParameter(state, @intFromEnum(param), value) > 0;
    }

    pub fn attachDictionary(state: *BrotliDecoder, @"type": BrotliSharedDictionaryType, data: []const u8) callconv(.c) c_int {
        return BrotliDecoderAttachDictionary(state, @"type", data.len, data.ptr);
    }

    pub fn createInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.c) ?*BrotliDecoder {
        return BrotliDecoderCreateInstance(alloc_func, free_func, @"opaque");
    }

    pub fn destroyInstance(state: *BrotliDecoder) callconv(.c) void {
        return BrotliDecoderDestroyInstance(state);
    }

    pub fn decompress(encoded: []const u8, decoded: *[]u8) callconv(.c) BrotliDecoderResult {
        return BrotliDecoderDecompress(encoded.len, encoded.ptr, &decoded.len, decoded.ptr);
    }

    pub fn decompressStream(state: *BrotliDecoder, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_out: *?[*]u8, total_out: ?*usize) callconv(.c) BrotliDecoderResult {
        return BrotliDecoderDecompressStream(state, available_in, next_in, available_out, next_out, total_out);
    }

    pub fn hasMoreOutput(state: *const BrotliDecoder) callconv(.c) bool {
        return BrotliDecoderHasMoreOutput(state) != 0;
    }

    pub fn takeOutput(state: *BrotliDecoder) callconv(.c) []const u8 {
        var max_size: usize = std.math.maxInt(usize);
        const ptr = BrotliDecoderTakeOutput(state, &max_size) orelse return "";
        return ptr[0..max_size];
    }

    pub fn isUsed(state: *const BrotliDecoder) callconv(.c) bool {
        return BrotliDecoderIsUsed(state) != 0;
    }

    pub fn isFinished(state: *const BrotliDecoder) callconv(.c) bool {
        return BrotliDecoderIsFinished(state) != 0;
    }

    pub fn getErrorCode(state: *const BrotliDecoder) callconv(.c) BrotliDecoderErrorCode {
        return @enumFromInt(@intFromEnum(BrotliDecoderGetErrorCode(state)));
    }

    pub fn errorString(c: BrotliDecoderErrorCode) callconv(.c) [:0]const u8 {
        return bun.sliceTo(BrotliDecoderErrorString(c) orelse "", 0);
    }

    pub fn version() callconv(.c) u32 {
        return BrotliDecoderVersion();
    }

    pub fn initializeBrotli() bool {
        return true;
    }
};
pub const BrotliDecoderResult = enum(c_uint) {
    err = 0,
    success = 1,
    needs_more_input = 2,
    needs_more_output = 3,
};
pub const BROTLI_DECODER_NO_ERROR: c_int = 0;
pub const BROTLI_DECODER_SUCCESS: c_int = 1;
pub const BROTLI_DECODER_NEEDS_MORE_INPUT: c_int = 2;
pub const BROTLI_DECODER_NEEDS_MORE_OUTPUT: c_int = 3;
pub const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: c_int = -1;
pub const BROTLI_DECODER_ERROR_FORMAT_RESERVED: c_int = -2;
pub const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: c_int = -3;
pub const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: c_int = -4;
pub const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: c_int = -5;
pub const BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: c_int = -6;
pub const BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: c_int = -7;
pub const BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: c_int = -8;
pub const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: c_int = -9;
pub const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: c_int = -10;
pub const BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: c_int = -11;
pub const BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: c_int = -12;
pub const BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: c_int = -13;
pub const BROTLI_DECODER_ERROR_FORMAT_PADDING_1: c_int = -14;
pub const BROTLI_DECODER_ERROR_FORMAT_PADDING_2: c_int = -15;
pub const BROTLI_DECODER_ERROR_FORMAT_DISTANCE: c_int = -16;
pub const BROTLI_DECODER_ERROR_COMPOUND_DICTIONARY: c_int = -18;
pub const BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: c_int = -19;
pub const BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: c_int = -20;
pub const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: c_int = -21;
pub const BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: c_int = -22;
pub const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: c_int = -25;
pub const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: c_int = -26;
pub const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: c_int = -27;
pub const BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: c_int = -30;
pub const BROTLI_DECODER_ERROR_UNREACHABLE: c_int = -31;
pub const BrotliDecoderErrorCode = enum(c_int) {
    FORMAT_EXUBERANT_NIBBLE = -1,
    FORMAT_RESERVED = -2,
    FORMAT_EXUBERANT_META_NIBBLE = -3,
    FORMAT_SIMPLE_HUFFMAN_ALPHABET = -4,
    FORMAT_SIMPLE_HUFFMAN_SAME = -5,
    FORMAT_CL_SPACE = -6,
    FORMAT_HUFFMAN_SPACE = -7,
    FORMAT_CONTEXT_MAP_REPEAT = -8,
    FORMAT_BLOCK_LENGTH_1 = -9,
    FORMAT_BLOCK_LENGTH_2 = -10,
    FORMAT_TRANSFORM = -11,
    FORMAT_DICTIONARY = -12,
    FORMAT_WINDOW_BITS = -13,
    FORMAT_PADDING_1 = -14,
    FORMAT_PADDING_2 = -15,
    FORMAT_DISTANCE = -16,
    COMPOUND_DICTIONARY = -18,
    DICTIONARY_NOT_SET = -19,
    INVALID_ARGUMENTS = -20,
    ALLOC_CONTEXT_MODES = -21,
    ALLOC_TREE_GROUPS = -22,
    ALLOC_CONTEXT_MAP = -25,
    ALLOC_RING_BUFFER_1 = -26,
    ALLOC_RING_BUFFER_2 = -27,
    ALLOC_BLOCK_TYPE_TREES = -30,
    UNREACHABLE = -31,
};
pub const BrotliDecoderErrorCode2 = enum(c_int) {
    NO_ERROR = 0,
    SUCCESS = 1,
    NEEDS_MORE_INPUT = 2,
    NEEDS_MORE_OUTPUT = 3,
    ERROR_FORMAT_EXUBERANT_NIBBLE = -1,
    ERROR_FORMAT_RESERVED = -2,
    ERROR_FORMAT_EXUBERANT_META_NIBBLE = -3,
    ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET = -4,
    ERROR_FORMAT_SIMPLE_HUFFMAN_SAME = -5,
    ERROR_FORMAT_CL_SPACE = -6,
    ERROR_FORMAT_HUFFMAN_SPACE = -7,
    ERROR_FORMAT_CONTEXT_MAP_REPEAT = -8,
    ERROR_FORMAT_BLOCK_LENGTH_1 = -9,
    ERROR_FORMAT_BLOCK_LENGTH_2 = -10,
    ERROR_FORMAT_TRANSFORM = -11,
    ERROR_FORMAT_DICTIONARY = -12,
    ERROR_FORMAT_WINDOW_BITS = -13,
    ERROR_FORMAT_PADDING_1 = -14,
    ERROR_FORMAT_PADDING_2 = -15,
    ERROR_FORMAT_DISTANCE = -16,
    ERROR_COMPOUND_DICTIONARY = -18,
    ERROR_DICTIONARY_NOT_SET = -19,
    ERROR_INVALID_ARGUMENTS = -20,
    ERROR_ALLOC_CONTEXT_MODES = -21,
    ERROR_ALLOC_TREE_GROUPS = -22,
    ERROR_ALLOC_CONTEXT_MAP = -25,
    ERROR_ALLOC_RING_BUFFER_1 = -26,
    ERROR_ALLOC_RING_BUFFER_2 = -27,
    ERROR_ALLOC_BLOCK_TYPE_TREES = -30,
    ERROR_UNREACHABLE = -31,
};
pub const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: c_int = 0;
pub const BROTLI_DECODER_PARAM_LARGE_WINDOW: c_int = 1;
pub const BrotliDecoderParameter = enum(c_uint) {
    DISABLE_RING_BUFFER_REALLOCATION = 0,
    LARGE_WINDOW = 1,
};

pub const BROTLI_UINT32_MAX = ~@import("std").zig.c_translation.cast(u32, @as(c_int, 0));
pub const BROTLI_SIZE_MAX = ~@import("std").zig.c_translation.cast(usize, @as(c_int, 0));
pub const BROTLI_LAST_ERROR_CODE = BROTLI_DECODER_ERROR_UNREACHABLE;
pub const BrotliSharedDictionaryStruct = struct_BrotliSharedDictionaryStruct;

pub const struct_BrotliEncoderPreparedDictionaryStruct = opaque {};
pub const BrotliEncoderPreparedDictionary = struct_BrotliEncoderPreparedDictionaryStruct;
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
    // update kMaxBrotliParam in src/js/node/zlib.ts if this list changes
};

pub extern fn BrotliEncoderSetParameter(state: *BrotliEncoder, param: c_uint, value: u32) c_int;
pub extern fn BrotliEncoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliEncoder;
pub extern fn BrotliEncoderDestroyInstance(state: *BrotliEncoder) void;
pub extern fn BrotliEncoderPrepareDictionary(@"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8, quality: c_int, alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) *BrotliEncoderPreparedDictionary;
pub extern fn BrotliEncoderDestroyPreparedDictionary(dictionary: *BrotliEncoderPreparedDictionary) void;
pub extern fn BrotliEncoderAttachPreparedDictionary(state: *BrotliEncoder, dictionary: ?*const BrotliEncoderPreparedDictionary) c_int;
pub extern fn BrotliEncoderMaxCompressedSize(input_size: usize) usize;
pub extern fn BrotliEncoderCompress(quality: c_int, lgwin: c_int, mode: BrotliEncoderMode, input_size: usize, input_buffer: [*]const u8, encoded_size: *usize, encoded_buffer: [*]u8) c_int;
pub extern fn BrotliEncoderCompressStream(state: *BrotliEncoder, op: BrotliEncoder.Operation, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_in: ?*?[*]u8, total_out: ?*usize) c_int;
pub extern fn BrotliEncoderIsFinished(state: *BrotliEncoder) c_int;
pub extern fn BrotliEncoderHasMoreOutput(state: *BrotliEncoder) c_int;
pub extern fn BrotliEncoderTakeOutput(state: *BrotliEncoder, size: *usize) ?[*]const u8;
pub extern fn BrotliEncoderEstimatePeakMemoryUsage(quality: c_int, lgwin: c_int, input_size: usize) usize;
pub extern fn BrotliEncoderGetPreparedDictionarySize(dictionary: ?*const BrotliEncoderPreparedDictionary) usize;
pub extern fn BrotliEncoderVersion() u32;

pub const BrotliEncoder = opaque {
    pub const Operation = enum(c_uint) {
        process = 0,
        flush = 1,
        finish = 2,
        emit_metadata = 3,
    };

    pub fn createInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.c) ?*BrotliEncoder {
        return BrotliEncoderCreateInstance(alloc_func, free_func, @"opaque");
    }

    pub fn destroyInstance(state: *BrotliEncoder) callconv(.c) void {
        return BrotliEncoderDestroyInstance(state);
    }

    pub fn hasMoreOutput(state: *BrotliEncoder) callconv(.c) bool {
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
        return BrotliEncoderSetParameter(state, @intFromEnum(param), value) > 0;
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

const std = @import("std");
const bun = @import("root").bun;
