//! Where the output is put together before it is handed out, behind what matches copy from.

use crate::error::{Error, Result};
use crate::format::MAX_WINDOW_BITS;
use crate::vec;

pub(super) const MAX_DISTANCE: usize = 1 << MAX_WINDOW_BITS;
/// How far past `end` a few literals and a match may write, and more, so that a lap has whole cache lines.
pub(super) const SLACK: usize = 384;
/// By how much `end` goes back when it starts over. What is written in the slack replaces only what is out of reach.
pub(super) const LAP: usize = MAX_DISTANCE + SLACK;
/// So many bytes are taken along to the start, so that no match is copied from both ends.
const CARRIED: usize = 320;
const LAP_END: usize = CARRIED + LAP;
const FULL_LEN: usize = LAP_END + SLACK;
const MIN_GROWTH: usize = 256;
/// In front of what is within reach, before that is moved to the start.
const MAX_WASTED: usize = 4096;
/// With the slack.
const SHORT_MESSAGE_ROOM: usize = 2048;

/// Of as many as fit in `max` bytes, but at least one.
pub(super) fn whole_periods_len(period: usize, max: usize) -> usize {
    period.max(max - max % period)
}

pub(super) struct Window {
    /// Only as long as it has had to be.
    pub(super) bytes: Vec<u8>,
    /// Where the next byte goes. One within reach is `n` back at `end - n`, or at `end - n + LAP` if that is negative.
    pub(super) end: usize,
    /// What is between it and `end` has not been handed out.
    handed_out: usize,
    /// What `grow()` has added since `resume()`.
    grown: usize,
    /// The capacity, unless a long message has needed all.
    usual_capacity: usize,
}

impl Window {
    pub(super) fn new(size: usize) -> Self {
        // Sizes that mimalloc has, but for the largest window.
        let for_short_messages = size + size.min(MAX_WASTED) + SHORT_MESSAGE_ROOM.max(size / 4);
        Self {
            bytes: Vec::new(),
            end: 0,
            handed_out: 0,
            grown: 0,
            usual_capacity: for_short_messages.min(FULL_LEN),
        }
    }

    pub(super) fn clear(&mut self) {
        self.end = 0;
        self.handed_out = 0;
    }

    #[inline]
    pub(super) fn pending(&self) -> usize {
        self.end - self.handed_out
    }

