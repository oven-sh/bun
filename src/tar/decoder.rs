//! A tar reader with the gzip layers in front of it.

use crate::error::{Error, Result};
use crate::gzip::{self, Progress};
use crate::output::Output as _;
use crate::reader::{Entry, Event, Options, Poll, Reader};

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read_support_filter_gzip.c#L306
const BLOCK: usize = 64 * 1024;
// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read.c#L578
const MAX_LAYERS: usize = 24;

/// Where a layer's next block goes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    InsteadOfTheLast,
    BehindTheLast,
}

struct Layer {
    gzip: gzip::Decoder,
    out: Vec<u8>,
    pos: usize,
    done: bool,
}

impl Layer {
    fn new() -> Result<Self> {
        let mut out = Vec::new();
        out.try_reserve_exact(BLOCK)?;
        Ok(Self {
            gzip: gzip::Decoder::new()?,
            out,
            pos: 0,
            done: false,
        })
    }

    fn unread(&self) -> &[u8] {
        self.out.get(self.pos..).unwrap_or_default()
    }
}

/// Takes compressed or plain bytes as they come and gives tar events back.
pub struct Decoder {
    /// The first one reads the caller's input, and each next one the output of the one before.
    layers: Vec<Layer>,
    tar: Reader,
}

impl Decoder {
    /// Nothing is detected, so this works however little of the input is there yet.
    pub fn new(options: Options, gzip: bool) -> Result<Self> {
        let mut layers = Vec::new();
        if gzip {
            layers.push(Layer::new()?);
        }
        Ok(Self {
            layers,
            tar: Reader::new(options),
        })
    }

    pub fn entry(&self) -> &Entry {
        self.tar.entry()
    }

    /// See [`Reader::skip_entry`].
    pub fn skip_entry(&mut self) {
        self.tar.skip_entry();
    }

    /// Gives layer `index` a full block, dropped whole if it fails. `false`: no output for want of input.
    fn refill(
        &mut self,
        index: usize,
        input: &[u8],
        eof: bool,
        place: Place,
    ) -> Result<(usize, bool)> {
        let mut used_total = 0usize;
        let Some(layer) = self.layers.get_mut(index) else {
            return Ok((0, true));
        };
        if place == Place::InsteadOfTheLast {
            layer.out.clear();
            layer.pos = 0;
        }
        let start = layer.out.len();
        loop {
            let (below, rest) = self.layers.split_at_mut(index);
            let Some(layer) = rest.first_mut() else {
                return Ok((used_total, true));
            };
            let (source, source_eof) = match below.last() {
                Some(lower) => (lower.unread(), lower.done),
                None => (input.get(used_total..).unwrap_or_default(), eof),
            };
            let decoded = layer.gzip.decode(
                source,
                source_eof,
                &mut layer.out,
                start.saturating_add(BLOCK),
            );
            let (used, progress) = match decoded {
                Ok(decoded) => decoded,
                Err(error) => {
                    layer.out.truncate(start);
                    return Err(error);
                }
            };
            match below.last_mut() {
                Some(lower) => lower.pos = lower.pos.saturating_add(used),
                None => used_total = used_total.saturating_add(used),
            }
            match progress {
                Progress::Done => {
                    layer.done = true;
                    return Ok((used_total, true));
                }
                Progress::OutputFull => return Ok((used_total, true)),
                Progress::NeedInput => {}
            }
            let has_output = layer.out.len() > start;
            let Some(lower) = index.checked_sub(1) else {
                return Ok((used_total, has_output));
            };
            let rest = input.get(used_total..).unwrap_or_default();
            used_total = used_total.saturating_add(self.refill_source(
                lower,
                rest,
                eof,
                Place::InsteadOfTheLast,
            )?);
        }
    }

