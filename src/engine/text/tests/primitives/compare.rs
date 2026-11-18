use std::mem::MaybeUninit;

use bun_engine_text::Text;

use crate::support::*;

const LETTERS: [u16; 6] = [0x41, 0x5a, 0x61, 0x7a, 0x40, 0xe9];

#[test]
fn one_difference_anywhere() {
    let mut random = Random::new();
    for length in lengths() {
        let a = random.units(length, &LETTERS);
        each_pair(&a, &a, |x, y| {
            assert!(x == y && x.cmp(&y).is_eq() && x.eq_ignore_ascii_case(y));
            assert_eq!(x.common_prefix_len(y), length);
        });
        for at in indices(length) {
            let mut b = a.clone();
            b[at] = random.pick(&[0, 0x5b, 0xff, a[at] + 0x100, a[at] << 8]);
            each_pair(&a, &b, |x, y| {
                assert!(x != y && !x.eq_ignore_ascii_case(y), "{length} {at}");
                assert_eq!(x.cmp(&y), a.cmp(&b), "{length} {at}");
                assert_eq!(y.cmp(&x), b.cmp(&a), "{length} {at}");
                assert_eq!(x.common_prefix_len(y), at);
            });
        }
    }
}

#[test]
fn the_first_difference_decides() {
    let mut random = Random::new();
    for _ in 0..if cfg!(miri) { 100 } else { 20_000 } {
        let (p, q) = (random.below(40), random.below(40));
        let alphabet: &[u16] = random.pick(&[&[1, 2], &[0x100, 0x1, 0xff], &[0xd800, 0xffff, 0]]);
        let a = random.units(p, alphabet);
        let mut b = a[..random.below(p + 1)].to_vec();
        b.extend(random.units(q / 8, alphabet));
        each_pair(&a, &b, |x, y| {
            assert_eq!(x.cmp(&y), a.cmp(&b));
            assert_eq!(x == y, a == b);
            assert_eq!(x.starts_with(y), a.starts_with(&b));
            assert_eq!(x.ends_with(y), a.ends_with(&b));
        });
    }
}

#[test]
fn ascii_case() {
    let lower = |unit: u16| u8::try_from(unit).map_or(unit, |it| it.to_ascii_lowercase().into());
    let upper = |unit: u16| u8::try_from(unit).map_or(unit, |it| it.to_ascii_uppercase().into());
    for a in 0..0x180 {
        for b in [a, a ^ 0x20, a ^ 0x100] {
            each_pair(&[a; 17], &[b; 17], |x, y| {
                assert_eq!(x.eq_ignore_ascii_case(y), lower(a) == lower(b));
            });
        }
    }
    let mut random = Random::new();
    for length in lengths() {
        let units = random.units(length, &LETTERS);
        let lowered: Vec<u16> = units.iter().map(|&unit| lower(unit)).collect();
        let raised: Vec<u16> = units.iter().map(|&unit| upper(unit)).collect();
        each_width(&units, |text| {
            let result = text.to_ascii_lower_case().unwrap();
            assert_eq!(result.is_none(), lowered == units);
            assert!(result.is_none_or(|it| units_of(it.text()) == lowered));
            let result = text.to_ascii_upper_case().unwrap();
            assert_eq!(result.is_none(), raised == units);
            assert!(result.is_none_or(|it| units_of(it.text()) == raised));
            assert!(text.starts_with_ignore_ascii_case(Text::Utf16(&raised[..length / 2])));
        });
        for at in indices(length) {
            let mut one = vec![0x61; length];
            one[at] = 0x5a;
            each_width(&one, |text| {
                assert_eq!(
                    text.to_ascii_lower_case().unwrap().unwrap().text().at(at),
                    0x7a
                );
            });
        }
    }
}

#[test]
fn ranges_of_units() {
    for length in lengths() {
        each_width(&vec![0x7f; length], |text| {
            assert!(text.is_ascii() && text.fits_latin1());
            assert_eq!(
                (text.find_non_ascii(), text.find_non_latin1()),
                (None, None)
            );
        });
        for at in indices(length) {
            for unit in [0x80, 0xff, 0x100, 0x8000] {
                let mut units = vec![0x7f; length];
                units[at] = unit;
                units[length - 1] |= unit;
                each_width(&units, |text| {
                    assert!(!text.is_ascii());
                    assert_eq!(text.find_non_ascii(), Some(at));
                    assert_eq!(text.fits_latin1(), unit <= 0xff);
                    assert_eq!(text.find_non_latin1(), (unit > 0xff).then_some(at));
                });
            }
        }
    }
}

#[test]
fn copies_fill_their_target_and_nothing_else() {
    fn check<T: bun_engine_text::CodeUnit>(text: Text<'_>) {
        let mut buffer = vec![MaybeUninit::new(T::from(0xee)); text.len() + 2];
        text.copy_to(&mut buffer[1..=text.len()]);
        // SAFETY: made initialized.
        let buffer = unsafe { buffer.assume_init_ref() };
        let expected = text.code_units().map(T::from_u16_truncating);
        assert!(buffer[1..=text.len()].iter().copied().eq(expected));
        assert!(buffer[0].is(0xee) && buffer[text.len() + 1].is(0xee));
    }
    for length in lengths() {
        for step in [1, 0x101] {
            let units: Vec<u16> = (0..length).map(|at| (at % 200 * step) as u16).collect();
            each_width(&units, |text| {
                check::<u8>(text);
                check::<u16>(text);
            });
        }
    }
}
