use bun_engine_standalone as _;
use bun_yarr::{Compiled, Error, NO_MATCH, Text, flags};

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void {
    core::ptr::null_mut()
}

fn exec(pattern: &str, bits: u16, text: &str, start: u32) -> Option<Vec<u32>> {
    let compiled = Compiled::new(Text::from_ascii(pattern), bits).unwrap();
    let units: Vec<u16> = text.encode_utf16().collect();
    let [narrow, wide] = [Text::from_ascii(text), Text::Utf16(&units)].map(|text| {
        let mut offsets = vec![7; compiled.offsets_len()];
        compiled.exec(text, start, &mut offsets).then_some(offsets)
    });
    assert_eq!(narrow, wide);
    narrow
}

#[test]
fn reports_offsets() {
    assert_eq!(exec("b", 0, "abab", 2), Some(vec![3, 4]));
    assert_eq!(exec("b", flags::STICKY, "abab", 2), None);
    assert_eq!(exec("", 0, "ab", 2), Some(vec![2, 2]));
    assert_eq!(exec("", 0, "ab", 3), None);
    let expected = vec![1, 3, NO_MATCH, NO_MATCH, 2, 3];
    assert_eq!(
        exec("(x)|b(c)", flags::IGNORE_CASE, "aBC", 0),
        Some(expected)
    );
}

#[test]
fn needs_room_for_the_groups() {
    let compiled = Compiled::new(Text::from_ascii("(a)"), 0).unwrap();
    assert!(!compiled.exec(Text::from_ascii("a"), 0, &mut [0; 3]));
}

#[test]
fn refuses() {
    let both = flags::UNICODE | flags::UNICODE_SETS;
    for (pattern, bits, expected) in [
        ("(", 0, Error::Syntax),
        ("a", both, Error::Syntax),
        ("a", 1 << 8, Error::Syntax),
        ("\\p{Nope}", flags::UNICODE, Error::UnknownProperty),
        ("a{4294967295}b", 0, Error::TooLarge),
    ] {
        let refusal = Compiled::new(Text::from_ascii(pattern), bits).err();
        assert_eq!(refusal, Some(expected));
    }
}

#[test]
fn is_shared_by_threads() {
    let compiled = Compiled::new(Text::from_ascii("(\\d+)-"), 0).unwrap();
    let units: Vec<u16> = "ab12-".encode_utf16().collect();
    std::thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| {
                let mut offsets = [0; 4];
                assert!(compiled.exec(Text::Utf16(&units), 0, &mut offsets));
                assert_eq!(offsets, [2, 5, 2, 4]);
            });
        }
    });
}
