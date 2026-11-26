//! Decompresses the items of ICU's data, for the hooks that include `icu_data.h`.

use core::slice;

use bun_zstd_decoder::array::allocate;
use bun_zstd_decoder::{
    ContentSize, Dictionary, FrameLen, Output, decompress, frame_content_size, frame_len,
};

/// As much of the frame at `item` as it takes for `is_enough`, or all of it.
///
/// # Safety
/// `item` has `length` bytes if that is positive, or else starts with a whole zstd frame.
unsafe fn frame<'a>(
    item: *const u8,
    length: i32,
    is_enough: impl Fn(&[u8]) -> bool,
) -> Option<&'a [u8]> {
    let mut len = length.max(0) as usize;
    loop {
        // SAFETY: that is `length`, or the frame is at least as long.
        let prefix = unsafe { slice::from_raw_parts(item, len) };
        if is_enough(prefix) {
            return Some(prefix);
        }
        len = match frame_len(prefix).ok()? {
            FrameLen::Complete(len) => return prefix.get(..len),
            FrameLen::AtLeast(len) if length <= 0 => len,
            FrameLen::AtLeast(_) => return None,
        };
    }
}

/// -1 if it is not known.
///
/// # Safety
/// As for [`frame`].
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ICUItem__size(item: *const u8, length: i32) -> i32 {
    let has_header = |prefix: &[u8]| frame_content_size(prefix) != ContentSize::Invalid;
    // SAFETY: the caller guarantees what `frame()` asks for.
    match unsafe { frame(item, length, has_header) }.map(frame_content_size) {
        Some(ContentSize::Known(size)) => i32::try_from(size).unwrap_or(-1),
        _ => -1,
    }
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<Dictionary<'static>>();

/// # Safety
/// As for [`frame`]. `dictionary` has `dictionary_size` bytes for good, or is null. `out` has room for `size` bytes.
/// `parsed` is null, or what an earlier call on any thread left there.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ICUItem__decompress(
    item: *const u8,
    length: i32,
    dictionary: *const u8,
    dictionary_size: usize,
    parsed: &mut Option<Box<Dictionary<'static>>>,
    out: *mut u8,
    size: usize,
) -> bool {
    if parsed.is_none() && !dictionary.is_null() {
        // SAFETY: it has `dictionary_size` bytes for good.
        let bytes = unsafe { slice::from_raw_parts(dictionary, dictionary_size) };
        let Ok(dictionary) = Dictionary::new(bytes).and_then(|it| allocate(|| it)) else {
            return false;
        };
        *parsed = Some(dictionary);
    }
    // SAFETY: the caller guarantees what `frame()` asks for. The `size` bytes of `out` are initialized first.
    let (frame, out) = unsafe {
        out.write_bytes(0, size);
        (
            frame(item, length, |_| false),
            slice::from_raw_parts_mut(out, size),
        )
    };
    frame.is_some_and(|frame| decompress(frame, &mut Output::slice(out), parsed.as_deref()).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "abcabcabcab", which takes the dictionary below.
    const WITH_DICTIONARY: &[u8] =
        b"\x28\xb5\x2f\xfd\x20\x0b\x3d\x00\x00\x00\x01\x54\x00\x02\x08\x06";
    const DICTIONARY: &[u8] = b"01234abc";
    const RAW: &[u8] = b"\x28\xb5\x2f\xfd\x20\x03\x19\x00\x00abc";
    const SIZE_UNKNOWN: &[u8] = b"\x28\xb5\x2f\xfd\x00\x00\x19\x00\x00abc";
    const SIZE_OF_2_GB: &[u8] = b"\x28\xb5\x2f\xfd\x80\x00\x00\x00\x00\x80\x19\x00\x00abc";

    fn size(item: &[u8], length: i32) -> i32 {
        // SAFETY: the callers pass a whole frame, or no more than its length.
        unsafe { Bun__ICUItem__size(item.as_ptr(), length) }
    }

    fn decompressed(item: &[u8], length: i32, size: usize) -> Option<Vec<u8>> {
        decompressed_with(Some(DICTIONARY), &mut None, item, length, size)
    }

    fn decompressed_with(
        dictionary: Option<&'static [u8]>,
        parsed: &mut Option<Box<Dictionary<'static>>>,
        item: &[u8],
        length: i32,
        size: usize,
    ) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(size);
        let (dictionary, len) =
            dictionary.map_or((core::ptr::null(), 0), |it| (it.as_ptr(), it.len()));
        // SAFETY: as above. The dictionary is static, and success means that `size` bytes of `out` are initialized.
        unsafe {
            let (item, room) = (item.as_ptr(), out.as_mut_ptr());
            let is_done =
                Bun__ICUItem__decompress(item, length, dictionary, len, parsed, room, size);
            out.set_len(if is_done { size } else { 0 });
            is_done.then_some(out)
        }
    }

    #[test]
    fn the_length_is_optional() {
        let padded = [RAW, &[0; 5]].concat();
        for (item, length) in [(RAW, -1), (RAW, 0), (RAW, 12), (&padded, 17)] {
            assert_eq!(size(item, length), 3);
            assert_eq!(decompressed(item, length, 3).as_deref(), Some(&b"abc"[..]));
        }
    }

    #[test]
    fn a_frame_ends_within_the_length() {
        for length in 1..RAW.len() {
            let expected = if length < 6 { -1 } else { 3 };
            assert_eq!(size(&RAW[..length], length as i32), expected);
            assert_eq!(decompressed(&RAW[..length], length as i32, 3), None);
        }
    }

    #[test]
    fn a_size_is_known_and_fits() {
        assert_eq!(size(SIZE_UNKNOWN, -1), -1);
        assert_eq!(size(SIZE_OF_2_GB, -1), -1);
        assert_eq!(size(b"not a frame", 11), -1);
    }

    #[test]
    fn items_refer_to_the_dictionary() {
        let out = decompressed(WITH_DICTIONARY, -1, 11);
        assert_eq!(out.as_deref(), Some(&b"abcabcabcab"[..]));
        assert_eq!(decompressed(WITH_DICTIONARY, -1, 10), None);
    }

    #[test]
    fn the_dictionary_is_optional_and_tried_until_it_is_accepted() {
        let mut parsed = None;
        let cut_off: &[u8] = b"\x37\xa4\x30\xec\x01\x00\x00\x00";
        for (dictionary, item, expected) in [
            (None, RAW, Some(&b"abc"[..])),
            (Some(cut_off), RAW, None),
            (None, WITH_DICTIONARY, None),
            (Some(DICTIONARY), WITH_DICTIONARY, Some(b"abcabcabcab")),
            (Some(cut_off), WITH_DICTIONARY, Some(b"abcabcabcab")),
        ] {
            let size = size(item, -1) as usize;
            let out = decompressed_with(dictionary, &mut parsed, item, -1, size);
            assert_eq!(out.as_deref(), expected);
        }
    }
}
