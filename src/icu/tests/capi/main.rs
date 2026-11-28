//! Calls the exported functions as C++ does: with buffers that are not initialized, and with pointers that it keeps.
#![cfg(not(any(target_os = "macos", bun_system_icu)))]

mod package;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::ffi::{CStr, c_char, c_void};
use std::fmt::Debug;
use std::ptr::{null, null_mut};

use bun_icu as _;
#[cfg(not(miri))]
use bun_sema_standalone as _;

type Handle = *mut c_void;
type Status = i32;
type Result<T> = std::result::Result<T, Status>;

const ILLEGAL_ARGUMENT: Status = 1;
const MISSING_RESOURCE: Status = 2;
const MEMORY_ALLOCATION: Status = 7;
const UNSUPPORTED: Status = 16;
const BUFFER_OVERFLOW: Status = 15;
const NOT_TERMINATED: Status = -124;

macro_rules! declare {
    ($($name:ident($($parameter:ty),*) $(-> $result:ty)?;)+) => {
        unsafe extern "C" {$(
            #[link_name = concat!(stringify!($name), "_79")]
            fn $name($(_: $parameter),*) $(-> $result)?;
        )+}
    };
}
declare! {
    u_strToLower(*mut u16, i32, *const u16, i32, *const c_char, *mut Status) -> i32;
    u_strToUpper(*mut u16, i32, *const u16, i32, *const c_char, *mut Status) -> i32;
    ubrk_open(i32, *const c_char, *const u16, i32, *mut Status) -> Handle;
    ucal_add(Handle, i32, i32, *mut Status);
    ucal_clear(Handle);
    ucal_clone(Handle, *mut Status) -> Handle;
    ucal_close(Handle);
    ucal_get(Handle, i32, *mut Status) -> i32;
    ucal_getMillis(Handle, *mut Status) -> f64;
    ucal_open(*const u16, i32, *const c_char, i32, *mut Status) -> Handle;
    ucal_set(Handle, i32, i32);
    ucal_setMillis(Handle, f64, *mut Status);
    ucfpos_close(Handle);
    ucfpos_constrainField(Handle, i32, i32, *mut Status);
    ucfpos_getIndexes(Handle, *mut i32, *mut i32, *mut Status);
    ucfpos_open(*mut Status) -> Handle;
    ucol_open(*const c_char, *mut Status) -> Handle;
    uenum_close(Handle);
    uenum_next(Handle, *mut i32, *mut Status) -> *const c_char;
    ufieldpositer_close(Handle);
    ufieldpositer_next(Handle, *mut i32, *mut i32) -> i32;
    ufieldpositer_open(*mut Status) -> Handle;
    ufmtval_getString(Handle, *mut i32, *mut Status) -> *const u16;
    ufmtval_nextPosition(Handle, Handle, *mut Status) -> i8;
    ulistfmt_close(Handle);
    ulistfmt_closeResult(Handle);
    ulistfmt_format(Handle, *const *const u16, *const i32, i32, *mut u16, i32, *mut Status) -> i32;
    ulistfmt_formatStringsToResult(Handle, *const *const u16, *const i32, i32, Handle, *mut Status);
    ulistfmt_openForType(*const c_char, i32, i32, *mut Status) -> Handle;
    ulistfmt_openResult(*mut Status) -> Handle;
    ulistfmt_resultAsValue(Handle, *mut Status) -> Handle;
    uloc_canonicalize(*const c_char, *mut u8, i32, *mut Status) -> i32;
    uloc_countAvailable() -> i32;
    uloc_getAvailable(i32) -> *const c_char;
    uloc_getDefault() -> *const c_char;
    uloc_openKeywords(*const c_char, *mut Status) -> Handle;
    uloc_setDefault(*const c_char, *mut Status);
    uloc_toLanguageTag(*const c_char, *mut u8, i32, i8, *mut Status) -> i32;
    uloc_setKeywordValue(*const c_char, *const c_char, *mut u8, i32, *mut Status) -> i32;
    unorm2_getNFCInstance(*mut Status) -> Handle;
    unorm2_getNFDInstance(*mut Status) -> Handle;
    unorm2_getNFKCInstance(*mut Status) -> Handle;
    unorm2_normalize(Handle, *const u16, i32, *mut u16, i32, *mut Status) -> i32;
    unumf_close(Handle);
    unumf_closeResult(Handle);
    unumf_formatDecimal(Handle, *const c_char, i32, Handle, *mut Status);
    unumf_formatDouble(Handle, f64, Handle, *mut Status);
    unumf_openForSkeletonAndLocale(*const u16, i32, *const c_char, *mut Status) -> Handle;
    unumf_openResult(*mut Status) -> Handle;
    unumf_resultGetAllFieldPositions(Handle, Handle, *mut Status);
    unumf_resultToString(Handle, *mut u16, i32, *mut Status) -> i32;
    uplrules_close(Handle);
    uplrules_getKeywords(Handle, *mut Status) -> Handle;
    uplrules_openForType(*const c_char, i32, *mut Status) -> Handle;
    uplrules_selectFormatted(Handle, Handle, *mut u16, i32, *mut Status) -> i32;
    ures_close(Handle);
    ures_getByKey(Handle, *const c_char, Handle, *mut Status) -> Handle;
    ures_getStringByKey(Handle, *const c_char, *mut i32, *mut Status) -> *const u16;
    ures_open(*const c_char, *const c_char, *mut Status) -> Handle;
}

