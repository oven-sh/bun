//! RFC 9218 §4.

use bun_core::strings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Priority {
    /// From 0 to 7, less is more urgent.
    pub urgency: u8,
    pub is_incremental: bool,
}

impl Default for Priority {
    fn default() -> Self {
        Self {
            urgency: 3,
            is_incremental: false,
        }
    }
}

impl Priority {
    /// Ignores what it does not understand.
    pub(super) fn update(&mut self, mut dictionary: &[u8]) {
        while !dictionary.is_empty() {
            let member = strings::trim(next_member(&mut dictionary), b" \t");
            let item = strings::split_once_char(member, b';').map_or(member, |it| it.0);
            match item {
                [b'u', b'=', digit @ b'0'..=b'7'] => self.urgency = digit - b'0',
                b"i" | b"i=?1" => self.is_incremental = true,
                b"i=?0" => self.is_incremental = false,
                _ => {}
            }
        }
    }

    pub(super) fn encode(self) -> ([u8; 5], usize) {
        let len = match self.is_incremental {
            true => 5,
            false if self == Self::default() => 0,
            false => 3,
        };
        ([b'u', b'=', b'0' + self.urgency, b',', b'i'], len)
    }
}

/// Up to a comma that is not in a string (RFC 8941 §3.2).
fn next_member<'a>(dictionary: &mut &'a [u8]) -> &'a [u8] {
    let (mut is_quoted, mut is_escaped) = (false, false);
    let len = (dictionary.iter())
        .take_while(|&&byte| {
            match byte {
                _ if is_escaped => is_escaped = false,
                b'\\' => is_escaped = is_quoted,
                b'"' => is_quoted = !is_quoted,
                b',' => return is_quoted,
                _ => {}
            }
            true
        })
        .count();
    let member = dictionary.split_off(..len).unwrap_or_default();
    dictionary.split_off_first();
    member
}
