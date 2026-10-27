//! Domain names on the wire (RFC 1035 sections 3.1 and 4.1.4).

use std::collections::BTreeMap;

use bun_core::strings;

use super::Name;
use crate::reader::Reader;
use crate::text::{is_hostname_byte, is_print};
use crate::{Error, Result};

/// Label bytes plus one separator between labels. Up to two bytes looser than [`MAX_WIRE_LEN`].
const MAX_PRESENTATION_LEN: usize = 255;
/// RFC 1035 section 2.3.4. Some servers hang up on a question that is longer.
pub(super) const MAX_WIRE_LEN: usize = 255;
/// A name of 255 bytes has at most 128 labels, so no name needs more pointers than that.
const MAX_POINTERS: usize = 128;
const MAX_LABEL_LEN: usize = 63;
/// A pointer has 14 bits.
const MAX_POINTER_TARGET: usize = 0x3fff;
/// c-ares copies a name into `char[512]` before it writes it, and cuts what does not fit.
const MAX_WRITTEN_TEXT_LEN: usize = 511;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Charset {
    /// [`is_hostname_byte`] only.
    Hostname,
    Any,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Compression {
    Allowed,
    /// RFC 3597 section 4: types newer than RFC 1035 have no pointers in their RDATA.
    Refused,
}

fn is_reserved(byte: u8) -> bool {
    matches!(byte, b'"' | b'.' | b';' | b'\\' | b'(' | b')' | b'@' | b'$')
}

/// Reads the name at the cursor and leaves the cursor after it.
pub(super) fn parse(reader: &mut Reader<'_>, compression: Compression) -> Result<Name> {
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
                reader.set_position(target).ok_or(Error::EBADNAME)?;
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
        reader.set_position(position).ok_or(Error::EBADNAME)?;
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
pub(super) struct NameOffsets {
    names: BTreeMap<Name, usize>,
}

impl NameOffsets {
    /// The length and place of the longest name that `text` is, or ends with after a dot, escaped
    /// or not. Case matters.
    fn longest_suffix_of(&self, text: &[u8]) -> Option<(usize, usize)> {
        let mut suffix = text;
        loop {
            if let Some(offset) = self.names.get(suffix) {
                return Some((suffix.len(), *offset));
            }
            (_, suffix) = strings::split_once_char(suffix, b'.')?;
        }
    }
}

/// Appends `name` to `out`, which holds the message from its first byte.
pub(super) fn write(
    out: &mut Vec<u8>,
    written: Option<&mut NameOffsets>,
    charset: Charset,
    name: &[u8],
) -> Result<()> {
    let position = out.len();
    let text = name.get(..MAX_WRITTEN_TEXT_LEN).unwrap_or(name);
    let suffix = (written.as_ref()).and_then(|written| written.longest_suffix_of(text));
    // What is before the suffix and its dot: nothing if the suffix is the whole name.
    let head = match suffix {
        Some((len, _)) => text
            .get(..text.len().saturating_sub(len + 1))
            .unwrap_or_default(),
        None => text,
    };
    for label in split_labels(head, charset)? {
        out.push(label.len() as u8);
        out.extend_from_slice(&label);
    }
    match suffix {
        Some((_, offset)) => out.extend_from_slice(&(0xc000 | offset as u16).to_be_bytes()),
        None => out.push(0),
    }
    if let Some(written) = written
        && !head.is_empty()
    {
        if name.len() > MAX_PRESENTATION_LEN {
            return Err(Error::EFORMERR);
        }
        if position <= MAX_POINTER_TARGET {
            written.names.insert(name.to_vec(), position);
        }
    }
    Ok(())
}