thread_local! {
    /// How many allocations are granted, and how many are refused after them.
    static GRANTS: Cell<Option<(usize, usize)>> = const { Cell::new(None) };
    static IS_IN_CALL: Cell<bool> = const { Cell::new(false) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        match GRANTS.get().filter(|_| IS_IN_CALL.get()) {
            Some((0, refusals)) => {
                GRANTS.set((refusals > 1).then_some((0, refusals - 1)));
                return null_mut();
            }
            Some((grants, refusals)) => GRANTS.set(Some((grants - 1, refusals))),
            None => {}
        }
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

fn with_status<T>(function: impl FnOnce(*mut Status) -> T) -> (T, Status) {
    let mut status = 0;
    IS_IN_CALL.set(true);
    let result = function(&raw mut status);
    IS_IN_CALL.set(false);
    (result, status)
}

fn call<T>(function: impl FnOnce(*mut Status) -> T) -> Result<T> {
    let (result, status) = with_status(function);
    if status > 0 { Err(status) } else { Ok(result) }
}

/// Closes the handle when it is dropped.
struct Open(Handle, unsafe extern "C" fn(Handle));

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: `open` has paired them.
        unsafe { self.1(self.0) }
    }
}

fn open(
    close: unsafe extern "C" fn(Handle),
    function: impl FnOnce(*mut Status) -> Handle,
) -> Result<Open> {
    let (handle, status) = with_status(function);
    let handle = Open(handle, close);
    if status > 0 { Err(status) } else { Ok(handle) }
}

/// Calls `function` with no buffer, and with each capacity up to one that holds the NUL.
fn written<T: Copy + Default + PartialEq + Debug>(
    function: impl Fn(*mut T, i32, *mut Status) -> i32,
) -> Result<Vec<T>> {
    let (length, status) = with_status(|status| function(null_mut(), 0, status));
    if status > 0 && status != BUFFER_OVERFLOW {
        return Err(status);
    }
    let mut last = Vec::new();
    for capacity in [0, length / 2, length, length + 1] {
        let mut buffer = Vec::with_capacity(capacity as usize);
        let (result, status) =
            with_status(|status| function(buffer.as_mut_ptr(), capacity, status));
        match status {
            MEMORY_ALLOCATION => return Err(status),
            BUFFER_OVERFLOW => assert!(capacity < length),
            _ => {
                assert_eq!(
                    status,
                    if capacity == length {
                        NOT_TERMINATED
                    } else {
                        0
                    },
                    "{capacity} {length}"
                );
                // SAFETY: success means that the text is there, and the NUL if there is room.
                unsafe { buffer.set_len(capacity as usize) };
                assert!(buffer.starts_with(&last));
                last = buffer;
            }
        }
        assert_eq!(result, length);
    }
    assert_eq!(last.pop(), Some(T::default()));
    Ok(last)
}

