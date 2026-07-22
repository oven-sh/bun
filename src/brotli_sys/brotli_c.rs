// TODO: prefer generating this file via bindgen

#![allow(non_camel_case_types, non_snake_case)]

use core::ffi::{c_char, c_int, c_uint, c_void};

pub type brotli_alloc_func =
    Option<unsafe extern "C" fn(opaque: *mut c_void, size: usize) -> *mut c_void>;
pub type brotli_free_func = Option<unsafe extern "C" fn(opaque: *mut c_void, address: *mut c_void)>;

bun_opaque::opaque_ffi! { pub struct struct_BrotliSharedDictionaryStruct; }

pub const BROTLI_SHARED_DICTIONARY_RAW: c_int = 0;
pub type enum_BrotliSharedDictionaryType = c_uint;
pub type BrotliSharedDictionaryType = enum_BrotliSharedDictionaryType;

// Not bound: BrotliSharedDictionaryCreateInstance, BrotliSharedDictionaryDestroyInstance,
// BrotliSharedDictionaryAttach (unused).

unsafe extern "C" {
    // Opaque handle by reference + scalars only.
    pub safe fn BrotliDecoderSetParameter(
        state: &mut BrotliDecoder,
        param: c_uint,
        value: u32,
    ) -> c_int;
    pub fn BrotliDecoderAttachDictionary(
        state: *mut BrotliDecoder,
        type_: BrotliSharedDictionaryType,
        data_size: usize,
        data: *const u8,
    ) -> c_int;
    pub fn BrotliDecoderCreateInstance(
        alloc_func: brotli_alloc_func,
        free_func: brotli_free_func,
        opaque: *mut c_void,
    ) -> *mut BrotliDecoder;
    pub fn BrotliDecoderDestroyInstance(state: *mut BrotliDecoder);
    pub fn BrotliDecoderDecompress(
        encoded_size: usize,
        encoded_buffer: *const u8,
        decoded_size: *mut usize,
        decoded_buffer: *mut u8,
    ) -> BrotliDecoderResult;
    pub fn BrotliDecoderDecompressStream(
        state: *mut BrotliDecoder,
        available_in: *mut usize,
        next_in: *mut *const u8,
        available_out: *mut usize,
        next_out: *mut *mut u8,
        total_out: *mut usize,
    ) -> BrotliDecoderResult;
    // Query fns: opaque handle by reference + scalars only — `BrotliDecoder` is
    // `!Freeze` (UnsafeCell) so internal C mutation through `&` is sound.
    pub safe fn BrotliDecoderHasMoreOutput(state: &BrotliDecoder) -> c_int;
    pub safe fn BrotliDecoderTakeOutput(state: &mut BrotliDecoder, size: &mut usize) -> *const u8;
    pub safe fn BrotliDecoderIsUsed(state: &BrotliDecoder) -> c_int;
    pub safe fn BrotliDecoderIsFinished(state: &BrotliDecoder) -> c_int;
    pub safe fn BrotliDecoderGetErrorCode(state: &BrotliDecoder) -> BrotliDecoderErrorCode2;
    pub safe fn BrotliDecoderErrorString(c: BrotliDecoderErrorCode) -> *const c_char;
    pub safe fn BrotliDecoderVersion() -> u32;
}

bun_opaque::opaque_ffi! {
    /// Opaque brotli decoder state. `UnsafeCell` makes the type `!Freeze` so a
    /// `&BrotliDecoder` does not assert immutability of the C-owned state.
    pub struct BrotliDecoder;
}

impl BrotliDecoder {
    pub fn set_parameter(
        state: &mut BrotliDecoder,
        param: BrotliDecoderParameter,
        value: u32,
    ) -> bool {
        BrotliDecoderSetParameter(state, param as c_uint, value) > 0
    }

