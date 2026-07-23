use core::ffi::{CStr, c_char, c_int, c_uint, c_ulong, c_void};

// #define Z_BINARY   0
// #define Z_TEXT     1
// #define Z_ASCII    Z_TEXT   /* for compatibility with 1.2.2 and earlier */
// #define Z_UNKNOWN  2
#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum DataType {
    Binary = 0,
    Text = 1,
    Unknown = 2,
}

// #define Z_OK            0
// #define Z_STREAM_END    1
// #define Z_NEED_DICT     2
// #define Z_ERRNO        (-1)
// #define Z_STREAM_ERROR (-2)
// #define Z_DATA_ERROR   (-3)
// #define Z_MEM_ERROR    (-4)
// #define Z_BUF_ERROR    (-5)
// #define Z_VERSION_ERROR (-6)
#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ReturnCode {
    Ok = 0,
    StreamEnd = 1,
    NeedDict = 2,
    ErrNo = -1,
    StreamError = -2,
    DataError = -3,
    MemError = -4,
    BufError = -5,
    VersionError = -6,
}

// #define Z_NO_FLUSH      0
// #define Z_PARTIAL_FLUSH 1
// #define Z_SYNC_FLUSH    2
// #define Z_FULL_FLUSH    3
// #define Z_FINISH        4
// #define Z_BLOCK         5
// #define Z_TREES         6
#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FlushValue {
    NoFlush = 0,
    PartialFlush = 1,
    /// Z_SYNC_FLUSH requests that inflate() flush as much output as possible to the output buffer
    SyncFlush = 2,
    FullFlush = 3,
    Finish = 4,

    /// Z_BLOCK requests that inflate() stop if and when it gets to the next / deflate block boundary When decoding the zlib or gzip format, this will / cause inflate() to return immediately after the header and before the / first block. When doing a raw inflate, inflate() will go ahead and / process the first block, and will return when it gets to the end of that / block, or when it runs out of data. / The Z_BLOCK option assists in appending to or combining deflate streams. / To assist in this, on return inflate() always sets strm->data_type to the / number of unused bits in the last byte taken from strm->next_in, plus 64 / if inflate() is currently decoding the last block in the deflate stream, / plus 128 if inflate() returned immediately after decoding an end-of-block / code or decoding the complete header up to just before the first byte of / the deflate stream. The end-of-block will not be indicated until all of / the uncompressed data from that block has been written to strm->next_out. / The number of unused bits may in general be greater than seven, except / when bit 7 of data_type is set, in which case the number of unused bits / will be less than eight. data_type is set as noted here every time / inflate() returns for all flush options, and so can be used to determine / the amount of currently consumed input in bits.
    Block = 5,

    /// The Z_TREES option behaves as Z_BLOCK does, but it also returns when the end of each deflate block header is reached, before any actual data in that block is decoded. This allows the caller to determine the length of the deflate block header for later use in random access within a deflate block. 256 is added to the value of strm->data_type when inflate() returns immediately after reaching the end of the deflate block header.
    Trees = 6,
}

// typedef voidpf (*alloc_func)(voidpf opaque, uInt items, uInt size);
// typedef void   (*free_func) (voidpf opaque, voidpf address);
pub type alloc_func = Option<unsafe extern "C" fn(*mut c_void, c_uint, c_uint) -> *mut c_void>;
pub type free_func = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;
// Legacy spellings the per-platform modules exported; keep both so downstream
// `pub use` re-exports stay source-compatible.
pub type z_alloc_fn = alloc_func;
pub type z_free_fn = free_func;
pub type z_alloc_func = alloc_func;
pub type z_free_func = free_func;

// ---------------------------------------------------------------------------
// zconf.h scalar typedefs — single source of truth.
//
// All resolve to ABI-identical primitives on every target Bun ships; `uLong`
// = `unsigned long` (4B on LLP64 Windows, 8B on LP64 Unix).
// ---------------------------------------------------------------------------
pub type Byte = u8;
pub type Bytef = u8;
pub type uInt = c_uint;
pub type uLong = c_ulong;
pub type uLongf = uLong;
pub type voidpf = *mut c_void;

