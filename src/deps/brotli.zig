const bun = @import("root").bun;
pub const brotli_alloc_func = ?*const fn (?*anyopaque, usize) callconv(.C) ?*anyopaque;
pub const brotli_free_func = ?*const fn (?*anyopaque, ?*anyopaque) callconv(.C) void;
pub const struct_BrotliSharedDictionaryStruct = opaque {};
pub const BrotliSharedDictionary = struct_BrotliSharedDictionaryStruct;
pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub const BROTLI_SHARED_DICTIONARY_SERIALIZED: c_int = 1;
pub const enum_BrotliSharedDictionaryType = c_uint;
pub const BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;
pub extern fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, ctx: ?*anyopaque) ?*BrotliSharedDictionary;
pub extern fn BrotliSharedDictionaryDestroyInstance(dict: ?*BrotliSharedDictionary) void;
pub extern fn BrotliSharedDictionaryAttach(dict: ?*BrotliSharedDictionary, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8) c_int;

fn default_brotli_alloc_fn(ctx: ?*anyopaque, size: usize) callconv(.C) ?*anyopaque {
    _ = ctx;
    return bun.Mimalloc.mi_malloc(size);
}

fn default_brotli_free_fn(ctx: ?*anyopaque, ptr: ?*anyopaque) callconv(.C) void {
    _ = ctx;
    bun.Mimalloc.mi_free(ptr);
}

