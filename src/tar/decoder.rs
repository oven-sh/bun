//! A tar reader with the gzip layers in front of it.

use crate::error::{Error, Result};
use crate::gzip::{self, Progress};
use crate::reader::{Entry, Event, Options, Poll, Reader};

const BLOCK: usize = 64 * 1024;
/// More wrappings than this are not looked for.
const MAX_LAYERS: usize = 25;

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
            .map_err(|_| Error::OutOfMemory)?;
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

    /// Refills layer `index`, whose output has all been read. Returns how much of `input` was
    /// consumed, and whether the layer now has output or has ended. Otherwise it needs input.
    fn refill(&mut self, index: usize, input: &[u8], eof: bool) -> Result<(usize, bool)> {
        let mut used_total = 0usize;
        loop {
            let (below, rest) = self.layers.split_at_mut(index);
            let Some(layer) = rest.first_mut() else {
                return Ok((used_total, true));
            };
            layer.out.clear();
            layer.pos = 0;
            let (source, source_eof) = match below.last() {
                Some(lower) => (lower.unread(), lower.done),
                None => (input.get(used_total..).unwrap_or_default(), eof),
            };
            let (used, progress) = layer
                .gzip
                .decode(source, source_eof, &mut layer.out, BLOCK)?;
            layer.done = progress == Progress::Done;
            let ready = layer.done || !layer.out.is_empty();
            match below.last_mut() {
                Some(lower) => lower.pos = lower.pos.saturating_add(used),
                None => used_total = used_total.saturating_add(used),
            }
            if ready {
                return Ok((used_total, true));
            }
            // The layer wants more than its source has.
            if index == 0 {
                return Ok((used_total, false));
            }
            let (used, ready) = self.refill(
                index.saturating_sub(1),
                input.get(used_total..).unwrap_or_default(),
                eof,
            )?;
            used_total = used_total.saturating_add(used);
            if !ready {
                return Ok((used_total, false));
            }
        }
    }

    /// Runs every layer to its end, so that each one gets to check all of its input. An inner
    /// layer stops at whatever follows its last member, which leaves the ones around it unfinished.
    /// Returns how much of `input` was consumed, and `false` if more is needed.
    fn drain(&mut self, input: &[u8], eof: bool) -> Result<(usize, bool)> {
        let mut used_total = 0usize;
        for index in (0..self.layers.len()).rev() {
            while self.layers.get(index).is_some_and(|layer| !layer.done) {
                let (used, ready) =
                    self.refill(index, input.get(used_total..).unwrap_or_default(), eof)?;
                used_total = used_total.saturating_add(used);
                if !ready {
                    return Ok((used_total, false));
                }
            }
        }
        Ok((used_total, true))
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
                Poll::EndOfArchive => {
                    let (used, finished) =
                        self.drain(input.get(used_total..).unwrap_or_default(), eof)?;
                    used_total = used_total.saturating_add(used);
                    break if finished {
                        Poll::EndOfArchive
                    } else {
                        Poll::NeedInput
                    };
                }
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
                self.refill(top, input.get(used_total..).unwrap_or_default(), eof)?;
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
    /// From looking at what a layer holds. It is reported in place of the first event.
    failed: Option<Error>,
}

impl<'a> MemoryDecoder<'a> {
    pub fn new(data: &'a [u8], options: Options) -> Result<Self> {
        let mut this = Self {
            data,
            pos: 0,
            decoder: Decoder::new(options, false)?,
            failed: None,
        };
        while this.decoder.layers.len() < MAX_LAYERS {
            let is_gzip = match this.decoder.layers.last() {
                None => gzip::starts_with_header(data),
                // One block is all that is looked at, which a header only outgrows with a name or
                // a comment of that size.
                Some(layer) => gzip::starts_with_header(layer.unread()),
            };
            if !is_gzip {
                break;
            }
            this.decoder.layers.push(Layer::new()?);
            let top = this.decoder.layers.len().saturating_sub(1);
            match this
                .decoder
                .refill(top, data.get(this.pos..).unwrap_or_default(), true)
            {
                Ok((used, _)) => this.pos = this.pos.saturating_add(used),
                Err(error) => {
                    this.failed = Some(error);
                    break;
                }
            }
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
            out.try_reserve(zeros).map_err(|_| Error::OutOfMemory)?;
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
                        .map_err(|_| Error::OutOfMemory)?;
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
        if let Some(error) = self.failed {
            return Err(error);
        }
        let (used, event) = self
            .decoder
            .next(self.data.get(self.pos..).unwrap_or_default(), true)?;
        self.pos = self.pos.saturating_add(used);
        Ok(event)
    }
}
