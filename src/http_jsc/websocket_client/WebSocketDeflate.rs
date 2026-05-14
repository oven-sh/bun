//! Manages the DEFLATE compression and decompression streams for a WebSocket connection.

use core::cell::Cell;
use core::ffi::c_int;

use bun_core::feature_flag;
use bun_jsc::rare_data::RareData as JscRareData;
use bun_libdeflate_sys::libdeflate as libdeflate_sys;
use bun_zlib as zlib;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Params {
    pub server_max_window_bits: u8,
    pub client_max_window_bits: u8,
    pub server_no_context_takeover: u8,
    pub client_no_context_takeover: u8,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            server_max_window_bits: 15,
            client_max_window_bits: 15,
            server_no_context_takeover: 0,
            client_no_context_takeover: 0,
        }
    }
}

impl Params {
    pub const MAX_WINDOW_BITS: u8 = 15;
    pub const MIN_WINDOW_BITS: u8 = 8;
}

pub struct RareData {
    libdeflate_compressor: Cell<Option<*mut libdeflate_sys::Compressor>>,
    libdeflate_decompressor: Cell<Option<*mut libdeflate_sys::Decompressor>>,
    // PERF(port): was StackFallbackAllocator(128 * 1024) — profile in Phase B
    // Zig kept a 128KB inline buffer reused as scratch for (de)compression output.
}

impl Default for RareData {
    fn default() -> Self {
        Self {
            libdeflate_compressor: Cell::new(None),
            libdeflate_decompressor: Cell::new(None),
        }
    }
}

impl RareData {
    pub const STACK_BUFFER_SIZE: usize = 128 * 1024;

    pub fn array_list(&self) -> Vec<u8> {
        // PERF(port): Zig handed back an ArrayList aliasing the 128KB stack_fallback
        // buffer (zero-alloc). Phase A uses a fresh heap Vec; revisit in Phase B.
        Vec::with_capacity(Self::STACK_BUFFER_SIZE)
    }

    // Zig `allocator()` returned the stack-fallback allocator. Allocator params are
    // dropped in non-AST crates; callers use the global allocator.
    // PERF(port): was stack-fallback

    pub fn decompressor(&self) -> *mut libdeflate_sys::Decompressor {
        match self.libdeflate_decompressor.get() {
            Some(d) => d,
            None => {
                let d = libdeflate_sys::Decompressor::alloc();
                self.libdeflate_decompressor.set(Some(d));
                d
            }
        }
    }

    pub fn compressor(&self) -> *mut libdeflate_sys::Compressor {
        match self.libdeflate_compressor.get() {
            Some(c) => c,
            None => {
                let c = libdeflate_sys::Compressor::alloc(Z_DEFAULT_COMPRESSION);
                self.libdeflate_compressor.set(Some(c));
                c
            }
        }
    }
}

impl Drop for RareData {
    fn drop(&mut self) {
        if let Some(c) = self.libdeflate_compressor.get() {
            // SAFETY: allocated by libdeflate_alloc_compressor, freed exactly once here.
            unsafe { libdeflate_sys::Compressor::destroy(c) };
        }
        if let Some(d) = self.libdeflate_decompressor.get() {
            // SAFETY: allocated by libdeflate_alloc_decompressor, freed exactly once here.
            unsafe { libdeflate_sys::Decompressor::destroy(d) };
        }
        // Zig: bun.destroy(this) — handled by Box<RareData> drop at the owner.
    }
}

/// Parent module references this type as `WebSocketDeflate`.
pub type WebSocketDeflate = PerMessageDeflate;
/// Parent module matches `websocket_deflate::Error::*` against `decompress()`'s
/// error type.
pub type Error = DecompressError;

pub struct PerMessageDeflate {
    pub compress_stream: zlib::z_stream,
    pub decompress_stream: zlib::z_stream,
    pub params: Params,
    // PORT NOTE: Zig borrowed `&RareData` from VM `bun_jsc::RareData` (pooled
    // libdeflate handles, shared across connections). `bun_jsc::RareData::
    // websocket_deflate()` currently returns an opaque placeholder (the real
    // type is *this* `RareData`, which would be a dep cycle), so own a
    // per-connection instance instead.
    // PERF(port): per-connection libdeflate alloc — restore VM-pooled instance
    // once `bun_jsc::rare_data::WebSocketDeflateRareData` is wired to this type.
    pub rare_data: RareData,
}

