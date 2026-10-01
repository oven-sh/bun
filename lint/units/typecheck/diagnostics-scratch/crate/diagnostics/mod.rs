// Port of internal/diagnostics/diagnostics.go.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
pub enum Category {
    #[default]
    Warning = 0,
    Error = 1,
    Suggestion = 2,
    Message = 3,
}

impl Category {
    pub const fn name(self) -> &'static [u8] {
        match self {
            Category::Warning => b"warning",
            Category::Error => b"error",
            Category::Suggestion => b"suggestion",
            Category::Message => b"message",
        }
    }
    const fn from_bits(bits: u8) -> Category {
        match bits & 3 {
            0 => Category::Warning,
            1 => Category::Error,
            2 => Category::Suggestion,
            _ => Category::Message,
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct MessageId(pub u32);

const FLAG_REPORTS_UNNECESSARY: u8 = 1;
const FLAG_ELIDED_IN_COMPATIBILITY_PYRAMID: u8 = 2;
const FLAG_REPORTS_DEPRECATED: u8 = 4;

// Highest placeholder index of a text plus one.
pub(crate) const fn placeholder_count(text: &str) -> u8 {
    let bytes = text.as_bytes();
    let mut count: u32 = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            let mut j = i + 1;
            let mut value: u32 = 0;
            while j < bytes.len() && bytes[j].is_ascii_digit() && j - i < 4 {
                value = value * 10 + (bytes[j] - b'0') as u32;
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b'}' {
                if value + 1 > count {
                    count = value + 1;
                }
                i = j;
            }
        }
        i += 1;
    }
    assert!(count <= 7);
    count as u8
}

pub(crate) const fn info(category: Category, flags: u8, text: &str) -> u8 {
    (category as u8) | (flags << 2) | (placeholder_count(text) << 5)
}

const fn text_ends(lens: &[u16; MESSAGE_COUNT]) -> [u32; MESSAGE_COUNT] {
    let mut ends = [0u32; MESSAGE_COUNT];
    let mut at: u32 = 0;
    let mut i = 0;
    while i < MESSAGE_COUNT {
        at += lens[i] as u32;
        ends[i] = at;
        i += 1;
    }
    ends
}

const fn codes_ascend(codes: &[u32; MESSAGE_COUNT]) -> bool {
    let mut i = 1;
    while i < MESSAGE_COUNT {
        if codes[i - 1] >= codes[i] {
            return false;
        }
        i += 1;
    }
    codes[0] != 0
}

macro_rules! messages {
    ($(($name:ident, $code:literal, $category:ident, $flags:literal, $text:literal)),* $(,)?) => {
        $(pub const $name: $crate::diagnostics::MessageId = $crate::diagnostics::MessageId($code);)*
        pub(crate) static CODES: [u32; MESSAGE_COUNT] = [$($code),*];
        pub(crate) static INFO: [u8; MESSAGE_COUNT] = [$($crate::diagnostics::info($crate::diagnostics::Category::$category, $flags, $text)),*];
        pub(crate) const TEXT_LENS: [u16; MESSAGE_COUNT] = [$($text.len() as u16),*];
        pub(crate) const TEXTS: &str = concat!($($text),*);
    };
}

#[allow(non_upper_case_globals)]
mod diagnostics_generated;
pub use diagnostics_generated::*;

static TEXT_ENDS: [u32; MESSAGE_COUNT] = text_ends(&TEXT_LENS);
const _: () = assert!(codes_ascend(&CODES));

// English is the only language: upstream's locale argument stays so that call sites keep their shape.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Locale;

impl Locale {
    pub const DEFAULT: Self = Self;
}

// Localize: `ad_hoc_text` is the text of a message made by NewAdHocMessage.
pub fn localize(
    _locale: Locale,
    message: MessageId,
    ad_hoc_text: &[u8],
    args: &[&[u8]],
) -> (Vec<u8>, Result<(), InvalidPlaceholder>) {
    let text = if message == MessageId::AD_HOC {
        ad_hoc_text
    } else {
        message.text()
    };
    format(text, args)
}

impl MessageId {
    pub const NIL: Self = Self(0);
    // The id of every message made by NewAdHocMessage: code -1.
    pub const AD_HOC: Self = Self(u32::MAX);
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
    pub fn index(self) -> Option<usize> {
        CODES.binary_search(&self.0).ok()
    }
    pub fn is_valid(self) -> bool {
        self.index().is_some()
    }
    pub const fn code(self) -> i32 {
        self.0 as i32
    }
    fn info(self) -> u8 {
        match self.index() {
            Some(index) => INFO.get(index).copied().unwrap_or(Category::Error as u8),
            None => Category::Error as u8,
        }
    }
    pub fn category(self) -> Category {
        Category::from_bits(self.info())
    }
    pub fn reports_unnecessary(self) -> bool {
        (self.info() >> 2) & FLAG_REPORTS_UNNECESSARY != 0
    }
    pub fn elided_in_compatibility_pyramid(self) -> bool {
        (self.info() >> 2) & FLAG_ELIDED_IN_COMPATIBILITY_PYRAMID != 0
    }
    pub fn reports_deprecated(self) -> bool {
        (self.info() >> 2) & FLAG_REPORTS_DEPRECATED != 0
    }
    pub fn argument_count(self) -> usize {
        usize::from(self.info() >> 5)
    }
    pub fn text(self) -> &'static [u8] {
        let Some(index) = self.index() else {
            return b"";
        };
        let end = TEXT_ENDS.get(index).copied().unwrap_or(0) as usize;
        let start = match index.checked_sub(1) {
            Some(before) => TEXT_ENDS.get(before).copied().unwrap_or(0) as usize,
            None => 0,
        };
        TEXTS.as_bytes().get(start..end).unwrap_or(b"")
    }
    // convertPropertyName of generate.go, the key half.
    pub fn key(self) -> Vec<u8> {
        if self == Self::AD_HOC {
            return b"-1".to_vec();
        }
        let mut key = convert_property_name(self.text());
        key.truncate(100);
        key.push(b'_');
        write_decimal(&mut key, i64::from(self.code()));
        key
    }
}