    /// # Safety
    /// `opaque` is forwarded to brotli's allocator hooks; it must be valid for
    /// every `alloc_func`/`free_func` invocation for the lifetime of the
    /// returned decoder (or null when the default allocator is used).
    pub unsafe fn create_instance(
        alloc_func: brotli_alloc_func,
        free_func: brotli_free_func,
        opaque: *mut c_void,
    ) -> Option<&'static mut BrotliDecoder> {
        // SAFETY: FFI constructor; null on failure
        unsafe { BrotliDecoderCreateInstance(alloc_func, free_func, opaque).as_mut() }
    }

    pub fn destroy_instance(state: &mut BrotliDecoder) {
        // SAFETY: state is a valid &mut BrotliDecoder allocated by create_instance
        unsafe { BrotliDecoderDestroyInstance(state) }
    }

    pub fn decompress_stream(
        state: &mut BrotliDecoder,
        available_in: &mut usize,
        next_in: &mut *const u8,
        available_out: &mut usize,
        next_out: &mut *mut u8,
        total_out: Option<&mut usize>,
    ) -> BrotliDecoderResult {
        // SAFETY: all pointers are valid for the duration of the call; brotli advances next_in/next_out
        unsafe {
            BrotliDecoderDecompressStream(
                state,
                available_in,
                next_in,
                available_out,
                next_out,
                total_out
                    .map(std::ptr::from_mut::<usize>)
                    .unwrap_or(core::ptr::null_mut()),
            )
        }
    }

    pub fn is_finished(state: &BrotliDecoder) -> bool {
        BrotliDecoderIsFinished(state) != 0
    }

    pub fn get_error_code(state: &BrotliDecoder) -> BrotliDecoderErrorCode {
        BrotliDecoderGetErrorCode(state)
    }

    pub fn version() -> u32 {
        BrotliDecoderVersion()
    }

    pub fn initialize_brotli() -> bool {
        true
    }
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderResult {
    err = 0,
    success = 1,
    needs_more_input = 2,
    needs_more_output = 3,
}

// NOTE: the duplicate error-code tables the upstream brotli headers define are
// intentionally collapsed into the single enum below; `BrotliDecoderErrorCode`
// is kept as an alias so FFI signatures keep their upstream names.
type BrotliDecoderErrorCode = BrotliDecoderErrorCode2;

#[repr(i32)]
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

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliDecoderParameter {
    DISABLE_RING_BUFFER_REALLOCATION = 0,
    LARGE_WINDOW = 1,
}

bun_opaque::opaque_ffi! { pub struct struct_BrotliEncoderPreparedDictionaryStruct; }
pub type BrotliEncoderPreparedDictionary = struct_BrotliEncoderPreparedDictionaryStruct;

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliEncoderMode {
    generic = 0,
    text = 1,
    font = 2,
}

#[repr(u32)]
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
    // Opaque handle by reference + scalars only.
    pub safe fn BrotliEncoderSetParameter(
        state: &mut BrotliEncoder,
        param: c_uint,
        value: u32,
    ) -> c_int;
    pub fn BrotliEncoderCreateInstance(
        alloc_func: brotli_alloc_func,
        free_func: brotli_free_func,
        opaque: *mut c_void,
    ) -> *mut BrotliEncoder;
    pub fn BrotliEncoderDestroyInstance(state: *mut BrotliEncoder);
    pub fn BrotliEncoderPrepareDictionary(
        type_: BrotliSharedDictionaryType,
        data_size: usize,
        data: *const u8,
        quality: c_int,
        alloc_func: brotli_alloc_func,
        free_func: brotli_free_func,
        opaque: *mut c_void,
    ) -> *mut BrotliEncoderPreparedDictionary;
    pub fn BrotliEncoderDestroyPreparedDictionary(dictionary: *mut BrotliEncoderPreparedDictionary);
    pub fn BrotliEncoderAttachPreparedDictionary(
        state: *mut BrotliEncoder,
        dictionary: *const BrotliEncoderPreparedDictionary,
    ) -> c_int;
    pub safe fn BrotliEncoderMaxCompressedSize(input_size: usize) -> usize;
    pub fn BrotliEncoderCompress(
        quality: c_int,
        lgwin: c_int,
        mode: BrotliEncoderMode,
        input_size: usize,
        input_buffer: *const u8,
        encoded_size: *mut usize,
        encoded_buffer: *mut u8,
    ) -> c_int;
    pub fn BrotliEncoderCompressStream(
        state: *mut BrotliEncoder,
        op: BrotliEncoderOperation,
        available_in: *mut usize,
        next_in: *mut *const u8,
        available_out: *mut usize,
        next_out: *mut *mut u8,
        total_out: *mut usize,
    ) -> c_int;
    // Query fns: opaque handle by reference + scalars only.
    pub safe fn BrotliEncoderIsFinished(state: &BrotliEncoder) -> c_int;
    pub safe fn BrotliEncoderHasMoreOutput(state: &BrotliEncoder) -> c_int;
    pub safe fn BrotliEncoderTakeOutput(state: &mut BrotliEncoder, size: &mut usize) -> *const u8;
    pub safe fn BrotliEncoderEstimatePeakMemoryUsage(
        quality: c_int,
        lgwin: c_int,
        input_size: usize,
    ) -> usize;
    pub fn BrotliEncoderGetPreparedDictionarySize(
        dictionary: *const BrotliEncoderPreparedDictionary,
    ) -> usize;
    pub safe fn BrotliEncoderVersion() -> u32;
}