    /// To its reader a layer that fails has ended: an error inside a member, nothing between two.
    fn refill_source(
        &mut self,
        index: usize,
        input: &[u8],
        eof: bool,
        place: Place,
    ) -> Result<usize> {
        match self.refill(index, input, eof, place) {
            Ok((used, _)) => Ok(used),
            Err(error @ Error::Alloc(_)) => Err(error),
            Err(_) => {
                if let Some(layer) = self.layers.get_mut(index) {
                    layer.done = true;
                }
                Ok(0)
            }
        }
    }

    /// If layer `index`, which is new, does not start with a header, none of its source counts as read.
    fn read_first_header(&mut self, index: usize, input: &[u8]) -> Result<(usize, bool)> {
        let mut used_total = 0usize;
        let mut header_len = 0usize;
        loop {
            let (below, rest) = self.layers.split_at_mut(index);
            let Some(layer) = rest.first_mut() else {
                return Ok((used_total, false));
            };
            let (source, source_eof) = match below.last() {
                Some(lower) => (lower.unread(), lower.done),
                None => (input, true),
            };
            let source = source.get(header_len..).unwrap_or_default();
            let (used, progress) = layer.gzip.decode(source, source_eof, &mut layer.out, 0)?;
            header_len = header_len.saturating_add(used);
            match progress {
                Progress::Done => return Ok((used_total, false)),
                Progress::OutputFull => {
                    match below.last_mut() {
                        Some(lower) => lower.pos = lower.pos.saturating_add(header_len),
                        None => used_total = header_len,
                    }
                    return Ok((used_total, true));
                }
                Progress::NeedInput => {}
            }
            let Some(lower) = index.checked_sub(1) else {
                return Ok((used_total, false));
            };
            let rest = input.get(used_total..).unwrap_or_default();
            used_total = used_total.saturating_add(self.refill_source(
                lower,
                rest,
                true,
                Place::BehindTheLast,
            )?);
        }
    }

    /// Like [`Reader::next`], with `input` being what the outermost layer reads.
    pub fn next<'a>(&'a mut self, input: &'a [u8], eof: bool) -> Result<(usize, Event<'a>)> {
        let Some(top) = self.layers.len().checked_sub(1) else {
            return self.tar.next(input, eof);
        };
        let mut used_total = 0usize;
        let poll = loop {
            let Some(layer) = self.layers.get_mut(top) else {
                break Poll::EndOfArchive;
            };
            let base = layer.pos;
            let (used, poll) = self.tar.poll(layer.unread(), layer.done)?;
            layer.pos = layer.pos.saturating_add(used);
            match poll {
                Poll::NeedInput => {}
                Poll::Data { offset, start, len } => {
                    break Poll::Data {
                        offset,
                        start: base.saturating_add(start),
                        len,
                    };
                }
                other => break other,
            }
            let (used, ready) = self.refill(
                top,
                input.get(used_total..).unwrap_or_default(),
                eof,
                Place::InsteadOfTheLast,
            )?;
            used_total = used_total.saturating_add(used);
            if !ready {
                break Poll::NeedInput;
            }
        };
        let decoded = self.layers.get(top).map_or(&[][..], |layer| &layer.out);
        Ok((used_total, poll.event(self.tar.entry(), decoded)))
    }
}

/// Reads an archive that is all in memory, and works out by itself how it is wrapped.
pub struct MemoryDecoder<'a> {
    data: &'a [u8],
    pos: usize,
    decoder: Decoder,
    /// Zeros that `read_data` has written for holes.
    holes: usize,
}

/// A sparse map of a few bytes declares up to 2^60 zeros. Held to what gzip can make of the same input, about 1,000 times.
fn holes_limit(archive: &[u8]) -> usize {
    const MIB: usize = 1024 * 1024;
    archive
        .len()
        .saturating_mul(1024)
        .clamp(64 * MIB, 1024 * MIB)
}

