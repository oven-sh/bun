//! Removes from files what is not read.

use crate::resb::{u16_at, u32_at};

const HEADER_SIZE: usize = 24;

/// Returns the header without the copyright notice, and what follows the header.
pub(crate) fn split_header(file: &[u8]) -> (Vec<u8>, &[u8]) {
    let mut header = file[..HEADER_SIZE].to_vec();
    header[..2].copy_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
    (header, &file[u16_at(file, 0).into()..])
}

/// ICU4C: rbbidata.h, emojiprops.h
pub(crate) fn without_unread_parts(path: &str, file: &[u8]) -> Vec<u8> {
    let (header, rest) = split_header(file);
    let field = |index: usize| u32_at(rest, 4 * index) as usize;
    let end = if path.ends_with(".brk") {
        let [rules, status_table] = [field(10), field(12)];
        assert!(rules > status_table);
        rules
    } else if path == "uemoji.icu" {
        field(1)
    } else {
        rest.len()
    };
    [&header, &rest[..end]].concat()
}
