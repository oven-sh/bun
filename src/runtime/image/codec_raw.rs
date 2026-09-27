//! Camera raw decode on Linux through a dlopen'd system LibRaw.
//!
//! A NEF, CR2, ARW or DNG is a TIFF container, so `Format::sniff` already
//! calls it `Tiff` — and `Tiff` has no decoder outside macOS/Windows, so
//! `new Bun.Image(nef)` is `ERR_IMAGE_FORMAT_UNSUPPORTED` on Linux. This
//! routes that case to the host's LibRaw when one is installed, which turns
//! the sensor mosaic into RGB the way every raw converter does.
//!
//! Nothing is linked: entry points resolve with `dlsym` at first use, so a
//! host without LibRaw keeps returning the error it returns now. Same
//! arrangement, and same reasoning, as `codec_heif.rs`.
//!
//! `libraw_r` — the reentrant build — is the only one loaded. Decodes run on
//! the WorkPool, and the plain `libraw` build is not documented as safe for
//! concurrent `libraw_data_t`s.
//!
//! Scope. This is the TIFF-container raws, which is Nikon, Canon CR2, Sony,
//! Pentax, Adobe DNG and most of the rest. The ones with their own magic —
//! Fuji RAF, Canon CR3, Panasonic RW2, Sigma X3F — sniff as nothing today and
//! need their own `Format`, which is a separate change. Ordinary TIFFs are
//! unaffected: LibRaw answers `LIBRAW_FILE_UNSUPPORTED` for them and the
//! error the caller sees is the one they see today.
//!
//! Development settings are LibRaw's defaults plus two: output sRGB, and the
//! camera's own white balance rather than LibRaw's daylight default, read
//! back through `libraw_get_cam_mul` and applied with `libraw_set_user_mul`
//! because there is no C setter for `use_camera_wb`. Everything else —
//! demosaic algorithm, highlight handling, auto-brightness — is left where
//! LibRaw puts it. Exposing those as pipeline options is a separate change;
//! this one is about a raw file decoding at all.

use core::ffi::{c_int, c_void};
use std::sync::OnceLock;

use super::codecs;
use super::exif;

// The LibRaw ABI below is written out by hand for the reasons set out at the
// same point in `codec_heif.rs`: it is how C ABIs are declared throughout
// this tree, and generating it from a header would pin the values to the
// machine that built Bun while the library loaded belongs to the machine
// that runs it. These are enum values and one struct layout, none of which
// can move without breaking every compiled consumer of LibRaw, and
// `SUPPORTED_MAJOR` below refuses a version where that stops holding. Each
// was read out of the header named beside it.

/// `LIBRAW_SUCCESS`.
const LIBRAW_SUCCESS: c_int = 0;
/// `LIBRAW_IMAGE_BITMAP` — the `type` of what `dcraw_make_mem_image` returns
/// when it is pixels rather than a passed-through JPEG thumbnail.
const IMAGE_BITMAP: c_int = 2;
/// `libraw_set_output_color`: 1 = sRGB.
const COLOR_SRGB: c_int = 1;

/// `libraw_processed_image_t`'s header. The trailing `data[]` is read through
/// a pointer rather than declared. Field order is fixed by
/// `libraw_types.h` and has not changed across the 0.x series.
#[repr(C)]
struct ProcessedImage {
    kind: c_int, // enum LibRaw_image_formats
    height: u16,
    width: u16,
    colors: u16,
    bits: u16,
    data_size: u32,
    // unsigned char data[1] follows.
}

type Data = c_void;

