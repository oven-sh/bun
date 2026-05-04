//! Manages the DEFLATE compression and decompression streams for a WebSocket connection.

use core::cell::Cell;
use core::ffi::c_int;

use bun_core::feature_flag;
use bun_jsc::RareData as JscRareData;
use bun_zlib as zlib;
use libdeflate_sys;

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
                let c = libdeflate_sys::Compressor::alloc();
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
            unsafe { libdeflate_sys::Compressor::deinit(c) };
        }
        if let Some(d) = self.libdeflate_decompressor.get() {
            // SAFETY: allocated by libdeflate_alloc_decompressor, freed exactly once here.
            unsafe { libdeflate_sys::Decompressor::deinit(d) };
        }
        // Zig: bun.destroy(this) — handled by Box<RareData> drop at the owner.
    }
}

pub struct PerMessageDeflate<'a> {
    pub compress_stream: zlib::z_stream,
    pub decompress_stream: zlib::z_stream,
    pub params: Params,
    pub rare_data: &'a RareData,
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

impl From<DecompressError> for bun_core::Error {
    fn from(e: DecompressError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

impl From<CompressError> for bun_core::Error {
    fn from(e: CompressError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

impl<'a> PerMessageDeflate<'a> {
    pub fn init(params: Params, rare_data: &'a JscRareData) -> Result<Box<Self>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut self_ = Box::new(Self {
            params,
            // SAFETY: z_stream is #[repr(C)] POD; all-zero is the documented init state.
            compress_stream: unsafe { core::mem::zeroed::<zlib::z_stream>() },
            // SAFETY: z_stream is #[repr(C)] POD; all-zero is the documented init state.
            decompress_stream: unsafe { core::mem::zeroed::<zlib::z_stream>() },
            rare_data: rare_data.websocket_deflate(),
        });

        // Initialize compressor (deflate)
        // We use negative window bits for raw DEFLATE, as required by RFC 7692.
        // SAFETY: compress_stream is a zeroed #[repr(C)] z_stream; &mut points to a valid
        // z_stream for the duration of the call; zlibVersion() returns a valid C string.
        let compress_err = unsafe {
            zlib::deflateInit2_(
                &mut self_.compress_stream,
                Z_DEFAULT_COMPRESSION,                          // level
                Z_DEFLATED,                                     // method
                -(self_.params.client_max_window_bits as c_int), // windowBits
                Z_DEFAULT_MEM_LEVEL,                            // memLevel
                Z_DEFAULT_STRATEGY,                             // strategy
                zlib::zlibVersion(),
                c_int::try_from(core::mem::size_of::<zlib::z_stream>()).unwrap(),
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
                &mut self_.decompress_stream,
                -(self_.params.server_max_window_bits as c_int), // windowBits
                zlib::zlibVersion(),
                c_int::try_from(core::mem::size_of::<zlib::z_stream>()).unwrap(),
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
            let spare = out.spare_capacity_mut();
            // SAFETY: libdeflate writes into the uninit spare region; we only advance len by `written`.
            let result = unsafe {
                libdeflate_sys::Decompressor::deflate(
                    self.rare_data.decompressor(),
                    in_buf,
                    spare,
                )
            };
            if result.status == libdeflate_sys::Status::Success {
                // SAFETY: libdeflate reported `written` bytes initialized in spare capacity.
                unsafe { out.set_len(out.len() + result.written) };
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
            out.reserve(COMPRESSION_BUFFER_SIZE);
            // PORT NOTE: reshaped for borrowck — capture spare ptr/len before handing to zlib.
            let spare = out.spare_capacity_mut();
            let spare_len = spare.len();
            self.decompress_stream.next_out = spare.as_mut_ptr().cast::<u8>();
            self.decompress_stream.avail_out = u32::try_from(spare_len).expect("unreachable");

            // SAFETY: decompress_stream was initialized by inflateInit2_ in init();
            // next_in is valid for avail_in bytes (in_with_trailer kept alive on stack);
            // next_out is valid for avail_out bytes (spare capacity of `out`).
            let res = unsafe { zlib::inflate(&mut self.decompress_stream, zlib::FlushValue::NoFlush) };
            let written = spare_len - self.decompress_stream.avail_out as usize;
            // SAFETY: zlib initialized `written` bytes at the start of spare capacity.
            unsafe { out.set_len(out.len() + written) };

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
            unsafe { zlib::inflateReset(&mut self.decompress_stream) };
        }

        Ok(())
    }

    pub fn compress(&mut self, in_buf: &[u8], out: &mut Vec<u8>) -> Result<(), CompressError> {
        self.compress_stream.next_in = in_buf.as_ptr();
        self.compress_stream.avail_in = u32::try_from(in_buf.len()).expect("unreachable");

        loop {
            out.reserve(COMPRESSION_BUFFER_SIZE);
            // PORT NOTE: reshaped for borrowck — capture spare ptr/len before handing to zlib.
            let spare = out.spare_capacity_mut();
            let spare_len = spare.len();
            self.compress_stream.next_out = spare.as_mut_ptr().cast::<u8>();
            self.compress_stream.avail_out = u32::try_from(spare_len).expect("unreachable");

            // SAFETY: compress_stream was initialized by deflateInit2_ in init();
            // next_in is valid for avail_in bytes (in_buf borrowed for this call);
            // next_out is valid for avail_out bytes (spare capacity of `out`).
            let res = unsafe { zlib::deflate(&mut self.compress_stream, zlib::FlushValue::SyncFlush) };
            let written = spare_len - self.compress_stream.avail_out as usize;
            // SAFETY: zlib initialized `written` bytes at the start of spare capacity.
            unsafe { out.set_len(out.len() + written) };
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
            unsafe { zlib::deflateReset(&mut self.compress_stream) };
        }

        Ok(())
    }
}

impl<'a> Drop for PerMessageDeflate<'a> {
    fn drop(&mut self) {
        // SAFETY: streams were initialized by deflateInit2_/inflateInit2_ in init()
        // (or are zeroed on the init() error path, in which case *End is a defined
        // no-op returning Z_STREAM_ERROR). Called exactly once via Drop.
        unsafe {
            zlib::deflateEnd(&mut self.compress_stream);
            zlib::inflateEnd(&mut self.decompress_stream);
        }
        // Zig: self.allocator.destroy(self) — handled by Box drop at the owner.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client/WebSocketDeflate.zig (236 lines)
//   confidence: medium
//   todos:      1
//   notes:      RareData stack-fallback 128KB scratch dropped (PERF); rare_data uses Cell for interior mutability to satisfy &'a borrow; init() error path lets Drop run (*End on zeroed/failed z_stream is a no-op).
// ──────────────────────────────────────────────────────────────────────────