    /// Of what is handed out next.
    pub(super) fn pending_address(&self) -> usize {
        self.bytes.as_ptr().addr() + self.handed_out
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

    #[inline]
    pub(super) fn bytes_and_end(&mut self) -> (&mut [u8], &mut usize) {
        (&mut self.bytes, &mut self.end)
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

    /// Whether all that is within reach repeats. At the end of a lap.
    pub(super) fn has_period(&self, period: usize) -> bool {
        let all = self.bytes.get(self.end - MAX_DISTANCE..self.end);
        all.is_some_and(|all| all.get(period..).is_some_and(|rest| all.starts_with(rest)))
    }

    /// The last ones, if `has_period()`.
    pub(super) fn periods(&self, period: usize) -> &[u8] {
        const CACHED_LEN: usize = 16 * 1024;
        let len = whole_periods_len(period, CACHED_LEN);
        self.bytes.get(self.end - len..self.end).unwrap_or_default()
    }

    /// Adds the first `len` bytes of another period, which have been handed out. At the start of a lap.
    pub(super) fn record_part_of_period(&mut self, period: usize, len: usize) -> Result<()> {
        let start = self.end + LAP - period;
        let lap = self
            .bytes
            .get_mut(..self.end + LAP)
            .ok_or(Error::Internal)?;
        lap.copy_within(start..start + len, self.end);
        self.end += len;
        self.handed_out = self.end;
        Ok(())
    }

    fn slide(&mut self, by: usize) -> Result<()> {
        let written = self.bytes.get_mut(..self.end).ok_or(Error::Internal)?;
        written.copy_within(by.., 0);
        self.end -= by;
        self.handed_out -= by;
        Ok(())
    }

    fn slide_by_lines(&mut self, max: usize) -> Result<()> {
        // https://sourceware.org/bugzilla/show_bug.cgi?id=30994
        self.slide(max / 64 * 64)
    }

    /// The last one is over, and nothing is pending.
    pub(super) fn start_lap(&mut self) -> Result<()> {
        debug_assert_eq!((self.pending(), self.bytes.capacity()), (0, FULL_LEN));
        self.bytes.resize(FULL_LEN, 0);
        self.slide(LAP)
    }

    /// Only `reach` of the bytes that have been handed out are still needed, and few can do with little memory.
    #[inline]
    pub(super) fn resume(&mut self, reach: usize) -> Result<()> {
        const { assert!(MAX_DISTANCE + MAX_WASTED > FULL_LEN) };
        self.grown = 0;
        // What waits for room is long, and better off in laps.
        if self.pending() == 0
            && self.handed_out > reach + reach.min(MAX_WASTED)
            && self.bytes.len() < FULL_LEN
        {
            self.slide_by_lines(self.handed_out - reach)?;
        }
        Ok(())
    }

    /// Gives back what a long message has taken, but for the last `reach` bytes. Nothing is pending.
    #[inline]
    pub(super) fn shrink(&mut self, reach: usize) {
        debug_assert_eq!(self.pending(), 0);
        if self.bytes.capacity() > self.usual_capacity
            && let Ok(mut kept) = vec::with_room(self.usual_capacity)
        {
            let in_last_lap = LAP - reach.saturating_sub(self.end)..LAP;
            for part in [in_last_lap, self.end.saturating_sub(reach)..self.end] {
                kept.extend_from_slice(self.bytes.get(part).unwrap_or_default());
            }
            (self.end, self.handed_out) = (kept.len(), kept.len());
            self.bytes = kept;
        }
    }

    fn capacity_for(&self, len: usize) -> usize {
        if len <= self.usual_capacity {
            self.usual_capacity
        } else {
            FULL_LEN
        }
    }

    fn make_room(&mut self, len: usize) -> Result<()> {
        let additional = self.capacity_for(len).saturating_sub(self.bytes.len());
        Ok(self.bytes.try_reserve_exact(additional)?)
    }

    /// Moves `limit()` past `end`, by about `wanted` bytes. The lap is not over.
    #[cold]
    pub(super) fn grow(&mut self, wanted: usize) -> Result<()> {
        let growth = wanted.max(self.grown).clamp(MIN_GROWTH, LAP);
        self.grown += growth;
        let max_len = self.capacity_for(self.end + MIN_GROWTH + SLACK);
        let len = (self.end + growth + SLACK).min(max_len);
        self.make_room(len)?;
        self.bytes.resize(len, 0);
        Ok(())
    }

    /// Adds what has been handed out some other way, or its last `max` bytes. Nothing may be pending.
    #[inline]
    pub(super) fn record(&mut self, bytes: &[u8], max: usize) -> Result<()> {
        let end = self.end + bytes.len();
        match self.bytes.get_mut(self.end..end) {
            Some(room) if end <= LAP_END && bytes.len() < max => room.copy_from_slice(bytes),
            _ => return self.make_room_and_record(bytes, max),
        }
        (self.end, self.handed_out) = (end, end);
        Ok(())
    }

    fn make_room_and_record(&mut self, bytes: &[u8], max: usize) -> Result<()> {
        let mut bytes = bytes.split_at(bytes.len().saturating_sub(max)).1;
        // Starting over in each call would put the next lap where `slide_by_lines()` avoids it.
        if self.bytes.len() < FULL_LEN {
            if bytes.len() == max {
                self.clear();
            } else if self.end + bytes.len() > self.usual_capacity && max < MAX_DISTANCE {
                self.slide_by_lines(self.end + bytes.len() - max)?;
            }
        }
        while !bytes.is_empty() {
            if self.is_lap_over() {
                self.start_lap()?;
            }
            let piece;
            (piece, bytes) = bytes.split_at(bytes.len().min(LAP_END - self.end));
            if let Some(room) = self.bytes.get_mut(self.end..self.end + piece.len()) {
                room.copy_from_slice(piece);
            } else {
                self.make_room(self.end + piece.len())?;
                self.bytes.truncate(self.end);
                self.bytes.extend_from_slice(piece);
            }
            self.end += piece.len();
            self.handed_out = self.end;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_reach_takes_little_memory() {
        let mut window = Window::new(MAX_DISTANCE);
        for byte in 0..=u8::MAX {
            assert_eq!(window.resume(1000), Ok(()));
            assert_eq!(window.record(&[byte; 300], 1000), Ok(()));
        }
        assert!(window.bytes.len() <= 2300);
        let reach = window.bytes.get(window.end - 901..window.end - 899);
        assert_eq!(reach, Some(&[252, 253][..]));
    }

    #[test]
    fn a_small_window_gives_back_what_a_long_message_took() {
        let bytes: [u8; 40_000] = core::array::from_fn(|at| (at % 251) as u8);
        // In the first lap, just behind the start of the second, and further into it.
        for len in [9000, LAP_END + 100, 40_000] {
            let mut window = Window::new(1024);
            for piece in bytes.split_at(len).0.chunks(1000) {
                assert_eq!(window.record(piece, MAX_DISTANCE), Ok(()));
            }
            assert_eq!(window.bytes.capacity(), FULL_LEN);
            window.shrink(1024);
            assert!(window.bytes.capacity() < 5000);
            assert_eq!(bytes.get(len - 1024..len), window.bytes.get(..window.end));
        }
    }

    #[test]
    fn the_largest_window_goes_in_laps() {
        let mut window = Window::new(MAX_DISTANCE);
        for _ in 0..17 {
            assert_eq!(window.record(&[7; 2000], MAX_DISTANCE), Ok(()));
        }
        assert_eq!(window.end, 17 * 2000 - LAP);
    }
}
