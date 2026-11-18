use bun_engine_date::{make_date, make_day, make_full_year, make_time, time_clip};
use bun_engine_standalone as _;

fn utc([year, month, day, hour, minute, second, millisecond]: [f64; 7]) -> f64 {
    time_clip(make_date(
        make_day(make_full_year(year), month, day),
        make_time(hour, minute, second, millisecond),
    ))
}

#[test]
fn components() {
    for (components, expected) in [
        ([1970.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0], 0.0),
        ([70.9, 0.9, 1.9, 0.9, 0.9, 0.9, 0.9], 0.0),
        (
            [-0.9, -0.9, 1.0, -0.9, -0.9, -0.9, -0.9],
            -2_208_988_800_000.0,
        ),
        ([100.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0], -59_011_459_200_000.0),
        (
            [2017.0, -1.0, 32.0, -1.0, 60.0, 0.0, 0.0],
            1_483_228_800_000.0,
        ),
        ([275_760.0, 8.0, 13.0, 0.0, 0.0, 0.0, 0.0], 8.64e15),
        ([-271_821.0, 3.0, 20.0, 0.0, 0.0, 0.0, 0.0], -8.64e15),
        ([1e9, 12.0 * (1970.0 - 1e9), 1.0, 0.0, 0.0, 0.0, 0.0], 0.0),
        ([401_970.0, 0.0, -146_096_999.0, 0.0, 0.0, 0.0, 0.0], 0.0),
        (
            [
                1970.0,
                0.0,
                1.0,
                80_063_993_375.0,
                29.0,
                1.0,
                -288_230_376_151_711_740.0,
            ],
            29_312.0,
        ),
        (
            [
                1970.0,
                0.0,
                213_503_982_336.0,
                0.0,
                0.0,
                0.0,
                -18_446_744_073_709_552_000.0,
            ],
            34_447_360.0,
        ),
    ] {
        assert_eq!(utc(components), expected);
    }
}

#[test]
fn components_out_of_range() {
    let epoch = [1970.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    for index in 0..7 {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX, -1e17] {
            let mut components = epoch;
            components[index] = value;
            assert!(utc(components).is_nan());
        }
    }
    assert!(utc([275_760.0, 8.0, 13.0, 0.0, 0.0, 0.0, 1.0]).is_nan());
    assert!(utc([-271_821.0, 3.0, 20.0, 0.0, 0.0, 0.0, -1.0]).is_nan());
    assert!(make_day(f64::MAX, f64::MAX, 1.0).is_nan());
    assert!(make_day(2_147_483_648.0, 0.0, 1.0).is_nan());
}

#[test]
fn clipping() {
    assert_eq!(time_clip(-0.0).to_bits(), 0);
    assert_eq!(time_clip(-0.9).to_bits(), 0);
    assert_eq!(time_clip(-1.9), -1.0);
    assert!(time_clip(8.64e15 + 1.0).is_nan());
}
