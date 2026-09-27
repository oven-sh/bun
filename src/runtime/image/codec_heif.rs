//! HEIC/HEIF decode on Linux through a dlopen'd system libheif.
//!
//! macOS and Windows already decode HEIC through `system_backend`
//! (ImageIO/WIC). Linux has no system backend, so `new Bun.Image(heic)` has
//! been `ERR_IMAGE_FORMAT_UNSUPPORTED` there — which is where servers run and
//! where iPhone uploads land (#44037). This routes that case to the host's
//! libheif when one is installed, and keeps the old error when it is not.
//!
//! Bun links nothing. Every entry point is resolved with `dlsym` at first
//! use, so a host without `libheif.so.1` behaves exactly as it does today and
//! a minimal container does not have to carry an HEVC decoder it will never
//! call.
//!
//! Decode only. HEIC *output* needs an HEVC encoder, which is the part with
//! the licensing problem, and #44037 asks only for decode; `.heic()` stays
//! unavailable outside macOS and Windows.
//!
//! No C++ shim, unlike `backend_coregraphics.rs` and the libavif loader in
//! #30204. Those wrap APIs that need C (CoreFoundation) or a dozen pinned
//! struct layouts; libheif's C API is opaque handles throughout, so the only
//! layout to mirror is `heif_error`, and a second language on the path would
//! only add an `extern "C"` signature to keep in sync by hand.

use core::ffi::{c_char, c_int, c_void};
use std::sync::OnceLock;

use super::codecs;

// ─── libheif C ABI ──────────────────────────────────────────────────────────
//
// Written out by hand, not generated. That is the convention here — the
// `bindgen` crate is in none of the Cargo manifests and the C ABI is declared
// this way in some 270 files under `src/` — and for a dlopen'd library it is
// also the only correct choice. Generating from a header would pin these
// values to whatever version the machine that *built* Bun happened to have
// installed, while the library actually loaded belongs to the machine that
// *runs* it; two builds on different distros would disagree and neither would
// know. Nothing decided at build time can track that.
//
// What makes them safe to write down is that every one is ABI: enum values, a
// struct layout, and two four-character codes that ISO/IEC 23008-12 fixes
// rather than libheif. None can change without breaking every compiled
// consumer of libheif, which is what its SONAME promises not to do —
// `SUPPORTED_MAJOR` below is the check that the promise still applies. Each
// value was read out of the header named beside it, so the risk they carry is
// a transcription error now, not drift later.

/// `heif_error`, returned by value: two enums and a pointer (`heif_error.h`).
#[repr(C)]
struct HeifError {
    code: c_int,
    subcode: c_int,
    message: *const c_char,
}

/// `heif_error.h`: `heif_error_Memory_allocation_error` and
/// `heif_suberror_Security_limit_exceeded`, the pair libheif answers with
/// when an input trips the size limit `open_primary` sets on the context.
const ERROR_MEMORY_ALLOCATION: c_int = 6;
const SUBERROR_SECURITY_LIMIT_EXCEEDED: c_int = 1000;
/// Also `heif_error.h`: `heif_error_Unsupported_feature` with
/// `heif_suberror_Unsupported_codec`, which is what a libheif installed
/// without an HEVC decoder plugin answers.
const ERROR_UNSUPPORTED_FEATURE: c_int = 4;
const SUBERROR_UNSUPPORTED_CODEC: c_int = 3000;

impl HeifError {
    fn ok(&self) -> bool {
        self.code == 0 // heif_error_Ok
    }

    /// The error to report for a failed call. Tripping the size limit set in
    /// `open_primary` is the same refusal `codecs::guard` makes a few lines
    /// later, so it surfaces as the same error rather than as a damaged
    /// file. libheif 1.22 checks that limit when it decodes rather than when
    /// it reads, so in practice the guard is what answers; this is here so
    /// the code does not depend on which of the two gets there first.
    fn err(&self) -> codecs::Error {
        if self.code == ERROR_MEMORY_ALLOCATION && self.subcode == SUBERROR_SECURITY_LIMIT_EXCEEDED
        {
            codecs::Error::TooManyPixels
        } else {
            codecs::Error::DecodeFailed
        }
    }
}

