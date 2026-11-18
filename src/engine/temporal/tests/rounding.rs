mod support;

use bun_engine_temporal::DifferenceOperation::{Since, Until};
use bun_engine_temporal::RoundingMode::{Ceil, Expand, Floor, HalfEven, HalfExpand, Trunc};
use bun_engine_temporal::{
    DifferenceOptions, DurationRoundOptions, Error, Instant, OptionValue, PartialDuration,
    RelativeTo, RoundOptions, RoundingIncrement, RoundingMode, Unit, UnitOption,
};
use support::*;

fn round_to(unit: Unit, increment: u32, rounding_mode: RoundingMode) -> RoundOptions {
    RoundOptions {
        rounding_increment: RoundingIncrement::new(increment.into()).unwrap(),
        rounding_mode,
        smallest_unit: Some(UnitOption::Unit(unit)),
    }
}

#[test]
fn modes() {
    let values = [-25, -16, -15, -14, -10, 14, 15, 16, 25];
    for (mode, signed, as_if_positive) in [
        (
            "ceil",
            [-2, -1, -1, -1, -1, 2, 2, 2, 3],
            [-2, -1, -1, -1, -1, 2, 2, 2, 3],
        ),
        (
            "floor",
            [-3, -2, -2, -2, -1, 1, 1, 1, 2],
            [-3, -2, -2, -2, -1, 1, 1, 1, 2],
        ),
        (
            "expand",
            [-3, -2, -2, -2, -1, 2, 2, 2, 3],
            [-2, -1, -1, -1, -1, 2, 2, 2, 3],
        ),
        (
            "trunc",
            [-2, -1, -1, -1, -1, 1, 1, 1, 2],
            [-3, -2, -2, -2, -1, 1, 1, 1, 2],
        ),
        (
            "halfCeil",
            [-2, -2, -1, -1, -1, 1, 2, 2, 3],
            [-2, -2, -1, -1, -1, 1, 2, 2, 3],
        ),
        (
            "halfFloor",
            [-3, -2, -2, -1, -1, 1, 1, 2, 2],
            [-3, -2, -2, -1, -1, 1, 1, 2, 2],
        ),
        (
            "halfExpand",
            [-3, -2, -2, -1, -1, 1, 2, 2, 3],
            [-2, -2, -1, -1, -1, 1, 2, 2, 3],
        ),
        (
            "halfTrunc",
            [-2, -2, -1, -1, -1, 1, 1, 2, 2],
            [-3, -2, -2, -1, -1, 1, 1, 2, 2],
        ),
        (
            "halfEven",
            [-2, -2, -2, -1, -1, 1, 2, 2, 2],
            [-2, -2, -2, -1, -1, 1, 2, 2, 2],
        ),
    ] {
        let mode = RoundingMode::parse(text(mode)).unwrap();
        let epoch = Instant::new(0).unwrap();
        for (index, value) in values.into_iter().enumerate() {
            let value = Instant::new(value).unwrap();
            let options = rounded(Unit::Nanosecond, Unit::Nanosecond, 10, mode);
            for difference in [
                epoch.difference(Until, value, options),
                value.difference(Since, epoch, options),
            ] {
                let nanoseconds = difference.unwrap().get(Unit::Nanosecond);
                assert_eq!(nanoseconds, f64::from(signed[index] * 10));
            }
            let rounded = value.round(round_to(Unit::Nanosecond, 10, mode)).unwrap();
            assert_eq!(rounded.epoch_nanoseconds(), as_if_positive[index] * 10);
        }
    }
}

#[test]
fn ties_count_from_the_next_larger_unit() {
    let options = round_to(Unit::Minute, 20, HalfEven);
    assert_eq!(time("01:10").round(options), Ok(time("01:00")));
    assert_eq!(time("01:30").round(options), Ok(time("01:40")));
    assert_eq!(time("23:50").round(options), Ok(time("23:40")));
    let day = round_to(Unit::Hour, 24, HalfEven);
    assert_eq!(
        instant("1970-01-02T12:00Z").round(day),
        Ok(instant("1970-01-03T00:00Z"))
    );
    assert_eq!(
        instant("1969-12-30T12:00Z").round(day),
        Ok(instant("1969-12-30T00:00Z"))
    );
}

