//! A tar reader with the gzip layers in front of it.

use crate::error::{Error, Result};
use crate::gzip::{self, Progress};
use crate::reader::{Entry, Event, Options, Poll, Reader};
use bun_alloc::AllocError;

const BLOCK: usize = 64 * 1024;
const MAX_LAYERS: usize = 24;

struct Layer {
    gzip: gzip::Decoder,
    out: Vec<u8>,
    pos: usize,
    done: bool,
}

impl Layer {
    fn new() -> Result<Self> {
        let mut out = Vec::new();
        out.try_reserve_exact(BLOCK)
            .map_err(|_| Error::Alloc(AllocError))?;
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
    /// `gzip` says whether the input is compressed. Nothing is detected, so this works however
    /// little of the input is there yet.
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

    /// Gives layer `index` its next block, in place of what it holds or, with `keep`, behind it.
    /// A block is as full as the layers below can make it, and one that fails is dropped whole.
    /// Returns how much of `input` was consumed, and `false` if there is no output for want of it.
    fn refill(
        &mut self,
        index: usize,
        input: &[u8],
        eof: bool,
        keep: bool,
    ) -> Result<(usize, bool)> {
        let mut used_total = 0usize;
        let Some(layer) = self.layers.get_mut(index) else {
            return Ok((0, true));
        };
        if !keep {
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
            used_total = used_total.saturating_add(self.refill_source(lower, rest, eof, false)?);
        }
    }

    /// [`Self::refill`] for a layer that another one reads. To its reader, a layer that fails has
    /// ended: that is an error in the middle of a member, and nothing between two of them.
    fn refill_source(
        &mut self,
        index: usize,
        input: &[u8],
        eof: bool,
        keep: bool,
    ) -> Result<usize> {
        match self.refill(index, input, eof, keep) {
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

    /// Reads the first header of layer `index`, which is new. If what is there is not one, nothing
    /// of the layer's source counts as read. Returns how much of `input` was consumed.
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
            used_total = used_total.saturating_add(self.refill_source(lower, rest, true, true)?);
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
            let (used, ready) =
                self.refill(top, input.get(used_total..).unwrap_or_default(), eof, false)?;
            used_total = used_total.saturating_add(used);
            if !ready {
                break Poll::NeedInput;
            }
        };
        let event = match poll {
            Poll::NeedInput => Event::NeedInput,
            Poll::Entry => Event::Entry(self.tar.entry()),
            Poll::Data { offset, start, len } => Event::Data {
                offset,
                bytes: self
                    .layers
                    .get(top)
                    .and_then(|layer| layer.out.get(start..start.saturating_add(len)))
                    .unwrap_or_default(),
            },
            Poll::EndOfEntry { size } => Event::EndOfEntry { size },
            Poll::EndOfArchive => Event::EndOfArchive,
        };
        Ok((used_total, event))
    }
}

/// Reads an archive that is all in memory, and works out by itself how it is wrapped.
pub struct MemoryDecoder<'a> {
    data: &'a [u8],
    pos: usize,
    decoder: Decoder,
}

impl<'a> MemoryDecoder<'a> {
    /// Fails if `data` is not an archive, or if the first block of a gzip layer does not
    /// decompress. So nothing that is wrong from the start gets as far as the first entry.
    pub fn new(data: &'a [u8], options: Options) -> Result<Self> {
        let mut this = Self {
            data,
            pos: 0,
            decoder: Decoder::new(options, false)?,
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
            let (used, _) = this.decoder.refill(top, rest, true, false)?;
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

    /// Moves to the next entry, past whatever is left of the current one. `None` at the end of the
    /// archive.
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

    /// Appends the first `size` bytes of the current entry's contents to `out`, or all of them if
    /// there are fewer. Holes read as zeros.
    pub fn read_data(&mut self, size: usize, out: &mut Vec<u8>) -> Result<()> {
        let start = out.len();
        let zeros_up_to = |out: &mut Vec<u8>, offset: i64| -> Result<()> {
            let have = out.len().saturating_sub(start);
            let offset = usize::try_from(offset).map_err(|_| Error::OutOfOrderSparse)?;
            if offset < have {
                return Err(Error::OutOfOrderSparse);
            }
            let zeros = offset.min(size).saturating_sub(have);
            out.try_reserve(zeros)
                .map_err(|_| Error::Alloc(AllocError))?;
            out.resize(out.len().saturating_add(zeros), 0);
            Ok(())
        };
        while out.len().saturating_sub(start) < size {
            match self.next()? {
                Event::Data { offset, bytes } => {
                    zeros_up_to(out, offset)?;
                    let room = size.saturating_sub(out.len().saturating_sub(start));
                    let bytes = bytes.get(..room.min(bytes.len())).unwrap_or_default();
                    out.try_reserve(bytes.len())
                        .map_err(|_| Error::Alloc(AllocError))?;
                    out.extend_from_slice(bytes);
                }
                Event::EndOfEntry { size: end } => {
                    zeros_up_to(out, end)?;
                    break;
                }
                Event::NeedInput | Event::Entry(_) | Event::EndOfArchive => break,
            }
        }
        Ok(())
    }

    /// Never returns [`Event::NeedInput`].
    pub fn next(&mut self) -> Result<Event<'_>> {
        let (used, event) = self
            .decoder
            .next(self.data.get(self.pos..).unwrap_or_default(), true)?;
        self.pos = self.pos.saturating_add(used);
        Ok(event)
    }
}
