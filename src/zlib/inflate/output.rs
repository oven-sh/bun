//! Where one call puts its output.

use core::cell::Cell;
use core::iter::repeat;

use bun_core::vec::{BorrowedBuf, append_behind, append_with};
use bun_deflate::lanes::{Block, Lanes, Sheet};
use bun_highway::zlib::{Appender, NEXT_MATCH_OFFSET};

use super::Status;
use super::bits::BitReader;
use super::codes::{self, FAST_INPUT, Lap, Reach, Stop};
use super::tables::Tables;
use super::window::SLACK;
use crate::checksum::Checksum;
use crate::error::Result;

pub(super) trait Target {
    fn filled(&self) -> &[u8];
    fn room(&self) -> usize;
    /// Once it is as large as it may get.
    fn max_room(&self) -> usize;
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum);
    /// `false` if it is as large as it may get.
    fn grow(&mut self, input_len: usize) -> Result<bool>;
    /// When it is nearly full: if that is cheap, or what `input_len` bytes stand for is unlikely to fit.
    fn grow_early(&mut self, input_len: usize);
    /// If it has no memory yet.
    fn reserve_first(&mut self, len: impl FnOnce() -> usize);
    /// The last `back` bytes, or the first `max` of them.
    fn append_again(&mut self, back: usize, max: usize, checksum: &mut Checksum);
    /// Touches no more than `room` bytes, and the `reach.from` in front of them. `None` if they are all but used up.
    fn decode(
        &mut self,
        tables: &Tables,
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
        last_distance: &Cell<usize>,
    ) -> Result<Option<Status>>;
    /// The same, but `None` may come earlier.
    fn decode_in_lanes(
        &mut self,
        lanes: (&mut Lanes, &mut Block),
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
    ) -> Result<Option<Status>>;
}

/// Lends `fill` all of `buf`, which is initialized, and its length.
#[inline(always)]
fn with_all<R>(buf: &mut BorrowedBuf<'_, u8>, fill: impl FnOnce(&mut [u8], &mut usize) -> R) -> R {
    debug_assert!(buf.is_init());
    let mut len = buf.len();
    let mut all = buf.clear().unfilled();
    let result = fill(all.ensure_init(), &mut len);
    all.advance_checked(len);
    result
}

impl Target for &mut BorrowedBuf<'_, u8> {
    #[inline]
    fn filled(&self) -> &[u8] {
        BorrowedBuf::filled(self)
    }

    #[inline]
    fn room(&self) -> usize {
        self.capacity() - self.len()
    }

    #[inline]
    fn max_room(&self) -> usize {
        self.room()
    }

    #[inline(always)]
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum) {
        checksum.copy(bytes, self.unfilled());
    }

    #[inline]
    fn grow(&mut self, _: usize) -> Result<bool> {
        Ok(false)
    }

    #[inline]
    fn grow_early(&mut self, _: usize) {}

    #[inline]
    fn reserve_first(&mut self, _: impl FnOnce() -> usize) {}

    fn append_again(&mut self, back: usize, max: usize, checksum: &mut Checksum) {
        with_all(self, |all, len| {
            let (filled, rest) = all.split_at_mut(*len);
            let last = filled.split_at(*len - back).1;
            let bytes = last.get(..max).unwrap_or(last);
            checksum.copy(bytes, BorrowedBuf::from(rest).unfilled());
            *len += bytes.len();
        });
    }

    #[inline(always)]
    fn decode(
        &mut self,
        tables: &Tables,
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
        last_distance: &Cell<usize>,
    ) -> Result<Option<Status>> {
        with_all(self, |all, len| {
            let start = *len - reach.from;
            let bytes = all.get_mut(start..*len + room).unwrap_or_default();
            let mut end = reach.from;
            let result = decode_in_place(tables, bits, (bytes, &mut end), reach, last_distance);
            *len = start + end;
            result
        })
    }

    #[inline(never)]
    fn decode_in_lanes(
        &mut self,
        (lanes, block): (&mut Lanes, &mut Block),
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
    ) -> Result<Option<Status>> {
        with_all(self, |all, len| {
            let (start, limit) = (*len - reach.from, reach.from + room - (SLACK - 1));
            let bytes = all.get_mut(start..*len + room).unwrap_or_default();
            let mut sheet =
                Sheet::slice(bytes, reach.from..usize::MAX, reach.available, reach.max, 0);
            let has_ended = codes::decode_in_lanes((lanes, block), bits, &mut sheet);
            let mut end = sheet.position();
            let result = if has_ended || end != reach.from {
                Ok(has_ended.then_some(Status::BlockEnd))
            } else {
                let (tape, steps) = (
                    Lap::new((bytes, &mut end), limit, None)?,
                    0..codes::steps_between_lanes(bits),
                );
                codes::decode_slowly(lanes, bits, tape, reach, steps)
            };
            *len = start + end;
            result
        })
    }
}

#[inline(always)]
fn decode_in_place(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    (bytes, end): (&mut [u8], &mut usize),
    reach: Reach,
    last_distance: &Cell<usize>,
) -> Result<Option<Status>> {
    let (limit, ahead) = (bytes.len() - (SLACK - 1), NEXT_MATCH_OFFSET);
    if bits.rest.len() >= FAST_INPUT
        && let slice = (&mut *bytes, &mut *end)
        && let Stop::EndOfBlock =
            codes::decode_to_slice(tables, bits, slice, limit, ahead, reach, last_distance)?
    {
        return Ok(Some(Status::BlockEnd));
    }
    codes::decode_slowly(
        tables,
        bits,
        Lap::new((bytes, end), limit, None)?,
        reach,
        repeat(()),
    )
}

const MIN_GROWTH: usize = 4096;

