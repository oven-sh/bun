const bun = @import("root").bun;
const std = @import("std");

pub const brotli_alloc_func = ?*const fn (?*anyopaque, usize) callconv(.C) ?*anyopaque;
pub const brotli_free_func = ?*const fn (?*anyopaque, *anyopaque) callconv(.C) void;
pub const struct_BrotliSharedDictionaryStruct = opaque {};
pub const BrotliSharedDictionary = struct_BrotliSharedDictionaryStruct;
pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub const BROTLI_SHARED_DICTIONARY_SERIALIZED: c_int = 1;
pub const enum_BrotliSharedDictionaryType = c_uint;
pub const BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;
// pub extern fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) ?*BrotliSharedDictionary;
// pub extern fn BrotliSharedDictionaryDestroyInstance(dict: ?*BrotliSharedDictionary) void;
// pub extern fn BrotliSharedDictionaryAttach(dict: ?*BrotliSharedDictionary, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*]const u8) c_int;
pub const BrotliDecoder = opaque {
    extern "C" fn BrotliDecoderSetParameter(state: *BrotliDecoder, param: BrotliDecoderParameter, value: u32) callconv(.C) c_int;
    extern "C" fn BrotliDecoderAttachDictionary(state: *BrotliDecoder, @"type": BrotliSharedDictionaryType, data_size: usize, data: [*]const u8) callconv(.C) c_int;
    extern "C" fn BrotliDecoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.C) ?*BrotliDecoder;
    extern "C" fn BrotliDecoderDestroyInstance(state: *BrotliDecoder) callconv(.C) void;
    extern "C" fn BrotliDecoderDecompress(encoded_size: usize, encoded_buffer: [*]const u8, decoded_size: *usize, decoded_buffer: [*]u8) callconv(.C) BrotliDecoderResult;
    extern "C" fn BrotliDecoderDecompressStream(state: *BrotliDecoder, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_out: *?[*]u8, total_out: ?*usize) callconv(.C) BrotliDecoderResult;
    extern "C" fn BrotliDecoderHasMoreOutput(state: *const BrotliDecoder) callconv(.C) c_int;
    extern "C" fn BrotliDecoderTakeOutput(state: *BrotliDecoder, size: *usize) callconv(.C) ?[*]const u8;
    extern "C" fn BrotliDecoderIsUsed(state: *const BrotliDecoder) callconv(.C) c_int;
    extern "C" fn BrotliDecoderIsFinished(state: *const BrotliDecoder) callconv(.C) c_int;
    extern "C" fn BrotliDecoderGetErrorCode(state: *const BrotliDecoder) callconv(.C) BrotliDecoderErrorCode;
    extern "C" fn BrotliDecoderErrorString(c: BrotliDecoderErrorCode) callconv(.C) ?[*:0]const u8;
    extern "C" fn BrotliDecoderVersion() callconv(.C) u32;
    const BrotliDecoderSetMetadataCallbacks = fn (state: *BrotliDecoder, start_func: brotli_decoder_metadata_start_func, chunk_func: brotli_decoder_metadata_chunk_func, @"opaque": ?*anyopaque) callconv(.C) void;
    const brotli_decoder_metadata_start_func = ?*const fn (?*anyopaque, usize) callconv(.C) void;
    const brotli_decoder_metadata_chunk_func = ?*const fn (?*anyopaque, [*]const u8, usize) callconv(.C) void;

    pub fn setParameter(state: *BrotliDecoder, param: BrotliDecoderParameter, value: u32) callconv(.C) bool {
        return BrotliDecoderSetParameter(state, param, value) > 0;
    }

    pub fn attachDictionary(state: *BrotliDecoder, @"type": BrotliSharedDictionaryType, data: []const u8) callconv(.C) c_int {
        return BrotliDecoderAttachDictionary(state, @"type", data.len, data.ptr);
    }

    pub fn createInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, @"opaque": ?*anyopaque) callconv(.C) ?*BrotliDecoder {
        return BrotliDecoderCreateInstance(alloc_func, free_func, @"opaque");
    }

    pub fn destroyInstance(state: *BrotliDecoder) callconv(.C) void {
        return BrotliDecoderDestroyInstance(state);
    }

    pub fn decompress(encoded: []const u8, decoded: *[]u8) callconv(.C) BrotliDecoderResult {
        return BrotliDecoderDecompress(encoded.len, encoded.ptr, &decoded.len, decoded.ptr);
    }

    pub fn decompressStream(state: *BrotliDecoder, available_in: *usize, next_in: *?[*]const u8, available_out: *usize, next_out: *?[*]u8, total_out: ?*usize) callconv(.C) BrotliDecoderResult {
        return BrotliDecoderDecompressStream(state, available_in, next_in, available_out, next_out, total_out);
    }

    pub fn hasMoreOutput(state: *const BrotliDecoder) callconv(.C) bool {
        return BrotliDecoderHasMoreOutput(state) != 0;
    }

    pub fn takeOutput(state: *BrotliDecoder) callconv(.C) []const u8 {
        var max_size: usize = std.math.maxInt(usize);
        const ptr = BrotliDecoderTakeOutput(state, &max_size) orelse return "";
        return ptr[0..max_size];
    }

    pub fn isUsed(state: *const BrotliDecoder) callconv(.C) bool {
        return BrotliDecoderIsUsed(state) != 0;
    }

    pub fn isFinished(state: *const BrotliDecoder) callconv(.C) bool {
        return BrotliDecoderIsFinished(state) != 0;
    }

    pub fn getErrorCode(state: *const BrotliDecoder) callconv(.C) BrotliDecoderErrorCode {
        return BrotliDecoderGetErrorCode(state);
    }

    pub fn errorString(c: BrotliDecoderErrorCode) callconv(.C) [:0]const u8 {
        return bun.sliceTo(BrotliDecoderErrorString(c) orelse "", 0);
    }

    pub fn version() callconv(.C) u32 {
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
pub const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: c_int = 0;
pub const BROTLI_DECODER_PARAM_LARGE_WINDOW: c_int = 1;
pub const BrotliDecoderParameter = enum(c_uint) {
    DISABLE_RING_BUFFER_REALLOCATION = 0,
    LARGE_WINDOW = 1,
};

pub const BROTLI_UINT32_MAX = ~@import("std").zig.c_translation.cast(u32, @as(c_int, 0));
pub const BROTLI_SIZE_MAX = ~@import("std").zig.c_translation.cast(usize, @as(c_int, 0));
pub const SHARED_BROTLI_MIN_DICTIONARY_WORD_LENGTH = @as(c_int, 4);
pub const SHARED_BROTLI_MAX_DICTIONARY_WORD_LENGTH = @as(c_int, 31);
pub const SHARED_BROTLI_NUM_DICTIONARY_CONTEXTS = @as(c_int, 64);
pub const SHARED_BROTLI_MAX_COMPOUND_DICTS = @as(c_int, 15);
pub const BROTLI_LAST_ERROR_CODE = BROTLI_DECODER_ERROR_UNREACHABLE;
pub const BrotliSharedDictionaryStruct = struct_BrotliSharedDictionaryStruct;
