//! From characters to code units.

use smallvec::SmallVec;

use super::graph::{Graph, Id, Kind, Step, masked_units};
use crate::Error;
use crate::analysis::Next;
use crate::program::{ClassId, Direction, Width};
use crate::set::{CharRange, Latin1Set, Set, SetBuilder};
use crate::surrogate::{ASTRAL, LEADS, SURROGATES, TRAILS, lead_of, trail_of};

/// How a member of a set is stored in the subject.
#[derive(Clone, Copy)]
pub(super) enum Encoding {
    Never,
    Unit(Step),
    /// In the order of the subject.
    TwoUnits(Step, Step),
    Pair(ClassId),
    CodePoint(ClassId),
}

const BELOW_SURROGATES: CharRange = CharRange::new(0, 0xd7ff);
const ABOVE_SURROGATES: CharRange = CharRange::new(0xe000, 0xffff);

pub(crate) fn set_of(ranges: impl Iterator<Item = CharRange>) -> Result<Set, Error> {
    let mut builder = SetBuilder::default();
    for range in ranges {
        builder.add_range(range.first, range.last)?;
    }
    Ok(builder.finish(None)?)
}

/// The test that exactly the members pass, if one comparison does it.
fn masked_unit(set: &Set, max: u16) -> Option<Step> {
    const MEMBERS: u32 = 8;
    if set.latin1().len() > MEMBERS {
        let is_all = set.contains_range(CharRange::new(0, max.into()));
        return is_all.then_some(Step::Unit {
            value: max,
            mask: max,
        });
    }
    let (mut count, mut all, mut any) = (0, u32::MAX, 0);
    for range in set.ranges().take_while(|range| range.first <= max.into()) {
        let last = range.last.min(max.into());
        count += last - range.first + 1;
        if count > MEMBERS {
            return None;
        }
        for c in range.first..=last {
            all &= c;
            any |= c;
        }
    }
    (count == 1 << (all ^ any).count_ones()).then_some(Step::Unit {
        value: any as u16,
        mask: (all ^ any) as u16,
    })
}

impl Graph {
    /// Nothing if no member fits in a unit.
    pub(crate) fn step(&mut self, set: &Set) -> Result<Option<Step>, Error> {
        let max = self.width.max_unit();
        if !set.intersects_range(CharRange::new(0, max.into())) {
            return Ok(None);
        }
        Ok(Some(match masked_unit(set, max) {
            Some(step) => step,
            None => Step::Class(self.add_class(set.try_clone()?)?),
        }))
    }

    pub(super) fn set_of_units(&self, value: u16, mask: u16) -> Result<Set, Error> {
        if mask == self.width.max_unit() {
            return Ok(Set::ALL);
        }
        if let Ok(value) = u8::try_from(value) {
            let mut members = Latin1Set::EMPTY;
            masked_units(value.into(), mask).for_each(|unit| members.insert(unit as u8));
            return Ok(Set::from_latin1(members));
        }
        set_of(masked_units(value, mask).map(|unit| CharRange::single(unit.into())))
    }

    pub(crate) fn class_of_step(&mut self, step: Step) -> Result<ClassId, Error> {
        match step {
            Step::Class(class) => Ok(class),
            Step::Unit { value, mask } => self.add_class(self.set_of_units(value, mask)?),
        }
    }

    pub(super) fn encode(&mut self, set: &Set, unicode_aware: bool) -> Result<Encoding, Error> {
        let has_pairs = unicode_aware && self.width == Width::Utf16;
        if !has_pairs || !set.intersects_range(SURROGATES) && !set.intersects_range(ASTRAL) {
            return Ok(self.step(set)?.map_or(Encoding::Never, Encoding::Unit));
        }
        let is_astral = ![BELOW_SURROGATES, SURROGATES, ABOVE_SURROGATES]
            .into_iter()
            .any(|range| set.intersects_range(range));
        if is_astral && let Some((leads, trails)) = halves(set.above())? {
            let steps = (self.step(&leads)?, self.step(&trails)?);
            if let (Some(lead), Some(trail)) = steps {
                return Ok(Encoding::TwoUnits(lead, trail));
            }
        }
        let class = self.add_class(set.try_clone()?)?;
        Ok(match is_astral {
            true => Encoding::Pair(class),
            false => Encoding::CodePoint(class),
        })
    }

    /// The units that the members start with in the direction.
    pub(super) fn first_units(&self, class: ClassId, direction: Direction) -> Next {
        let mut first = *self.units_of(class);
        let above = self[class].above();
        let astral = &above[above.partition_point(|range| range.last < ASTRAL.first)..];
        match (direction, astral) {
            (_, []) => {}
            (Direction::Backward, _) => first.insert_wide(TRAILS),
            (Direction::Forward, [lowest, ..]) => {
                let highest = astral.last().unwrap_or(lowest);
                first.insert_wide(CharRange::new(
                    lead_of(lowest.first.max(ASTRAL.first)).into(),
                    lead_of(highest.last).into(),
                ));
            }
        }
        first
    }

    pub(super) fn character(
        &mut self,
        encoding: Encoding,
        direction: Direction,
    ) -> Result<Id, Error> {
        match encoding {
            Encoding::Never => Ok(Graph::FAIL),
            Encoding::Unit(step) => self.add_steps([step].into_iter()),
            Encoding::TwoUnits(lead, trail) => self.add_steps(match direction {
                Direction::Forward => [lead, trail].into_iter(),
                Direction::Backward => [trail, lead].into_iter(),
            }),
            Encoding::Pair(class) => {
                self.leaf_with_first(Kind::Pair(class), self.first_units(class, direction))
            }
            Encoding::CodePoint(class) => {
                self.leaf_with_first(Kind::CodePoint(class), self.first_units(class, direction))
            }
        }
    }
}

/// The leads and the trails, if the astral characters are all combinations of them.
fn halves(astral: &[CharRange]) -> Result<Option<(Set, Set)>, Error> {
    const RANGES: usize = 16;
    let (Some(lowest), Some(highest)) = (astral.first(), astral.last()) else {
        return Ok(None);
    };
    if astral.len() > RANGES {
        return Ok(None);
    }
    let map = |half: fn(u32) -> u16| -> SmallVec<[CharRange; 4]> {
        let ranges = astral.iter();
        ranges
            .map(|range| CharRange::new(half(range.first).into(), half(range.last).into()))
            .collect()
    };
    let lead = lead_of(lowest.first);
    if lead == lead_of(highest.last) {
        let leads = [CharRange::single(lead.into())];
        return Ok(Some((
            set_of(leads.into_iter())?,
            set_of(map(trail_of).into_iter())?,
        )));
    }
    let has_all_trails =
        |range: &CharRange| range.first & 0x3ff == 0 && range.last & 0x3ff == 0x3ff;
    if astral.iter().all(has_all_trails) {
        return Ok(Some((
            set_of(map(lead_of).into_iter())?,
            set_of([TRAILS].into_iter())?,
        )));
    }
    Ok(None)
}

/// Whether passing units that are members ends where passing code points does.
pub(crate) fn has_all_pairs_and_halves(set: &Set) -> bool {
    set.contains_range(LEADS) && set.contains_range(TRAILS) && set.contains_range(ASTRAL)
}
