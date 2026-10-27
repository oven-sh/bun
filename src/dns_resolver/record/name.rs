//! Domain names on the wire (RFC 1035 sections 3.1 and 4.1.4).

use super::Name;
use crate::buf::{Reader, is_hostname_byte, is_print};
use crate::{Error, Result};

/// Label bytes plus one separator between labels. Up to two bytes looser than RFC 1035's 255 on the wire.
const MAX_PRESENTATION_LEN: usize = 255;
/// A name of 255 bytes has at most 128 labels, so no name needs more pointers than that.
const MAX_POINTERS: usize = 128;
const MAX_LABEL_LEN: usize = 63;
/// A pointer has 14 bits.
const MAX_POINTER_TARGET: usize = 0x3fff;
/// c-ares copies a name into `char[512]` before it writes it, and cuts what does not fit.
const MAX_WRITTEN_TEXT_LEN: usize = 511;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Charset {
    /// [`is_hostname_byte`] only.
    Hostname,
    Any,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Compression {
    Allowed,
    /// RFC 3597 section 4: types newer than RFC 1035 have no pointers in their RDATA.
    Refused,
}

fn is_reserved(byte: u8) -> bool {
    matches!(byte, b'"' | b'.' | b';' | b'\\' | b'(' | b')' | b'@' | b'$')
}

/// Reads the name at the cursor and leaves the cursor after it.
pub(crate) fn parse(reader: &mut Reader<'_>, compression: Compression) -> Result<Name> {
    let mut name = Name::new();
    let mut resume_at = None;
    // A pointer goes backwards: to before where any label of this name began.
    let mut earliest_label = reader.position();
    let mut presentation_len = 0usize;
    let mut pointers = 0usize;

    loop {
        earliest_label = earliest_label.min(reader.position());
        let len = reader.u8().map_err(|_| Error::EBADNAME)?;
        match len & 0xc0 {
            0xc0 => {
                if compression == Compression::Refused {
                    return Err(Error::EBADNAME);
                }
                let low = reader.u8().map_err(|_| Error::EBADNAME)?;
                let target = usize::from(len & 0x3f) << 8 | usize::from(low);
                pointers += 1;
                if target >= earliest_label || pointers > MAX_POINTERS {
                    return Err(Error::EBADNAME);
                }
                resume_at.get_or_insert_with(|| reader.position());
                reader.set_position(target).map_err(|_| Error::EBADNAME)?;
            }
            0 if len == 0 => break,
            0 => {
                if presentation_len != 0 {
                    presentation_len += 1;
                }
                presentation_len += usize::from(len);
                if presentation_len > MAX_PRESENTATION_LEN {
                    return Err(Error::EBADNAME);
                }
                if !name.is_empty() {
                    name.push(b'.');
                }
                let label = reader
                    .bytes(usize::from(len))
                    .map_err(|_| Error::EBADNAME)?;
                for &byte in label {
                    if !is_print(byte) {
                        name.extend_from_slice(&[
                            b'\\',
                            b'0' + byte / 100,
                            b'0' + byte % 100 / 10,
                            b'0' + byte % 10,
                        ]);
                        continue;
                    }
                    if is_reserved(byte) {
                        name.push(b'\\');
                    }
                    name.push(byte);
                }
            }
            // 10 and 01 are reserved.
            _ => return Err(Error::EBADNAME),
        }
    }

    if let Some(position) = resume_at {
        reader.set_position(position).map_err(|_| Error::EBADNAME)?;
    }
    Ok(name)
}

/// The labels of a name in presentation form, unescaped.
fn split_labels(text: &[u8], charset: Charset) -> Result<Vec<Vec<u8>>> {
    let mut labels: Vec<Vec<u8>> = Vec::new();
    let mut label = Vec::new();
    let mut bytes = text.iter().copied();

    while let Some(byte) = bytes.next() {
        let unescaped = match byte {
            b'.' => {
                labels.push(core::mem::take(&mut label));
                continue;
            }
            b'\\' => {
                let first = bytes.next().ok_or(Error::EBADNAME)?;
                if first.is_ascii_digit() {
                    let mut value = u32::from(first - b'0');
                    for _ in 0..2 {
                        let digit = bytes.next().filter(u8::is_ascii_digit);
                        value = value * 10 + u32::from(digit.ok_or(Error::EBADNAME)? - b'0');
                    }
                    u8::try_from(value).map_err(|_| Error::EBADNAME)?
                } else {
                    first
                }
            }
            other => other,
        };
        if charset == Charset::Hostname && !is_hostname_byte(unescaped) {
            return Err(Error::EBADNAME);
        }
        label.push(unescaped);
    }
    labels.push(label);

    // "a." has a blank label at the end, and "." has two.
    if labels.last().is_some_and(Vec::is_empty) {
        labels.pop();
    }
    if let [only] = labels.as_slice() {
        if only.is_empty() {
            labels.pop();
        }
    }

    let mut total = 0usize;
    for label in &labels {
        if label.is_empty() || label.len() > MAX_LABEL_LEN {
            return Err(Error::EBADNAME);
        }
        total += label.len();
    }
    if !labels.is_empty() && total + labels.len() - 1 > MAX_PRESENTATION_LEN {
        return Err(Error::EBADNAME);
    }
    Ok(labels)
}

/// The names a message has so far, for later names to point at.
#[derive(Default)]
pub(crate) struct Written {
    names: Vec<(Name, usize)>,
}

impl Written {
    /// The longest name that `text` is or ends with at a label boundary; the last of equals. Case matters.
    fn longest_suffix_of(&self, text: &[u8]) -> Option<(usize, usize)> {
        let mut best: Option<(usize, usize)> = None;
        for (name, offset) in &self.names {
            if best.is_some_and(|(len, _)| len > name.len()) {
                continue;
            }
            let Some(prefix) = text.strip_suffix(name.as_slice()) else {
                continue;
            };
            if !matches!(prefix.last(), None | Some(b'.')) {
                continue;
            }
            best = Some((name.len(), *offset));
        }
        best
    }
}

/// Appends `name` to `out`, which holds the message from its first byte.
pub(crate) fn write(
    out: &mut Vec<u8>,
    written: Option<&mut Written>,
    charset: Charset,
    name: &[u8],
) -> Result<()> {
    let position = out.len();
    let text = name.get(..MAX_WRITTEN_TEXT_LEN).unwrap_or(name);
    let suffix = match &written {
        Some(written) if !text.is_empty() => written.longest_suffix_of(text),
        _ => None,
    };
    let whole_name_is_known = suffix.is_some_and(|(len, _)| len == text.len());

    if !whole_name_is_known {
        let head = match suffix {
            Some((len, _)) => text.get(..text.len() - len - 1).unwrap_or(&[]),
            None => text,
        };
        for label in split_labels(head, charset)? {
            out.push(label.len() as u8);
            out.extend_from_slice(&label);
        }
        if suffix.is_none() {
            out.push(0);
        }
    }
    if let Some((_, offset)) = suffix {
        out.extend_from_slice(&(0xc000 | offset as u16).to_be_bytes());
    }

    let head_len = match suffix {
        Some((len, _)) if !whole_name_is_known => text.len() - len - 1,
        _ => text.len(),
    };
    if let Some(written) = written {
        if !whole_name_is_known && head_len > 0 {
            if name.len() > MAX_PRESENTATION_LEN {
                return Err(Error::EFORMERR);
            }
            if position <= MAX_POINTER_TARGET {
                written.names.push((name.to_vec(), position));
            }
        }
    }
    Ok(())
}
