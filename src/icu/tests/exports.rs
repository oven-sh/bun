use bun_engine_standalone as _;
use bun_icu as _;

unsafe extern "C" {
    fn Bun__collateUTF8(
        numeric: bool,
        a: *const u8,
        a_length: usize,
        b: *const u8,
        b_length: usize,
    ) -> i32;
    fn Bun__collateUTF16(
        numeric: bool,
        a: *const u16,
        a_length: usize,
        b: *const u16,
        b_length: usize,
    ) -> i32;
    fn Bun__normalizeUTF16(
        form: u8,
        text: *const u16,
        length: usize,
        out: *mut u16,
        capacity: usize,
    ) -> i32;
}

#[test]
fn collation() {
    for (numeric, a, b, order) in [
        (false, "a", "B", -1),
        (false, "a", "A", -1),
        (false, "\u{e9}", "e\u{301}", 0),
        (false, "10", "9", -1),
        (false, "b", "", 1),
        (true, "a", "\u{c1}", 0),
        (true, "10", "9", 1),
    ] {
        let (c, d): (Vec<_>, Vec<_>) = (a.encode_utf16().collect(), b.encode_utf16().collect());
        // SAFETY: slices.
        let orders = unsafe {
            [
                Bun__collateUTF8(numeric, a.as_ptr(), a.len(), b.as_ptr(), b.len()),
                Bun__collateUTF16(numeric, c.as_ptr(), c.len(), d.as_ptr(), d.len()),
            ]
        };
        assert_eq!(orders, [order; 2], "{a} {b}");
    }
}

#[test]
fn normalization() {
    let text = [0x1e9b, 0x323];
    let forms: [&[u16]; 4] = [
        &text,
        &[0x17f, 0x323, 0x307],
        &[0x1e69],
        &[0x73, 0x323, 0x307],
    ];
    for (form, expected) in (0..).zip(forms) {
        for capacity in [0, expected.len()] {
            let mut out = vec![0; capacity];
            // SAFETY: slices.
            let length =
                unsafe { Bun__normalizeUTF16(form, text.as_ptr(), 2, out.as_mut_ptr(), capacity) };
            assert_eq!(length as usize, expected.len());
            assert_eq!(out, expected[..capacity]);
        }
    }
}
