// TODO: prefer generating this file via bindgen

#![allow(non_camel_case_types, non_snake_case)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_str::ZStr;

pub type brotli_alloc_func = Option<unsafe extern "C" fn(opaque: *mut c_void, size: usize) -> *mut c_void>;
pub type brotli_free_func = Option<unsafe extern "C" fn(opaque: *mut c_void, address: *mut c_void)>;

#[repr(C)]
pub struct struct_BrotliSharedDictionaryStruct {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}
pub type BrotliSharedDictionary = struct_BrotliSharedDictionaryStruct;

pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub const BROTLI_SHARED_DICTIONARY_SERIALIZED: c_int = 1;
pub type enum_BrotliSharedDictionaryType = c_uint;
pub type BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;

// pub extern fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: ?*anyopaque) ?*BrotliSharedDictionary;
// pub extern fn BrotliSharedDictionaryDestroyInstance(dict: ?*BrotliSharedDictionary) void;
// pub extern fn BrotliSharedDictionaryAttach(dict: ?*BrotliSharedDictionary, type: BrotliSharedDictionaryType, data_size: usize, data: [*]const u8) c_int;

unsafe extern "C" {
    pub fn BrotliDecoderSetParameter(state: *mut BrotliDecoder, param: c_uint, value: u32) -> c_int;
    pub fn BrotliDecoderAttachDictionary(state: *mut BrotliDecoder, type_: BrotliSharedDictionaryType, data_size: usize, data: *const u8) -> c_int;
    pub fn BrotliDecoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> *mut BrotliDecoder;
    pub fn BrotliDecoderDestroyInstance(state: *mut BrotliDecoder);
    pub fn BrotliDecoderDecompress(encoded_size: usize, encoded_buffer: *const u8, decoded_size: *mut usize, decoded_buffer: *mut u8) -> BrotliDecoderResult;
    pub fn BrotliDecoderDecompressStream(state: *mut BrotliDecoder, available_in: *mut usize, next_in: *mut *const u8, available_out: *mut usize, next_out: *mut *mut u8, total_out: *mut usize) -> BrotliDecoderResult;
    pub fn BrotliDecoderHasMoreOutput(state: *const BrotliDecoder) -> c_int;
    pub fn BrotliDecoderTakeOutput(state: *mut BrotliDecoder, size: *mut usize) -> *const u8;
    pub fn BrotliDecoderIsUsed(state: *const BrotliDecoder) -> c_int;
    pub fn BrotliDecoderIsFinished(state: *const BrotliDecoder) -> c_int;
    pub fn BrotliDecoderGetErrorCode(state: *const BrotliDecoder) -> BrotliDecoderErrorCode2;
    pub fn BrotliDecoderErrorString(c: BrotliDecoderErrorCode) -> *const c_char;
    pub fn BrotliDecoderVersion() -> u32;
}

#[repr(C)]
pub struct BrotliDecoder {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[allow(dead_code)]
type BrotliDecoderSetMetadataCallbacks = unsafe extern "C" fn(state: *mut BrotliDecoder, start_func: brotli_decoder_metadata_start_func, chunk_func: brotli_decoder_metadata_chunk_func, opaque: *mut c_void);
#[allow(dead_code)]
type brotli_decoder_metadata_start_func = Option<unsafe extern "C" fn(opaque: *mut c_void, size: usize)>;
#[allow(dead_code)]
type brotli_decoder_metadata_chunk_func = Option<unsafe extern "C" fn(opaque: *mut c_void, data: *const u8, size: usize)>;

impl BrotliDecoder {
    pub fn set_parameter(state: &mut BrotliDecoder, param: BrotliDecoderParameter, value: u32) -> bool {
        // SAFETY: state is a valid &mut BrotliDecoder
        unsafe { BrotliDecoderSetParameter(state, param as c_uint, value) > 0 }
    }

    pub fn attach_dictionary(state: &mut BrotliDecoder, type_: BrotliSharedDictionaryType, data: &[u8]) -> c_int {
        // SAFETY: state is a valid &mut BrotliDecoder; data.ptr/len are a valid slice
        unsafe { BrotliDecoderAttachDictionary(state, type_, data.len(), data.as_ptr()) }
    }

    pub fn create_instance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> Option<&'static mut BrotliDecoder> {
        // SAFETY: FFI constructor; null on failure
        unsafe { BrotliDecoderCreateInstance(alloc_func, free_func, opaque).as_mut() }
    }