// Constants from zlib.h
const Z_DEFAULT_COMPRESSION: c_int = 6;
const Z_DEFLATED: c_int = 8;
const Z_DEFAULT_STRATEGY: c_int = 0;
const Z_DEFAULT_MEM_LEVEL: c_int = 8;

// Buffer size for compression/decompression operations
const COMPRESSION_BUFFER_SIZE: usize = 4096;

// Maximum decompressed message size (128 MB)
const MAX_DECOMPRESSED_SIZE: usize = 128 * 1024 * 1024;

// DEFLATE trailer bytes added by Z_SYNC_FLUSH
const DEFLATE_TRAILER: [u8; 4] = [0x00, 0x00, 0xff, 0xff];

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum DecompressError {
    #[error("InflateFailed")]
    InflateFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("TooLarge")]
    TooLarge,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum CompressError {
    #[error("DeflateFailed")]
    DeflateFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::named_error_set!(DecompressError, CompressError);

impl PerMessageDeflate {
    pub fn init(params: Params, rare_data: &mut JscRareData) -> Result<Box<Self>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut self_ = Box::new(Self {
            params,
            compress_stream: bun_core::ffi::zeroed::<zlib::z_stream>(),
            decompress_stream: bun_core::ffi::zeroed::<zlib::z_stream>(),
            // TODO(b2-blocked): bun_jsc::rare_data::WebSocketDeflateRareData —
            // `rare_data.websocket_deflate()` returns an opaque `{ _opaque: () }`
            // placeholder in bun_jsc; the real type is `self::RareData` (this
            // module), which bun_jsc cannot import without a dep cycle. Until a
            // re-export shim lands, fall back to a fresh per-connection instance.
            rare_data: {
                let _ = rare_data;
                RareData::default()
            },
        });

        // Initialize compressor (deflate)
        // We use negative window bits for raw DEFLATE, as required by RFC 7692.
        // SAFETY: compress_stream is a zeroed #[repr(C)] z_stream; &mut points to a valid
        // z_stream for the duration of the call; zlibVersion() returns a valid C string.
        let compress_err = unsafe {
            zlib::deflateInit2_(
                &raw mut self_.compress_stream,
                Z_DEFAULT_COMPRESSION,                           // level
                Z_DEFLATED,                                      // method
                -(self_.params.client_max_window_bits as c_int), // windowBits
                Z_DEFAULT_MEM_LEVEL,                             // memLevel
                Z_DEFAULT_STRATEGY,                              // strategy
                zlib::zlibVersion().cast::<u8>(),
                c_int::try_from(core::mem::size_of::<zlib::z_stream>()).expect("int cast"),
            )
        };
        if compress_err != zlib::ReturnCode::Ok {
            // Drop will call deflateEnd/inflateEnd on zeroed/failed streams; zlib defines
            // those as no-ops returning Z_STREAM_ERROR, so it is safe to let the Box drop.
            return Err(bun_core::err!("DeflateInitFailed"));
        }

        // Initialize decompressor (inflate)
        // SAFETY: decompress_stream is a zeroed #[repr(C)] z_stream; &mut points to a valid
        // z_stream for the duration of the call; zlibVersion() returns a valid C string.
        let decompress_err = unsafe {
            zlib::inflateInit2_(
                &raw mut self_.decompress_stream,
                -(self_.params.server_max_window_bits as c_int), // windowBits
                zlib::zlibVersion().cast::<u8>(),
                c_int::try_from(core::mem::size_of::<zlib::z_stream>()).expect("int cast"),
            )
        };
        if decompress_err != zlib::ReturnCode::Ok {
            // Drop handles deflateEnd on the initialized compress_stream and inflateEnd
            // on the failed decompress_stream (no-op, returns Z_STREAM_ERROR).
            return Err(bun_core::err!("InflateInitFailed"));
        }

        Ok(self_)
    }

    fn can_use_libdeflate(len: usize) -> bool {
        if feature_flag::BUN_FEATURE_FLAG_NO_LIBDEFLATE.get() {
            return false;
        }

        len < RareData::STACK_BUFFER_SIZE
    }

    pub fn decompress(&mut self, in_buf: &[u8], out: &mut Vec<u8>) -> Result<(), DecompressError> {
        let initial_len = out.len();

        // First we try with libdeflate, which is both faster and doesn't need the trailing deflate bytes
        if Self::can_use_libdeflate(in_buf.len()) {
            // SAFETY: `decompressor()` returns a live *mut Decompressor allocated
            // on first use and freed in Drop.
            let result = unsafe { &mut *self.rare_data.decompressor() }.decompress_to_vec(
                in_buf,
                out,
                libdeflate_sys::Encoding::Deflate,
            );
            if result.status == libdeflate_sys::Status::Success {
                if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
                    return Err(DecompressError::TooLarge);
                }
                return Ok(());
            }
        }

        let mut in_with_trailer: Vec<u8> = Vec::with_capacity(in_buf.len() + DEFLATE_TRAILER.len());
        in_with_trailer.extend_from_slice(in_buf);
        in_with_trailer.extend_from_slice(&DEFLATE_TRAILER);

        self.decompress_stream.next_in = in_with_trailer.as_ptr();
        self.decompress_stream.avail_in =
            u32::try_from(in_with_trailer.len()).expect("unreachable");

        loop {
            let stream = &mut self.decompress_stream;
            // SAFETY: `stream` was initialized by inflateInit2_ in init();
            // next_in is valid for avail_in bytes (in_with_trailer kept alive on
            // stack); next_out is valid for spare.len() bytes (spare capacity of `out`).
            let res = unsafe {
                bun_core::vec::fill_spare(out, COMPRESSION_BUFFER_SIZE, |spare| {
                    stream.next_out = spare.as_mut_ptr();
                    stream.avail_out = spare.len() as u32;
                    let res = zlib::inflate(&raw mut *stream, zlib::FlushValue::NoFlush);
                    (spare.len() - stream.avail_out as usize, res)
                })
            };

            // Check for decompression bomb
            if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
                return Err(DecompressError::TooLarge);
            }

            if res == zlib::ReturnCode::StreamEnd {
                break;
            }
            if res != zlib::ReturnCode::Ok {
                return Err(DecompressError::InflateFailed);
            }
            if self.decompress_stream.avail_out == 0 && self.decompress_stream.avail_in != 0 {
                // Need more output buffer space, continue loop
                continue;
            }
            if self.decompress_stream.avail_in == 0 {
                // This shouldn't happen with the trailer, but as a safeguard.
                break;
            }
        }

        if self.params.server_no_context_takeover == 1 {
            // SAFETY: decompress_stream was initialized by inflateInit2_ in init().
            unsafe { zlib::inflateReset(&raw mut self.decompress_stream) };
        }

        Ok(())
    }

    pub fn compress(&mut self, in_buf: &[u8], out: &mut Vec<u8>) -> Result<(), CompressError> {
        self.compress_stream.next_in = in_buf.as_ptr();
        self.compress_stream.avail_in = u32::try_from(in_buf.len()).expect("unreachable");

        loop {
            let stream = &mut self.compress_stream;
            // SAFETY: `stream` was initialized by deflateInit2_ in init();
            // next_in is valid for avail_in bytes (in_buf borrowed for this call);
            // next_out is valid for spare.len() bytes (spare capacity of `out`).
            let res = unsafe {
                bun_core::vec::fill_spare(out, COMPRESSION_BUFFER_SIZE, |spare| {
                    stream.next_out = spare.as_mut_ptr();
                    stream.avail_out = spare.len() as u32;
                    let res = zlib::deflate(&raw mut *stream, zlib::FlushValue::SyncFlush);
                    (spare.len() - stream.avail_out as usize, res)
                })
            };
            if res != zlib::ReturnCode::Ok {
                return Err(CompressError::DeflateFailed);
            }

            // exit only when zlib is truly finished
            if self.compress_stream.avail_in == 0 && self.compress_stream.avail_out != 0 {
                break;
            }
        }

        // Remove the 4-byte trailer (00 00 FF FF) added by Z_SYNC_FLUSH
        if out.len() >= 4 && out[out.len() - 4..] == DEFLATE_TRAILER {
            out.truncate(out.len() - 4);
        }

        if self.params.client_no_context_takeover == 1 {
            // SAFETY: compress_stream was initialized by deflateInit2_ in init().
            unsafe { zlib::deflateReset(&raw mut self.compress_stream) };
        }

        Ok(())
    }
}

impl Drop for PerMessageDeflate {
    fn drop(&mut self) {
        // SAFETY: streams were initialized by deflateInit2_/inflateInit2_ in init()
        // (or are zeroed on the init() error path, in which case *End is a defined
        // no-op returning Z_STREAM_ERROR). Called exactly once via Drop.
        unsafe {
            zlib::deflateEnd(&raw mut self.compress_stream);
            zlib::inflateEnd(&raw mut self.decompress_stream);
        }
        // Zig: self.allocator.destroy(self) — handled by Box drop at the owner.
    }
}

// ported from: src/http_jsc/websocket_client/WebSocketDeflate.zig