struct Lib {
    init: unsafe extern "C" fn(u32) -> *mut Data,
    close: unsafe extern "C" fn(*mut Data),
    open_buffer: unsafe extern "C" fn(*mut Data, *const c_void, usize) -> c_int,
    unpack: unsafe extern "C" fn(*mut Data) -> c_int,
    dcraw_process: unsafe extern "C" fn(*mut Data) -> c_int,
    make_mem_image: unsafe extern "C" fn(*mut Data, *mut c_int) -> *mut ProcessedImage,
    clear_mem: unsafe extern "C" fn(*mut ProcessedImage),
    get_iwidth: unsafe extern "C" fn(*mut Data) -> c_int,
    get_iheight: unsafe extern "C" fn(*mut Data) -> c_int,
    get_cam_mul: unsafe extern "C" fn(*mut Data, c_int) -> f32,
    set_user_mul: unsafe extern "C" fn(*mut Data, c_int, f32),
    set_output_bps: unsafe extern "C" fn(*mut Data, c_int),
    set_output_color: unsafe extern "C" fn(*mut Data, c_int),
    set_bright: unsafe extern "C" fn(*mut Data, f32),
    set_no_auto_bright: unsafe extern "C" fn(*mut Data, c_int),
    /// `data_callback` is `(void*, const char*, INT64)`. LibRaw installs
    /// `default_data_callback`, which `fprintf`s to stderr on a truncated
    /// file; a null one disables the call, which is what a runtime wants.
    set_dataerror_handler: unsafe extern "C" fn(*mut Data, *const c_void, *mut c_void),
    /// `(major << 16) | (minor << 8) | patch`, so 0.22.2 is `0x00001602`.
    version_number: unsafe extern "C" fn() -> c_int,
}

/// LibRaw bumps its SONAME every release, so unlike libheif there is no one
/// name to ask for: 0.20 is `.20`, 0.21 `.23`, 0.22 `.25`. Newest first, then
/// the `-dev` symlink for source builds. Each miss is one failed lookup, once
/// per process.
///
/// That last entry can resolve to any version the host has, including one
/// released after this list was written, so `major_version` below decides
/// whether to keep it.
const SONAMES: [&core::ffi::CStr; 8] = [
    c"libraw_r.so.25",
    c"libraw_r.so.24",
    c"libraw_r.so.23",
    c"libraw_r.so.22",
    c"libraw_r.so.21",
    c"libraw_r.so.20",
    c"libraw_r.so.19",
    c"libraw_r.so",
];

/// LibRaw has only ever shipped 0.x; these signatures were checked against
/// 0.22.
const SUPPORTED_MAJOR: c_int = 0;

static LIB: OnceLock<Option<Lib>> = OnceLock::new();

fn lib() -> Option<&'static Lib> {
    LIB.get_or_init(load).as_ref()
}

fn load() -> Option<Lib> {
    let mut handle: *mut c_void = core::ptr::null_mut();
    for name in SONAMES {
        // SAFETY: `name` is a 'static NUL-terminated C string.
        handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_NOW) };
        if !handle.is_null() {
            break;
        }
    }
    if handle.is_null() {
        return None;
    }
    macro_rules! sym {
        ($name:literal) => {{
            // SAFETY: `handle` is a live dlopen handle and the name is a
            // 'static NUL-terminated C string. The transmute is
            // pointer-to-fn-pointer, guarded by the null check, to the
            // signature `libraw.h` gives that symbol.
            let p = unsafe { libc::dlsym(handle, concat!($name, "\0").as_ptr().cast()) };
            if p.is_null() {
                return None;
            }
            unsafe { core::mem::transmute(p) }
        }};
    }
    let lib = Lib {
        init: sym!("libraw_init"),
        close: sym!("libraw_close"),
        open_buffer: sym!("libraw_open_buffer"),
        unpack: sym!("libraw_unpack"),
        dcraw_process: sym!("libraw_dcraw_process"),
        make_mem_image: sym!("libraw_dcraw_make_mem_image"),
        clear_mem: sym!("libraw_dcraw_clear_mem"),
        get_iwidth: sym!("libraw_get_iwidth"),
        get_iheight: sym!("libraw_get_iheight"),
        get_cam_mul: sym!("libraw_get_cam_mul"),
        set_user_mul: sym!("libraw_set_user_mul"),
        set_output_bps: sym!("libraw_set_output_bps"),
        set_output_color: sym!("libraw_set_output_color"),
        set_bright: sym!("libraw_set_bright"),
        set_no_auto_bright: sym!("libraw_set_no_auto_bright"),
        set_dataerror_handler: sym!("libraw_set_dataerror_handler"),
        version_number: sym!("libraw_versionNumber"),
    };
    // The bare `libraw_r.so` above resolves to whatever the host has, which
    // with a SONAME that moves every release is quite likely something newer
    // than this list. LibRaw has only ever shipped 0.x; a 1.0 would be the
    // point to re-check `libraw_processed_image_t`, the one layout mirrored
    // here, so refuse it rather than read a struct that may have moved.
    // SAFETY: just resolved; takes no arguments and only reads a constant.
    if ((unsafe { (lib.version_number)() } >> 16) & 0xFF) != SUPPORTED_MAJOR {
        return None;
    }
    Some(lib)
}

