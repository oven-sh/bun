//! What each byte means to the parser.

use bun_highway::url::PlainBytes;

/// A union of groups of bytes.
pub(crate) type Set = u16;

const OTHER_CONTROL_OR_NOT_ASCII: Set = 1 << 0;
const SPACE_QUOTE_OR_ANGLE: Set = 1 << 1;
const BACKTICK: Set = 1 << 2;
const APOSTROPHE: Set = 1 << 3;
const CARET_OR_BRACE: Set = 1 << 4;
const AUTHORITY_PUNCTUATION: Set = 1 << 5;
const FORM_PUNCTUATION: Set = 1 << 6;
const UNSAFE_IN_FILE_NAME: Set = 1 << 7;
pub(crate) const NUMBER_SIGN: Set = 1 << 8;
pub(crate) const QUESTION_MARK: Set = 1 << 9;
pub(crate) const BACKSLASH: Set = 1 << 10;
pub(crate) const PERCENT: Set = 1 << 11;
pub(crate) const TAB_OR_NEWLINE: Set = 1 << 12;

// The percent-encode sets. Those up to the path leave out what the parser does not encode where it reads a whole URL:
// tabs and newlines, and the `?` and `#` that end a part.
pub(crate) const C0_CONTROL: Set = OTHER_CONTROL_OR_NOT_ASCII;
pub(crate) const FRAGMENT: Set = C0_CONTROL | SPACE_QUOTE_OR_ANGLE | BACKTICK;
pub(crate) const QUERY: Set = C0_CONTROL | SPACE_QUOTE_OR_ANGLE;
pub(crate) const SPECIAL_QUERY: Set = QUERY | APOSTROPHE;
pub(crate) const PATH: Set = QUERY | CARET_OR_BRACE | BACKTICK;
pub(crate) const USERINFO: Set =
    PATH | TAB_OR_NEWLINE | NUMBER_SIGN | QUESTION_MARK | BACKSLASH | AUTHORITY_PUNCTUATION;
pub(crate) const FORM: Set = USERINFO | PERCENT | APOSTROPHE | FORM_PUNCTUATION;
/// The path percent-encode set and what RFC 1738 calls unsafe, but for the backslash.
pub(crate) const FILE_PATH: Set =
    PATH | TAB_OR_NEWLINE | NUMBER_SIGN | QUESTION_MARK | PERCENT | UNSAFE_IN_FILE_NAME;

const fn add(table: &mut [u16; 256], mut bytes: &[u8], bits: u16) {
    while let [byte, rest @ ..] = bytes {
        table[*byte as usize] |= bits;
        bytes = rest;
    }
}

const fn add_range(table: &mut [u16; 256], first: u8, last: u8, bits: u16) {
    let mut byte = first as usize;
    while byte <= last as usize {
        table[byte] |= bits;
        byte += 1;
    }
}

static GROUPS: [Set; 256] = {
    let mut table = [0; 256];
    add_range(&mut table, 0, 0x08, OTHER_CONTROL_OR_NOT_ASCII);
    add_range(&mut table, 0x0b, 0x0c, OTHER_CONTROL_OR_NOT_ASCII);
    add_range(&mut table, 0x0e, 0x1f, OTHER_CONTROL_OR_NOT_ASCII);
    add_range(&mut table, 0x7f, 0xff, OTHER_CONTROL_OR_NOT_ASCII);
    add(&mut table, b" \"<>", SPACE_QUOTE_OR_ANGLE);
    add(&mut table, b"`", BACKTICK);
    add(&mut table, b"'", APOSTROPHE);
    add(&mut table, b"^{}", CARET_OR_BRACE);
    add(&mut table, b"/:;=@[]|", AUTHORITY_PUNCTUATION);
    add(&mut table, b"$&+,!()~", FORM_PUNCTUATION);
    add(&mut table, b"[]|~", UNSAFE_IN_FILE_NAME);
    add(&mut table, b"#", NUMBER_SIGN);
    add(&mut table, b"?", QUESTION_MARK);
    add(&mut table, b"\\", BACKSLASH);
    add(&mut table, b"%", PERCENT);
    add(&mut table, b"\t\n\r", TAB_OR_NEWLINE);
    table
};

