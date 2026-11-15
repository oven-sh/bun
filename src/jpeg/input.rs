//! The bytes of a file, and the markers between them.

use crate::marker::{EOI, RST0, RST7, SOF0};

pub(crate) struct Input<'a> {
    bytes: &'a [u8],
    at: usize,
    /// What ended the data of a scan, if nothing has taken it yet.
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

    /// The file is followed by EOI markers without end, whatever they are read as (jdatasrc-tj.c).
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

    pub(crate) fn word(&mut self) -> u16 {
        u16::from_be_bytes([self.byte(), self.byte()])
    }

    /// Skips `len` bytes. Returns them if the file has them all.
    pub(crate) fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let start = self.at;
        self.at += len;
        self.bytes.get(start..self.at)
    }

    /// Skips and returns the bytes before the next 0xFF, `most` at most.
    fn take_plain(&mut self, most: usize) -> &'a [u8] {
        let rest = self.bytes.get(self.at..).unwrap_or_default();
        let rest = rest.get(..most).unwrap_or(rest);
        let len = bun_highway::index_of_char(rest, 0xFF).unwrap_or(rest.len());
        self.take(len).unwrap_or_default()
    }

    /// The next byte of entropy-coded data, or the marker that comes in its place.
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

    /// Fills `out` with entropy-coded data, as far as the next marker. Returns how many bytes that is.
    pub(crate) fn read_data(&mut self, mut out: &mut [u8]) -> usize {
        let room = out.len();
        while self.marker.is_none() {
            let plain = self.take_plain(out.len());
            let (filled, rest) = out.split_at_mut(plain.len());
            filled.copy_from_slice(plain);
            out = rest;
            let [next, ..] = out else { break };
            match self.data_byte() {
                Ok(byte) => {
                    *next = byte;
                    out = out.get_mut(1..).unwrap_or_default();
                }
                Err(marker) => self.marker = Some(marker),
            }
        }
        room - out.len()
    }

    pub(crate) fn len_left(&self) -> usize {
        self.bytes.len().saturating_sub(self.at)
    }

    pub(crate) fn pending_marker(&self) -> Option<u8> {
        self.marker
    }

    /// Skips whatever comes before it.
    pub(crate) fn next_marker(&mut self) -> u8 {
        if let Some(marker) = self.marker.take() {
            return marker;
        }
        loop {
            self.take_plain(usize::MAX);
            if let Err(marker) = self.data_byte() {
                return marker;
            }
        }
    }

    /// Goes past the restart marker `number`, but not one that belongs further on (`jpeg_resync_to_restart()`).
    pub(crate) fn restart(&mut self, number: u8) {
        loop {
            let marker = self.next_marker();
            match marker {
                ..SOF0 => {}
                RST0..=RST7 => match (marker - RST0).wrapping_sub(number) % 8 {
                    6 | 7 => {}
                    1 | 2 => return self.marker = Some(marker),
                    _ => return,
                },
                _ => return self.marker = Some(marker),
            }
        }
    }
}