pub fn convert_property_name(orig_name: &[u8]) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::with_capacity(orig_name.len());
    for &r in orig_name {
        let part: &[u8] = match r {
            b'*' => b"_Asterisk",
            b'/' => b"_Slash",
            b':' => b"_Colon",
            _ if r.is_ascii_alphanumeric() => core::slice::from_ref(&r),
            _ => b"_",
        };
        for &c in part {
            // get rid of all multi-underscores
            if c == b'_' && b.last() == Some(&b'_') {
                continue;
            }
            b.push(c);
        }
    }
    // remove any leading underscore, unless it is followed by a number.
    if b.first() == Some(&b'_') && b.get(1).is_some_and(|c| !c.is_ascii_digit()) {
        b.remove(0);
    }
    // get rid of all trailing underscores.
    if b.last() == Some(&b'_') {
        b.pop();
    }
    b
}

pub fn write_decimal(out: &mut Vec<u8>, value: i64) {
    let mut digits = [0u8; 20];
    let mut at = digits.len();
    let mut rest = value.unsigned_abs();
    loop {
        at -= 1;
        if let Some(slot) = digits.get_mut(at) {
            *slot = b'0' + (rest % 10) as u8;
        }
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    if value < 0 {
        out.push(b'-');
    }
    out.extend_from_slice(digits.get(at..).unwrap_or(b""));
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct InvalidPlaceholder;

// strings.ToValidUTF8(arg, "\uFFFD"): each run of invalid bytes becomes one replacement character.
pub fn to_valid_utf8(out: &mut Vec<u8>, arg: &[u8]) {
    let mut rest = arg;
    let mut invalid = false;
    while !rest.is_empty() {
        match core::str::from_utf8(rest) {
            Ok(valid) => {
                out.extend_from_slice(valid.as_bytes());
                return;
            }
            Err(error) => {
                let (valid, after) = rest.split_at(error.valid_up_to());
                if !valid.is_empty() {
                    invalid = false;
                    out.extend_from_slice(valid);
                }
                if !invalid {
                    invalid = true;
                    out.extend_from_slice("\u{FFFD}".as_bytes());
                }
                // Go resynchronises one byte after a bad byte.
                rest = after.get(1..).unwrap_or(b"");
            }
        }
    }
}

// Format: one pass over the text, `{digits}` is the only placeholder form.
pub fn format(text: &[u8], args: &[&[u8]]) -> (Vec<u8>, Result<(), InvalidPlaceholder>) {
    let mut out: Vec<u8> = Vec::with_capacity(text.len());
    if args.is_empty() {
        out.extend_from_slice(text);
        return (out, Ok(()));
    }
    let mut result = Ok(());
    let mut i = 0;
    while let Some(&byte) = text.get(i) {
        if byte == b'{' {
            let mut j = i + 1;
            let mut index: Option<usize> = Some(0);
            while let Some(digit) = text.get(j).copied().filter(u8::is_ascii_digit) {
                index = index
                    .and_then(|v| v.checked_mul(10))
                    .and_then(|v| v.checked_add(usize::from(digit - b'0')));
                j += 1;
            }
            if j > i + 1 && text.get(j) == Some(&b'}') {
                match index.and_then(|v| args.get(v)) {
                    Some(arg) => to_valid_utf8(&mut out, arg),
                    None => {
                        result = Err(InvalidPlaceholder);
                        out.extend_from_slice(text.get(i..=j).unwrap_or(b""));
                    }
                }
                i = j + 1;
                continue;
            }
        }
        out.push(byte);
        i += 1;
    }
    (out, result)
}

#[cfg(test)]
mod tests;
