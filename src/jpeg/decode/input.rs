//! The compressed bytes, and the part of marker reading that the entropy decoders need (jdatasrc-tj.c, jdmarker.c).

use crate::markers::{M_EOI, M_RST0, M_RST7, M_SOF0};

/// A broken rule that libjpeg goes on from. TurboJPEG only remembered that there was one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Warning {
    /// The data ends before the image does.
    PrematureEof = 1 << 0,
    /// Bytes that belong to nothing come before a marker.
    ExtraneousData = 1 << 1,
    /// A restart marker is not the expected one.
    MustResync = 1 << 2,
    /// A data segment ends before its last MCU does.
    HitMarker = 1 << 3,
    /// Bits that are no Huffman code. libjpeg-turbo's fast path did not report this one.
    BadHuffCode = 1 << 4,
    /// Scan parameters that a sequential scan cannot have.
    NotSequential = 1 << 5,
    /// A JFIF version other than 1.x.
    JfifMajor = 1 << 6,
    /// An Adobe transform code that means nothing.
    AdobeTransform = 1 << 7,
    /// The pieces of the ICC profile do not add up.
    BogusIcc = 1 << 8,
    /// A progressive scan that does not follow from the ones before it.
    BogusProgression = 1 << 9,
    /// Bits that the arithmetic decoder cannot make sense of.
    BadArithCode = 1 << 10,
}

pub(crate) struct Input<'a> {
    data: &'a [u8],
    /// May be past the end of `data`: the stream goes on with EOI markers forever, so that a truncated file decodes as
    /// far as it goes.
    pos: usize,
    /// A marker code that has been read and not handled, or 0. No entropy decoder reads past it.
    pub(crate) unread_marker: u8,
    pub(crate) next_restart_num: u8,
    /// Bytes passed over while looking for a marker. Only decides whether the next marker warns.
    pub(crate) discarded_bytes: usize,
    /// The entropy decoder ran out of data in this segment and made up zeros.
    pub(crate) insufficient_data: bool,
    /// `Warning`s or-ed together.
    pub(crate) warnings: u32,
}

impl<'a> Input<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Input {
            data,
            pos: 0,
            unread_marker: 0,
            next_restart_num: 0,
            discarded_bytes: 0,
            insufficient_data: false,
            warnings: 0,
        }
    }

    #[inline]
    pub(crate) fn warn(&mut self, warning: Warning) {
        self.warnings |= warning as u32;
    }

    #[inline]
    pub(crate) fn byte(&mut self) -> u8 {
        let b = match self.data.get(self.pos) {
            Some(&b) => b,
            None => self.byte_past_end(),
        };
        self.pos += 1;
        b
    }

    #[cold]
    fn byte_past_end(&mut self) -> u8 {
        if (self.pos - self.data.len()) & 1 == 0 {
            self.warn(Warning::PrematureEof);
            0xff
        } else {
            M_EOI
        }
    }

    #[inline]
    pub(crate) fn u16(&mut self) -> u16 {
        let hi = self.byte();
        let lo = self.byte();
        u16::from_be_bytes([hi, lo])
    }

    pub(crate) fn skip(&mut self, n: usize) {
        self.pos += n;
        if self.pos > self.data.len() {
            self.warn(Warning::PrematureEof);
        }
    }

    /// What is left of the real data.
    #[inline]
    pub(crate) fn remaining(&self) -> &'a [u8] {
        self.data.get(self.pos..).unwrap_or(&[])
    }

    /// Only for bytes taken from `remaining()`.
    #[inline]
    pub(crate) fn advance(&mut self, n: usize) {
        self.pos += n;
    }

    /// Reads up to the next marker and leaves its code, which is never 0 or 0xFF, in `unread_marker`.
    pub(crate) fn next_marker(&mut self) {
        let mut c;
        loop {
            c = self.byte();
            while c != 0xff {
                self.discarded_bytes += 1;
                c = self.byte();
            }
            // Extra FFs are legal padding.
            while c == 0xff {
                c = self.byte();
            }
            if c != 0 {
                break;
            }
            // A stuffed zero: this was data.
            self.discarded_bytes += 2;
        }
        if self.discarded_bytes != 0 {
            self.warn(Warning::ExtraneousData);
            self.discarded_bytes = 0;
        }
        self.unread_marker = c;
    }

    /// Called by an entropy decoder where it expects a restart marker. If `unread_marker` is still set afterwards, the
    /// decoder cannot read past it and the next segment is empty.
    pub(crate) fn read_restart_marker(&mut self) {
        if self.unread_marker == 0 {
            self.next_marker();
        }
        if self.unread_marker == M_RST0 + self.next_restart_num {
            self.unread_marker = 0;
        } else {
            self.resync_to_restart(self.next_restart_num);
        }
        self.next_restart_num = (self.next_restart_num + 1) & 7;
    }

    fn resync_to_restart(&mut self, desired: u8) {
        self.warn(Warning::MustResync);
        loop {
            let marker = self.unread_marker;
            let rst = |n: u8| M_RST0 + (n & 7);
            if marker < M_SOF0 {
                // Not a marker code at all: look further.
                self.next_marker();
            } else if !(M_RST0..=M_RST7).contains(&marker) {
                // Leave it unread, so that the scan does not run over its end.
                return;
            } else if marker == rst(desired.wrapping_add(1))
                || marker == rst(desired.wrapping_add(2))
            {
                // The expected one got lost.
                return;
            } else if marker == rst(desired.wrapping_sub(1))
                || marker == rst(desired.wrapping_sub(2))
            {
                // An earlier one: look further.
                self.next_marker();
            } else {
                // Too far off to tell. Drop it and go on with the data after it.
                self.unread_marker = 0;
                return;
            }
        }
    }
}