fn text(function: impl Fn(*mut u16, i32, *mut Status) -> i32) -> Result<String> {
    Ok(String::from_utf16(&written(function)?).unwrap())
}

fn utf16(text: &str) -> (Vec<u16>, i32) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let length = units.len() as i32;
    (units, length)
}

/// SAFETY: `units` points to `length` units and a NUL.
unsafe fn kept(units: *const u16, length: i32) -> String {
    // SAFETY: the caller's.
    let units = unsafe { std::slice::from_raw_parts(units, length as usize + 1) };
    String::from_utf16(units.strip_suffix(&[0]).unwrap()).unwrap()
}

fn items(enumeration: &Open) -> Result<String> {
    let mut all = Vec::new();
    loop {
        // SAFETY: an item is valid until the next call.
        unsafe {
            let item = call(|status| uenum_next(enumeration.0, null_mut(), status))?;
            if item.is_null() {
                return Ok(all.join(" "));
            }
            all.push(CStr::from_ptr(item).to_str().unwrap().to_owned());
        }
    }
}

fn set_up() {
    package::install();
    // SAFETY: the argument is a C string.
    call(|status| unsafe { uloc_setDefault(c"en_US".as_ptr(), status) }).unwrap();
}

/// Runs once as it is, then refuses each allocation alone, and with all that follow.
fn check<T: PartialEq<E> + Debug, E: Debug>(expected: E, run: impl Fn() -> Result<T>) {
    set_up();
    assert_eq!(run().unwrap(), expected);
    let step = if cfg!(miri) { 7 } else { 1 };
    for refusals in [1, usize::MAX] {
        for grants in (0..).step_by(step) {
            GRANTS.set(Some((grants, refusals)));
            let result = run();
            let was_refused = GRANTS.take().is_none_or(|it| it.1 < refusals);
            match result {
                Err(status) => assert!(was_refused && status == MEMORY_ALLOCATION, "{status}"),
                Ok(result) => assert_eq!(result, expected, "{grants}"),
            }
            if !was_refused {
                break;
            }
        }
    }
}

#[test]
fn a_source_that_overlaps_the_buffer_is_refused() {
    for (from, length, to, expected) in [
        (4, 4, 4, UNSUPPORTED),
        (4, 4, 1, UNSUPPORTED),
        (4, 4, 7, UNSUPPORTED),
        (4, 4, 0, NOT_TERMINATED),
        (4, 4, 8, NOT_TERMINATED),
        (5, 0, 4, 0),
    ] {
        let (mut units, mut status) = ([u16::from(b'a'); 12], 0);
        let start = units.as_mut_ptr();
        // SAFETY: both ranges are in `units`.
        unsafe {
            let (dest, source) = (start.add(to), start.add(from));
            u_strToUpper(dest, 4, source, length, c"".as_ptr(), &raw mut status)
        };
        assert_eq!(status, expected, "{from} {length} {to}");
    }
}

#[test]
fn case_mapping() {
    let (source, length) = utf16("İi ß ΑΣ 𐐨");
    for (locale, upper, lower) in [
        (c"", "İI SS ΑΣ 𐐀", "i̇i ß ας 𐐨"),
        (c"tr", "İİ SS ΑΣ 𐐀", "ii ß ας 𐐨"),
    ] {
        let (source, locale) = (source.as_ptr(), locale.as_ptr());
        // SAFETY: here and below, the arguments are what the header asks for.
        check([upper, lower], || unsafe {
            Ok([
                text(|to, room, status| u_strToUpper(to, room, source, length, locale, status))?,
                text(|to, room, status| u_strToLower(to, room, source, length, locale, status))?,
            ])
        });
    }
}

