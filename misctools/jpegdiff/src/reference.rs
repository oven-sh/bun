//! What src/runtime/image/codec_jpeg.rs did with libjpeg-turbo, call for call, minus the CMYK to RGBA step.
use core::ffi::{c_char, c_int, c_void};

type Handle = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ScalingFactor {
    pub num: c_int,
    pub denom: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CropRegion {
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
}
unsafe extern "C" {
    fn tj3Init(init_type: c_int) -> Handle;
    fn tj3Destroy(h: Handle);
    fn tj3Set(h: Handle, param: c_int, value: c_int) -> c_int;
    fn tj3Get(h: Handle, param: c_int) -> c_int;
    fn tj3BunCompletedWithWarning(h: Handle) -> c_int;
    fn tj3DecompressHeader(h: Handle, buf: *const u8, len: usize) -> c_int;
    fn tj3Decompress8(h: Handle, buf: *const u8, len: usize, dst: *mut u8, pitch: c_int, pf: c_int) -> c_int;
    fn tj3Compress8(h: Handle, src: *const u8, w: c_int, pitch: c_int, height: c_int, pf: c_int, out: *mut *mut u8, out_len: *mut usize) -> c_int;
    fn tj3SetScalingFactor(h: Handle, sf: ScalingFactor) -> c_int;
    fn tj3SetCroppingRegion(h: Handle, r: CropRegion) -> c_int;
    fn tj3Free(ptr: *mut c_void);
    fn tj3GetICCProfile(h: Handle, icc_buf: *mut *mut u8, icc_size: *mut usize) -> c_int;
    fn tj3SetICCProfile(h: Handle, icc_buf: *const u8, icc_size: usize) -> c_int;
    fn tj3GetErrorStr(h: Handle) -> *const c_char;
}
const TJPARAM_QUALITY: c_int = 3;
const TJPARAM_SUBSAMP: c_int = 4;
const TJPARAM_JPEGWIDTH: c_int = 5;
const TJPARAM_JPEGHEIGHT: c_int = 6;
const TJPARAM_COLORSPACE: c_int = 8;
const TJPARAM_PROGRESSIVE: c_int = 12;
const TJPARAM_MAXPIXELS: c_int = 24;
const TJPARAM_SAVEMARKERS: c_int = 25;
const TJPF_RGBA: c_int = 7;
const TJPF_CMYK: c_int = 11;

pub struct Decoded {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub cmyk: bool,
    pub icc: Option<Vec<u8>>,
    pub header_warned: bool,
    pub decode_warned: bool,
    pub last_message: String,
}
#[derive(Debug)]
pub enum Failure {
    Header(String),
    Decode(String),
}
struct H(Handle);
impl Drop for H {
    fn drop(&mut self) {
        unsafe { tj3Destroy(self.0) }
    }
}
fn message(h: Handle) -> String {
    unsafe { core::ffi::CStr::from_ptr(tj3GetErrorStr(h)) }.to_string_lossy().into_owned()
}
fn scaled(dim: u32, sf: ScalingFactor) -> u32 {
    ((dim as i64 * sf.num as i64 + sf.denom as i64 - 1) / sf.denom as i64) as u32
}
fn dims(h: Handle) -> Option<(u32, u32)> {
    let (w, ht) = unsafe { (tj3Get(h, TJPARAM_JPEGWIDTH), tj3Get(h, TJPARAM_JPEGHEIGHT)) };
    (w >= 1 && ht >= 1).then_some((w as u32, ht as u32))
}

/// `eighths` is the scaling factor the old code would have picked from its hint.
pub fn decode(bytes: &[u8], eighths: u32, max_pixels: u64) -> Result<Decoded, Failure> {
    unsafe {
        let handle = H(tj3Init(1));
        let h = handle.0;
        tj3Set(h, TJPARAM_SAVEMARKERS, 2);
        let rc = tj3DecompressHeader(h, bytes.as_ptr(), bytes.len());
        let header_warned = rc != 0 && tj3BunCompletedWithWarning(h) != 0;
        if rc != 0 && !header_warned {
            return Err(Failure::Header(message(h)));
        }
        let Some((src_w, src_h)) = dims(h) else {
            return Err(Failure::Header("no dimensions".into()));
        };
        if src_w as u64 * src_h as u64 > max_pixels {
            return Err(Failure::Header("too many pixels".into()));
        }
        let cmyk = matches!(tj3Get(h, TJPARAM_COLORSPACE), 3 | 4);
        let (mut w, mut ht) = (src_w, src_h);
        if eighths != 8 {
            let g = match eighths { 2 | 6 => 2, 4 => 4, _ => 1 };
            let sf = ScalingFactor { num: (eighths / g) as c_int, denom: (8 / g) as c_int };
            assert_eq!(tj3SetScalingFactor(h, sf), 0);
            w = scaled(src_w, sf);
            ht = scaled(src_h, sf);
        }
        tj3Set(h, TJPARAM_MAXPIXELS, c_int::try_from(src_w * src_h).unwrap_or(c_int::MAX));
        let cropped = tj3SetCroppingRegion(h, CropRegion { x: 0, y: 0, w: w as c_int, h: ht as c_int }) == 0;
        let pitch = if cropped {
            (w * 4) as c_int
        } else {
            tj3SetScalingFactor(h, ScalingFactor { num: 1, denom: 1 });
            w = src_w;
            ht = src_h;
            0
        };
        let out_len = w as usize * ht as usize * 4;
        let mut out = vec![0xA5u8; out_len];
        let rc = tj3Decompress8(h, bytes.as_ptr(), bytes.len(), out.as_mut_ptr(), pitch, if cmyk { TJPF_CMYK } else { TJPF_RGBA });
        let decode_warned = rc != 0 && tj3BunCompletedWithWarning(h) != 0;
        let last_message = if rc != 0 { message(h) } else { String::new() };
        if (rc != 0 && !decode_warned) || dims(h) != Some((src_w, src_h)) {
            return Err(Failure::Decode(last_message));
        }
        let mut icc_ptr: *mut u8 = core::ptr::null_mut();
        let mut icc_size = 0usize;
        let icc = if tj3GetICCProfile(h, &raw mut icc_ptr, &raw mut icc_size) != 0 || icc_size == 0 || icc_ptr.is_null() {
            None
        } else {
            let v = core::slice::from_raw_parts(icc_ptr, icc_size).to_vec();
            tj3Free(icc_ptr.cast());
            Some(v)
        };
        Ok(Decoded { pixels: out, width: w, height: ht, cmyk, icc, header_warned, decode_warned, last_message })
    }
}

pub fn encode(rgba: &[u8], w: u32, ht: u32, quality: u8, progressive: bool, icc: Option<&[u8]>) -> Result<Vec<u8>, String> {
    unsafe {
        let handle = H(tj3Init(0));
        let h = handle.0;
        tj3Set(h, TJPARAM_QUALITY, c_int::from(quality.clamp(1, 100)));
        tj3Set(h, TJPARAM_SUBSAMP, 2);
        if progressive {
            tj3Set(h, TJPARAM_PROGRESSIVE, 1);
        }
        if let Some(p) = icc && !p.is_empty() {
            tj3SetICCProfile(h, p.as_ptr(), p.len());
        }
        let mut out_ptr: *mut u8 = core::ptr::null_mut();
        let mut out_len = 0usize;
        let rc = tj3Compress8(h, rgba.as_ptr(), w as c_int, 0, ht as c_int, TJPF_RGBA, &raw mut out_ptr, &raw mut out_len);
        if rc != 0 {
            if !out_ptr.is_null() {
                tj3Free(out_ptr.cast());
            }
            return Err(message(h));
        }
        let v = core::slice::from_raw_parts(out_ptr, out_len).to_vec();
        tj3Free(out_ptr.cast());
        Ok(v)
    }
}
