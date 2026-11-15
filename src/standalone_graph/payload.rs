//! The bytes that a standalone module graph is read from.

use bun_core::{AnyBitPattern, StringPointer};
use bun_resolver::compiled_program::{ImageFile, LoadedImage};

/// The only handle to a payload. Nothing writes to the payload before `into_payload_and_image` hands out its image.
pub(crate) struct RawPayload {
    base: *mut u8,
    length: usize,
    pub(crate) file: Option<ImageFile>,
}

impl RawPayload {
    /// `file`: the descriptor `base` was mapped from, and the offset of `base` in that file.
    ///
    /// # Safety
    /// While the result or anything read from it is in use, `base[..length]` stays readable and is only written
    /// through the `LoadedImage` of the result. It is initialized, except for an image that no record overlaps.
    pub(crate) unsafe fn from_raw_parts(
        base: *mut u8,
        length: usize,
        file: Option<ImageFile>,
    ) -> RawPayload {
        RawPayload { base, length, file }
    }

    pub(crate) fn len(&self) -> usize {
        self.length
    }

    pub(crate) fn bytes(&self, offset: usize, length: usize) -> Option<&[u8]> {
        if offset.checked_add(length)? > self.length {
            return None;
        }
        // SAFETY: the range lies in `base[..length]`, and the borrow ends before there is a `LoadedImage`.
        Some(unsafe { core::slice::from_raw_parts(self.base.add(offset), length) })
    }

    pub(crate) fn read<T: AnyBitPattern>(&self, offset: usize) -> Option<T> {
        bun_core::read_prefix(self.bytes(offset, size_of::<T>())?)
    }

    /// For a payload without an image.
    pub(crate) fn into_payload(self) -> Payload {
        Payload {
            before_image: &[],
            // SAFETY: there will be no `LoadedImage`.
            after_image: unsafe { core::slice::from_raw_parts(self.base, self.length) },
            image_end: 0,
        }
    }

    pub(crate) fn into_payload_and_image(
        self,
        image: StringPointer,
    ) -> Option<(Payload, LoadedImage)> {
        let (start, length) = (image.offset as usize, image.length as usize);
        let image_end = start + length;
        let length_after = self.length.checked_sub(image_end)?;
        // SAFETY: three disjoint ranges of `base[..length]`, and `self` was the only handle to them.
        unsafe {
            let payload = Payload {
                before_image: core::slice::from_raw_parts(self.base, start),
                after_image: core::slice::from_raw_parts(self.base.add(image_end), length_after),
                image_end,
            };
            let image = core::ptr::slice_from_raw_parts_mut(self.base.add(start), length);
            Some((payload, LoadedImage::from_raw(image)))
        }
    }
}

/// A payload without its image.
#[derive(Copy, Clone)]
pub(crate) struct Payload {
    before_image: &'static [u8],
    after_image: &'static [u8],
    image_end: usize,
}

impl Payload {
    /// `None` if the range is out of bounds or overlaps the image.
    pub(crate) fn bytes(&self, offset: usize, length: usize) -> Option<&'static [u8]> {
        match offset.checked_sub(self.image_end) {
            Some(offset) => self.after_image.get(offset..offset.checked_add(length)?),
            None => self.before_image.get(offset..offset.checked_add(length)?),
        }
    }

    /// The offset of an empty string is not checked.
    pub(crate) fn pointed_bytes(&self, pointer: StringPointer) -> Option<&'static [u8]> {
        self.bytes(pointer.offset as usize, pointer.length as usize)
            .or_else(|| (pointer.length == 0).then_some(&[]))
    }
}