#[test]
fn normalization() {
    for repetitions in [1, 20] {
        let (source, length) = utf16(&"e\u{301}\u{323}한".repeat(repetitions));
        let expected = ["ẹ\u{301}한", "e\u{323}\u{301}\u{1112}\u{1161}\u{11ab}"];
        // SAFETY: as above.
        check(expected.map(|it| it.repeat(repetitions)), || unsafe {
            let normalized = |form| {
                text(|to, room, status| {
                    unorm2_normalize(form, source.as_ptr(), length, to, room, status)
                })
            };
            Ok([
                normalized(call(|status| unorm2_getNFCInstance(status))?)?,
                normalized(call(|status| unorm2_getNFDInstance(status))?)?,
            ])
        });
    }
}

#[test]
fn locale_ids() {
    let id = c"de-at@collation=phonebook;calendar=roc".as_ptr();
    let expected = [
        "de_AT@calendar=roc;collation=phonebook",
        "calendar collation",
        "en@calendar=roc;numbers=arab",
        "en@calendar=roc",
    ];
    // SAFETY: as above.
    check(expected, || unsafe {
        let canonical = written(|to, room, status| uloc_canonicalize(id, to, room, status))?;
        let keywords = open(uenum_close, |status| uloc_openKeywords(id, status))?;
        let mut buffer = Vec::<u8>::with_capacity(32);
        buffer.extend(b"en\0");
        let buffer = buffer.as_mut_ptr();
        let set = |key: &CStr, value| {
            call(|status| uloc_setKeywordValue(key.as_ptr(), value, buffer, 32, status))?;
            Ok(CStr::from_ptr(buffer.cast()).to_str().unwrap().to_owned())
        };
        set(c"numbers", c"arab".as_ptr())?;
        let with_two = set(c"calendar", c"roc".as_ptr())?;
        let too_long = set(c"collation", c"phonebook".as_ptr()).unwrap_err();
        if too_long != BUFFER_OVERFLOW {
            return Err(too_long);
        }
        Ok([
            canonical.into_iter().map(char::from).collect(),
            items(&keywords)?,
            with_two,
            set(c"numbers", c"".as_ptr())?,
        ])
    });
}

#[test]
fn language_tags() {
    for (id, tag) in [
        (c"EN_us", "en-US"),
        (c"eng", "en"),
        (c"deu_DD", "de-DE"),
        (c"iw_hebr_il", "he-Hebr-IL"),
        (c"es_419", "es-419"),
        (c"und_Latn", "und-Latn"),
        (c"fra_FRA", "fr-FR"),
        // Only the canonicalization knows these.
        (c"zh_GAN", "gan"),
        (c"zh_YUE", "yue"),
        (c"en_US_POSIX", "en-US-u-va-posix"),
    ] {
        check(tag, || {
            // SAFETY: the buffer has the capacity, and the ID ends with a NUL.
            let tag = written(|dest, capacity, status| unsafe {
                uloc_toLanguageTag(id.as_ptr(), dest, capacity, 0, status)
            })?;
            Ok(String::from_utf8(tag).unwrap())
        });
    }
}

#[test]
fn names_of_locales_stay() {
    set_up();
    // SAFETY: as above.
    unsafe {
        let (default, first) = (uloc_getDefault(), uloc_getAvailable(0));
        call(|status| uloc_setDefault(c"en-US".as_ptr(), status)).unwrap();
        assert_eq!(uloc_countAvailable(), 2);
        assert_eq!(CStr::from_ptr(default), c"en_US");
        assert_eq!(CStr::from_ptr(first), c"de");
    }
}

fn decimal_separator(name: &CStr) -> Result<String> {
    // SAFETY: as above. A string is in the data, so it outlives its bundle.
    unsafe {
        let mut bundle = open(ures_close, |status| {
            ures_open(null(), name.as_ptr(), status)
        })?;
        for key in [c"NumberElements", c"latn", c"symbols"] {
            bundle = open(ures_close, |status| {
                ures_getByKey(bundle.0, key.as_ptr(), null_mut(), status)
            })?;
        }
        let mut length = 0;
        let decimal = call(|status| {
            ures_getStringByKey(bundle.0, c"decimal".as_ptr(), &raw mut length, status)
        })?;
        drop(bundle);
        Ok(kept(decimal, length))
    }
}

