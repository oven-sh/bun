//! In a process of its own, as the first dictionary that is accepted stays.

use bun_icu_data as _;

unsafe extern "C" {
    fn Bun__ICUItem__decompress(
        item: *const u8,
        length: i32,
        dictionary: *const u8,
        dictionary_size: usize,
        out: *mut u8,
        size: usize,
    ) -> bool;
}

fn decompressed(item: &[u8], dictionary: Option<&'static [u8]>) -> Option<[u8; 11]> {
    let (dictionary, len) = dictionary.map_or((std::ptr::null(), 0), |it| (it.as_ptr(), it.len()));
    let mut out = [0; 11];
    // SAFETY: the callers pass a whole frame, and `out` is as long as it is said to be.
    let is_done = unsafe {
        Bun__ICUItem__decompress(item.as_ptr(), -1, dictionary, len, out.as_mut_ptr(), 11)
    };
    is_done.then_some(out)
}

#[test]
fn the_dictionary_is_optional_and_tried_until_it_is_accepted() {
    let expected = Some(*b"abcabcabcab");
    let raw = b"\x28\xb5\x2f\xfd\x20\x0b\x59\x00\x00abcabcabcab";
    assert_eq!(decompressed(raw, None), expected);
    let cut_off = b"\x37\xa4\x30\xec\x01\x00\x00\x00";
    assert_eq!(decompressed(raw, Some(cut_off)), None);

    let needs_one = b"\x28\xb5\x2f\xfd\x20\x0b\x3d\x00\x00\x00\x01\x54\x00\x02\x08\x06";
    assert_eq!(decompressed(needs_one, None), None);
    assert_eq!(decompressed(needs_one, Some(b"01234abc")), expected);
}
