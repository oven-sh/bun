use bun_engine_date::{
    CivilDate, civil_from_days, day_of_year, days_from_civil, days_in_month, days_in_year,
    is_leap_year, week_day,
};
use bun_engine_standalone as _;

fn date(year: i32, month: u8, day: u8) -> CivilDate {
    CivilDate { year, month, day }
}

#[test]
fn known_days() {
    for (days, expected, expected_week_day) in [
        (0, date(1970, 1, 1), 4),
        (-1, date(1969, 12, 31), 3),
        (11_016, date(2000, 2, 29), 2),
        (-25_508, date(1900, 3, 1), 4),
        (-719_528, date(0, 1, 1), 6),
        (100_000_000, date(275_760, 9, 13), 6),
        (-100_000_000, date(-271_821, 4, 20), 2),
        (i32::MAX, date(5_881_580, 7, 11), 5),
        (i32::MIN, date(-5_877_641, 6, 23), 2),
    ] {
        assert_eq!(civil_from_days(days), expected);
        assert_eq!(
            days_from_civil(expected.year, expected.month, expected.day),
            i64::from(days)
        );
        assert_eq!(week_day(days), expected_week_day);
    }
    assert_eq!(days_from_civil(i32::MAX, 12, 31), 784_351_576_776);
    assert_eq!(days_from_civil(i32::MIN, 1, 1), -784_353_015_833);
}

#[test]
fn days_follow_each_other_through_an_era() {
    for first_year in [-5_000_000, -271_900, -200, 1800, 275_500, 5_000_000] {
        let mut days = days_from_civil(first_year, 1, 1) as i32;
        for year in first_year..first_year + 400 {
            let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
            assert_eq!(is_leap_year(year), is_leap);
            let mut ordinal = 0;
            for month in 1..=12 {
                for day in 1..=days_in_month(year, month) {
                    ordinal += 1;
                    assert_eq!(civil_from_days(days), date(year, month, day));
                    assert_eq!(days_from_civil(year, month, day), i64::from(days));
                    assert_eq!(day_of_year(date(year, month, day)), ordinal);
                    assert_eq!(i32::from(week_day(days)), (days + 4).rem_euclid(7));
                    days += 1;
                }
            }
            assert_eq!(ordinal, 365 + u16::from(is_leap));
            assert_eq!(days_in_year(year), ordinal);
        }
    }
}