#[test]
fn bundles() {
    for (name, decimal) in [(c"de", ","), (c"nomagic", "."), (c"zz", ".")] {
        check(decimal, || decimal_separator(name));
    }
}

/// Runs all tests again in a process that has `ICU_DATA`. There each call opens a bundle that none has opened.
#[test]
#[cfg(not(miri))]
#[expect(clippy::disallowed_methods, clippy::disallowed_types)]
fn files() {
    use package::{german, german_of, package};
    use std::{env, fs, process};
    let names = |prefix| (100..300).map(move |number| format!("{prefix}{number}"));
    if env::var_os("ICU_DATA").is_some() {
        for prefix in ["alias", "loose", "packed"] {
            let names = std::cell::RefCell::new(names(prefix));
            check(",", || {
                let name = names.borrow_mut().next().unwrap();
                decimal_separator(&std::ffi::CString::new(name).unwrap())
            });
        }
        return;
    }
    let directory = env::temp_dir().join(format!("bun_icu-{}", process::id()));
    fs::create_dir_all(directory.join("icudt79l")).unwrap();
    let write = |path: String, bytes| fs::write(directory.join(path), bytes).unwrap();
    for name in names("alias") {
        write(format!("icudt79l/{name}.res"), german_of(&name));
        write(
            format!("{name}.dat"),
            package(&name, &[("de.res", german())]),
        );
    }
    // The other tests need the linked item.
    write("icudt79l/de.res".into(), vec![0; 64]);
    for name in names("loose") {
        write(format!("icudt79l/{name}.res"), german());
    }
    let packed: Vec<_> = names("packed")
        .map(|name| (name + ".res", german()))
        .collect();
    write("icudt79l.dat".into(), package("icudt79l", &packed));
    let mut again = process::Command::new(env::current_exe().unwrap());
    let status = again.env("ICU_DATA", &directory).status();
    fs::remove_dir_all(directory).unwrap();
    assert!(status.unwrap().success());
}

#[test]
fn what_stays_compressed_is_a_refused_allocation() {
    set_up();
    // SAFETY: as above.
    let opened = with_status(|status| unsafe { ures_open(null(), c"frame".as_ptr(), status) });
    assert_eq!(opened, (null_mut(), MEMORY_ALLOCATION));
}

#[test]
fn what_lacks_its_data_does_not_open() {
    type Opener = fn(*mut Status) -> Handle;
    // SAFETY: as above.
    let openers: [Opener; 3] = unsafe {
        [
            |status| ubrk_open(1, c"de".as_ptr(), null(), 0, status),
            |status| ucol_open(c"de".as_ptr(), status),
            |status| unorm2_getNFKCInstance(status),
        ]
    };
    for opener in openers {
        check((null_mut(), true), || match with_status(opener) {
            (_, MEMORY_ALLOCATION) => Err(MEMORY_ALLOCATION),
            (handle, status) => Ok((handle, status >= MISSING_RESOURCE)),
        });
    }
}

#[test]
fn lists() {
    const LIST: i32 = 3;
    const ELEMENT: i32 = 1;
    let (first, last, zeros) = (utf16("a").0, utf16("bc").0, [0u16; 2]);
    let misaligned = zeros.as_ptr().wrapping_byte_add(1);
    let strings = [first.as_ptr(), misaligned, last.as_ptr()];
    let (strings, lengths) = (strings.as_ptr(), [1, 0, 2]);
    let expected = ["a,  & bc", "a,  & bc", "0-1 6-8"];
    // SAFETY: as above. The text of a result is valid until the result changes.
    check(expected, || unsafe {
        let list = open(ulistfmt_close, |status| {
            ulistfmt_openForType(c"de".as_ptr(), 1, 0, status)
        })?;
        let result = open(ulistfmt_closeResult, |status| ulistfmt_openResult(status))?;
        call(|status| {
            ulistfmt_formatStringsToResult(list.0, strings, lengths.as_ptr(), 3, result.0, status)
        })?;
        let direct = text(|to, room, status| {
            ulistfmt_format(list.0, strings, lengths.as_ptr(), 3, to, room, status)
        })?;
        drop(list);
        let value = call(|status| ulistfmt_resultAsValue(result.0, status))?;
        let mut length = 0;
        let units = call(|status| ufmtval_getString(value, &raw mut length, status))?;
        let position = open(ucfpos_close, |status| ucfpos_open(status))?;
        call(|status| ucfpos_constrainField(position.0, LIST, ELEMENT, status))?;
        let mut spans = Vec::new();
        while call(|status| ufmtval_nextPosition(value, position.0, status))? != 0 {
            let (mut start, mut limit) = (0, 0);
            call(|status| ucfpos_getIndexes(position.0, &raw mut start, &raw mut limit, status))?;
            spans.push(format!("{start}-{limit}"));
        }
        Ok([direct, kept(units, length), spans.join(" ")])
    });
}