// ---------------------------------------------------------------------------
// gzFile — opaque handle.
//
// zlib.h exposes `struct gzFile_s { unsigned have; unsigned char *next;
// z_off64_t pos; }` purely so the `gzgetc()` macro can inline a fast path;
// every other API treats `gzFile` as an opaque pointer. Bun never derefs it,
// so one definition suffices for all targets. `pos` is `z_off64_t` — `__int64`
// on Windows, `off64_t` on LP64 Unix — i.e. `i64` everywhere Bun ships, hence
// the divergence between the old win32.rs (`c_longlong`) and bun_zlib
// (`c_long`) copies was immaterial.
// ---------------------------------------------------------------------------
#[repr(C)]
pub struct struct_gzFile_s {
    pub have: c_uint,
    pub next: *mut u8,
    pub pos: i64,
}
pub type gzFile_s = struct_gzFile_s;
pub type gzFile = *mut struct_gzFile_s;

/// zlib's opaque `struct internal_state { int dummy; }` stub — applications
/// never look inside, only carry the pointer.
#[repr(C)]
pub struct struct_internal_state {
    dummy: c_int,
}
pub type internal_state = struct_internal_state;

// ---------------------------------------------------------------------------
// z_stream — single source of truth for both POSIX and Windows.
//
// zlib (and zlib-ng compat) typedef `uLong` as `unsigned long`, so one
// `c_ulong`-based definition is ABI-correct on LP64 (8-byte) *and* LLP64
// (4-byte) targets.
//
// Type invariants (enforced by field privacy; see the `safe fn` FFI decls
// below for what they discharge):
//
//   (S1) `internal_state` is null, or points to a live state allocated by
//        zlib for *this* stream (only zlib itself ever writes this field).
//   (S2) `alloc_func`/`free_func` are `None` (= null → zlib installs its
//        defaults) or `Some(valid fn ptr)`. `Option<extern fn>` already
//        makes an invalid non-null value unconstructible in safe Rust.
//   (B)  `next_in` is null or readable for `avail_in` bytes; `next_out` is
//        null or writable for `avail_out` bytes. Established by
//        [`set_input`]/[`set_output`]; the caller's `unsafe` promise there
//        is what makes [`inflate`]/[`deflate`]/[`deflate_params`]/
//        [`input`] safe methods.
//
// [`set_input`]: zStream_struct::set_input
// [`set_output`]: zStream_struct::set_output
// [`inflate`]: zStream_struct::inflate
// [`deflate`]: zStream_struct::deflate
// [`deflate_params`]: zStream_struct::deflate_params
// [`input`]: zStream_struct::input
// ---------------------------------------------------------------------------

// https://zlib.net/manual.html#Stream
#[repr(C)]
pub struct zStream_struct {
    /// next input byte
    next_in: *const u8,
    /// number of bytes available at next_in
    avail_in: c_uint,
    /// total number of input bytes read so far
    pub total_in: c_ulong,

    /// next output byte will go here
    next_out: *mut u8,
    /// remaining free space at next_out
    avail_out: c_uint,
    /// total number of bytes output so far
    pub total_out: c_ulong,

    /// last error message, NULL if no error
    err_msg: *const c_char,
    /// not visible by applications
    internal_state: *mut struct_internal_state,

    /// used to allocate the internal state
    alloc_func: alloc_func,
    /// used to free the internal state
    free_func: free_func,
    /// private data object passed to zalloc and zfree
    user_data: *mut c_void,

    /// best guess about the data type: binary or text for deflate, or the decoding state for inflate
    pub data_type: DataType,

    /// Adler-32 or CRC-32 value of the uncompressed data
    pub adler: c_ulong,
    /// reserved for future use
    reserved: c_ulong,
}

pub type z_stream = zStream_struct;
pub type z_streamp = *mut z_stream;
// Alternate spellings (win32.rs historically used these).
pub type struct_z_stream_s = zStream_struct;
pub type z_stream_s = zStream_struct;

// SAFETY: `#[repr(C)]` POD — raw pointers, integers, `Option<extern fn>`
// allocators, and `DataType` (a `#[repr(C)]` enum with `Binary = 0`). All-zero
// is the documented pre-`inflateInit`/`deflateInit` state and satisfies
// invariants (S1)/(S2)/(B).
unsafe impl bun_core::ffi::Zeroable for zStream_struct {}

impl Default for zStream_struct {
    #[inline]
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

impl zStream_struct {
    /// A zeroed stream with the given allocator thunks. `None`/`None` leaves
    /// them null so zlib installs its own defaults at `*Init*` time.
    #[inline]
    pub fn with_allocator(alloc: alloc_func, free: free_func) -> Self {
        Self {
            alloc_func: alloc,
            free_func: free,
            ..Default::default()
        }
    }