/// One `libraw_data_t`; `libraw_close` is its only deallocator.
struct Raw {
    lib: &'static Lib,
    data: *mut Data,
}

impl Drop for Raw {
    fn drop(&mut self) {
        // SAFETY: allocated by libraw_init.
        unsafe { (self.lib.close)(self.data) };
    }
}

/// One developed image from `dcraw_make_mem_image`.
struct Mem {
    lib: &'static Lib,
    img: *mut ProcessedImage,
}

impl Drop for Mem {
    fn drop(&mut self) {
        if !self.img.is_null() {
            // SAFETY: allocated by libraw_dcraw_make_mem_image.
            unsafe { (self.lib.clear_mem)(self.img) };
        }
    }
}

/// Parse the header and report the developed size. `libraw_open_buffer` runs
/// LibRaw's identify step only — no sensor data is read — so this is cheap
/// enough to be the probe path.
fn open(bytes: &[u8], max_pixels: u64) -> Result<(Raw, u32, u32), codecs::Error> {
    let lib = lib().ok_or(codecs::Error::UnsupportedOnPlatform)?;
    // SAFETY: no preconditions; null on allocation failure.
    let data = unsafe { (lib.init)(0) };
    if data.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let r = Raw { lib, data };
    // LibRaw's default data-error callback writes "Unexpected end of file" to
    // stderr, from whichever WorkPool thread happened to run the decode. The
    // error is already reported through the return value.
    // SAFETY: `data` is live; a null callback is how LibRaw's `derror` is
    // told there is nobody to notify.
    unsafe { (lib.set_dataerror_handler)(data, core::ptr::null(), core::ptr::null_mut()) };
    // SAFETY: `data` is live; ptr/len come from a live `&[u8]`, which LibRaw
    // copies out of before this returns.
    if unsafe { (lib.open_buffer)(data, bytes.as_ptr().cast(), bytes.len()) } != LIBRAW_SUCCESS {
        // Every non-raw file lands here, `LIBRAW_FILE_UNSUPPORTED` among
        // them, and the caller turns that back into the error an ordinary
        // TIFF already produces.
        return Err(codecs::Error::UnsupportedOnPlatform);
    }
    // SAFETY: `data` is live and identified.
    let w = unsafe { (lib.get_iwidth)(data) };
    // SAFETY: as above.
    let h = unsafe { (lib.get_iheight)(data) };
    if w <= 0 || h <= 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // These two stay in sensor order. On LibRaw 0.22.2 a frame shot on its
    // side (`flip` 5 or 6) reports 3039×2014 here both before and after
    // `dcraw_process`, and only `dcraw_make_mem_image` hands back the
    // 2014×3039 the camera meant — so the axes have to be swapped for the
    // probe to describe the same picture the decode returns. There is no C
    // getter for `flip`; it is a field of a struct this file does not
    // mirror. It comes from the same IFD0 Orientation tag a TIFF carries,
    // though, and a camera raw is a TIFF.
    let swap = matches!(
        exif::parse_tiff(bytes)
            .unwrap_or(exif::Orientation::Normal)
            .transform()
            .rotate,
        90 | 270
    );
    let (w, h) = if swap {
        (h as u32, w as u32)
    } else {
        (w as u32, h as u32)
    };
    codecs::guard(w, h, max_pixels)?;
    Ok((r, w, h))
}

/// The developed dimensions, without demosaicing.
pub fn probe(bytes: &[u8], max_pixels: u64) -> Result<(u32, u32), codecs::Error> {
    let (_r, w, h) = open(bytes, max_pixels)?;
    Ok((w, h))
}

