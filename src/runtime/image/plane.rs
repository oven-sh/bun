//! An RGBA8 plane and its shape, as one value.
//!
//! `Decoded` lives in its own module so that its fields are private to every
//! file that handles a plane, `codecs.rs` included: the only way to obtain one
//! is `Decoded::new`, which checks the buffer against the shape, and the only
//! way to change one is `replace_with`, which takes another `Decoded`. A
//! buffer and a width/height pair therefore never travel separately between
//! a decoder, a geometry kernel, an encoder, the placeholder and the
//! `pixels()` hand-off, and none of those needs a check of its own.

use super::codecs::Error;

/// An RGBA8 plane and its shape.
pub(crate) struct Decoded {
    rgba: Vec<u8>, // global allocator (mimalloc)
    width: u32,
    height: u32,
    /// ICC color profile bytes pulled from the source container (JPEG APP2,
    /// PNG iCCP, WebP ICCP), global-allocator-owned. `None` when the
    /// source didn't carry one or the decode path doesn't extract it
    /// (BMP/GIF have no ICC chunk; the system backends do not forward one).
    /// The image pipeline hands this straight to the matching encoder; the
    /// RGBA buffer is NOT converted to sRGB, so the bytes only have their
    /// intended colour meaning when the profile travels with them. Dropping
    /// it on a Display-P3 / Adobe RGB / XYB source would reinterpret the
    /// values as sRGB and visibly shift the colours. See issue #30197.
    icc_profile: Option<Vec<u8>>,
}

impl Decoded {
    /// The one constructor: refuses a zero dimension or a buffer that is not
    /// exactly `width * height * 4` bytes, in release builds too.
    pub(crate) fn new(
        rgba: Vec<u8>,
        width: u32,
        height: u32,
        icc_profile: Option<Vec<u8>>,
    ) -> Result<Decoded, Error> {
        // u64 mul cannot overflow from two u32 factors and a 4.
        if width == 0
            || height == 0
            || rgba.len() as u64 != u64::from(width) * u64::from(height) * 4
        {
            return Err(Error::DecodeFailed);
        }
        Ok(Decoded {
            rgba,
            width,
            height,
            icc_profile,
        })
    }

    pub(crate) fn rgba(&self) -> &[u8] {
        &self.rgba
    }

    /// For the in-place stages (modulate, the GIF alpha normalisation): a
    /// slice, so the length cannot change under the shape.
    pub(crate) fn rgba_mut(&mut self) -> &mut [u8] {
        &mut self.rgba
    }

    pub(crate) fn width(&self) -> u32 {
        self.width
    }

    pub(crate) fn height(&self) -> u32 {
        self.height
    }

    pub(crate) fn icc_profile(&self) -> Option<&[u8]> {
        self.icc_profile.as_deref()
    }

    /// Swap in a geometry stage's output. The old buffer drops here, so peak
    /// memory is at most two frames. The ICC profile moves to the new plane,
    /// since geometry does not change colour meaning; nothing can fail
    /// between taking it and installing it.
    pub(crate) fn replace_with(&mut self, mut next: Decoded) {
        next.icc_profile = self.icc_profile.take();
        *self = next;
    }

    /// The plane and its shape, for the `pixels()` hand-off. The profile
    /// drops with the rest of `self`.
    pub(crate) fn into_plane(self) -> (Vec<u8>, u32, u32) {
        (self.rgba, self.width, self.height)
    }
}