    #[inline(always)]
    pub fn avail_in(&self) -> uInt {
        self.avail_in
    }

    #[inline(always)]
    pub fn avail_out(&self) -> uInt {
        self.avail_out
    }

    /// The unconsumed input window `next_in[..avail_in]`. Safe by invariant
    /// (B); empty when no input is set.
    #[inline(always)]
    pub fn input(&self) -> &[u8] {
        if self.avail_in == 0 || self.next_in.is_null() {
            return &[];
        }
        // SAFETY: invariant (B) — `next_in` readable for `avail_in` bytes.
        unsafe { core::slice::from_raw_parts(self.next_in, self.avail_in as usize) }
    }

    /// zlib's `msg`: a NUL-terminated static string on error, null otherwise.
    #[inline]
    pub fn err_msg(&self) -> Option<&CStr> {
        if self.err_msg.is_null() {
            return None;
        }
        // SAFETY: zlib only ever stores pointers to its own static string
        // table (`z_errmsg[]`) or literals here; never caller-owned memory.
        Some(unsafe { CStr::from_ptr(self.err_msg) })
    }

    /// Point the input window at `ptr[..len]`.
    ///
    /// # Safety
    /// `ptr` must be readable for `len` bytes and remain so until the stream
    /// has consumed it (`avail_in() == 0`), the window is replaced by another
    /// `set_input`, or the stream is dropped. This is the *only* place a
    /// caller vouches for invariant (B) on the input side; every method that
    /// reads the window ([`inflate`](Self::inflate),
    /// [`deflate`](Self::deflate), [`deflate_params`](Self::deflate_params),
    /// [`input`](Self::input)) relies on it.
    #[inline(always)]
    pub unsafe fn set_input(&mut self, ptr: *const u8, len: uInt) {
        self.next_in = ptr;
        self.avail_in = len;
    }

    /// Point the output window at `ptr[..len]`.
    ///
    /// # Safety
    /// `ptr` must be writable for `len` bytes and remain so until the stream
    /// has filled it (`avail_out() == 0`), the window is replaced by another
    /// `set_output`, or the stream is dropped.
    #[inline(always)]
    pub unsafe fn set_output(&mut self, ptr: *mut u8, len: uInt) {
        self.next_out = ptr;
        self.avail_out = len;
    }

    /// `inflateInit2(strm, windowBits)` — the version/stream_size stamp that
    /// zlib's `_` suffix wants is supplied here.
    #[inline(always)]
    pub fn inflate_init2(&mut self, window_bits: c_int) -> ReturnCode {
        raw::inflateInit2_(self, window_bits, raw::zlibVersion(), Z_STREAM_SIZE)
    }

    /// `deflateInit2(strm, level, Z_DEFLATED, windowBits, memLevel, strategy)`.
    #[inline(always)]
    pub fn deflate_init2(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
    ) -> ReturnCode {
        raw::deflateInit2_(
            self,
            level,
            Z_DEFLATED,
            window_bits,
            mem_level,
            strategy,
            raw::zlibVersion(),
            Z_STREAM_SIZE,
        )
    }

    #[inline(always)]
    pub fn inflate_end(&mut self) -> ReturnCode {
        raw::inflateEnd(self)
    }

    #[inline(always)]
    pub fn deflate_end(&mut self) -> ReturnCode {
        raw::deflateEnd(self)
    }

    #[inline(always)]
    pub fn inflate_reset(&mut self) -> ReturnCode {
        raw::inflateReset(self)
    }

    #[inline(always)]
    pub fn deflate_reset(&mut self) -> ReturnCode {
        raw::deflateReset(self)
    }

    #[inline(always)]
    pub fn deflate_bound(&mut self, source_len: uLong) -> uLong {
        raw::deflateBound(self, source_len)
    }

    #[inline(always)]
    pub fn inflate_set_dictionary(&mut self, dict: &[u8]) -> ReturnCode {
        // SAFETY: `dict` is a valid slice; zlib reads exactly `dict.len()`
        // bytes and does not retain the pointer.
        unsafe { raw::inflateSetDictionary(self, dict.as_ptr(), clamp_uint(dict.len())) }
    }

    #[inline(always)]
    pub fn deflate_set_dictionary(&mut self, dict: &[u8]) -> ReturnCode {
        // SAFETY: as above. `deflateSetDictionary` saves/restores
        // `next_in`/`avail_in` internally without dereferencing the saved
        // values, so invariant (B) is not exercised.
        unsafe { raw::deflateSetDictionary(self, dict.as_ptr(), clamp_uint(dict.len())) }
    }

