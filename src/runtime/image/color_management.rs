//! ICC-aware CMYK JPEG conversion through Little CMS.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use super::codecs;

type Context = *mut c_void;
type Profile = *mut c_void;
type Transform = *mut c_void;

// lcms2.h: COLORSPACE_SH(s) = s << 16, CHANNELS_SH(c) = c << 3,
// BYTES_SH(b) = b, EXTRA_SH(e) = e << 7, FLAVOR_SH(f) = f << 13.
const TYPE_CMYK_8_REV: u32 = (6 << 16) | (4 << 3) | 1 | (1 << 13);
const TYPE_RGBA_8: u32 = (4 << 16) | (3 << 3) | 1 | (1 << 7);
const CMYK_SIGNATURE: u32 = u32::from_be_bytes(*b"CMYK");
const INTENT_PERCEPTUAL: u32 = 0;
const LCMS_USED_AS_INPUT: u32 = 0;
const FLAGS_NOCACHE: u32 = 0x0040;

unsafe extern "C" {
    fn cmsCreateContext(plugin: *mut c_void, user_data: *mut c_void) -> Context;
    fn cmsDeleteContext(context: Context);
    fn cmsOpenProfileFromMemTHR(context: Context, bytes: *const c_void, size: u32) -> Profile;
    fn cmsCreate_sRGBProfileTHR(context: Context) -> Profile;
    fn cmsCloseProfile(profile: Profile) -> c_int;
    fn cmsGetColorSpace(profile: Profile) -> u32;
    fn cmsGetDeviceClass(profile: Profile) -> u32;
    fn cmsIsIntentSupported(profile: Profile, intent: u32, direction: u32) -> c_int;
    fn cmsCreateTransformTHR(
        context: Context,
        input: Profile,
        input_format: u32,
        output: Profile,
        output_format: u32,
        intent: u32,
        flags: u32,
    ) -> Transform;
    fn cmsDeleteTransform(transform: Transform);
    fn cmsDoTransform(transform: Transform, input: *const c_void, output: *mut c_void, count: u32);
}

pub(super) fn cmyk_to_srgb(profile: &[u8], pixels: &mut [u8]) -> Result<bool, codecs::Error> {
    debug_assert_eq!(pixels.len() % 4, 0);
    let size = u32::try_from(profile.len()).map_err(|_| codecs::Error::DecodeFailed)?;
    // SAFETY: null plugin/user_data requests an independent default context.
    let context =
        NonNull::new(unsafe { cmsCreateContext(core::ptr::null_mut(), core::ptr::null_mut()) })
            .ok_or(codecs::Error::OutOfMemory)?;
    let context = scopeguard::guard(context, |c| {
        // SAFETY: all profiles/transforms drop before their owning context.
        unsafe { cmsDeleteContext(c.as_ptr()) };
    });
    // SAFETY: `profile` stays alive until the profile handle is closed.
    let Some(input) = NonNull::new(unsafe {
        cmsOpenProfileFromMemTHR(context.as_ptr(), profile.as_ptr().cast(), size)
    }) else {
        return Ok(false);
    };
    let input = scopeguard::guard(input, |p| {
        // SAFETY: the live profile is closed once, after its transform is deleted.
        unsafe { cmsCloseProfile(p.as_ptr()) };
    });
    // SAFETY: input is a live profile. Device links cannot describe source pixels.
    if unsafe {
        cmsGetColorSpace(input.as_ptr()) != CMYK_SIGNATURE
            || cmsGetDeviceClass(input.as_ptr()) == u32::from_be_bytes(*b"link")
            || cmsIsIntentSupported(input.as_ptr(), INTENT_PERCEPTUAL, LCMS_USED_AS_INPUT) == 0
    } {
        return Ok(false);
    }
    // SAFETY: context remains live until the output profile is closed.
    let output = NonNull::new(unsafe { cmsCreate_sRGBProfileTHR(context.as_ptr()) })
        .ok_or(codecs::Error::OutOfMemory)?;
    let output = scopeguard::guard(output, |p| {
        // SAFETY: the live profile is closed once, after its transform is deleted.
        unsafe { cmsCloseProfile(p.as_ptr()) };
    });
    // SAFETY: both live profiles belong to this context and match their pixel formats.
    let transform = NonNull::new(unsafe {
        cmsCreateTransformTHR(
            context.as_ptr(),
            input.as_ptr(),
            TYPE_CMYK_8_REV,
            output.as_ptr(),
            TYPE_RGBA_8,
            INTENT_PERCEPTUAL,
            FLAGS_NOCACHE,
        )
    })
    .ok_or(codecs::Error::DecodeFailed)?;
    let transform = scopeguard::guard(transform, |t| {
        // SAFETY: the transform is deleted once, before either profile or context.
        unsafe { cmsDeleteTransform(t.as_ptr()) };
    });

    // Small batches bound the u32 pixel count and keep later alpha writes cache-local.
    for chunk in pixels.chunks_mut(4096 * 4) {
        let ptr = chunk.as_mut_ptr();
        // SAFETY: LCMS supports in-place transforms; both formats occupy 4 bytes per pixel.
        // The input formatter reads all four ink channels before the output formatter writes RGB.
        unsafe {
            cmsDoTransform(
                transform.as_ptr(),
                ptr.cast(),
                ptr.cast(),
                (chunk.len() / 4) as u32,
            )
        };
        for pixel in chunk.as_chunks_mut::<4>().0 {
            // LCMS leaves the extra channel untouched; the original K byte is not alpha.
            pixel[3] = 255;
        }
    }
    Ok(true)
}