    pub fn destroy_instance(state: &mut BrotliDecoder) {
        // SAFETY: state is a valid &mut BrotliDecoder allocated by create_instance
        unsafe { BrotliDecoderDestroyInstance(state) }
    }

    pub fn decompress(encoded: &[u8], decoded: &mut &mut [u8]) -> BrotliDecoderResult {
        let mut decoded_size = decoded.len();
        let decoded_ptr = decoded.as_mut_ptr();
        // SAFETY: encoded/decoded are valid slices; decoded_size is in-out
        let result = unsafe { BrotliDecoderDecompress(encoded.len(), encoded.as_ptr(), &mut decoded_size, decoded_ptr) };
        // PORT NOTE: reshaped for borrowck — Zig mutated `decoded.len` in place via `*[]u8`
        // SAFETY: decoded_ptr points to the same allocation; decoded_size <= original len per brotli contract
        *decoded = unsafe { core::slice::from_raw_parts_mut(decoded_ptr, decoded_size) };
        result
    }

    pub fn decompress_stream(state: &mut BrotliDecoder, available_in: &mut usize, next_in: &mut *const u8, available_out: &mut usize, next_out: &mut *mut u8, total_out: Option<&mut usize>) -> BrotliDecoderResult {
        // SAFETY: all pointers are valid for the duration of the call; brotli advances next_in/next_out
        unsafe {
            BrotliDecoderDecompressStream(
                state,
                available_in,
                next_in,
                available_out,
                next_out,
                total_out.map(|p| p as *mut usize).unwrap_or(core::ptr::null_mut()),
            )
        }
    }

    pub fn has_more_output(state: &BrotliDecoder) -> bool {
        // SAFETY: state is a valid &BrotliDecoder
        unsafe { BrotliDecoderHasMoreOutput(state) != 0 }
    }

    pub fn take_output(state: &mut BrotliDecoder) -> &[u8] {
        let mut max_size: usize = usize::MAX;
        // SAFETY: state is a valid &mut BrotliDecoder; max_size is in-out
        let ptr = unsafe { BrotliDecoderTakeOutput(state, &mut max_size) };
        if ptr.is_null() {
            return b"";
        }
        // SAFETY: brotli returns a pointer to an internal buffer of `max_size` bytes,
        // valid until the next decoder call
        unsafe { core::slice::from_raw_parts(ptr, max_size) }
    }

    pub fn is_used(state: &BrotliDecoder) -> bool {
        // SAFETY: state is a valid &BrotliDecoder
        unsafe { BrotliDecoderIsUsed(state) != 0 }
    }

    pub fn is_finished(state: &BrotliDecoder) -> bool {
        // SAFETY: state is a valid &BrotliDecoder
        unsafe { BrotliDecoderIsFinished(state) != 0 }
    }

    pub fn get_error_code(state: &BrotliDecoder) -> BrotliDecoderErrorCode {
        // SAFETY: state is a valid &BrotliDecoder; BrotliDecoderErrorCode2 is a superset of BrotliDecoderErrorCode discriminants
        unsafe { core::mem::transmute::<i32, BrotliDecoderErrorCode>(BrotliDecoderGetErrorCode(state) as i32) }
    }

    pub fn error_string(c: BrotliDecoderErrorCode) -> &'static ZStr {
        // SAFETY: BrotliDecoderErrorString returns a static NUL-terminated string (or null)
        let ptr = unsafe { BrotliDecoderErrorString(c) };
        if ptr.is_null() {
            return ZStr::EMPTY;
        }
        // SAFETY: ptr is a valid NUL-terminated static string from brotli
        unsafe { ZStr::from_ptr(ptr.cast::<u8>()) }
    }

    pub fn version() -> u32 {
        // SAFETY: pure FFI getter
        unsafe { BrotliDecoderVersion() }
    }

    pub fn initialize_brotli() -> bool {
        true
    }
}

#[repr(u32)] // Zig: enum(c_uint)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderResult {
    err = 0,
    success = 1,
    needs_more_input = 2,
    needs_more_output = 3,
}

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

#[repr(i32)] // Zig: enum(c_int)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderErrorCode {
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
}

#[repr(i32)] // Zig: enum(c_int)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderErrorCode2 {
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
}

pub const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: c_int = 0;
pub const BROTLI_DECODER_PARAM_LARGE_WINDOW: c_int = 1;

