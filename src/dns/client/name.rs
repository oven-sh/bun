//! Domain names, as text and on the wire (RFC 1035 §4.1.4, §5.1).

/// On the wire, with the lengths of the labels and the root.
pub(crate) const MAX_LEN: usize = 255;
const MAX_LABEL_LEN: u8 = 63;
/// More than a name has labels.
const MAX_POINTERS: usize = 128;
const POINTER: u8 = 0xc0;
/// Behind the header.
const FIRST_IN_MESSAGE: usize = 12;

pub const fn is_hostname_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'/' | b'*')
}

pub(crate) fn is_hostname(text: &[u8]) -> bool {
    text.iter().all(|&byte| is_hostname_byte(byte))
}

/// RFC 7686 §2: no server is asked about these. `wire` is from [`encode`].
pub(crate) fn is_onion(wire: &[u8]) -> bool {
    let end = wire.get(1..).and_then(<[u8]>::last_chunk::<7>);
    end.is_some_and(|[before, rest @ ..]| {
        matches!(before, 5 | b'.') && rest.eq_ignore_ascii_case(b"onion\0")
    })
}

/// Returns the part of `wire` that it takes.
pub(crate) fn encode<'a>(text: &[u8], wire: &'a mut [u8; MAX_LEN]) -> Option<&'a [u8]> {
    let mut bytes = if text == b"." { &[][..] } else { text }.iter().copied();
    let [first, rest @ ..] = wire;
    let (mut label_len, mut room) = (first, rest.iter_mut());
    *label_len = 0;
    while let Some(mut byte) = bytes.next() {
        if byte == b'.' && *label_len > 0 {
            label_len = room.next()?;
            *label_len = 0;
            continue;
        }
        if byte == b'.' || *label_len == MAX_LABEL_LEN {
            return None;
        }
        if byte == b'\\' {
            byte = unescape(&mut bytes)?;
        }
        *room.next()? = is_hostname_byte(byte).then_some(byte)?;
        *label_len += 1;
    }
    if *label_len > 0 {
        *room.next()? = 0;
    }
    let len = MAX_LEN - room.len();
    wire.get(..len)
}

pub(crate) fn can_encode(text: &[u8]) -> bool {
    encode(text, &mut [0; MAX_LEN]).is_some()
}

/// What follows a backslash: a byte that stands for itself, or three digits.
fn unescape(bytes: &mut impl Iterator<Item = u8>) -> Option<u8> {
    let first = bytes.next()?;
    if !first.is_ascii_digit() {
        return Some(first);
    }
    let mut value = first - b'0';
    for _ in 0..2 {
        let digit = bytes.next().filter(u8::is_ascii_digit)? - b'0';
        value = value.checked_mul(10)?.checked_add(digit)?;
    }
    Some(value)
}

/// Calls `visit` with each label of the name at `start`.
fn walk<'a>(message: &'a [u8], start: usize, mut visit: impl FnMut(&'a [u8])) -> Option<()> {
    let (mut at, mut lowest) = (start, start);
    let (mut len, mut pointers) = (1, 0);
    loop {
        match *message.get(at)? {
            0 => return Some(()),
            label_len @ 1..=MAX_LABEL_LEN => {
                let next = at + 1 + usize::from(label_len);
                len += next - at;
                if len > MAX_LEN {
                    return None;
                }
                visit(message.get(at + 1..next)?);
                at = next;
            }
            high @ POINTER.. => {
                let low = *message.get(at + 1)?;
                let target = usize::from(u16::from_be_bytes([high & !POINTER, low]));
                pointers += 1;
                if !(FIRST_IN_MESSAGE..lowest).contains(&target) || pointers > MAX_POINTERS {
                    return None;
                }
                (at, lowest) = (target, target);
            }
            _ => return None,
        }
    }
}

/// How many of `bytes` the name at their start takes, up to a pointer.
pub(crate) fn len_in_place(bytes: &[u8]) -> Option<usize> {
    let mut len = 0;
    loop {
        match *bytes.get(len)? {
            0 => return Some(len + 1),
            label_len @ 1..=MAX_LABEL_LEN => len += 1 + usize::from(label_len),
            POINTER.. => return Some(len + 2),
            _ => return None,
        }
    }
}

/// A name in a reply.
#[derive(Clone, Copy)]
pub struct Name<'a> {
    pub(crate) message: &'a [u8],
    pub(crate) start: usize,
}

impl Name<'_> {
    pub(crate) fn is_valid(self) -> bool {
        walk(self.message, self.start, |_| {}).is_some()
    }

    /// There is no hyphen at the start either.
    fn is_made_of(self, is_allowed: impl Fn(u8) -> bool) -> bool {
        let (mut result, mut is_first) = (true, true);
        walk(self.message, self.start, |label| {
            let is_first = core::mem::take(&mut is_first);
            result &= label.iter().all(|&byte| is_allowed(byte));
            result &= !(is_first && label.starts_with(b"-"));
        });
        result
    }

    /// As `res_hnok(3)`
    pub(crate) fn is_hostname(self) -> bool {
        self.is_made_of(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    }

    /// It can also be a wildcard or part of a network (RFC 2317 §4).
    pub(crate) fn is_alias_target(self) -> bool {
        self.is_made_of(|byte| is_hostname_byte(byte) && byte != b'.')
    }

    /// Replaces what is in `text` with printable ASCII. The root is empty.
    pub fn write_to(self, text: &mut Vec<u8>) {
        text.clear();
        walk(self.message, self.start, |label| {
            if !text.is_empty() {
                text.push(b'.');
            }
            for &byte in label {
                match byte {
                    b'"' | b'.' | b';' | b'\\' | b'(' | b')' | b'@' | b'$' => {
                        text.extend_from_slice(&[b'\\', byte]);
                    }
                    b' '..=b'~' => text.push(byte),
                    _ => {
                        let digits = [byte / 100, byte / 10 % 10, byte % 10];
                        text.push(b'\\');
                        text.extend_from_slice(&digits.map(|digit| b'0' + digit));
                    }
                }
            }
        });
    }
}
