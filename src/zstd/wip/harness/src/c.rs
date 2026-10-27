//! The reference C library.
#![allow(non_camel_case_types, dead_code)]
use std::ffi::{c_char, c_int, c_uint, c_ulonglong, c_void};

#[repr(C)]
pub struct ZSTD_inBuffer { pub src: *const c_void, pub size: usize, pub pos: usize }
#[repr(C)]
pub struct ZSTD_outBuffer { pub dst: *mut c_void, pub size: usize, pub pos: usize }
pub enum ZSTD_CCtx {}
pub enum ZSTD_DCtx {}
pub enum ZSTD_DDict {}

unsafe extern "C" {
    pub fn ZSTD_compress(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, level: c_int) -> usize;
    pub fn ZSTD_compressBound(size: usize) -> usize;
    pub fn ZSTD_decompress(dst: *mut c_void, cap: usize, src: *const c_void, size: usize) -> usize;
    pub fn ZSTD_isError(code: usize) -> c_uint;
    pub fn ZSTD_getErrorCode(code: usize) -> c_uint;
    pub fn ZSTD_getErrorName(code: usize) -> *const c_char;
    pub fn ZSTD_getErrorString(code: c_uint) -> *const c_char;
    pub fn ZSTD_findDecompressedSize(src: *const c_void, size: usize) -> c_ulonglong;
    pub fn ZSTD_getFrameContentSize(src: *const c_void, size: usize) -> c_ulonglong;
    pub fn ZSTD_findFrameCompressedSize(src: *const c_void, size: usize) -> usize;
    pub fn ZSTD_createCCtx() -> *mut ZSTD_CCtx;
    pub fn ZSTD_freeCCtx(c: *mut ZSTD_CCtx) -> usize;
    pub fn ZSTD_createDCtx() -> *mut ZSTD_DCtx;
    pub fn ZSTD_freeDCtx(c: *mut ZSTD_DCtx) -> usize;
    pub fn ZSTD_CCtx_setPledgedSrcSize(c: *mut ZSTD_CCtx, size: c_ulonglong) -> usize;
    pub fn ZSTD_CCtx_loadDictionary(c: *mut ZSTD_CCtx, d: *const c_void, n: usize) -> usize;
    pub fn ZSTD_CCtx_refPrefix(c: *mut ZSTD_CCtx, d: *const c_void, n: usize) -> usize;
    pub fn ZSTD_CCtx_setParameter(c: *mut ZSTD_CCtx, p: c_uint, v: c_int) -> usize;
    pub fn ZSTD_CCtx_reset(c: *mut ZSTD_CCtx, r: c_uint) -> usize;
    pub fn ZSTD_compress2(c: *mut ZSTD_CCtx, dst: *mut c_void, cap: usize, src: *const c_void, size: usize) -> usize;
    pub fn ZSTD_compressStream2(c: *mut ZSTD_CCtx, o: *mut ZSTD_outBuffer, i: *mut ZSTD_inBuffer, e: c_uint) -> usize;
    pub fn ZSTD_DCtx_loadDictionary(c: *mut ZSTD_DCtx, d: *const c_void, n: usize) -> usize;
    pub fn ZSTD_DCtx_refPrefix(c: *mut ZSTD_DCtx, d: *const c_void, n: usize) -> usize;
    pub fn ZSTD_DCtx_setParameter(c: *mut ZSTD_DCtx, p: c_uint, v: c_int) -> usize;
    pub fn ZSTD_DCtx_reset(c: *mut ZSTD_DCtx, r: c_uint) -> usize;
    pub fn ZSTD_initDStream(c: *mut ZSTD_DCtx) -> usize;
    pub fn ZSTD_decompressDCtx(c: *mut ZSTD_DCtx, dst: *mut c_void, cap: usize, src: *const c_void, size: usize) -> usize;
    pub fn ZSTD_decompressStream(c: *mut ZSTD_DCtx, o: *mut ZSTD_outBuffer, i: *mut ZSTD_inBuffer) -> usize;
    pub fn ZSTD_createDDict_byReference(d: *const c_void, n: usize) -> *mut ZSTD_DDict;
    pub fn ZSTD_freeDDict(d: *mut ZSTD_DDict) -> usize;
    pub fn ZSTD_decompress_usingDDict(c: *mut ZSTD_DCtx, dst: *mut c_void, cap: usize, src: *const c_void, size: usize, d: *const ZSTD_DDict) -> usize;
    pub fn ZSTD_defaultCLevel() -> c_int;
    pub fn ZSTD_minCLevel() -> c_int;
    pub fn ZSTD_maxCLevel() -> c_int;
}

/// `Ok(value)` or `Err(error code)`.
pub fn res(code: usize) -> Result<usize, u32> {
    unsafe { if ZSTD_isError(code) != 0 { Err(ZSTD_getErrorCode(code)) } else { Ok(code) } }
}

