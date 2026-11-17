//! Where the output is put together before it is handed out, behind what matches copy from.

use crate::error::{Error, Result};
use crate::format::MAX_WINDOW_BITS;

pub(super) const MAX_DISTANCE: usize = 1 << MAX_WINDOW_BITS;
/// How far past `end` a few literals and a match may write, as matches are copied in whole chunks.
pub(super) const SLACK: usize = 352;
/// By how much `end` goes back when it starts over. What is written in the slack replaces only what is out of reach.
pub(super) const LAP: usize = MAX_DISTANCE + SLACK;
/// So many bytes are taken along to the start, so that no match is copied from both ends.
const CARRIED: usize = 320;
const LAP_END: usize = CARRIED + LAP;
const FULL_LEN: usize = LAP_END + SLACK;
const MIN_GROWTH: usize = 256;

#[derive(Default)]
pub(super) struct Window {
    /// Only as long as it has had to be.
    pub(super) bytes: Vec<u8>,
    /// Where the next byte goes. The byte `n` back is at `end - n`, or at `end - n + LAP` if that is negative.
    pub(super) end: usize,
    /// What is between it and `end` has not been handed out.
    handed_out: usize,
}

impl Window {
    pub(super) fn clear(&mut self) {
        self.end = 0;
        self.handed_out = 0;
    }

    #[inline]
    pub(super) fn pending(&self) -> usize {
        self.end - self.handed_out
    }

    pub(super) fn drop_pending(&mut self) {
        self.end = self.handed_out;
    }

    #[inline]
    pub(super) fn hand_out(&mut self, max: usize) -> &[u8] {
        let start = self.handed_out;
        self.handed_out += max.min(self.pending());
        self.bytes.get(start..self.handed_out).unwrap_or_default()
    }

    /// Up to where `end` may be when something is written.
    #[inline]
    pub(super) fn limit(&self) -> usize {
        self.bytes.len().saturating_sub(SLACK)
    }

    #[inline]
    pub(super) fn is_lap_over(&self) -> bool {
        self.end >= LAP_END
    }

    /// If all that is within reach repeats every `period` bytes, some periods of it. At the end of a lap.
    pub(super) fn periods(&self, period: usize) -> Option<&[u8]> {
        const CACHED_LEN: usize = 16 * 1024;
        let all = self.bytes.get(self.end - MAX_DISTANCE..self.end)?;
        let len = period.max(CACHED_LEN - CACHED_LEN % period);
        all.starts_with(all.get(period..)?)
            .then(|| all.get(MAX_DISTANCE - len..))?
    }

    /// The last one is over, and nothing is pending.
    pub(super) fn start_lap(&mut self) -> Result<()> {
        debug_assert_eq!(self.pending(), 0);
        let written = self.bytes.get_mut(..self.end).ok_or(Error::Internal)?;
        written.copy_within(LAP.., 0);
        self.end -= LAP;
        self.handed_out = self.end;
        Ok(())
    }

    /// Moves `limit()` past `end`, by about `wanted` bytes. The lap is not over.
    #[cold]
    pub(super) fn grow(&mut self, wanted: usize) -> Result<()> {
        self.bytes.try_reserve_exact(FULL_LEN - self.bytes.len())?;
        let growth = wanted.clamp(MIN_GROWTH, LAP).max(self.end);
        self.bytes
            .resize((self.end + growth + SLACK).min(FULL_LEN), 0);
        Ok(())
    }

    /// Adds what has been handed out some other way. Nothing may be pending.
    pub(super) fn record(&mut self, mut bytes: &[u8]) -> Result<()> {
        if let Some(start) = bytes.len().checked_sub(MAX_DISTANCE) {
            bytes = bytes.get(start..).unwrap_or_default();
            self.end = 0;
        }
        self.handed_out = self.end;
        while !bytes.is_empty() {
            if self.is_lap_over() {
                self.start_lap()?;
            } else if self.end + bytes.len() > self.limit() && self.bytes.len() < FULL_LEN {
                self.grow(bytes.len())?;
            }
            let limit = self.limit();
            let room = self.bytes.get_mut(self.end..limit).unwrap_or_default();
            let piece;
            (piece, bytes) = bytes.split_at(room.len().min(bytes.len()));
            room.split_at_mut(piece.len()).0.copy_from_slice(piece);
            self.end += piece.len();
            self.handed_out = self.end;
        }
        Ok(())
    }
}