impl<'a> MemoryDecoder<'a> {
    /// Fails for what is not an archive, and if the first block of a gzip layer does not decompress.
    pub fn new(data: &'a [u8], options: Options) -> Result<Self> {
        let mut this = Self {
            data,
            pos: 0,
            decoder: Decoder::new(options, false)?,
            holes: 0,
        };
        loop {
            let rest = data.get(this.pos..).unwrap_or_default();
            let layers = &mut this.decoder.layers;
            if !gzip::starts_like_header(layers.last().map_or(rest, Layer::unread)) {
                break;
            }
            layers.push(Layer::new()?);
            let top = layers.len().saturating_sub(1);
            let (used, is_gzip) = this.decoder.read_first_header(top, rest)?;
            this.pos = this.pos.saturating_add(used);
            if !is_gzip {
                this.decoder.layers.pop();
                break;
            }
            if top >= MAX_LAYERS {
                return Err(Error::TooManyLayers);
            }
            let rest = data.get(this.pos..).unwrap_or_default();
            let (used, _) = this
                .decoder
                .refill(top, rest, true, Place::InsteadOfTheLast)?;
            this.pos = this.pos.saturating_add(used);
        }
        match this.decoder.layers.last_mut() {
            None => this.pos = this.decoder.tar.detect(data)?,
            Some(layer) => layer.pos = this.decoder.tar.detect(layer.unread())?,
        }
        Ok(this)
    }

    pub fn entry(&self) -> &Entry {
        self.decoder.entry()
    }

    pub fn skip_entry(&mut self) {
        self.decoder.skip_entry();
    }

    /// Skips what is left of the current entry. `None` at the end of the archive.
    pub fn next_entry(&mut self) -> Result<Option<&Entry>> {
        self.skip_entry();
        loop {
            match self.next()? {
                Event::Entry(_) => break,
                Event::EndOfArchive => return Ok(None),
                Event::NeedInput | Event::Data { .. } | Event::EndOfEntry { .. } => {}
            }
        }
        Ok(Some(self.entry()))
    }

    /// Appends at most `size` bytes of the current entry's contents. Holes read as zeros.
    pub fn read_data(&mut self, size: usize, out: &mut Vec<u8>) -> Result<()> {
        let start = out.len();
        let limit = holes_limit(self.data);
        let zeros_up_to = |out: &mut Vec<u8>, holes: &mut usize, offset: i64| -> Result<()> {
            let have = out.len().saturating_sub(start);
            let offset = usize::try_from(offset).map_err(|_| Error::OutOfOrderSparse)?;
            if offset < have {
                return Err(Error::OutOfOrderSparse);
            }
            let zeros = offset.min(size).saturating_sub(have);
            *holes = holes.saturating_add(zeros);
            if *holes > limit {
                return Err(Error::HolesTooLarge { limit });
            }
            out.try_reserve(zeros)?;
            out.resize(out.len().saturating_add(zeros), 0);
            Ok(())
        };
        while out.len().saturating_sub(start) < size {
            match next(&mut self.decoder, self.data, &mut self.pos)? {
                Event::Data { offset, bytes } => {
                    zeros_up_to(out, &mut self.holes, offset)?;
                    let room = size.saturating_sub(out.len().saturating_sub(start));
                    let bytes = bytes.get(..room.min(bytes.len())).unwrap_or_default();
                    out.write(bytes)?;
                }
                Event::EndOfEntry { size: end } => {
                    zeros_up_to(out, &mut self.holes, end)?;
                    break;
                }
                Event::NeedInput | Event::Entry(_) | Event::EndOfArchive => break,
            }
        }
        Ok(())
    }

    /// Never returns [`Event::NeedInput`].
    pub fn next(&mut self) -> Result<Event<'_>> {
        next(&mut self.decoder, self.data, &mut self.pos)
    }
}

fn next<'a>(decoder: &'a mut Decoder, data: &'a [u8], pos: &mut usize) -> Result<Event<'a>> {
    let (used, event) = decoder.next(data.get(*pos..).unwrap_or_default(), true)?;
    *pos = pos.saturating_add(used);
    Ok(event)
}
