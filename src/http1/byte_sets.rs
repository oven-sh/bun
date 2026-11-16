use bun_core::strings::ByteSet;

/// RFC 9110 §5.6.2 `tchar`.
pub(crate) static TOKEN: ByteSet = ByteSet::new(&[
    b'!'..=b'!',
    b'#'..=b'\'',
    b'*'..=b'+',
    b'-'..=b'.',
    b'0'..=b'9',
    b'A'..=b'Z',
    b'^'..=b'z',
    b'|'..=b'|',
    b'~'..=b'~',
]);

/// All but the control characters other than HTAB.
pub(crate) static CONTENT: ByteSet = ByteSet::new(&[b'\t'..=b'\t', b' '..=b'~', 0x80..=0xff]);

/// RFC 9110 §5.6.4 `qdtext`.
pub(crate) static QUOTED_TEXT: ByteSet = ByteSet::new(&[
    b'\t'..=b'\t',
    b' '..=b'!',
    b'#'..=b'[',
    b']'..=b'~',
    0x80..=0xff,
]);