pub(super) struct Growing<'a> {
    vec: &'a mut Vec<u8>,
    start: usize,
    max_len: usize,
    input_len: usize,
    guesses: u8,
    /// The caller did not know how long the output is.
    has_grown: bool,
}

impl<'a> Growing<'a> {
    pub(super) fn new(vec: &'a mut Vec<u8>, max: usize, input_len: usize) -> Self {
        Self {
            start: vec.len(),
            max_len: vec.len().saturating_add(max),
            input_len,
            guesses: 0,
            has_grown: false,
            vec,
        }
    }

    /// For the last `left` bytes of the input, if they are like those before. `None` where doubling is called for.
    fn likely_growth(&mut self, left: usize) -> Option<usize> {
        /// More than doubling takes. Windows does not wait for memory to be used.
        const MAX_BEYOND: usize = 32 << 20;
        let (read, len) = (self.input_len.saturating_sub(left), self.vec.len());
        let ratio = len
            .saturating_mul(18)
            .checked_div(read)
            .filter(|_| self.start == 0 && len >= MIN_GROWTH / 2 && self.guesses < 2)?;
        let likely = left.saturating_mul(ratio) / 16;
        self.guesses += u8::from(likely < len);
        let most = len.saturating_mul(16).min(len.saturating_add(MAX_BEYOND));
        Some(likely.clamp(len / 8, most) + SLACK)
    }
}

impl Target for Growing<'_> {
    #[inline]
    fn filled(&self) -> &[u8] {
        self.vec.get(self.start..).unwrap_or_default()
    }

    #[inline]
    fn room(&self) -> usize {
        self.vec.capacity().min(self.max_len) - self.vec.len()
    }

    #[inline]
    fn max_room(&self) -> usize {
        self.max_len - self.vec.len()
    }

    #[inline(always)]
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum) {
        append_with(self.vec, bytes.len(), |out| checksum.copy(bytes, out));
    }

    fn grow(&mut self, input_len: usize) -> Result<bool> {
        let spare = self.vec.capacity() - self.vec.len();
        let left = self.max_len.saturating_sub(self.vec.capacity());
        let reserved = match self.likely_growth(input_len) {
            Some(likely) => self.vec.try_reserve_exact(spare + left.min(likely)),
            None => self.vec.try_reserve(spare + left.min(MIN_GROWTH)),
        };
        if reserved.is_err() {
            let growth = left.min(MIN_GROWTH + self.vec.len() / 8);
            self.vec.try_reserve_exact(spare + growth)?;
        }
        self.has_grown = true;
        Ok(left != 0)
    }

    fn grow_early(&mut self, input_len: usize) {
        const LONG_INPUT: usize = 1024;
        if self.has_grown || input_len >= LONG_INPUT || self.vec.capacity() < MIN_GROWTH {
            // What is left may do after all.
            _ = self.grow(input_len);
        }
    }

    #[inline]
    fn reserve_first(&mut self, len: impl FnOnce() -> usize) {
        if self.vec.capacity() == 0 {
            self.has_grown = self.vec.try_reserve_exact(len().min(self.max_len)).is_ok();
        }
    }

    fn append_again(&mut self, back: usize, max: usize, checksum: &mut Checksum) {
        append_behind(self.vec, max, |bytes, out| {
            let last = bytes.split_at(bytes.len() - back).1;
            checksum.copy(last.get(..max).unwrap_or(last), out);
        });
    }

    #[inline(always)]
    fn decode(
        &mut self,
        tables: &Tables,
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
        last_distance: &Cell<usize>,
    ) -> Result<Option<Status>> {
        let start = self.vec.len();
        if bits.rest.len() >= FAST_INPUT
            && let Stop::EndOfBlock =
                codes::decode_to_vec(tables, bits, self.vec, room, reach, last_distance)?
        {
            return Ok(Some(Status::BlockEnd));
        }
        let decoded = self.vec.len() - start;
        let tape = Appender::new(self.vec, reach.from + decoded, room - decoded);
        codes::decode_slowly(tables, bits, tape, reach, repeat(()))
    }

    #[inline(never)]
    fn decode_in_lanes(
        &mut self,
        (lanes, block): (&mut Lanes, &mut Block),
        bits: &mut BitReader<'_>,
        room: usize,
        reach: Reach,
    ) -> Result<Option<Status>> {
        let start = self.vec.len();
        let has_ended = Sheet::behind(self.vec, room, reach.available, reach.max, |sheet| {
            codes::decode_in_lanes((lanes, block), bits, sheet)
        });
        if has_ended || self.vec.len() != start {
            return Ok(has_ended.then_some(Status::BlockEnd));
        }
        let (tape, steps) = (
            Appender::new(self.vec, reach.from, room),
            0..codes::steps_between_lanes(bits),
        );
        codes::decode_slowly(lanes, bits, tape, reach, steps)
    }
}

pub(super) struct Output<T> {
    pub(super) target: T,
    /// So many bytes at its end did not come from the window.
    pub(super) unrecorded: usize,
    /// So many of those are not in the checksum yet.
    pub(super) unchecked: usize,
}

impl<T: Target> Output<T> {
    #[inline]
    pub(super) fn len(&self) -> usize {
        self.target.filled().len()
    }

    #[inline]
    pub(super) fn room(&self) -> usize {
        self.target.room()
    }

    #[inline(always)]
    pub(super) fn check(&mut self, checksum: &mut Checksum) {
        if self.unchecked != 0 {
            self.check_now(checksum);
        }
    }

    #[inline(never)]
    fn check_now(&mut self, checksum: &mut Checksum) {
        let start = self.len() - core::mem::take(&mut self.unchecked);
        checksum.add(self.target.filled().split_at(start).1);
    }
}
