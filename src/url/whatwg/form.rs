//! `application/x-www-form-urlencoded`.

use bun_engine_text::{AllocError, StringRef, Text};

use crate::buffer::Buffer;
use crate::class::{self, FORM, FORM_PARSER_SCAN, FORM_SERIALIZER_SCAN};
use crate::input::{Encoding, Source, Transcoder};
use crate::percent;

#[derive(Clone, PartialEq, Eq, Debug)]
#[repr(C)]
pub struct Pair {
    pub name: StringRef,
    pub value: StringRef,
}

/// A name or a value in the making.
struct Decoder<'a> {
    source: Source<'a>,
    start: usize,
    /// What `source` has from `start` up to `pending`, decoded.
    decoded: Buffer,
    pending: usize,
    is_ascii: bool,
    limit: usize,
}

impl Decoder<'_> {
    fn flush(&mut self, at: usize) -> Result<&mut Buffer, AllocError> {
        self.decoded.extend(&self.source.bytes[self.pending..at])?;
        Ok(&mut self.decoded)
    }

    /// Returns the index behind what it has read.
    fn decode(&mut self, at: usize) -> Result<usize, AllocError> {
        let Source { bytes, encoding } = self.source;
        let (byte, length) = match bytes[at] {
            b'+' => (b' ', 1),
            b'%' => match percent::unescape(&bytes[at..]) {
                Some(byte) => (byte, 3),
                None => return Ok(at + 1),
            },
            0..=0x7f => return Ok(at + 1),
            _ => {
                self.is_ascii = false;
                let run = bytes[at..].iter().take_while(|byte| !byte.is_ascii());
                let end = at + run.count();
                if encoding == Encoding::Latin1 {
                    let out = self.flush(at)?;
                    for &character in &bytes[at..end] {
                        percent::push_utf8(out, character, encoding)?;
                    }
                    self.pending = end;
                }
                return Ok(end);
            }
        };
        self.is_ascii &= byte.is_ascii();
        self.flush(at)?.push(byte)?;
        self.pending = at + length;
        Ok(at + length)
    }

    /// Ends the text at `end`, and starts another behind it.
    fn take(&mut self, end: usize) -> Result<StringRef, AllocError> {
        let bytes = if self.pending == self.start {
            &self.source.bytes[self.start..end]
        } else {
            self.flush(end)?;
            &self.decoded
        };
        let string = match bytes {
            &[character] if self.is_ascii => StringRef::single_character(character),
            _ if self.is_ascii => StringRef::try_from_units(bytes)?,
            _ if bytes.len() > self.limit / size_of::<u16>() => return Err(AllocError),
            _ => StringRef::try_from_utf8_lossy(bytes)?,
        };
        self.decoded.truncate(0);
        (self.start, self.pending, self.is_ascii) = (end + 1, end + 1, true);
        Ok(string)
    }
}

/// Fails if there is no room for another pair in `limit` bytes.
pub(crate) fn push(pairs: &mut Vec<Pair>, pair: Pair, limit: usize) -> Result<(), AllocError> {
    if pairs.len() >= limit / size_of::<Pair>() || pairs.try_reserve(1).is_err() {
        return Err(AllocError);
    }
    pairs.push(pair);
    Ok(())
}

/// `limit` is the most bytes that the list may take, and the UTF-16 that a name or a value may decode to.
pub fn parse(input: Text<'_>, limit: usize) -> Result<Vec<Pair>, AllocError> {
    let mut transcoder = Transcoder::new();
    let source = transcoder.source(input)?;
    let mut decoder = Decoder {
        source,
        start: 0,
        decoded: Buffer::new(),
        pending: 0,
        is_ascii: true,
        limit,
    };
    let mut pairs = Vec::new();
    let mut name = None;
    let mut scan = FORM_PARSER_SCAN.scan(source.bytes, 0);
    loop {
        let at = scan.next().unwrap_or(source.bytes.len());
        match source.bytes.get(at) {
            Some(b'=') if name.is_none() => name = Some(decoder.take(at)?),
            None | Some(b'&') => {
                let last = decoder.take(at)?;
                let (name, value) = match name.take() {
                    Some(name) => (Some(name), last),
                    None => ((!last.is_empty()).then_some(last), StringRef::empty()),
                };
                if let Some(name) = name {
                    push(&mut pairs, Pair { name, value }, limit)?;
                }
                if at == source.bytes.len() {
                    return Ok(pairs);
                }
            }
            Some(_) => scan.skip_to(decoder.decode(at)?),
        }
    }
}

fn encode(text: Text<'_>, out: &mut Buffer) -> Result<(), AllocError> {
    let mut transcoder = Transcoder::new();
    let source = transcoder.source(text)?;
    let bytes = source.bytes;
    let mut pending = 0;
    let mut scan = FORM_SERIALIZER_SCAN.scan(bytes, 0);
    while let Some(start) = scan.next() {
        out.extend(&bytes[pending..start])?;
        if bytes[start] == b' ' {
            out.push(b'+')?;
            pending = start + 1;
            continue;
        }
        let is_escaped = |byte: &&u8| class::is_in(FORM, **byte) && **byte != b' ';
        pending = start + bytes[start..].iter().take_while(is_escaped).count();
        percent::escape_all(source.with_bytes(&bytes[start..pending]), out)?;
        scan.skip_to(pending);
    }
    out.extend(&bytes[pending..])
}

/// Of names and values.
pub fn serialize<'a>(
    pairs: impl IntoIterator<Item = (Text<'a>, Text<'a>)>,
) -> Result<StringRef, AllocError> {
    let mut out = Buffer::new();
    for (name, value) in pairs {
        if !out.is_empty() {
            out.push(b'&')?;
        }
        encode(name, &mut out)?;
        out.push(b'=')?;
        encode(value, &mut out)?;
    }
    StringRef::try_from_units(&out)
}
