use core::ffi::c_int;

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

// ---------------------------------------------------------------------------
// z_stream — single source of truth for both POSIX and Windows.
//
// zlib (and zlib-ng compat) typedef `uLong` as `unsigned long`, so one
// `c_ulong`-based definition is ABI-correct on LP64 (8-byte) *and* LLP64
// (4-byte) targets. The two per-platform copies in posix.rs / win32.rs were
// already field-for-field identical; win32.rs had even normalized its
// `struct_internal_state` to match posix so rustc's
// `clashing_extern_declarations` lint saw the extern fns as compatible. This
// hoist makes that the actual single definition.
// ---------------------------------------------------------------------------
use core::ffi::{c_char, c_uint, c_ulong, c_void};

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
// Previously duplicated in win32.rs (translate-c output) and bun_zlib::lib.rs
// (hand-port of zlib.zig). All resolve to ABI-identical primitives on every
// target Bun ships; `uLong` = `unsigned long` (4B on LLP64 Windows, 8B on LP64
// Unix) for the same reason zStream_struct above uses `c_ulong` directly.
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

// https://zlib.net/manual.html#Stream
#[repr(C)]
pub struct zStream_struct {
    /// next input byte
    pub next_in: *const u8,
    /// number of bytes available at next_in
    pub avail_in: c_uint,
    /// total number of input bytes read so far
    pub total_in: c_ulong,

    /// next output byte will go here
    pub next_out: *mut u8,
    /// remaining free space at next_out
    pub avail_out: c_uint,
    /// total number of bytes output so far
    pub total_out: c_ulong,

    /// last error message, NULL if no error
    pub err_msg: *const c_char,
    /// not visible by applications
    pub internal_state: *mut struct_internal_state,

    /// used to allocate the internal state
    pub alloc_func: alloc_func,
    /// used to free the internal state
    pub free_func: free_func,
    /// private data object passed to zalloc and zfree
    pub user_data: *mut c_void,

    /// best guess about the data type: binary or text for deflate, or the decoding state for inflate
    pub data_type: DataType,

    /// Adler-32 or CRC-32 value of the uncompressed data
    pub adler: c_ulong,
    /// reserved for future use
    pub reserved: c_ulong,
}

pub type z_stream = zStream_struct;
pub type z_streamp = *mut z_stream;
// translate-c spellings (win32.rs historically used these).
pub type struct_z_stream_s = zStream_struct;
pub type z_stream_s = zStream_struct;

// SAFETY: `#[repr(C)]` POD — raw pointers, integers, `Option<extern fn>`
// allocators, and `DataType` (a `#[repr(C)]` enum with `Binary = 0`). All-zero
// is the documented pre-`inflateInit`/`deflateInit` state (S021).
unsafe impl bun_core::ffi::Zeroable for zStream_struct {}

// ported from: src/zlib_sys/shared.zig
