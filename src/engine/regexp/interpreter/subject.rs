use core::ops::Range;

use bun_engine_text::{CodeUnit, Text};
use bun_engine_unicode::IgnoreCase;

use crate::program::{Class, Direction, Probe, Program, RowProbe, Scan, Step, Stride};
use crate::surrogate;

#[derive(Clone, Copy)]
pub(super) struct Subject<'a, U> {
    units: &'a [U],
    bytes: &'a [u8],
}

impl<'a, U: CodeUnit> Subject<'a, U> {
    #[inline]
    pub(super) fn new(units: &'a [U]) -> Subject<'a, U> {
        let bytes = match U::text(units) {
            Text::Latin1(characters) => characters,
            Text::Utf16(units) => bun_pod::slice_as_bytes(units),
        };
        Subject { units, bytes }
    }

    #[inline(always)]
    pub(super) fn len(self) -> usize {
        self.units.len()
    }

    #[inline(always)]
    pub(super) fn room(self, position: usize, direction: Direction) -> usize {
        match direction {
            Direction::Forward => self.len().wrapping_sub(position),
            Direction::Backward => position,
        }
    }

    #[inline(always)]
    pub(super) fn unit(self, at: usize) -> Option<u16> {
        self.units.get(at).map(|unit| unit.to_u16())
    }

    #[inline]
    pub(super) fn slice(self, range: Range<usize>) -> Option<&'a [U]> {
        self.units.get(range)
    }

    #[inline(always)]
    pub(super) fn word(self, at: usize, bytes: u8) -> Option<u64> {
        let rest = self.bytes.get(at.wrapping_mul(size_of::<U>())..)?;
        Some(match bytes {
            2 => u16::from_le_bytes(*rest.first_chunk()?).into(),
            4 => u32::from_le_bytes(*rest.first_chunk()?).into(),
            _ => u64::from_le_bytes(*rest.first_chunk()?),
        })
    }

    #[inline(always)]
    pub(super) fn is_in(self, at: usize, class: &Class) -> bool {
        (self.units.get(at)).is_some_and(|&unit| class.contains_unit(unit))
    }

    #[inline]
    pub(super) fn pair(self, at: usize) -> Option<u32> {
        surrogate::join(self.unit(at)?, self.unit(at.wrapping_add(1))?)
    }

    #[inline]
    pub(super) fn is_in_pair(self, position: usize) -> bool {
        self.pair(position.wrapping_sub(1)).is_some()
    }

    /// The next character in the direction, and the position after it.
    #[inline]
    fn code_point(self, position: usize, direction: Direction) -> Option<(u32, usize)> {
        let (single, double) = match direction {
            Direction::Forward => (position, position),
            Direction::Backward => (position.wrapping_sub(1), position.wrapping_sub(2)),
        };
        let unit = self.unit(single)?;
        let pair = surrogate::is_surrogate(unit).then(|| self.pair(double));
        let (c, length) = match pair.flatten() {
            Some(c) => (c, 2),
            None => (unit.into(), 1),
        };
        let step = direction.signed(length) as isize;
        Some((c, position.wrapping_add_signed(step)))
    }

    #[inline]
    pub(super) fn run(
        self,
        position: usize,
        direction: Direction,
        class: &Class,
        max: u32,
        reserve: u32,
    ) -> usize {
        let room = self.room(position, direction);
        let length = room.saturating_sub(reserve as usize).min(max as usize);
        let is_other = |unit: &U| !class.contains_unit(*unit);
        match direction {
            Direction::Forward => {
                let units = self.slice(position..position + length).unwrap_or_default();
                position + units.iter().position(is_other).unwrap_or(units.len())
            }
            Direction::Backward => {
                let units = self.slice(position - length..position).unwrap_or_default();
                position - units.len() + units.iter().rposition(is_other).map_or(0, |it| it + 1)
            }
        }
    }

    pub(super) fn run_code_points(
        self,
        mut position: usize,
        direction: Direction,
        class: &Class,
        max: u32,
        reserve: u32,
    ) -> usize {
        for _ in 0..max {
            match self.code_point(position, direction) {
                Some((c, after))
                    if class.contains(c) && self.room(after, direction) >= reserve as usize =>
                {
                    position = after;
                }
                _ => break,
            }
        }
        position
    }

