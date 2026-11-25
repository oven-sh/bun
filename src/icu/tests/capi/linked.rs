//! Reads Bun's data, of which some are expanded when they are first read.
#![cfg(not(any(target_os = "macos", bun_system_icu)))]

mod calls;

use std::ffi::{CStr, c_char};
use std::fmt::Debug;
use std::ptr::null_mut;

use bun_icu as _;
#[cfg(not(miri))]
use bun_sema_standalone as _;
use calls::*;

declare! {
    ubrk_close(Handle);
    ubrk_next(Handle) -> i32;
    ubrk_open(i32, *const c_char, *const u16, i32, *mut Status) -> Handle;
    ucal_close(Handle);
    ucal_get(Handle, i32, *mut Status) -> i32;
    ucal_open(*const u16, i32, *const c_char, i32, *mut Status) -> Handle;
    ucal_setMillis(Handle, f64, *mut Status);
    ucol_close(Handle);
    ucol_open(*const c_char, *mut Status) -> Handle;
    ucol_strcollUTF8(Handle, *const u8, i32, *const u8, i32, *mut Status) -> i32;
    udat_close(Handle);
    udat_format(Handle, f64, *mut u16, i32, Handle, *mut Status) -> i32;
    udat_open(i32, i32, *const c_char, *const u16, i32, *const u16, i32, *mut Status) -> Handle;
    uldn_close(Handle);
    uldn_localeDisplayName(Handle, *const c_char, *mut u16, i32, *mut Status) -> i32;
    uldn_openForContext(*const c_char, *const i32, i32, *mut Status) -> Handle;
    uloc_setDefault(*const c_char, *mut Status);
    unumf_close(Handle);
    unumf_closeResult(Handle);
    unumf_formatDouble(Handle, f64, Handle, *mut Status);
    unumf_openForSkeletonAndLocale(*const u16, i32, *const c_char, *mut Status) -> Handle;
    unumf_openResult(*mut Status) -> Handle;
    unumf_resultToString(Handle, *mut u16, i32, *mut Status) -> i32;
}

#[repr(C, align(16))]
struct Package<T>(T);

#[unsafe(export_name = "bun_icu_package")]
static mut PACKAGE: Package<[u8; include_bytes!("../../data/package.bin").len()]> =
    Package(*include_bytes!("../../data/package.bin"));

fn set_up() {
    // SAFETY: the argument is a C string.
    call(|status| unsafe { uloc_setDefault(c"en_US".as_ptr(), status) }).unwrap();
}

/// Refuses each allocation of the first run alone, and with all that follow. That takes a process each, which runs `test`.
#[expect(clippy::disallowed_methods, clippy::disallowed_types)]
fn check<T: PartialEq<E> + Debug, E: Debug>(test: &str, expected: E, run: impl Fn() -> Result<T>) {
    use std::{env, process};
    const NOT_REFUSED: i32 = 99;
    set_up();
    let number = |name| Some(env::var(name).ok()?.parse::<usize>().unwrap());
    if let (Some(grants), Some(refusals)) = (number("GRANTS"), number("REFUSALS")) {
        let was_refused = refuses(grants, refusals, &expected, &run);
        assert_eq!(run().unwrap(), expected);
        process::exit(if was_refused { 0 } else { NOT_REFUSED });
    }
    assert_eq!(run().unwrap(), expected);
    for refusals in [1, usize::MAX].into_iter().filter(|_| !cfg!(miri)) {
        for grants in 0.. {
            let again = process::Command::new(env::current_exe().unwrap())
                .args(["--exact", test])
                .env("GRANTS", grants.to_string())
                .env("REFUSALS", refusals.to_string())
                .output()
                .unwrap();
            match again.status.code() {
                Some(0) => {}
                Some(NOT_REFUSED) => break,
                _ => panic!("{grants} {refusals} {again:?}"),
            }
        }
    }
}

fn formatted(locale: &CStr, skeleton: &str, number: f64) -> Result<String> {
    let (skeleton, length) = utf16(skeleton);
    // SAFETY: here and below, the arguments are what the header asks for.
    unsafe {
        let format = open(unumf_close, |status| {
            unumf_openForSkeletonAndLocale(skeleton.as_ptr(), length, locale.as_ptr(), status)
        })?;
        let result = open(unumf_closeResult, |status| unumf_openResult(status))?;
        call(|status| unumf_formatDouble(format.0, number, result.0, status))?;
        text(|to, room, status| unumf_resultToString(result.0, to, room, status))
    }
}

fn order(locale: &CStr, pairs: &[(&str, &str)]) -> Result<Vec<i32>> {
    // SAFETY: as above.
    unsafe {
        let collator = open(ucol_close, |status| ucol_open(locale.as_ptr(), status))?;
        let compare = |&(a, b): &(&str, &str)| {
            let [(a, a_length), (b, b_length)] = [a, b].map(|it| (it.as_ptr(), it.len() as i32));
            call(|status| ucol_strcollUTF8(collator.0, a, a_length, b, b_length, status))
        };
        pairs.iter().map(compare).collect()
    }
}