pub struct CCtx(pub *mut ZSTD_CCtx);
impl CCtx {
    pub fn new() -> Self { Self(unsafe { ZSTD_createCCtx() }) }
    pub fn set(&mut self, p: u32, v: i32) -> Result<usize, u32> { res(unsafe { ZSTD_CCtx_setParameter(self.0, p, v) }) }
    pub fn load_dict(&mut self, d: &[u8]) -> Result<usize, u32> { res(unsafe { ZSTD_CCtx_loadDictionary(self.0, d.as_ptr().cast(), d.len()) }) }
    pub fn ref_prefix(&mut self, d: &[u8]) -> Result<usize, u32> { res(unsafe { ZSTD_CCtx_refPrefix(self.0, d.as_ptr().cast(), d.len()) }) }
    pub fn pledge(&mut self, n: u64) -> Result<usize, u32> { res(unsafe { ZSTD_CCtx_setPledgedSrcSize(self.0, n) }) }
    pub fn reset(&mut self, r: u32) -> Result<usize, u32> { res(unsafe { ZSTD_CCtx_reset(self.0, r) }) }
    pub fn compress2(&mut self, dst: &mut [u8], src: &[u8]) -> Result<usize, u32> {
        res(unsafe { ZSTD_compress2(self.0, dst.as_mut_ptr().cast(), dst.len(), src.as_ptr().cast(), src.len()) })
    }
    /// Returns (result, out pos, in pos).
    pub fn stream2(&mut self, dst: &mut [u8], dpos: usize, src: &[u8], spos: usize, end: u32) -> (Result<usize, u32>, usize, usize) {
        let mut o = ZSTD_outBuffer { dst: dst.as_mut_ptr().cast(), size: dst.len(), pos: dpos };
        let mut i = ZSTD_inBuffer { src: src.as_ptr().cast(), size: src.len(), pos: spos };
        let r = res(unsafe { ZSTD_compressStream2(self.0, &mut o, &mut i, end) });
        (r, o.pos, i.pos)
    }
}
impl Drop for CCtx { fn drop(&mut self) { unsafe { ZSTD_freeCCtx(self.0) }; } }

pub struct DCtx(pub *mut ZSTD_DCtx);
impl DCtx {
    pub fn new() -> Self { Self(unsafe { ZSTD_createDCtx() }) }
    pub fn set(&mut self, p: u32, v: i32) -> Result<usize, u32> { res(unsafe { ZSTD_DCtx_setParameter(self.0, p, v) }) }
    pub fn load_dict(&mut self, d: &[u8]) -> Result<usize, u32> { res(unsafe { ZSTD_DCtx_loadDictionary(self.0, d.as_ptr().cast(), d.len()) }) }
    pub fn ref_prefix(&mut self, d: &[u8]) -> Result<usize, u32> { res(unsafe { ZSTD_DCtx_refPrefix(self.0, d.as_ptr().cast(), d.len()) }) }
    pub fn reset(&mut self, r: u32) -> Result<usize, u32> { res(unsafe { ZSTD_DCtx_reset(self.0, r) }) }
    pub fn init_stream(&mut self) { unsafe { ZSTD_initDStream(self.0) }; }
    pub fn decompress(&mut self, dst: &mut [u8], src: &[u8]) -> Result<usize, u32> {
        res(unsafe { ZSTD_decompressDCtx(self.0, dst.as_mut_ptr().cast(), dst.len(), src.as_ptr().cast(), src.len()) })
    }
    pub fn stream(&mut self, dst: &mut [u8], dpos: usize, src: &[u8], spos: usize) -> (Result<usize, u32>, usize, usize) {
        let mut o = ZSTD_outBuffer { dst: dst.as_mut_ptr().cast(), size: dst.len(), pos: dpos };
        let mut i = ZSTD_inBuffer { src: src.as_ptr().cast(), size: src.len(), pos: spos };
        let r = res(unsafe { ZSTD_decompressStream(self.0, &mut o, &mut i) });
        (r, o.pos, i.pos)
    }
}
impl Drop for DCtx { fn drop(&mut self) { unsafe { ZSTD_freeDCtx(self.0) }; } }

pub fn compress(src: &[u8], level: i32) -> Vec<u8> {
    let mut dst = vec![0u8; unsafe { ZSTD_compressBound(src.len()) }];
    let n = res(unsafe { ZSTD_compress(dst.as_mut_ptr().cast(), dst.len(), src.as_ptr().cast(), src.len(), level) }).unwrap();
    dst.truncate(n);
    dst
}
pub fn decompress(dst: &mut [u8], src: &[u8]) -> Result<usize, u32> {
    res(unsafe { ZSTD_decompress(dst.as_mut_ptr().cast(), dst.len(), src.as_ptr().cast(), src.len()) })
}
