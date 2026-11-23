//! `FILETIME`: 100 ns ticks since 1601.

use bun_core::Timespec;

const TICKS_PER_SECOND: i64 = 10_000_000;
const EPOCH_DIFFERENCE_SECONDS: i64 = 11_644_473_600;

pub(crate) fn to_timespec(ticks: i64) -> Timespec {
    Timespec {
        sec: ticks.div_euclid(TICKS_PER_SECOND) - EPOCH_DIFFERENCE_SECONDS,
        nsec: ticks.rem_euclid(TICKS_PER_SECOND) * 100,
    }
}

/// `None` if the time is outside the range of `FILETIME`.
pub(crate) fn from_unix_time(sec: i64, nsec: i64) -> Option<i64> {
    sec.checked_add(EPOCH_DIFFERENCE_SECONDS)?
        .checked_mul(TICKS_PER_SECOND)?
        .checked_add(nsec.div_euclid(100))
        .filter(|&ticks| ticks >= 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_and_from_unix_time() {
        for (ticks, sec, nsec) in [
            (0, -11_644_473_600, 0),
            (116_444_735_999_999_999, -1, 999_999_900),
            (116_444_736_000_000_000, 0, 0),
            (159_394_409_010_000_001, 4_294_967_301, 100),
            (i64::MAX, 910_692_730_085, 477_580_700),
        ] {
            assert_eq!(to_timespec(ticks), Timespec { sec, nsec });
            assert_eq!(from_unix_time(sec, nsec), Some(ticks));
        }
        assert_eq!(to_timespec(i64::MIN).sec, -933_981_677_286);
        assert_eq!(from_unix_time(-11_644_473_601, 999_999_900), None);
        assert_eq!(from_unix_time(910_692_730_086, 0), None);
        assert_eq!(from_unix_time(i64::MAX, 0), None);
    }
}