#[test]
fn numbers() -> Result<()> {
    set_up();
    let (skeleton, skeleton_length) = utf16("rounding-mode-half-up .0#");
    let expected = [
        "-1.234,57",
        "0-1 2-3 1-6 6-7 7-9",
        "7.654.321,0",
        "other",
        "one other",
    ];
    // SAFETY: as above.
    unsafe {
        let locale = c"de".as_ptr();
        let format = open(unumf_close, |status| {
            unumf_openForSkeletonAndLocale(skeleton.as_ptr(), skeleton_length, locale, status)
        })?;
        let result = open(unumf_closeResult, |status| unumf_openResult(status))?;
        let formatted =
            || text(|to, room, status| unumf_resultToString(result.0, to, room, status));
        call(|status| unumf_formatDouble(format.0, -1234.567, result.0, status))?;
        let short = formatted()?;
        let fields = open(ufieldpositer_close, |status| ufieldpositer_open(status))?;
        call(|status| unumf_resultGetAllFieldPositions(result.0, fields.0, status))?;
        let (mut spans, mut start, mut limit) = (Vec::new(), 0, 0);
        while ufieldpositer_next(fields.0, &raw mut start, &raw mut limit) >= 0 {
            spans.push(format!("{start}-{limit}"));
        }
        let digits = c"7654321".as_ptr();
        call(|status| unumf_formatDecimal(format.0, digits, 7, result.0, status))?;
        drop(format);
        let rules = open(uplrules_close, |status| {
            uplrules_openForType(locale, 0, status)
        })?;
        let form =
            text(|to, room, status| uplrules_selectFormatted(rules.0, result.0, to, room, status))?;
        let forms = open(uenum_close, |status| uplrules_getKeywords(rules.0, status))?;
        drop(rules);
        assert_eq!(
            [short, spans.join(" "), formatted()?, form, items(&forms)?],
            expected
        );
    }
    Ok(())
}

#[test]
#[cfg_attr(miri, ignore = "reads the clock, which isolation forbids")]
fn calendars() -> Result<()> {
    const MONTH: i32 = 2;
    const DATE: i32 = 5;
    const HOUR_OF_DAY: i32 = 11;
    set_up();
    let (zone, length) = utf16("GMT+0530");
    let locale = c"de@calendar=coptic".as_ptr();
    // SAFETY: as above.
    unsafe {
        let calendar = open(ucal_close, |status| {
            ucal_open(zone.as_ptr(), length, locale, 0, status)
        })?;
        call(|status| ucal_setMillis(calendar.0, 1_706_659_200_000.0, status))?;
        let copy = open(ucal_close, |status| ucal_clone(calendar.0, status))?;
        call(|status| ucal_add(copy.0, MONTH, 8, status))?;
        let get = |from: &Open, field| call(|status| ucal_get(from.0, field, status));
        assert_eq!(get(&calendar, DATE)?, 22);
        drop(calendar);
        let fields = [MONTH, DATE, HOUR_OF_DAY].map(|field| get(&copy, field));
        assert_eq!(fields, [Ok(12), Ok(5), Ok(5)]);
    }
    Ok(())
}