    /// `inflate(strm, flush)`. Safe by invariants (S1)/(S2)/(B).
    #[inline(always)]
    pub fn inflate(&mut self, flush: FlushValue) -> ReturnCode {
        // SAFETY: invariant (B) — established by `set_input`/`set_output`.
        unsafe { raw::inflate(self, flush) }
    }

    /// `deflate(strm, flush)`. Safe by invariants (S1)/(S2)/(B).
    #[inline(always)]
    pub fn deflate(&mut self, flush: FlushValue) -> ReturnCode {
        // SAFETY: invariant (B) — established by `set_input`/`set_output`.
        unsafe { raw::deflate(self, flush) }
    }

    /// `deflateParams(strm, level, strategy)`. May flush pending input via an
    /// internal `deflate(Z_BLOCK)`, so invariant (B) applies.
    #[inline(always)]
    pub fn deflate_params(&mut self, level: c_int, strategy: c_int) -> ReturnCode {
        // SAFETY: invariant (B) — established by `set_input`/`set_output`.
        unsafe { raw::deflateParams(self, level, strategy) }
    }
}

#[inline(always)]
fn clamp_uint(n: usize) -> uInt {
    n.min(uInt::MAX as usize) as uInt
}

const Z_DEFLATED: c_int = 8;
const Z_STREAM_SIZE: c_int = core::mem::size_of::<zStream_struct>() as c_int;

/// Direct `extern "C"` declarations.
///
/// Every `safe fn` below is total given `z_stream`'s type invariants
/// (S1)/(S2): zlib-ng's `inflateStateCheck`/`deflateStateCheck` null-check
/// `strm`, `zalloc`/`zfree`, and `state` before dereferencing, so a stream
/// whose `internal_state` is null-or-zlib-owned cannot fault there. `&mut
/// z_stream` is ABI-identical to a non-null `z_streamp`. Functions that read
/// `next_in`/`next_out` (invariant (B)) stay `unsafe fn` and are fronted by
/// the safe methods above.
pub mod raw {
    use super::*;

    unsafe extern "C" {
        pub safe fn zlibVersion() -> *const c_char;
        pub safe fn compressBound(sourceLen: uLong) -> uLong;
        pub safe fn zError(err: c_int) -> *const u8;

        // -- init / end / reset: (S1)+(S2) only ---------------------------
        pub safe fn inflateInit2_(
            strm: &mut z_stream,
            windowBits: c_int,
            version: *const c_char,
            stream_size: c_int,
        ) -> ReturnCode;
        pub safe fn deflateInit2_(
            strm: &mut z_stream,
            level: c_int,
            method: c_int,
            windowBits: c_int,
            memLevel: c_int,
            strategy: c_int,
            version: *const c_char,
            stream_size: c_int,
        ) -> ReturnCode;
        pub safe fn inflateEnd(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateEnd(strm: &mut z_stream) -> ReturnCode;
        pub safe fn inflateReset(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateReset(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateBound(strm: &mut z_stream, sourceLen: uLong) -> uLong;

        // -- read next_in / write next_out: (B) required ------------------
        pub unsafe fn inflate(strm: &mut z_stream, flush: FlushValue) -> ReturnCode;
        pub unsafe fn deflate(strm: &mut z_stream, flush: FlushValue) -> ReturnCode;
        pub unsafe fn deflateParams(
            strm: &mut z_stream,
            level: c_int,
            strategy: c_int,
        ) -> ReturnCode;

        // -- ptr+len → &[u8] wrappers above -------------------------------
        pub unsafe fn inflateSetDictionary(
            strm: &mut z_stream,
            dictionary: *const Bytef,
            dictLength: uInt,
        ) -> ReturnCode;
        pub unsafe fn deflateSetDictionary(
            strm: &mut z_stream,
            dictionary: *const Bytef,
            dictLength: uInt,
        ) -> ReturnCode;
        pub unsafe fn crc32(crc: uLong, buf: *const Bytef, len: uInt) -> uLong;
        pub unsafe fn compress2(
            dest: *mut Bytef,
            destLen: *mut uLongf,
            source: *const Bytef,
            sourceLen: uLong,
            level: c_int,
        ) -> ReturnCode;
    }
}
