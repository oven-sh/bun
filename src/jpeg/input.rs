//! The bytes of a file, and the markers between them.

use crate::marker::{EOI, RST0, RST7, SOF0};

pub(crate) struct Input<'a> {
    bytes: &'a [u8],
    at: usize,
    /// The marker that ended the entropy-coded data, until it is taken.
    marker: Option<u8>,
}

impl<'a> Input<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            at: 0,
            marker: None,
        }
    }

    /// Past the end of the file come EOI markers without end (jdatasrc-tj.c).
    #[inline]
    pub(crate) fn byte(&mut self) -> u8 {
        let byte = match self.bytes.get(self.at) {
            Some(&byte) => byte,
            None if (self.at - self.bytes.len()).is_multiple_of(2) => 0xFF,
            None => EOI,
        };
        self.at += 1;
        byte
    }

    pub(crate) fn array<const N: usize>(&mut self) -> [u8; N] {
        core::array::from_fn(|_| self.byte())
    }

    pub(crate) fn u16(&mut self) -> u16 {
        u16::from_be_bytes(self.array())
    }

    /// Skips `len` bytes. Returns them if the file has them all.
    pub(crate) fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let start = self.at;
        self.at += len;
        self.bytes.get(start..self.at)
    }

    /// The next byte of entropy-coded data, unstuffed, or the marker in its place.
    fn data_byte(&mut self) -> Result<u8, u8> {
        let mut byte = self.byte();
        if byte != 0xFF {
            return Ok(byte);
        }
        while byte == 0xFF {
            byte = self.byte();
        }
        if byte == 0 { Ok(0xFF) } else { Err(byte) }
    }

    /// Unstuffs entropy-coded data into `out`, up to the next marker, and returns its length. It writes only zeros after that.
    pub(crate) fn read_data(&mut self, out: &mut [u8]) -> usize {
        const ONES: u64 = u64::MAX / 0xFF;
        let mut len = 0;
        while self.marker.is_none() {
            let from = self.bytes.get(self.at..).unwrap_or_default();
            let to = out.get_mut(len..).unwrap_or_default();
            let mut plain = 0;
            for (to, &from) in to.as_chunks_mut().0.iter_mut().zip(from.as_chunks().0) {
                let word = u64::from_le_bytes(from);
                // The lowest set bit is the top bit of the first 0xFF byte.
                let found = (!word).wrapping_sub(ONES) & word & ONES << 7;
                if found != 0 {
                    let before = found.trailing_zeros() - 7;
                    *to = (word & ((1 << before) - 1)).to_le_bytes();
                    plain += before as usize / 8;
                    break;
                }
                *to = from;
                plain += 8;
            }
            (self.at, len) = (self.at + plain, len + plain);
            let Some(next) = out.get_mut(len) else { break };
            match self.data_byte() {
                Ok(byte) => (*next, len) = (byte, len + 1),
                Err(marker) => self.marker = Some(marker),
            }
        }
        len
    }

    pub(crate) fn len_left(&self) -> usize {
        self.bytes.len().saturating_sub(self.at)
    }

    pub(crate) fn pending_marker(&self) -> Option<u8> {
        self.marker
    }

    /// Skips everything up to the next marker.
    pub(crate) fn next_marker(&mut self) -> u8 {
        loop {
            if let Some(marker) = self.marker.take() {
                return marker;
            }
            self.read_data(&mut [0; 64]);
        }
    }

    /// Takes restart marker `number`. A marker that belongs further on stays pending (`jpeg_resync_to_restart()`).
    pub(crate) fn restart(&mut self, number: u8) {
        // A shortcut, worth 3 % with a restart after each block.
        if self.marker.take_if(|it| *it == RST0 + number).is_some() {
            return;
        }
        self.marker = loop {
            let marker = self.next_marker();
            match marker {
                ..SOF0 => {}
                RST0..=RST7 => match (marker - RST0).wrapping_sub(number) % 8 {
                    // An earlier one.
                    6 | 7 => {}
                    // A later one: ours is lost.
                    1 | 2 => break Some(marker),
                    _ => break None,
                },
                _ => break Some(marker),
            }
        };
    }
}
