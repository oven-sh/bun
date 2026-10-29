//! The compressed bytes, and the part of marker reading that the entropy decoders need (jdatasrc-tj.c, jdmarker.c).

use crate::markers::{M_EOI, M_RST0, M_RST7, M_SOF0};

pub(crate) struct Input<'a> {
    data: &'a [u8],
    /// May be past the end of `data`: the stream goes on with EOI markers forever, so that a truncated file decodes as
    /// far as it goes.
    pos: usize,
    /// A marker code that has been read and not handled, or 0. No entropy decoder reads past it.
    pub(crate) unread_marker: u8,
    pub(crate) next_restart_num: u8,
    /// The entropy decoder ran out of data in this segment and made up zeros.
    pub(crate) insufficient_data: bool,
}

impl<'a> Input<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Input {
            data,
            pos: 0,
            unread_marker: 0,
            next_restart_num: 0,
            insufficient_data: false,
        }
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
    fn byte_past_end(&self) -> u8 {
        if (self.pos - self.data.len()) & 1 == 0 {
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

    #[inline]
    pub(crate) fn skip(&mut self, n: usize) {
        self.pos += n;
    }

    /// What is left of the real data.
    #[inline]
    pub(crate) fn remaining(&self) -> &'a [u8] {
        self.data.get(self.pos..).unwrap_or(&[])
    }

    /// Reads up to the next marker and leaves its code, which is never 0 or 0xFF, in `unread_marker`.
    pub(crate) fn next_marker(&mut self) {
        let mut c = 0;
        // An FF with a zero after it is data.
        while c == 0 {
            while c != 0xff {
                c = self.byte();
            }
            // Extra FFs are legal padding.
            while c == 0xff {
                c = self.byte();
            }
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
            self.resync_to_restart();
        }
        self.next_restart_num = (self.next_restart_num + 1) & 7;
        // Up against a marker, the next segment is empty: leaving the flag set keeps it gray instead of garbage.
        if self.unread_marker == 0 {
            self.insufficient_data = false;
        }
    }

    fn resync_to_restart(&mut self) {
        let desired = self.next_restart_num;
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

/// Counts down to the next restart marker.
#[derive(Default)]
pub(crate) struct Restarts {
    /// In MCUs, or rows of MCUs in a lossless stream. 0 if the scan has no restart markers.
    interval: u32,
    to_go: u32,
}

impl Restarts {
    pub(crate) fn new(interval: u32) -> Self {
        Restarts {
            interval,
            to_go: interval,
        }
    }

    pub(crate) fn in_use(&self) -> bool {
        self.interval != 0
    }

    /// Called before each MCU. Returns whether a restart marker was due, which has then been read.
    #[inline(always)]
    pub(crate) fn due(&mut self, input: &mut Input) -> bool {
        if self.interval == 0 {
            return false;
        }
        let due = self.to_go == 0;
        if due {
            input.read_restart_marker();
            self.to_go = self.interval;
        }
        self.to_go -= 1;
        due
    }
}