    #[inline]
    pub(super) fn give_back(
        self,
        position: &mut usize,
        direction: Direction,
        stride: Stride,
        floor: usize,
        filter: Option<&Class>,
    ) -> bool {
        let units = stride.least_units() as usize;
        loop {
            let next_unit = match direction {
                Direction::Forward if *position >= floor + units => {
                    *position -= units;
                    if stride.is_code_point() && *position > floor && self.is_in_pair(*position) {
                        *position -= 1;
                    }
                    *position
                }
                Direction::Backward if *position + units <= floor => {
                    *position += units;
                    if stride.is_code_point() && *position < floor && self.is_in_pair(*position) {
                        *position += 1;
                    }
                    *position - 1
                }
                _ => return false,
            };
            if filter.is_none_or(|class| self.is_in(next_unit, class)) {
                return true;
            }
        }
    }

    #[inline]
    pub(super) fn scan(self, position: &mut usize, scan: &Scan, program: &Program) -> bool {
        let at = |position: usize, offset: i16| position.wrapping_add_signed(offset.into());
        let end = (self.len() + 1).saturating_sub(scan.need() as usize);
        let first = scan.first();
        while *position < end {
            let range = at(*position, first.offset)..at(end, first.offset);
            let units = self.slice(range).unwrap_or_default();
            let Some(skipped) = find(units, first.step, program) else {
                *position = end;
                return false;
            };
            *position += skipped;
            let passes = |it: &Probe| match it.step {
                Step::Unit { value, mask } => {
                    (self.unit(at(*position, it.offset))).is_some_and(|it| it | mask == value)
                }
                Step::Class(class) => self.is_in(at(*position, it.offset), program.class(class)),
            };
            let rows = |it: &RowProbe| {
                self.unit(at(*position, it.offset))
                    .map_or(0, |unit| it.rows(unit))
            };
            if scan.others().iter().all(passes)
                && scan.rows().iter().fold(u8::MAX, |all, it| all & rows(it)) != 0
            {
                return true;
            }
            *position += 1;
        }
        false
    }

    /// The position after a second occurrence of the captured text. Adds what it takes to `work`.
    pub(super) fn repeats(
        self,
        captured: Range<usize>,
        position: usize,
        direction: Direction,
        ignore_case: bool,
        program: &Program,
        work: &mut i64,
    ) -> Option<usize> {
        const COMPARED_AT_ONCE: usize = 64;
        const WORK_OF_COMPARING: i64 = 12;
        if ignore_case && program.reads_pairs() {
            return self.repeats_folded(captured, position, direction, work);
        }
        let original = self.units.get(captured)?;
        let (candidate, end) = match direction {
            Direction::Forward => {
                let end = position + original.len();
                (self.units.get(position..end)?, end)
            }
            Direction::Backward => {
                let end = position.checked_sub(original.len())?;
                (self.units.get(end..position)?, end)
            }
        };
        let canonical = |unit: &U| program.case_equivalence().canonicalize(unit.to_u32());
        let chunks = |units: &'a [U]| units.chunks(COMPARED_AT_ONCE);
        let is_equal = chunks(original).zip(chunks(candidate)).all(|(a, b)| {
            *work += WORK_OF_COMPARING;
            a == b
                || ignore_case
                    && a.iter().zip(b).all(|(a, b)| {
                        *work += WORK_OF_FOLDING;
                        a == b || canonical(a) == canonical(b)
                    })
        });
        (is_equal && !(program.reads_pairs() && self.is_in_pair(end))).then_some(end)
    }

    /// Code points that are equal can differ in length.
    fn repeats_folded(
        self,
        captured: Range<usize>,
        mut position: usize,
        direction: Direction,
        work: &mut i64,
    ) -> Option<usize> {
        let original = Subject::new(self.units.get(captured)?);
        let mut compared = match direction {
            Direction::Forward => 0,
            Direction::Backward => original.len(),
        };
        while let Some((expected, next)) = original.code_point(compared, direction) {
            *work += WORK_OF_FOLDING;
            let (c, after) = self.code_point(position, direction)?;
            let canonical = |c| IgnoreCase::CodePoints.canonicalize(c);
            if c != expected && canonical(c) != canonical(expected) {
                return None;
            }
            (compared, position) = (next, after);
        }
        Some(position)
    }
}

#[inline]
fn find<U: CodeUnit>(units: &[U], step: Step, program: &Program) -> Option<usize> {
    match step {
        Step::Unit { value, mask: 0 } => U::text(units).find_unit(value, 0),
        Step::Unit { value, mask } => units.iter().position(|it| it.to_u16() | mask == value),
        Step::Class(class) => {
            let class = program.class(class);
            units.iter().position(|&it| class.contains_unit(it))
        }
    }
}

const WORK_OF_FOLDING: i64 = 12;