#[inline(always)]
pub(crate) fn is_in(set: Set, byte: u8) -> bool {
    GROUPS[usize::from(byte)] & set != 0
}

/// How many bytes of `set` there are at the start of `text`.
#[inline(always)]
pub(crate) fn run_length(set: Set, text: &[u8]) -> usize {
    text.iter().take_while(|&&byte| is_in(set, byte)).count()
}

/// What a host has in it that takes a closer look.
pub(crate) type HostTraits = u16;

pub(crate) const FORBIDDEN_IN_HOST: HostTraits = 1 << 0;
pub(crate) const FORBIDDEN_IN_DOMAIN: HostTraits = 1 << 1;
pub(crate) const PERCENT_OR_NOT_ASCII: HostTraits = 1 << 2;
pub(crate) const ENCODED_IN_OPAQUE_HOST: HostTraits = 1 << 3;
pub(crate) const UPPERCASE: HostTraits = 1 << 4;
/// A number and an ACE label start with one.
pub(crate) const DIGIT_OR_X: HostTraits = 1 << 5;
pub(crate) const AT_SIGN: HostTraits = 1 << 6;
pub(crate) const TO_BE_REMOVED: HostTraits = 1 << 7;
const IN_SCHEME: u16 = 1 << 8;

static TRAITS: [u16; 256] = {
    let mut table = [0; 256];
    add(
        &mut table,
        b"\0\t\n\r #/:<>?@[\\]^|",
        FORBIDDEN_IN_HOST | FORBIDDEN_IN_DOMAIN,
    );
    add_range(&mut table, 0, 0x1f, FORBIDDEN_IN_DOMAIN);
    add(&mut table, b"%\x7f", FORBIDDEN_IN_DOMAIN);
    add(&mut table, b"%", PERCENT_OR_NOT_ASCII);
    add_range(&mut table, 0x80, 0xff, PERCENT_OR_NOT_ASCII);
    add_range(&mut table, 0, 0x1f, ENCODED_IN_OPAQUE_HOST);
    add_range(&mut table, 0x7f, 0xff, ENCODED_IN_OPAQUE_HOST);
    add_range(&mut table, b'A', b'Z', UPPERCASE | IN_SCHEME);
    add(&mut table, b"0123456789x", DIGIT_OR_X);
    add(&mut table, b"@", AT_SIGN);
    add(&mut table, b"\t\n\r", TO_BE_REMOVED);
    add_range(&mut table, b'a', b'z', IN_SCHEME);
    add(&mut table, b"0123456789+-.", IN_SCHEME);
    table
};

#[inline(always)]
pub(crate) fn host_traits(byte: u8) -> HostTraits {
    TRAITS[usize::from(byte)]
}

#[inline(always)]
pub(crate) fn is_in_scheme(byte: u8) -> bool {
    TRAITS[usize::from(byte)] & IN_SCHEME != 0
}

/// Stops at whatever ends a host or has a trait.
pub(crate) static HOST_SCAN: PlainBytes =
    PlainBytes::new(b"#%/:<>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^|", b"0123456789x");
/// Stops at whatever ends a path, a query or a fragment, is encoded in one of them, or may start a dot segment.
pub(crate) static TAIL_SCAN: PlainBytes = PlainBytes::new(b"\"#'<>?\\^`{}", b".%");
pub(crate) static CONTROL_SCAN: PlainBytes = PlainBytes::new(b"", b"");
pub(crate) static OPAQUE_PATH_SCAN: PlainBytes = PlainBytes::new(b"#?", b"");
pub(crate) static FILE_PATH_SCAN: PlainBytes = PlainBytes::new(b"\"#%<>?[\\]^`{|}~", b".");
pub(crate) static FORM_PARSER_SCAN: PlainBytes = PlainBytes::new(b"%&+=", b"");
pub(crate) static FORM_SERIALIZER_SCAN: PlainBytes =
    PlainBytes::new(b"!\"#$%&'()+,/:;<=>?@[\\]^`{|}~", b"");