pub const BrotliDecoderState = opaque {
    pub fn init() *BrotliDecoderState {
        return BrotliDecoderCreateInstance(default_brotli_alloc_fn, default_brotli_free_fn, null);
    }

    pub fn deinit(self: *BrotliDecoderState) void {
        BrotliDecoderDestroyInstance(self);
    }

    pub fn isFinished(self: *const BrotliDecoderState) bool {
        return BrotliDecoderIsFinished(self) == BROTLI_TRUE;
    }

    pub fn isUsed(self: *const BrotliDecoderState) bool {
        return BrotliDecoderIsUsed(self) == BROTLI_TRUE;
    }

    pub fn hasMore(self: *const BrotliDecoderState) bool {
        return BrotliDecoderHasMoreOutput(self) == BROTLI_TRUE;
    }

    pub fn setParameter(self: *BrotliDecoderState, param: BrotliDecoderParameter, value: u32) bool {
        return BrotliDecoderSetParameter(self, param, value) == BROTLI_TRUE;
    }

    pub fn write(self: *BrotliDecoderState, input: *[]const u8, output: *[]u8) BrotliDecoderResult {
        return BrotliDecoderDecompressStream(self, &input.len, &input.ptr, &output.len, &output.ptr, null);
    }

    pub fn getErrorCode(self: *const BrotliDecoderState) BrotliDecoderErrorCode {
        return BrotliDecoderGetErrorCode(self);
    }
};
pub const BROTLI_DECODER_RESULT_ERROR: u32 = 0;
pub const BROTLI_DECODER_RESULT_SUCCESS: u32 = 1;
pub const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: u32 = 2;
pub const BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: u32 = 3;
pub const BrotliDecoderResult = enum(u32) {
    @"error" = BROTLI_DECODER_RESULT_ERROR,
    success = BROTLI_DECODER_RESULT_SUCCESS,
    needs_more_input = BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT,
    needs_more_output = BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT,
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
    no_error = BROTLI_DECODER_NO_ERROR,
    success = BROTLI_DECODER_SUCCESS,
    needs_more_input = BROTLI_DECODER_NEEDS_MORE_INPUT,
    needs_more_output = BROTLI_DECODER_NEEDS_MORE_OUTPUT,
    error_format_exuberant_nibble = BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE,
    error_format_reserved = BROTLI_DECODER_ERROR_FORMAT_RESERVED,
    error_format_exuberant_meta_nibble = BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE,
    error_format_simple_huffman_alphabet = BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET,
    error_format_simple_huffman_same = BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME,
    error_format_cl_space = BROTLI_DECODER_ERROR_FORMAT_CL_SPACE,
    error_format_huffman_space = BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE,
    error_format_context_map_repeat = BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT,
    error_format_block_length_1 = BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1,
    error_format_block_length_2 = BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2,
    error_format_transform = BROTLI_DECODER_ERROR_FORMAT_TRANSFORM,
    error_format_dictionary = BROTLI_DECODER_ERROR_FORMAT_DICTIONARY,
    error_format_window_bits = BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS,
    error_format_padding_1 = BROTLI_DECODER_ERROR_FORMAT_PADDING_1,
    error_format_padding_2 = BROTLI_DECODER_ERROR_FORMAT_PADDING_2,
    error_format_distance = BROTLI_DECODER_ERROR_FORMAT_DISTANCE,
    error_compound_dictionary = BROTLI_DECODER_ERROR_COMPOUND_DICTIONARY,
    error_dictionary_not_set = BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET,
    error_invalid_arguments = BROTLI_DECODER_ERROR_INVALID_ARGUMENTS,
    error_alloc_context_modes = BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES,
    error_alloc_tree_groups = BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS,
    error_alloc_context_map = BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP,
    error_alloc_ring_buffer_1 = BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1,
    error_alloc_ring_buffer_2 = BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2,
    error_alloc_block_type_trees = BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES,
    error_unreachable = BROTLI_DECODER_ERROR_UNREACHABLE,
};
pub const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: u32 = 0;
pub const BROTLI_DECODER_PARAM_LARGE_WINDOW: u32 = 1;
pub const BrotliDecoderParameter = enum(u32) {
    disable_ring_buffer_reallocation = BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION,
    large_window = BROTLI_DECODER_PARAM_LARGE_WINDOW,
};
pub extern fn BrotliDecoderSetParameter(state: ?*BrotliDecoderState, param: BrotliEncoderParameter, value: u32) c_int;
pub extern fn BrotliDecoderAttachDictionary(state: ?*BrotliDecoderState, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8) c_int;
pub extern fn BrotliDecoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliDecoderState;
pub extern fn BrotliDecoderDestroyInstance(state: ?*BrotliDecoderState) void;
pub extern fn BrotliDecoderDecompress(encoded_size: usize, encoded_buffer: [*]const u8, decoded_size: *usize, decoded_buffer: [*]u8) BrotliDecoderResult;
pub extern fn BrotliDecoderDecompressStream(state: *BrotliDecoderState, available_in: *usize, next_in: *[*]const u8, available_out: *usize, next_out: *[*]u8, total_out: ?*usize) BrotliDecoderResult;
pub extern fn BrotliDecoderHasMoreOutput(state: *const BrotliDecoderState) c_int;
pub extern fn BrotliDecoderTakeOutput(state: *BrotliDecoderState, size: *usize) ?[*]const u8;
pub extern fn BrotliDecoderIsUsed(state: ?*const BrotliDecoderState) c_int;
pub extern fn BrotliDecoderIsFinished(state: ?*const BrotliDecoderState) c_int;
pub extern fn BrotliDecoderGetErrorCode(state: ?*const BrotliDecoderState) BrotliDecoderErrorCode;
pub extern fn BrotliDecoderErrorString(c: BrotliDecoderErrorCode) [*c]const u8;
pub extern fn BrotliDecoderVersion() u32;
pub const brotli_decoder_metadata_start_func = ?*const fn (?*anyopaque, usize) callconv(.C) void;
pub const brotli_decoder_metadata_chunk_func = ?*const fn (?*anyopaque, [*c]const u8, usize) callconv(.C) void;
pub extern fn BrotliDecoderSetMetadataCallbacks(state: ?*BrotliDecoderState, start_func: brotli_decoder_metadata_start_func, chunk_func: brotli_decoder_metadata_chunk_func, @"opaque": ?*anyopaque) void;
pub const BROTLI_TRUE = @as(c_int, 1);
pub const BROTLI_FALSE = @as(c_int, 0);
pub const BROTLI_UINT32_MAX = ~@import("std").zig.c_translation.cast(u32, @as(c_int, 0));
pub const BROTLI_SIZE_MAX = ~@import("std").zig.c_translation.cast(usize, @as(c_int, 0));
pub const SHARED_BROTLI_MIN_DICTIONARY_WORD_LENGTH = @as(c_int, 4);
pub const SHARED_BROTLI_MAX_DICTIONARY_WORD_LENGTH = @as(c_int, 31);
pub const SHARED_BROTLI_NUM_DICTIONARY_CONTEXTS = @as(c_int, 64);
pub const SHARED_BROTLI_MAX_COMPOUND_DICTS = @as(c_int, 15);
pub const BROTLI_LAST_ERROR_CODE = BROTLI_DECODER_ERROR_UNREACHABLE;
pub const BrotliSharedDictionaryStruct = struct_BrotliSharedDictionaryStruct;