#[test]
#[cfg_attr(miri, ignore = "reads the clock, which isolation forbids")]
fn a_day_that_32_bits_do_not_hold_is_refused() -> Result<()> {
    const MONTH: i32 = 2;
    const DATE: i32 = 5;
    const EXTENDED_YEAR: i32 = 19;
    const DAY: f64 = 86_400_000.0;
    // 19 July 2023, which is the first day of the Islamic year 1445.
    const START: f64 = 19_557.0 * DAY;
    set_up();
    let (zone, length) = utf16("UTC");
    // SAFETY: as above.
    unsafe {
        let open_calendar = |locale: &CStr| {
            open(ucal_close, |status| {
                ucal_open(zone.as_ptr(), length, locale.as_ptr(), 0, status)
            })
        };
        let millis = |calendar: &Open| call(|status| ucal_getMillis(calendar.0, status));

        for locale in [
            c"en@calendar=islamic-civil",
            c"en@calendar=islamic-tbla",
            c"en@calendar=islamic-umalqura",
        ] {
            let calendar = open_calendar(locale)?;
            // Each amount is 2^32 days, to the nearest month.
            for (field, amount) in [(EXTENDED_YEAR, -12_120_122), (MONTH, 145_441_464)] {
                call(|status| ucal_setMillis(calendar.0, START, status))?;
                let added = call(|status| ucal_add(calendar.0, field, amount, status));
                assert_eq!(added, Err(ILLEGAL_ARGUMENT), "{locale:?} {field}");
                assert_eq!(millis(&calendar), Err(ILLEGAL_ARGUMENT));
                ucal_clear(calendar.0);
            }
            call(|status| ucal_setMillis(calendar.0, START, status))?;
            call(|status| ucal_add(calendar.0, EXTENDED_YEAR, -280_000, status))?;
            let year = call(|status| ucal_get(calendar.0, EXTENDED_YEAR, status));
            assert_eq!(year, Ok(1445 - 280_000));
        }

        for locale in [
            c"en@calendar=coptic",
            c"en@calendar=indian",
            c"en@calendar=persian",
            c"en@calendar=gregorian",
            c"en@calendar=buddhist",
            c"en@calendar=roc",
            c"en@calendar=iso8601",
        ] {
            let calendar = open_calendar(locale)?;
            call(|status| ucal_setMillis(calendar.0, START, status))?;
            ucal_set(calendar.0, EXTENDED_YEAR, -12_000_000);
            let read = [millis(&calendar), millis(&calendar)];
            assert_eq!(read, [Err(ILLEGAL_ARGUMENT); 2], "{locale:?}");
        }

        let calendar = open_calendar(c"en@calendar=gregorian")?;
        let millis_of = |year, month, date| {
            call(|status| ucal_setMillis(calendar.0, START, status))?;
            for (field, value) in [(EXTENDED_YEAR, year), (MONTH, month), (DATE, date)] {
                ucal_set(calendar.0, field, value);
            }
            millis(&calendar)
        };
        // The Julian day of 1 January 2023 is 2459946, and that of the year -5884202 is -2147483722.
        let last = i32::MAX - 2_459_945;
        assert_eq!(millis_of(2023, 0, last), Ok(2_145_043_059.0 * DAY));
        assert_eq!(millis_of(2023, 0, last + 1), Err(ILLEGAL_ARGUMENT));
        assert_eq!(millis_of(-5_877_000, 0, 1), Ok(-2_147_293_780.0 * DAY));
        assert_eq!(millis_of(-5_884_202, 0, 1), Err(ILLEGAL_ARGUMENT));
        // The day after 4 October 1582, which follows the Julian rules, is 15 October.
        assert_eq!(millis_of(1582, 9, 4), Ok(-141_428.0 * DAY));
        assert_eq!(millis_of(1582, 9, 15), Ok(-141_427.0 * DAY));
        assert_eq!(millis_of(1581, 11, 31), Ok(-141_705.0 * DAY));
        assert_eq!(millis_of(1583, 0, 1), Ok(-141_349.0 * DAY));
    }
    Ok(())
}