#[repr(u32)] // Zig: enum(c_uint)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderParameter {
    DISABLE_RING_BUFFER_REALLOCATION = 0,
    LARGE_WINDOW = 1,
}

pub const BROTLI_UINT32_MAX: u32 = !0u32;
pub const BROTLI_SIZE_MAX: usize = !0usize;
pub const BROTLI_LAST_ERROR_CODE: c_int = BROTLI_DECODER_ERROR_UNREACHABLE;
pub type BrotliSharedDictionaryStruct = struct_BrotliSharedDictionaryStruct;

#[repr(C)]
pub struct struct_BrotliEncoderPreparedDictionaryStruct {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}
pub type BrotliEncoderPreparedDictionary = struct_BrotliEncoderPreparedDictionaryStruct;

unsafe extern "C" {
    fn BrotliSharedDictionaryCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> *mut BrotliSharedDictionary;
    fn BrotliSharedDictionaryDestroyInstance(dict: *mut BrotliSharedDictionary);
    fn BrotliSharedDictionaryAttach(dict: *mut BrotliSharedDictionary, type_: BrotliSharedDictionaryType, data_size: usize, data: *const u8) -> c_int;
}

pub const BROTLI_MODE_GENERIC: c_int = 0;
pub const BROTLI_MODE_TEXT: c_int = 1;
pub const BROTLI_MODE_FONT: c_int = 2;

#[repr(u32)] // Zig: enum(c_uint)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliEncoderMode {
    generic = 0,
    text = 1,
    font = 2,
}

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

#[repr(u32)] // Zig: enum(c_uint)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliEncoderParameter {
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
}

unsafe extern "C" {
    pub fn BrotliEncoderSetParameter(state: *mut BrotliEncoder, param: c_uint, value: u32) -> c_int;
    pub fn BrotliEncoderCreateInstance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> *mut BrotliEncoder;
    pub fn BrotliEncoderDestroyInstance(state: *mut BrotliEncoder);
    pub fn BrotliEncoderPrepareDictionary(type_: BrotliSharedDictionaryType, data_size: usize, data: *const u8, quality: c_int, alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> *mut BrotliEncoderPreparedDictionary;
    pub fn BrotliEncoderDestroyPreparedDictionary(dictionary: *mut BrotliEncoderPreparedDictionary);
    pub fn BrotliEncoderAttachPreparedDictionary(state: *mut BrotliEncoder, dictionary: *const BrotliEncoderPreparedDictionary) -> c_int;
    pub fn BrotliEncoderMaxCompressedSize(input_size: usize) -> usize;
    pub fn BrotliEncoderCompress(quality: c_int, lgwin: c_int, mode: BrotliEncoderMode, input_size: usize, input_buffer: *const u8, encoded_size: *mut usize, encoded_buffer: *mut u8) -> c_int;
    pub fn BrotliEncoderCompressStream(state: *mut BrotliEncoder, op: BrotliEncoderOperation, available_in: *mut usize, next_in: *mut *const u8, available_out: *mut usize, next_out: *mut *mut u8, total_out: *mut usize) -> c_int;
    pub fn BrotliEncoderIsFinished(state: *mut BrotliEncoder) -> c_int;
    pub fn BrotliEncoderHasMoreOutput(state: *mut BrotliEncoder) -> c_int;
    pub fn BrotliEncoderTakeOutput(state: *mut BrotliEncoder, size: *mut usize) -> *const u8;
    pub fn BrotliEncoderEstimatePeakMemoryUsage(quality: c_int, lgwin: c_int, input_size: usize) -> usize;
    pub fn BrotliEncoderGetPreparedDictionarySize(dictionary: *const BrotliEncoderPreparedDictionary) -> usize;
    pub fn BrotliEncoderVersion() -> u32;
}

#[repr(C)]
pub struct BrotliEncoder {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u32)] // Zig: enum(c_uint)
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliEncoderOperation {
    process = 0,
    flush = 1,
    finish = 2,
    emit_metadata = 3,
}

// TODO(port): lifetime — `output` borrows the encoder's internal buffer until the next encoder call.
// Phase A forbids struct lifetime params; using &'static [u8] as a placeholder (Phase B decides Box<[u8]> vs raw *const [u8] vs lifetime).
#[derive(Default)]
pub struct CompressionResult {
    pub success: bool,
    pub has_more: bool,
    pub output: &'static [u8],
}

impl BrotliEncoder {
    pub type Operation = BrotliEncoderOperation;