#[test]
fn increments_and_units_are_checked() {
    for (number, error) in [
        (f64::NAN, Error::IncrementIsNaN),
        (f64::INFINITY, Error::IncrementNotFinite),
        (0.9, Error::IncrementOutOfRange),
        (1e9 + 1.0, Error::IncrementOutOfRange),
    ] {
        assert_eq!(RoundingIncrement::new(number), Err(error));
    }
    let noon = date_time("2020-01-01T12:00");
    assert_eq!(
        noon.round(round_to(Unit::Hour, 24, Trunc)),
        Err(Error::IncrementAboveMaximum)
    );
    assert_eq!(
        noon.round(round_to(Unit::Hour, 5, Trunc)),
        Err(Error::IncrementDoesNotDivide)
    );
    assert_eq!(
        noon.round(round_to(Unit::Day, 2, Trunc)),
        Err(Error::IncrementAboveMaximum)
    );
    assert_eq!(
        noon.round(round_to(Unit::Week, 1, Trunc)),
        Err(Error::DisallowedSmallestUnit)
    );
    assert_eq!(
        noon.round(RoundOptions::default()),
        Err(Error::MissingSmallestUnit)
    );
    let inverted = rounded(Unit::Hour, Unit::Day, 1, Trunc);
    assert_eq!(
        noon.difference(Until, noon, inverted),
        Err(Error::SmallestUnitAboveLargest)
    );
    let auto = DifferenceOptions {
        smallest_unit: Some(UnitOption::Auto),
        ..DifferenceOptions::default()
    };
    assert_eq!(
        noon.difference(Until, noon, auto),
        Err(Error::SmallestUnitIsAuto)
    );
    for unit in Unit::ALL {
        assert_eq!(Unit::find(text(unit.singular())), Some(unit));
    }
    for (unit, plural) in PartialDuration::PROPERTIES {
        assert_eq!(Unit::find(plural.text()), Some(unit));
    }
}

#[test]
fn relative_to_a_date() {
    for (amount, start, largest_unit, unit, increment, mode, expected) in [
        (
            "P45D",
            "2020-01-01",
            Unit::Month,
            Unit::Month,
            1,
            HalfExpand,
            "P1M",
        ),
        (
            "P46D",
            "2020-01-01",
            Unit::Month,
            Unit::Month,
            1,
            HalfExpand,
            "P2M",
        ),
        (
            "-P46D",
            "2020-01-01",
            Unit::Month,
            Unit::Month,
            1,
            HalfExpand,
            "-P2M",
        ),
        (
            "P11M30DT23H",
            "2020-01-01",
            Unit::Year,
            Unit::Day,
            1,
            Ceil,
            "P1Y",
        ),
        (
            "P1MT1H",
            "2020-01-31",
            Unit::Month,
            Unit::Month,
            1,
            Expand,
            "P2M",
        ),
        (
            "P20D",
            "2020-01-01",
            Unit::Week,
            Unit::Week,
            2,
            Floor,
            "P2W",
        ),
        (
            "P1Y",
            "2020-01-01",
            Unit::Hour,
            Unit::Hour,
            1,
            Trunc,
            "PT8784H",
        ),
        (
            "PT11H30M",
            "2024-03-10[America/New_York]",
            Unit::Day,
            Unit::Day,
            1,
            HalfExpand,
            "P1D",
        ),
        (
            "PT22H31M",
            "2024-03-10[America/New_York]",
            Unit::Day,
            Unit::Hour,
            1,
            HalfExpand,
            "P1D",
        ),
        (
            "PT24H",
            "2024-11-03[America/New_York]",
            Unit::Day,
            Unit::Hour,
            1,
            Trunc,
            "PT24H",
        ),
        (
            "P1Y",
            "2023-09-16[u-ca=hebrew]",
            Unit::Month,
            Unit::Month,
            1,
            Trunc,
            "P13M",
        ),
    ] {
        let options = DurationRoundOptions {
            largest_unit: Some(UnitOption::Unit(largest_unit)),
            relative_to: Some(RelativeTo::parse(text(start)).unwrap()),
            rounding: round_to(unit, increment, mode),
        };
        assert_eq!(
            duration(amount).round(&options),
            Ok(duration(expected)),
            "{amount}"
        );
    }
}

#[test]
fn totals_are_the_nearest_double() {
    for (amount, unit, start, expected) in [
        ("PT36H", Unit::Day, None, 1.5),
        ("PT816H2049187.49766S", Unit::Hour, None, 1_385.218_749_35),
        (
            "PT9007199254740991.999999999S",
            Unit::Second,
            None,
            9_007_199_254_740_992.0,
        ),
        (
            "PT9007199254740990.500000001S",
            Unit::Second,
            None,
            9_007_199_254_740_991.0,
        ),
        (
            "PT9007199254740990.5S",
            Unit::Second,
            None,
            9_007_199_254_740_990.0,
        ),
        ("-PT0.000000001S", Unit::Day, None, -1.0 / 86_400e9),
        ("P45D", Unit::Month, Some("2020-01-01"), 43.0 / 29.0),
        (
            "-P51Y",
            Unit::Month,
            Some("1889-04-21[u-ca=ethiopic]"),
            -663.0,
        ),
        (
            "PT11H30M",
            Unit::Day,
            Some("2024-03-10[America/New_York]"),
            0.5,
        ),
        ("P200000Y", Unit::Year, Some("2000-01-01"), 200_000.0),
    ] {
        let start = start.map(|it| RelativeTo::parse(text(it)).unwrap());
        assert_eq!(
            duration(amount).total(unit, start.as_ref()),
            Ok(expected),
            "{amount}"
        );
    }
    assert_eq!(
        duration("P1D").total(Unit::Week, None),
        Err(Error::TotalOfCalendarUnits)
    );
}
