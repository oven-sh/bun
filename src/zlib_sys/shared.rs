use core::ffi::{CStr, c_char, c_int, c_uint, c_ulong, c_void};

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
pub type gzFile = *mut struct_gzFile_s;

/// zlib's opaque `struct internal_state { int dummy; }` stub — applications
/// never look inside, only carry the pointer.
#[repr(C)]
pub struct struct_internal_state {
    dummy: c_int,
}

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
//        The inflate/deflate kind is not encoded in the type; the vendored
//        zlib-ng's StateCheck rejects a cross-kind call at runtime via
//        disjoint mode/status ranges (inflate `HEAD = 16180` onward, deflate
//        `INIT_STATE = 42`..`FINISH_STATE = 666`; deliberate since zlib
//        1.2.9), so `deflate_init2` then `inflate_end` returns
//        `Z_STREAM_ERROR` rather than corrupting.
//   (S2) `alloc_func`/`free_func` are both `None` (= null → zlib installs
//        its paired defaults) or a matched pair where `free_func` can free
//        what `alloc_func` allocates. Established by [`with_allocator`].
//   (B)  `next_in` is null, or readable for `avail_in` bytes and not
//        mutated through any other pointer while the window is live;
//        `next_out` is null or writable for `avail_out` bytes. Established
//        by [`set_input`]/[`set_output`]; the caller's `unsafe` promise
//        there is what makes [`inflate`]/[`deflate`]/[`deflate_params`]/
//        [`input_at`] safe methods.
//
// [`with_allocator`]: zStream_struct::with_allocator
// [`set_input`]: zStream_struct::set_input
// [`set_output`]: zStream_struct::set_output
// [`inflate`]: zStream_struct::inflate
// [`deflate`]: zStream_struct::deflate
// [`deflate_params`]: zStream_struct::deflate_params
// [`input_at`]: zStream_struct::input_at
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

    /// For deflate: `Z_BINARY`/`Z_TEXT`/`Z_UNKNOWN`. For inflate: a bitfield
    /// (unused bits + 64/128/256 flags), so this cannot be a Rust enum.
    data_type: c_int,

    /// Adler-32 or CRC-32 value of the uncompressed data
    pub adler: c_ulong,
    /// reserved for future use
    reserved: c_ulong,
}

pub type z_stream = zStream_struct;
pub type z_streamp = *mut z_stream;

// SAFETY: `#[repr(C)]` POD — raw pointers, integers, `Option<extern fn>`
// allocators. All-zero is the documented pre-`inflateInit`/`deflateInit`
// state and satisfies invariants (S1)/(S2)/(B).
unsafe impl bun_core::ffi::Zeroable for zStream_struct {}

impl Default for zStream_struct {
    #[inline]
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

impl zStream_struct {
    /// A zeroed stream with the given allocator pair.
    ///
    /// # Safety
    /// `alloc(opaque, items, size)` must return either null or a pointer to
    /// a writable allocation of `items * size` bytes, and `free` must accept
    /// exactly those pointers; this is the only place a caller vouches for
    /// invariant (S2). zlib defaults a null `zalloc` and null `zfree`
    /// independently, so passing only one of the two yields a
    /// cross-allocator free in `*_end()`.
    #[inline]
    pub unsafe fn with_allocator(alloc: alloc_func, free: free_func) -> Self {
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

    /// Byte `i` of the unconsumed input window, or `None` past `avail_in`.
    /// Safe by invariant (B); a raw-pointer byte read carries no aliasing
    /// assertion beyond "readable", matching [`set_input`](Self::set_input)'s
    /// contract exactly.
    #[inline(always)]
    pub fn input_at(&self, i: uInt) -> Option<u8> {
        if i >= self.avail_in || self.next_in.is_null() {
            return None;
        }
        // SAFETY: invariant (B) — `next_in` readable for `avail_in > i` bytes.
        Some(unsafe { self.next_in.add(i as usize).read() })
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
    /// `ptr[..len]` must be valid for reads, and not mutated through any
    /// other pointer, until the stream has consumed it (`avail_in() == 0`),
    /// the window is replaced by another `set_input`, or the stream is
    /// dropped. This is the *only* place a caller vouches for invariant (B)
    /// on the input side; every method that reads the window
    /// ([`inflate`](Self::inflate), [`deflate`](Self::deflate),
    /// [`deflate_params`](Self::deflate_params),
    /// [`input_at`](Self::input_at)) relies on it.
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
        // SAFETY: `zlibVersion()` returns zlib's own static NUL-terminated
        // version string; (S1)/(S2) hold by construction.
        unsafe { raw::inflateInit2_(self, window_bits, raw::zlibVersion(), Z_STREAM_SIZE) }
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
        // SAFETY: `zlibVersion()` returns zlib's own static NUL-terminated
        // version string; (S1)/(S2) hold by construction.
        unsafe {
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
/// `strm`/`zalloc`/`zfree`/`state`, then read `state->strm` and
/// `state->mode`/`status` (disjoint ranges between inflate and deflate, see
/// (S1)), so a stream whose `internal_state` is null-or-zlib-owned returns
/// `Z_STREAM_ERROR` for a null or wrong-kind state rather than faulting.
/// `&mut z_stream` is ABI-identical to a non-null `z_streamp`. Functions that
/// read `next_in`/`next_out` (invariant (B)) stay `unsafe fn` and are fronted
/// by the safe methods above.
pub mod raw {
    use super::*;

    unsafe extern "C" {
        pub safe fn zlibVersion() -> *const c_char;
        pub safe fn compressBound(sourceLen: uLong) -> uLong;

        // -- end / reset / bound: (S1)+(S2) only --------------------------
        pub safe fn inflateEnd(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateEnd(strm: &mut z_stream) -> ReturnCode;
        pub safe fn inflateReset(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateReset(strm: &mut z_stream) -> ReturnCode;
        pub safe fn deflateBound(strm: &mut z_stream, sourceLen: uLong) -> uLong;

        // -- init: `version` is dereferenced when non-null ----------------
        pub unsafe fn inflateInit2_(
            strm: &mut z_stream,
            windowBits: c_int,
            version: *const c_char,
            stream_size: c_int,
        ) -> ReturnCode;
        pub unsafe fn deflateInit2_(
            strm: &mut z_stream,
            level: c_int,
            method: c_int,
            windowBits: c_int,
            memLevel: c_int,
            strategy: c_int,
            version: *const c_char,
            stream_size: c_int,
        ) -> ReturnCode;

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