pub const BROTLI_MODE_GENERIC: u32 = 0;
pub const BROTLI_MODE_TEXT: u32 = 1;
pub const BROTLI_MODE_FONT: u32 = 2;
pub const BrotliEncoderMode = enum(u32) {
    generic = BROTLI_MODE_GENERIC,
    text = BROTLI_MODE_TEXT,
    font = BROTLI_MODE_FONT,
    _,
};
pub const BROTLI_OPERATION_PROCESS: u32 = 0;
pub const BROTLI_OPERATION_FLUSH: u32 = 1;
pub const BROTLI_OPERATION_FINISH: u32 = 2;
pub const BROTLI_OPERATION_EMIT_METADATA: u32 = 3;
pub const BrotliEncoderOperation = enum(u32) {
    process = BROTLI_OPERATION_PROCESS,
    flush = BROTLI_OPERATION_FLUSH,
    finish = BROTLI_OPERATION_FINISH,
    emit_metadata = BROTLI_OPERATION_EMIT_METADATA,
    _,
};
pub const BROTLI_PARAM_MODE: u32 = 0;
pub const BROTLI_PARAM_QUALITY: u32 = 1;
pub const BROTLI_PARAM_LGWIN: u32 = 2;
pub const BROTLI_PARAM_LGBLOCK: u32 = 3;
pub const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: u32 = 4;
pub const BROTLI_PARAM_SIZE_HINT: u32 = 5;
pub const BROTLI_PARAM_LARGE_WINDOW: u32 = 6;
pub const BROTLI_PARAM_NPOSTFIX: u32 = 7;
pub const BROTLI_PARAM_NDIRECT: u32 = 8;
pub const BROTLI_PARAM_STREAM_OFFSET: u32 = 9;
pub const BrotliEncoderParameter = enum(u32) {
    mode = BROTLI_PARAM_MODE,
    quality = BROTLI_PARAM_QUALITY,
    lgwin = BROTLI_PARAM_LGWIN,
    lgblock = BROTLI_PARAM_LGBLOCK,
    disable_literal_context_modeling = BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING,
    size_hint = BROTLI_PARAM_SIZE_HINT,
    large_window = BROTLI_PARAM_LARGE_WINDOW,
    npostfix = BROTLI_PARAM_NPOSTFIX,
    ndirect = BROTLI_PARAM_NDIRECT,
    stream_offset = BROTLI_PARAM_STREAM_OFFSET,
    _,
};
pub const struct_BrotliEncoderStateStruct = opaque {};
pub const BrotliEncoderState = struct_BrotliEncoderStateStruct;
pub extern fn BrotliEncoderSetParameter(state: ?*BrotliEncoderState, param: BrotliEncoderParameter, value: u32) c_int;
pub extern fn BrotliEncoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, ctx: ?*anyopaque) ?*BrotliEncoderState;
pub extern fn BrotliEncoderDestroyInstance(state: ?*BrotliEncoderState) void;
pub const struct_BrotliEncoderPreparedDictionaryStruct = opaque {};
pub const BrotliEncoderPreparedDictionary = struct_BrotliEncoderPreparedDictionaryStruct;
pub extern fn BrotliEncoderPrepareDictionary(@"type": BrotliSharedDictionaryType, data_size: usize, data: [*c]const u8, quality: c_int, alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliEncoderPreparedDictionary;
pub extern fn BrotliEncoderDestroyPreparedDictionary(dictionary: ?*BrotliEncoderPreparedDictionary) void;
pub extern fn BrotliEncoderAttachPreparedDictionary(state: ?*BrotliEncoderState, dictionary: ?*const BrotliEncoderPreparedDictionary) c_int;
pub extern fn BrotliEncoderMaxCompressedSize(input_size: usize) usize;
pub extern fn BrotliEncoderCompress(quality: c_int, lgwin: c_int, mode: BrotliEncoderMode, input_size: usize, input_buffer: [*]const u8, encoded_size: *usize, encoded_buffer: [*]u8) c_int;
pub extern fn BrotliEncoderCompressStream(state: *BrotliEncoderState, op: BrotliEncoderOperation, available_in: *usize, next_in: *[*]const u8, available_out: *usize, next_out: *?[*]u8, total_out: *usize) c_int;
pub extern fn BrotliEncoderIsFinished(state: *BrotliEncoderState) c_int;
pub extern fn BrotliEncoderHasMoreOutput(state: *BrotliEncoderState) c_int;
pub extern fn BrotliEncoderTakeOutput(state: *BrotliEncoderState, size: [*c]usize) [*c]const u8;
pub extern fn BrotliEncoderEstimatePeakMemoryUsage(quality: c_int, lgwin: c_int, input_size: usize) usize;
pub extern fn BrotliEncoderGetPreparedDictionarySize(dictionary: ?*const BrotliEncoderPreparedDictionary) usize;
pub extern fn BrotliEncoderVersion() u32;
pub const BROTLI_ENC_ENCODE_H_ = "";
pub const BROTLI_MIN_WINDOW_BITS = @as(c_int, 10);
pub const BROTLI_MAX_WINDOW_BITS = @as(c_int, 24);
pub const BROTLI_LARGE_MAX_WINDOW_BITS = @as(c_int, 30);
pub const BROTLI_MIN_INPUT_BLOCK_BITS = @as(c_int, 16);
pub const BROTLI_MAX_INPUT_BLOCK_BITS = @as(c_int, 24);
pub const BROTLI_MIN_QUALITY = @as(c_int, 0);
pub const BROTLI_MAX_QUALITY = @as(c_int, 11);
pub const BROTLI_DEFAULT_QUALITY = @as(c_int, 11);
pub const BROTLI_DEFAULT_WINDOW = @as(c_int, 22);
pub const BROTLI_DEFAULT_MODE = BROTLI_MODE_GENERIC;
pub const BrotliEncoderStateStruct = struct_BrotliEncoderStateStruct;
pub const BrotliEncoderPreparedDictionaryStruct = struct_BrotliEncoderPreparedDictionaryStruct;