pub fn decode(
    bytes: &[u8],
    max_pixels: u64,
    hint: codecs::DecodeHint,
) -> Result<codecs::Decoded, codecs::Error> {
    let (r, exp_w, exp_h) = open(bytes, max_pixels)?;
    let lib = r.lib;
    // SAFETY: `r.data` is live for all four; each only writes LibRaw's own
    // parameter block.
    unsafe {
        (lib.set_output_bps)(r.data, 8);
        (lib.set_output_color)(r.data, COLOR_SRGB);
        // The camera's as-shot white balance. LibRaw's default is a fixed
        // daylight one, which gives every indoor frame a colour cast; there
        // is no C setter for `use_camera_wb`, so copy the multipliers across.
        // All-zero `cam_mul` means the file recorded none — leave LibRaw's
        // default alone rather than multiplying the image by zero.
        let mul: [f32; 4] = core::array::from_fn(|c| (lib.get_cam_mul)(r.data, c as c_int));
        if mul[0] > 0.0 && mul[1] > 0.0 && mul[2] > 0.0 {
            for (c, m) in mul.iter().enumerate() {
                (lib.set_user_mul)(r.data, c as c_int, *m);
            }
        }
        // Absent, LibRaw's automatic brightness stretch stays on, which is
        // what `dcraw file.nef` produces and what a caller who set nothing
        // expects. Given a multiplier, the stretch goes off and the recorded
        // exposure is scaled by it instead — the two are alternatives, not
        // layers, so asking for one turns the other off.
        if let Some(bright) = hint.raw_brightness {
            (lib.set_no_auto_bright)(r.data, 1);
            (lib.set_bright)(r.data, bright);
        }
    }
    // SAFETY: `r.data` is live and identified.
    if unsafe { (lib.unpack)(r.data) } != LIBRAW_SUCCESS {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: `r.data` is live and unpacked.
    if unsafe { (lib.dcraw_process)(r.data) } != LIBRAW_SUCCESS {
        return Err(codecs::Error::DecodeFailed);
    }
    let mut errc: c_int = 0;
    // SAFETY: `r.data` is live and processed; `errc` is an initialised
    // out-param. The result is owned by `Mem` from here on.
    let img = unsafe { (lib.make_mem_image)(r.data, &raw mut errc) };
    if img.is_null() {
        return Err(codecs::Error::DecodeFailed);
    }
    let mem = Mem { lib, img };
    // SAFETY: non-null, and LibRaw fills the header before returning.
    let hdr = unsafe { &*mem.img };
    // A LibRaw that hands back a JPEG (`type == LIBRAW_IMAGE_JPEG`, the
    // passthrough path), a bit depth other than 8, or dimensions that
    // disagree with the ones the guard above accepted, is not something to
    // copy out of on a guess.
    let (w, h) = (u32::from(hdr.width), u32::from(hdr.height));
    // Either orientation of the pair the guard accepted: whichever way the
    // flip went, the pixel count — the thing the guard was about — is the
    // same. Anything else is not something to copy out of on a guess.
    if hdr.kind != IMAGE_BITMAP
        || hdr.bits != 8
        || hdr.colors != 3
        || !((w, h) == (exp_w, exp_h) || (w, h) == (exp_h, exp_w))
    {
        return Err(codecs::Error::DecodeFailed);
    }
    let rgb_len = (w as usize)
        .checked_mul(h as usize)
        .and_then(|px| px.checked_mul(3))
        .ok_or(codecs::Error::TooManyPixels)?;
    if hdr.data_size as usize != rgb_len {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: `data[]` starts one byte past the header LibRaw declares, and
    // `data_size` bytes of it were just checked to be `rgb_len`.
    let rgb = unsafe {
        core::slice::from_raw_parts(
            (mem.img as *const u8).add(core::mem::size_of::<ProcessedImage>()),
            rgb_len,
        )
    };

    // RGB8 → RGBA8: the pipeline's invariant is four channels, and a raw
    // frame has no alpha.
    let len = rgb_len / 3 * 4;
    let mut out: Vec<u8> = Vec::new();
    out.try_reserve_exact(len)
        .map_err(|_| codecs::Error::OutOfMemory)?;
    for px in rgb.chunks_exact(3) {
        out.extend_from_slice(&[px[0], px[1], px[2], 0xFF]);
    }

    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        // Developed straight to sRGB above, so there is no profile to carry:
        // the bytes already mean what an untagged image means.
        icc_profile: None,
    })
}

/// Whether a usable LibRaw was found; the tests skip rather than fail on a
/// host without one.
pub fn available() -> bool {
    lib().is_some()
}