/// `heif_image.h`. Asking for interleaved RGBA8 is what makes libheif do the
/// YCbCr→RGB conversion, the chroma upsampling and any 10-bit→8-bit
/// reduction, so the pipeline's RGBA8-everywhere invariant holds without this
/// file touching a sample.
const COLORSPACE_RGB: c_int = 1;
const CHROMA_INTERLEAVED_RGBA: c_int = 11;
const CHANNEL_INTERLEAVED: c_int = 10;
/// `heif_color.h`: `heif_color_profile_type_{rICC,prof}` as fourccs. Both are
/// a raw ICC payload. `nclx` is a CICP triple, not an ICC profile, and
/// `Decoded.icc_profile` has nowhere to put one.
const PROFILE_RICC: u32 = 0x7249_4343;
const PROFILE_PROF: u32 = 0x7072_6f66;

type Ctx = c_void;
type Handle = c_void;
type Img = c_void;

struct Lib {
    /// Added in 1.13, so older distro packages lack it; those initialise
    /// lazily on first use instead, which is why this one is optional where
    /// the rest are required.
    init: Option<unsafe extern "C" fn(*mut c_void) -> HeifError>,
    context_alloc: unsafe extern "C" fn() -> *mut Ctx,
    context_free: unsafe extern "C" fn(*mut Ctx),
    set_max_size: unsafe extern "C" fn(*mut Ctx, c_int),
    read_mem: unsafe extern "C" fn(*mut Ctx, *const c_void, usize, *const c_void) -> HeifError,
    primary_handle: unsafe extern "C" fn(*mut Ctx, *mut *mut Handle) -> HeifError,
    handle_release: unsafe extern "C" fn(*mut Handle),
    handle_width: unsafe extern "C" fn(*const Handle) -> c_int,
    handle_height: unsafe extern "C" fn(*const Handle) -> c_int,
    /// `heif_image_handle_get_luma_bits_per_pixel`: the source's depth,
    /// used only to tell an undecodable one from a corrupt file.
    handle_luma_depth: unsafe extern "C" fn(*const Handle) -> c_int,
    /// `0xHHMMLL00`, so 1.22.2 is `0x01160200`.
    version_number: unsafe extern "C" fn() -> u32,
    profile_type: unsafe extern "C" fn(*const Handle) -> u32,
    profile_size: unsafe extern "C" fn(*const Handle) -> usize,
    profile_read: unsafe extern "C" fn(*const Handle, *mut c_void) -> HeifError,
    decode_image:
        unsafe extern "C" fn(*const Handle, *mut *mut Img, c_int, c_int, *const c_void) -> HeifError,
    image_release: unsafe extern "C" fn(*mut Img),
    plane_readonly: unsafe extern "C" fn(*const Img, c_int, *mut c_int) -> *const u8,
    /// The decoded frame's own dimensions, which the row copy checks the
    /// handle's against rather than assuming the two agree.
    image_width: unsafe extern "C" fn(*const Img, c_int) -> c_int,
    image_height: unsafe extern "C" fn(*const Img, c_int) -> c_int,
}

/// The versioned name first: on Debian the bare `libheif.so` is in
/// `libheif-dev`, which a container serving photo uploads has no reason to
/// install, while `libheif.so.1` comes with the runtime package. The bare
/// name is the fallback for a source build that installed no versioned one.
///
/// A future `libheif.so.2` is not listed, and deliberately: a SONAME bump is
/// an ABI break, so the entry points below would have to be re-checked
/// against it by a human before it could be trusted. Until someone does that,
/// such a host gets `UnsupportedOnPlatform`, which is what it gets today.
/// `major_version` is what keeps the bare-name fallback from being a hole in
/// that reasoning.
const SONAMES: [&core::ffi::CStr; 2] = [c"libheif.so.1", c"libheif.so"];

/// Only the 1.x series is known to match the signatures declared above.
const SUPPORTED_MAJOR: u32 = 1;

static LIB: OnceLock<Option<Lib>> = OnceLock::new();

fn lib() -> Option<&'static Lib> {
    LIB.get_or_init(load).as_ref()
}

