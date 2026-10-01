// Scratch only: replays every line of the golden vector files of the notes against the port.
use crate::jsnum::{Number, from_string, parse_pseudo_big_int};

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn bits(s: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(s, 16).unwrap())
}

fn same(a: f64, b: f64) -> bool {
    if a.is_nan() { b.is_nan() } else { a.to_bits() == b.to_bits() }
}

fn replay(path: &str) -> Vec<(String, u64, u64)> {
    let text = std::fs::read_to_string(path).unwrap();
    let mut counts = std::collections::BTreeMap::<String, (u64, u64)>::new();
    let mut shown = 0;
    for line in text.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        let ok = match f[0] {
            "F" => same(from_string(&unhex(f[1])).0, bits(f[2])),
            "S" => Number(bits(f[1])).string() == f[2].as_bytes(),
            "B" => {
                let (a, b) = (Number(bits(f[1])), Number(bits(f[2])));
                let r = [a.bitwise_or(b), a.bitwise_and(b), a.bitwise_xor(b), a.signed_right_shift(b), a.unsigned_right_shift(b), a.left_shift(b), a.remainder(b)];
                (0..7).all(|i| same(r[i].0, bits(f[3 + i])))
            }
            "N" => same(Number(bits(f[1])).bitwise_not().0, bits(f[2])),
            "P" => same(Number(bits(f[1])).exponentiate(Number(bits(f[2]))).0, bits(f[3])),
            "G" => parse_pseudo_big_int(&unhex(f[1])).unwrap_or_else(|_| b"PANIC".to_vec()) == f[2].as_bytes(),
            _ => continue,
        };
        let e = counts.entry(f[0].to_string()).or_insert((0, 0));
        e.0 += 1;
        if !ok {
            e.1 += 1;
            if shown < 20 {
                shown += 1;
                eprintln!("mismatch {line}");
            }
        }
    }
    counts.into_iter().map(|(k, (n, bad))| (k, n, bad)).collect()
}

#[test]
fn golden_vectors() {
    for path in ["/tmp/golden/vectors_126.tsv", "/tmp/golden/vectors4.tsv", "/tmp/golden/vectors2.tsv"] {
        let counts = replay(path);
        eprintln!("{path}: {counts:?}");
        for (kind, _, bad) in &counts {
            assert_eq!(*bad, 0, "{kind} of {path}");
        }
    }
}

// Scratch only: random byte strings through every function that takes text, with overflow checks on. A panic fails the test.
#[test]
fn no_panic_on_random_bytes() {
    use crate::core::*;
    use crate::jsnum::*;
    use crate::stringutil::*;
    let alphabet: &[u8] = b"/\\.:ac%3A^\xff\xc3\xe2\x80\xed\xa0\xbd\xb8e01x-+n_ \n\r*\"'`\xef\xbb\xbfIi\xc4\xb0\xcf\x83\xce\xa3bBoOXdtsjS\xf4\x90";
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let mut text = |max: u64| -> Vec<u8> {
        let len = next() % max;
        (0..len).map(|_| alphabet[(next() % alphabet.len() as u64) as usize]).collect()
    };
    let mut sink: usize = 0;
    for round in 0..60_000u64 {
        let (a, b, c) = (text(14), text(10), text(6));
        sink += crate::tspath::path::tests::one(&a).len();
        if round % 4 == 0 {
            sink += crate::tspath::path::tests::two(&a, &b).len();
        }
        sink += crate::tspath::combine_paths(&a, &[&b, &c]).len() + crate::tspath::resolve_path(&c, &[&b, &a]).len();
        let n = from_string(&a);
        sink += n.string().len() + from_string(&n.string()).string().len();
        sink += parse_pseudo_big_int(&a).map_or(0, |v| v.len()) + parse_valid_big_int(&b).map_or(0, |v| v.string().len());
        let lines = split_lines(&a);
        sink += guess_indentation(&lines) as usize + encode_uri(&a).len() + strip_quotes(&a).len() + unquote_string(&a).len();
        sink += lower_first_char(&a).len() + truncate_by_runes(&a, (round % 7) as isize - 1).len() + combine_surrogate_pairs(&a).len();
        sink += to_lower_js(&a).len() + to_upper_js(&a).len() + remove_byte_order_mark(&a).len() + add_utf8_byte_order_mark(&a).len();
        sink += usize::from(equate_string_case_insensitive(&a, &b)) + usize::from(has_prefix(&a, &c, false)) + usize::from(has_suffix(&a, &c, false));
        sink += (compare_strings_case_insensitive(&a, &b) + compare_strings_case_insensitive_eslint_compatible(&a, &b) + 2) as usize;
        let pattern = try_parse_pattern(&c);
        sink += usize::from(pattern.matches(&a)) + pattern.matched_text(&a).map_or(0, |t| t.len());
        sink += get_script_kind_from_file_name(&a).0 as usize + compute_ecma_line_starts(&a).len() + utf16_len(&a).0 as usize;
        sink += get_spelling_suggestion_for_strings(&a, [&b[..], &c[..], &a[..]]).len();
        sink += index_after(&a, &c, (round % 20) as isize - 3).unsigned_abs();
        let (line, offset) = position_to_line_and_byte_offset(round as isize % 9 - 2, &compute_ecma_line_starts(&b));
        sink += (line + offset).unsigned_abs();
    }
    let mut bits: u64 = 0x0123_4567_89AB_CDEF;
    for _ in 0..400_000 {
        bits ^= bits << 13;
        bits ^= bits >> 7;
        bits ^= bits << 17;
        let (x, y) = (Number(f64::from_bits(bits)), Number(f64::from_bits(bits.rotate_left(29) ^ 0x5555)));
        let text = x.string();
        let back = from_string(&text);
        assert!(x.is_nan() || back.0.to_bits() == x.0.to_bits() || (x.0 == 0.0 && back.0 == 0.0), "{:?}", x);
        sink += (x.bitwise_or(y).0 + x.left_shift(y).0 + x.unsigned_right_shift(y).0) as usize;
        let small = Number((bits % 97) as f64 - 48.0);
        let _ = x.remainder(y).0 + x.exponentiate(small).0 + small.exponentiate(Number((bits >> 40) as f64 / 1000.0 - 4000.0)).0;
    }
    assert!(sink > 0);
}