#[test]
#[cfg_attr(miri, ignore = "takes minutes to interpret")]
fn numbers() {
    let expected = ["2 franci elvețieni", "2 Liter pro Tag"];
    check("numbers", expected, || {
        Ok([
            formatted(c"ro_MD", "currency/CHF unit-width-full-name .", 2.0)?,
            formatted(c"de_AT", "unit/liter-per-day unit-width-full-name", 2.0)?,
        ])
    });
}

#[test]
#[cfg_attr(miri, ignore = "reads the clock, which isolation forbids")]
fn dates() {
    const PATTERN: i32 = -2;
    let [zone, pattern] =
        ["America/Lima\0", "Gy年M月d日EEEE H時mm分ss秒 zzzz\0"].map(|it| utf16(it).0);
    let expected = "令和元年5月1日水曜日 7時00分00秒 ペルー標準時";
    // SAFETY: as above.
    check("dates", expected, || unsafe {
        let locale = c"ja@calendar=japanese".as_ptr();
        let format = open(udat_close, |status| {
            udat_open(
                PATTERN,
                PATTERN,
                locale,
                zone.as_ptr(),
                -1,
                pattern.as_ptr(),
                -1,
                status,
            )
        })?;
        let date = 1_556_712_000_000.0;
        text(|to, room, status| udat_format(format.0, date, to, room, null_mut(), status))
    });
}

#[test]
#[cfg_attr(miri, ignore = "reads the clock, which isolation forbids")]
fn zones() {
    const ZONE_OFFSET: i32 = 15;
    let (zone, length) = utf16("Europe/London");
    // SAFETY: as above.
    check("zones", 3_600_000, || unsafe {
        let calendar = open(ucal_close, |status| {
            ucal_open(zone.as_ptr(), length, c"en".as_ptr(), 0, status)
        })?;
        call(|status| ucal_setMillis(calendar.0, 0.0, status))?;
        call(|status| ucal_get(calendar.0, ZONE_OFFSET, status))
    });
}

#[test]
fn names() {
    let contexts = [0x001, 0x104, 0x200, 0x301];
    // SAFETY: as above.
    check("names", "Srpski (latinica, Crna Gora)", || unsafe {
        let names = open(uldn_close, |status| {
            uldn_openForContext(c"hr".as_ptr(), contexts.as_ptr(), 4, status)
        })?;
        let locale = c"sr_Latn_ME".as_ptr();
        text(|to, room, status| uldn_localeDisplayName(names.0, locale, to, room, status))
    });
}

const PAIRS: [(&str, &str); 5] = [
    ("ä", "z"),
    ("中", "文"),
    ("𠀀", "𠀁"),
    ("я", "α"),
    ("가", "か"),
];

#[test]
#[cfg_attr(miri, ignore = "takes minutes to interpret")]
fn collation() {
    let expected = [[1, -1, -1, 1, -1], [-1, 1, -1, 1, -1]];
    check("collation", expected, || {
        Ok([order(c"sv", &PAIRS)?, order(c"zh", &PAIRS)?])
    });
}

#[test]
#[cfg_attr(miri, ignore = "takes minutes to interpret")]
fn segments() {
    const WORD: i32 = 1;
    const SENTENCE: i32 = 3;
    let breaks = |kind, locale: &CStr, text: &str| -> Result<Vec<i32>> {
        let (text, length) = utf16(text);
        // SAFETY: as above. The text outlives the iterator.
        unsafe {
            let iterator = open(ubrk_close, |status| {
                ubrk_open(kind, locale.as_ptr(), text.as_ptr(), length, status)
            })?;
            let next = || with_status(|_| ubrk_next(iterator.0)).0;
            Ok(Vec::from_iter(
                std::iter::repeat_with(next).take_while(|&it| it >= 0),
            ))
        }
    };
    let expected = [&[2, 3, 5, 7, 11, 14][..], &[3, 5]];
    check("segments", expected, || {
        let found = [
            breaks(WORD, c"ja", "今日は良い天気ภาษาไทย")?,
            breaks(SENTENCE, c"el", "α; Β.")?,
        ];
        // `ubrk_next` has no status. It finds fewer breaks.
        (found == expected)
            .then_some(found)
            .ok_or(MEMORY_ALLOCATION)
    });
}

#[test]
#[cfg_attr(miri, ignore = "takes minutes to interpret")]
fn threads_that_read_the_same_data_first() {
    set_up();
    std::thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| {
                assert_eq!(order(c"ko", &PAIRS).unwrap(), [-1, 1, -1, 1, -1]);
                assert_eq!(
                    formatted(c"fi", "currency/SEK .00", 2.0).unwrap(),
                    "2,00\u{a0}SEK"
                );
            });
        }
    });
}