fn load() -> Option<Lib> {
    // RTLD_NOW so libheif's own NEEDED entries — the HEVC decoder it was
    // built against, libde265 or ffmpeg — resolve at load time rather than
    // during someone's first decode. Default scope (RTLD_LOCAL): libheif
    // reaches its decoder plugins through an in-library table, so its own
    // load group suffices, and RTLD_GLOBAL would promote every de265_* symbol
    // into the process scope to collide with native addons carrying their own
    // copy.
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

    // Never dlclose'd: the library stays mapped for the life of the process,
    // which is what a decoder reachable from any WorkPool thread wants.
    macro_rules! sym {
        ($name:literal) => {{
            // SAFETY: `handle` is a live dlopen handle and the name is a
            // 'static NUL-terminated C string. The transmute is
            // pointer-to-fn-pointer, guarded by the null check, to the
            // signature libheif's header gives that symbol.
            let p = unsafe { libc::dlsym(handle, concat!($name, "\0").as_ptr().cast()) };
            if p.is_null() {
                return None;
            }
            unsafe { core::mem::transmute(p) }
        }};
    }

    // SAFETY: as in `sym!`; a null result is the "not present" case, which
    // this one symbol tolerates rather than failing the whole load.
    let init_ptr = unsafe { libc::dlsym(handle, c"heif_init".as_ptr()) };
    let lib = Lib {
        init: if init_ptr.is_null() {
            None
        } else {
            // SAFETY: non-null, and this is `heif_init`'s signature.
            Some(unsafe { core::mem::transmute(init_ptr) })
        },
        context_alloc: sym!("heif_context_alloc"),
        context_free: sym!("heif_context_free"),
        set_max_size: sym!("heif_context_set_maximum_image_size_limit"),
        read_mem: sym!("heif_context_read_from_memory_without_copy"),
        primary_handle: sym!("heif_context_get_primary_image_handle"),
        handle_release: sym!("heif_image_handle_release"),
        handle_width: sym!("heif_image_handle_get_width"),
        handle_height: sym!("heif_image_handle_get_height"),
        handle_luma_depth: sym!("heif_image_handle_get_luma_bits_per_pixel"),
        version_number: sym!("heif_get_version_number"),
        profile_type: sym!("heif_image_handle_get_color_profile_type"),
        profile_size: sym!("heif_image_handle_get_raw_color_profile_size"),
        profile_read: sym!("heif_image_handle_get_raw_color_profile"),
        decode_image: sym!("heif_decode_image"),
        image_release: sym!("heif_image_release"),
        plane_readonly: sym!("heif_image_get_plane_readonly"),
        image_width: sym!("heif_image_get_width"),
        image_height: sym!("heif_image_get_height"),
    };
    // The bare `libheif.so` above can resolve to any major version the host
    // happens to have. Loading one whose ABI these signatures were never
    // checked against would be worse than not loading it at all, so refuse
    // rather than call into it.
    // SAFETY: just resolved; takes no arguments and only reads a constant.
    if (unsafe { (lib.version_number)() } >> 24) != SUPPORTED_MAJOR {
        return None;
    }
    if let Some(init) = lib.init {
        // SAFETY: just resolved; a null params pointer asks for the defaults.
        unsafe { init(core::ptr::null_mut()) };
    }
    Some(lib)
}

// ─── RAII ───────────────────────────────────────────────────────────────────

/// Context and primary-image handle for one call. libheif's own free
/// functions are the matching deallocators and each runs exactly once.
struct Reader {
    lib: &'static Lib,
    ctx: *mut Ctx,
    handle: *mut Handle,
}

impl Drop for Reader {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: allocated by heif_context_get_primary_image_handle.
            unsafe { (self.lib.handle_release)(self.handle) };
        }
        if !self.ctx.is_null() {
            // SAFETY: allocated by heif_context_alloc.
            unsafe { (self.lib.context_free)(self.ctx) };
        }
    }
}

/// One decoded frame.
struct Frame {
    lib: &'static Lib,
    img: *mut Img,
}

impl Drop for Frame {
    fn drop(&mut self) {
        if !self.img.is_null() {
            // SAFETY: allocated by heif_decode_image.
            unsafe { (self.lib.image_release)(self.img) };
        }
    }
}

/// The ICC copy, freed on drop; `libc::malloc` is its allocator because the
/// size is only known after libheif reports it and the bytes are copied into
/// a global-allocator `Vec` straight after.
struct IccBuf {
    ptr: *mut u8,
    size: usize,
}

