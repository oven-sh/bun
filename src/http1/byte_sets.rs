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

/// RFC 5234 `VCHAR`.
pub(crate) static VISIBLE: ByteSet = ByteSet::new(core::slice::from_ref(&(b'!'..=b'~')));

/// RFC 3986 §3.2 `authority`, but for `@`.
pub(crate) static AUTHORITY: ByteSet = ByteSet::new(&[
    b'!'..=b'!',
    b'$'..=b'.',
    b'0'..=b';',
    b'='..=b'=',
    b'A'..=b'[',
    b']'..=b']',
    b'_'..=b'_',
    b'a'..=b'z',
    b'~'..=b'~',
]);

/// [`CONTENT`], but for the comma.
pub(crate) static LIST_ELEMENT: ByteSet =
    ByteSet::new(&[b'\t'..=b'\t', b' '..=b'+', b'-'..=b'~', 0x80..=0xff]);

/// All but CR and LF.
pub(crate) static LINE: ByteSet = ByteSet::new(&[0..=9, 11..=12, 14..=0xff]);

/// All but CR, LF and NUL: <https://fetch.spec.whatwg.org/#header-value>
pub(crate) static RELAXED_CONTENT: ByteSet = ByteSet::new(&[1..=9, 11..=12, 14..=0xff]);