bun_opaque::opaque_ffi! {
    /// Opaque brotli encoder state. `UnsafeCell` makes the type `!Freeze` so a
    /// `&BrotliEncoder` does not assert immutability of the C-owned state.
    pub struct BrotliEncoder;
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BrotliEncoderOperation {
    process = 0,
    flush = 1,
    finish = 2,
    emit_metadata = 3,
}

// `output` borrows the encoder's internal buffer; valid until the next encoder call.
pub struct CompressionResult<'a> {
    pub success: bool,
    pub output: &'a [u8],
}

impl<'a> Default for CompressionResult<'a> {
    fn default() -> Self {
        Self {
            success: false,
            output: b"",
        }
    }
}

impl BrotliEncoder {
    /// # Safety
    /// `opaque` is forwarded to brotli's allocator hooks; it must be valid for
    /// every `alloc_func`/`free_func` invocation for the lifetime of the
    /// returned encoder (or null when the default allocator is used).
    pub unsafe fn create_instance(
        alloc_func: brotli_alloc_func,
        free_func: brotli_free_func,
        opaque: *mut c_void,
    ) -> Option<&'static mut BrotliEncoder> {
        // SAFETY: FFI constructor; null on failure
        unsafe { BrotliEncoderCreateInstance(alloc_func, free_func, opaque).as_mut() }
    }

    pub fn destroy_instance(state: &mut BrotliEncoder) {
        // SAFETY: state is a valid &mut BrotliEncoder allocated by create_instance
        unsafe { BrotliEncoderDestroyInstance(state) }
    }

    // https://github.com/google/brotli/blob/2ad58d8603294f5ee33d23bb725e0e6a17c1de50/go/cbrotli/writer.go#L23-L40
    pub fn compress_stream<'a>(
        state: &'a mut BrotliEncoder,
        op: BrotliEncoderOperation,
        data: &[u8],
    ) -> CompressionResult<'a> {
        let mut available_in = data.len();
        let mut next_in: *const u8 = data.as_ptr();

        let mut available_out: usize = 0;

        // SAFETY: state is a valid &mut BrotliEncoder; in/out pointers are valid;
        // next_out is null (we use take_output below); total_out is null (unused)
        let success = unsafe {
            BrotliEncoderCompressStream(
                state,
                op,
                &raw mut available_in,
                &raw mut next_in,
                &raw mut available_out,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            ) > 0
        };

        let mut output: &'a [u8] = &[];
        if success {
            let mut size: usize = 0;
            let ptr = BrotliEncoderTakeOutput(state, &mut size);
            if !ptr.is_null() {
                // SAFETY: brotli returns a pointer to an internal buffer of `size` bytes,
                // valid until the next encoder call (bounded by 'a)
                output = unsafe { core::slice::from_raw_parts::<'a>(ptr, size) };
            }
        }

        CompressionResult {
            success,
            output,
        }
    }
}

pub const BROTLI_MIN_QUALITY: c_int = 0;
pub const BROTLI_MAX_QUALITY: c_int = 11;
pub const BROTLI_DEFAULT_WINDOW: c_int = 22;