impl IccBuf {
    fn into_owned(self) -> Option<Vec<u8>> {
        if self.ptr.is_null() || self.size == 0 {
            return None;
        }
        // SAFETY: `self.size` bytes were written at `self.ptr`; the copy runs
        // before `Drop` frees them.
        Some(unsafe { core::slice::from_raw_parts(self.ptr, self.size) }.to_vec())
    }
}

impl Drop for IccBuf {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            // SAFETY: allocated with libc::malloc; libc::free matches.
            unsafe { libc::free(self.ptr.cast::<c_void>()) };
        }
    }
}

// ─── decode ─────────────────────────────────────────────────────────────────

/// Parse the container as far as the primary image's dimensions and apply the
/// pixel guard. No HEVC decoding happens here — `heif_decode_image` is where
/// that starts — so this is the probe path too.
fn open_primary(bytes: &[u8], max_pixels: u64) -> Result<(Reader, u32, u32), codecs::Error> {
    let lib = lib().ok_or(codecs::Error::UnsupportedOnPlatform)?;
    // SAFETY: no preconditions; null on allocation failure.
    let ctx = unsafe { (lib.context_alloc)() };
    if ctx.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let mut r = Reader {
        lib,
        ctx,
        handle: core::ptr::null_mut(),
    };
    // Coarse pre-parse bomb guard: libheif rejects a side wider than this
    // before allocating. It is per-side and `max_pixels` is a product, so it
    // cannot be exact; `codecs::guard` below is, and runs before the alloc.
    // SAFETY: `ctx` is live.
    unsafe { (lib.set_max_size)(ctx, c_int::try_from(max_pixels).unwrap_or(c_int::MAX)) };
    // `without_copy` borrows `bytes` for the lifetime of the context, which
    // ends with `r`, inside the call the caller is blocked on.
    // SAFETY: `ctx` is live; ptr/len come from a live `&[u8]`; a null options
    // pointer asks for the defaults.
    let e = unsafe { (lib.read_mem)(ctx, bytes.as_ptr().cast(), bytes.len(), core::ptr::null()) };
    if !e.ok() {
        return Err(e.err());
    }
    // SAFETY: `ctx` is live; `r.handle` is an initialised out-param owned by
    // `Reader::drop` from here on.
    let e = unsafe { (lib.primary_handle)(ctx, &raw mut r.handle) };
    if !e.ok() || r.handle.is_null() {
        return Err(e.err());
    }
    // SAFETY: `r.handle` is live for as long as `r` is.
    let w = unsafe { (lib.handle_width)(r.handle) };
    // SAFETY: as above.
    let h = unsafe { (lib.handle_height)(r.handle) };
    if w <= 0 || h <= 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let (w, h) = (w as u32, h as u32);
    codecs::guard(w, h, max_pixels)?;
    Ok((r, w, h))
}

