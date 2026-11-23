//! What few inputs get to by the filters.

use super::*;

fn check_two_way<T: Unsigned + Readable<T>>(hay: &[T], needle: &[T], skipped: usize) {
    let Some(spare) = hay.len().checked_sub(needle.len() + skipped) else {
        return;
    };
    let matches = |&at: &usize| hay[at..].starts_with(needle);
    let expected = [
        (skipped..=skipped + spare).find(matches),
        (0..=spare).rfind(matches),
    ];
    let both = [
        two_way::<T, T, true>(hay, needle, skipped),
        two_way::<T, T, false>(hay, needle, spare),
    ];
    assert_eq!(both.map(found), expected, "{needle:?} in {hay:?}");
}

/// All texts of so many letters, the shortest first.
fn text(mut code: usize, letters: usize) -> Vec<u8> {
    let mut text = Vec::new();
    while code > 0 {
        text.push(b'a' + ((code - 1) % letters) as u8);
        code = (code - 1) / letters;
    }
    text
}

#[test]
fn two_way_finds_all_short_needles() {
    for (letters, needles, hays) in [(2, 255, 4095), (3, 364, 3280)] {
        let hays: Vec<_> = (1..hays).map(|it| text(it, letters)).collect();
        for needle in 1..needles {
            let needle = text(needle, letters);
            for (i, hay) in hays.iter().enumerate() {
                check_two_way(hay, &needle, i % 2);
                check_two_way(&[hay, &needle[..], hay].concat(), &needle, 0);
            }
        }
    }
}

#[test]
fn two_way_skips_up_to_the_nearest_candidate() {
    for needle in [&b"b"[..], b"ab", b"ba", b"aabaa", b"bcb", b"abab"] {
        for len in 0..70 {
            for code in 0..len * len {
                let mut hay = vec![b'a'; len + needle.len()];
                hay[code % len] = b'b';
                check_two_way(&hay, needle, 0);
                hay[code / len..][..needle.len()].copy_from_slice(needle);
                check_two_way(&hay, needle, 0);
                let wide = |it: &[u8]| it.iter().map(|&it| u16::from(it) << 8).collect::<Vec<_>>();
                check_two_way(&wide(&hay), &wide(needle), 0);
            }
        }
    }
}

#[test]
fn each_difference_is_found() {
    fn check<T: Unsigned + Readable<T>>() {
        for len in 1..140 {
            let needle: Vec<T> = (0..len).map(T::from).collect();
            let mut hay = [&[T::from(9)], &needle[..], &[T::ZERO]].concat();
            assert!(is_at::baseline::<T, T>(&hay, &needle, 1));
            for at in 0..needle.len() {
                hay[1 + at] = T::from(200);
                assert!(!is_at::baseline::<T, T>(&hay, &needle, 1));
                hay[1 + at] = needle[at];
            }
        }
    }
    check::<u8>();
    check::<u16>();
}

#[test]
fn the_time_is_linear() {
    for period in [&b"a"[..], b"ab"] {
        let (needle, mut hay) = (period.repeat(1 << 19), period.repeat(1 << 22));
        hay.iter_mut().step_by(needle.len()).for_each(|it| *it = 0);
        assert_eq!([memmem, memrmem].map(|f| f(&hay, &needle)), [None; 2]);
    }
    let (hay, len) = (vec![b'a'; 1 << 21], 1 << 19);
    for at in [0, len - 1] {
        let mut needle = vec![b'a'; len];
        needle[at] = b'b';
        let last = hay.len() - len;
        assert_eq!(two_way::<u8, _, true>(&hay, &needle, 0), NOT_FOUND);
        assert_eq!(two_way::<u8, _, false>(&hay, &needle, last), NOT_FOUND);
    }
}
