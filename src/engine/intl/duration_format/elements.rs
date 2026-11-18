//! Which units PartitionDurationFormatPattern shows, and with which number.

use bun_engine_temporal::{Duration, Unit};
use smallvec::SmallVec;

use super::{Display, Units};

pub(super) enum Magnitude {
    Whole(f64),
    /// Of the unit and of those that are its fraction. Not zero.
    Nanoseconds(u128),
}

pub(super) struct Element {
    pub(super) unit: Unit,
    pub(super) magnitude: Magnitude,
    pub(super) shows_minus_sign: bool,
    /// Whether the time separator joins it to the element before.
    pub(super) is_joined: bool,
}

impl Magnitude {
    fn of(duration: &Duration, unit: Unit, has_fraction: bool) -> Magnitude {
        const EXACT_LIMIT: f64 = (1u64 << 53) as f64;

        let whole = duration.get(unit).abs();
        let is_whole = || (Unit::ALL.iter()).all(|&it| it >= unit || duration.get(it) == 0.0);
        if has_fraction && (whole > EXACT_LIMIT || !is_whole()) {
            Magnitude::Nanoseconds(duration.nanoseconds_from(unit).unsigned_abs())
        } else {
            Magnitude::Whole(whole)
        }
    }

    fn is_zero(&self) -> bool {
        matches!(self, Magnitude::Whole(0.0))
    }
}

pub(super) fn elements(units: &Units, duration: &Duration) -> SmallVec<[Element; Unit::ALL.len()]> {
    let if_shown = |unit| {
        let magnitude = Magnitude::of(duration, unit, units.has_fraction(unit));
        (!magnitude.is_zero() || units.get(unit).display == Display::Always).then_some(magnitude)
    };
    let mut elements = SmallVec::<[Element; Unit::ALL.len()]>::new();
    for unit in Unit::ALL {
        let is_joined = (elements.last()).is_some_and(|it| units.get(it.unit).style.is_numeric());
        let between_hours_and_seconds = || {
            (unit == Unit::Minute && is_joined && if_shown(Unit::Second).is_some())
                .then_some(Magnitude::Whole(0.0))
        };
        if let Some(magnitude) = if_shown(unit).or_else(between_hours_and_seconds) {
            elements.push(Element {
                unit,
                magnitude,
                shows_minus_sign: elements.is_empty() && duration.sign() < 0,
                is_joined,
            });
        }
        if units.has_fraction(unit) {
            break;
        }
    }
    elements
}