    pub fn create_instance(alloc_func: brotli_alloc_func, free_func: brotli_free_func, opaque: *mut c_void) -> Option<&'static mut BrotliEncoder> {
        // SAFETY: FFI constructor; null on failure
        unsafe { BrotliEncoderCreateInstance(alloc_func, free_func, opaque).as_mut() }
    }

    pub fn destroy_instance(state: &mut BrotliEncoder) {
        // SAFETY: state is a valid &mut BrotliEncoder allocated by create_instance
        unsafe { BrotliEncoderDestroyInstance(state) }
    }

    pub fn has_more_output(state: &mut BrotliEncoder) -> bool {
        // SAFETY: state is a valid &mut BrotliEncoder
        unsafe { BrotliEncoderHasMoreOutput(state) > 0 }
    }

    pub fn take_output(state: &mut BrotliEncoder) -> &[u8] {
        let mut size: usize = 0;
        // SAFETY: state is a valid &mut BrotliEncoder; size is in-out
        let ptr = unsafe { BrotliEncoderTakeOutput(state, &mut size) };
        if !ptr.is_null() {
            // SAFETY: brotli returns a pointer to an internal buffer of `size` bytes,
            // valid until the next encoder call
            return unsafe { core::slice::from_raw_parts(ptr, size) };
        }

        b""
    }

    // https://github.com/google/brotli/blob/2ad58d8603294f5ee33d23bb725e0e6a17c1de50/go/cbrotli/writer.go#L23-L40
    pub fn compress_stream(state: &mut BrotliEncoder, op: BrotliEncoderOperation, data: &[u8]) -> CompressionResult {
        let mut available_in = data.len();
        let mut next_in: *const u8 = data.as_ptr();

        let mut available_out: usize = 0;

        let mut result = CompressionResult::default();

        // SAFETY: state is a valid &mut BrotliEncoder; in/out pointers are valid;
        // next_out is null (we use take_output below); total_out is null (unused)
        result.success = unsafe {
            BrotliEncoderCompressStream(state, op, &mut available_in, &mut next_in, &mut available_out, core::ptr::null_mut(), core::ptr::null_mut()) > 0
        };

        if result.success {
            result.output = Self::take_output(state);
        }

        // SAFETY: state is a valid &mut BrotliEncoder
        result.has_more = unsafe { BrotliEncoderHasMoreOutput(state) > 0 };

        result
    }

    pub fn set_parameter(state: &mut BrotliEncoder, param: BrotliEncoderParameter, value: u32) -> bool {
        // SAFETY: state is a valid &mut BrotliEncoder
        unsafe { BrotliEncoderSetParameter(state, param as c_uint, value) > 0 }
    }
}

pub const SHARED_BROTLI_MIN_DICTIONARY_WORD_LENGTH: c_int = 4;
pub const SHARED_BROTLI_MAX_DICTIONARY_WORD_LENGTH: c_int = 31;
pub const SHARED_BROTLI_NUM_DICTIONARY_CONTEXTS: c_int = 64;
pub const SHARED_BROTLI_MAX_COMPOUND_DICTS: c_int = 15;
pub const BROTLI_MIN_WINDOW_BITS: c_int = 10;
pub const BROTLI_MAX_WINDOW_BITS: c_int = 24;
pub const BROTLI_LARGE_MAX_WINDOW_BITS: c_int = 30;
pub const BROTLI_MIN_INPUT_BLOCK_BITS: c_int = 16;
pub const BROTLI_MAX_INPUT_BLOCK_BITS: c_int = 24;
pub const BROTLI_MIN_QUALITY: c_int = 0;
pub const BROTLI_MAX_QUALITY: c_int = 11;
pub const BROTLI_DEFAULT_QUALITY: c_int = 11;
pub const BROTLI_DEFAULT_WINDOW: c_int = 22;
pub const BROTLI_DEFAULT_MODE: c_int = BROTLI_MODE_GENERIC;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/brotli_sys/brotli_c.zig (334 lines)
//   confidence: medium
//   todos:      1
//   notes:      inherent associated type `BrotliEncoder::Operation` is unstable; Phase B may flatten to module-level alias. get_error_code transmute is UB if brotli returns 0..3 (non-error) — matches Zig behavior. CompressionResult.output uses &'static [u8] placeholder (no struct lifetimes in Phase A); Phase B must reconcile with take_output borrow.
// ──────────────────────────────────────────────────────────────────────────