/// Dimensions of the primary image without running the HEVC decode — the
/// container parse alone, so `metadata()` on a 12 MP iPhone photo stays a box
/// walk, as it is for every other format.
pub fn probe(bytes: &[u8], max_pixels: u64) -> Result<(u32, u32), codecs::Error> {
    let (_r, w, h) = open_primary(bytes, max_pixels)?;
    Ok((w, h))
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let (r, w, h) = open_primary(bytes, max_pixels)?;
    let lib = r.lib;
    let row = (w as usize) * 4;
    let len = row
        .checked_mul(h as usize)
        .ok_or(codecs::Error::TooManyPixels)?;
    let mut out: Vec<u8> = Vec::new();
    out.try_reserve_exact(len)
        .map_err(|_| codecs::Error::OutOfMemory)?;

    let mut frame = Frame {
        lib,
        img: core::ptr::null_mut(),
    };
    // RGBA8 is the most the pipeline can carry, so it is what we ask for
    // whatever the source holds; libheif reduces a 10- or 12-bit frame on the
    // way out. A null options pointer takes its defaults, which include
    // applying the container's `irot`/`imir`, so the pixels arrive upright.
    // Bun's auto-orient only runs for JPEG, so nothing rotates them again.
    // SAFETY: `r.handle` is live; `frame.img` is an initialised out-param
    // owned by `Frame::drop` from here on.
    let e = unsafe {
        (lib.decode_image)(
            r.handle,
            &raw mut frame.img,
            COLORSPACE_RGB,
            CHROMA_INTERLEAVED_RGBA,
            core::ptr::null(),
        )
    };
    if !e.ok() || frame.img.is_null() {
        // Three unrelated problems arrive here, and only the last means the
        // file is bad. libheif can be installed with no HEVC decoder plugin
        // at all — on Debian those are separate packages — and says so. A
        // plugin built for 8-bit only cannot read a 10- or 12-bit frame, and
        // says nothing in particular, so the frame's own depth is what tells
        // us. Both are "install a decoder that can read this", which is what
        // `UnsupportedOnPlatform` means; only what is left is `DecodeFailed`.
        if e.code == ERROR_UNSUPPORTED_FEATURE && e.subcode == SUBERROR_UNSUPPORTED_CODEC {
            return Err(codecs::Error::UnsupportedOnPlatform);
        }
        // SAFETY: `r.handle` is live.
        if unsafe { (lib.handle_luma_depth)(r.handle) } > 8 {
            return Err(codecs::Error::UnsupportedOnPlatform);
        }
        return Err(codecs::Error::DecodeFailed);
    }
    let mut stride: c_int = 0;
    // SAFETY: `frame.img` is live; `stride` is an initialised out-param.
    let plane = unsafe { (lib.plane_readonly)(frame.img, CHANNEL_INTERLEAVED, &raw mut stride) };
    if plane.is_null() || stride < 0 || (stride as usize) < row {
        return Err(codecs::Error::DecodeFailed);
    }
    let stride = stride as usize;
    // `out` was sized from the handle's dimensions and the copy below reads
    // `h` rows of `row` bytes out of the plane, so the two have to be the
    // same picture. libheif has let them disagree — strukturag/libheif#417,
    // where the handle was taller than the decoded plane — and a row that is
    // not there is not worth leaving to the library's good behaviour. There
    // is nothing the caller could do differently about it, so it joins the
    // rest as a bad decode. Compared only: the loop below stays bounded by
    // `h`, the height the guard accepted and `len` was sized from, never by
    // anything re-read from the frame.
    // SAFETY: `frame.img` is live.
    let dw = unsafe { (lib.image_width)(frame.img, CHANNEL_INTERLEAVED) };
    // SAFETY: as above.
    let dh = unsafe { (lib.image_height)(frame.img, CHANNEL_INTERLEAVED) };
    if dw != w as c_int || dh != h as c_int {
        return Err(codecs::Error::DecodeFailed);
    }
    for y in 0..h as usize {
        // SAFETY: the plane has `h` rows of `stride >= row` bytes, both
        // checked just above, and `out` has `len == row * h` bytes of spare
        // capacity.
        unsafe {
            core::ptr::copy_nonoverlapping(plane.add(y * stride), out.as_mut_ptr().add(y * row), row);
        }
    }
    // SAFETY: the loop wrote every one of the `len` bytes.
    unsafe { bun_core::vec::commit_spare(&mut out, len) };
    drop(frame);

    // SAFETY: `r.handle` is live.
    let profile = unsafe { (lib.profile_type)(r.handle) };
    let icc = if profile == PROFILE_RICC || profile == PROFILE_PROF {
        // SAFETY: as above.
        let size = unsafe { (lib.profile_size)(r.handle) };
        if size == 0 {
            None
        } else {
            // SAFETY: non-zero size; null on allocation failure.
            let ptr = unsafe { libc::malloc(size) }.cast::<u8>();
            if ptr.is_null() {
                return Err(codecs::Error::OutOfMemory);
            }
            let buf = IccBuf { ptr, size };
            // SAFETY: `r.handle` is live and `ptr` has the `size` writable
            // bytes heif_image_handle_get_raw_color_profile_size asked for.
            if unsafe { (lib.profile_read)(r.handle, ptr.cast()) }.ok() {
                buf.into_owned()
            } else {
                // A profile that will not read back is not a decode failure:
                // the pixels are right, they just get read as sRGB.
                None
            }
        }
    } else {
        None
    };

    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile: icc,
    })
}

/// Whether a usable libheif was found; the tests skip rather than fail on a
/// host without one.
pub fn available() -> bool {
    lib().is_some()
}
