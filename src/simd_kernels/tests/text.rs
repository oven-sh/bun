//! The searches, paths, scanners and packed words against plain loops, on each target that the CPU has.

use bun_simd::target::{Target, reset_cpu, set_cpu};
use bun_simd_kernels::*;
use core::mem::MaybeUninit;

const LONGEST: usize = if cfg!(miri) { 170 } else { 600 };
const STEP: usize = if cfg!(miri) { 83 } else { 1 };
const ROUNDS: usize = if cfg!(miri) { 1 } else { 3000 };

struct Random(u64);

impl Random {
    fn below(&mut self, limit: usize) -> usize {
        self.0 = self.0.wrapping_mul(0x5851_f42d_4c95_7f2d).wrapping_add(1);
        (self.0 >> 33) as usize % limit
    }

    /// Letters, with bytes of `rare` or any others here and there. It doesn't start at an aligned address.
    fn text(&mut self, longest: usize, rare: &[u8], check: impl FnOnce(&[u8])) {
        let (skip, every) = (self.below(64), 1 << self.below(9));
        let longest = longest >> self.below(6);
        let text: Vec<u8> = (0..skip + self.below(longest + 1))
            .map(|_| match (self.below(every), self.below(8)) {
                (0, 0) => self.below(256) as u8,
                (0, _) => rare[self.below(rare.len())],
                _ => b'a' + self.below(26) as u8,
            })
            .collect();
        check(&text[skip..]);
    }
}

fn first(text: &[u8], matches: impl Fn(u8) -> bool) -> Option<usize> {
    (0..text.len()).find(|&at| matches(text[at]))
}

fn last(text: &[u8], matches: impl Fn(u8) -> bool) -> Option<usize> {
    (0..text.len()).rfind(|&at| matches(text[at]))
}

fn count(text: &[u8], byte: u8) -> usize {
    text.iter().map(|&it| usize::from(it == byte)).sum()
}

fn bits(items: impl DoubleEndedIterator<Item = bool>) -> u64 {
    items.rfold(0, |bits, it| bits << 1 | u64::from(it))
}

fn is_one_of(set: &[u8]) -> impl Fn(u8) -> bool {
    move |byte| count(set, byte) != 0
}

static TOKEN: ByteSet = ByteSet::new(&[b'-'..=b'.', b'0'..=b'9', b'A'..=b'Z', b'^'..=b'z']);
static LINE: ByteSet = ByteSet::new(&[0..=9, 11..=12, 14..=0xff]);

fn check_searches(text: &[u8]) {
    let is_plain = |byte: u8| matches!(byte, 0x20..=0x7f);
    for byte in [b'/', 0, 0xff, b'a'] {
        assert_eq!(index_of_char(text, byte), first(text, |it| it == byte));
        assert_eq!(last_index_of_char(text, byte), last(text, |it| it == byte));
        assert_eq!(index_of_not_char(text, byte), first(text, |it| it != byte));
        assert_eq!(count_char(text, byte), count(text, byte));
    }
    let chars = b"/\\\0\xff\n.#@$*\"'`\r\t \x7f\x80\x1f";
    for len in (0..=chars.len()).step_by(if cfg!(miri) { 5 } else { 1 }) {
        let set = &chars[..len];
        let found = [index_of_any_char, index_of_any_char_nearby].map(|f| f(text, set));
        assert_eq!(found, [first(text, is_one_of(set)); 2]);
        assert_eq!(
            last_index_of_any_char(text, set),
            last(text, is_one_of(set))
        );
    }
    // One of each row of ASCII, and some twice.
    let sets = [
        &b"\0\x11\"3DUf\x7f"[..],
        b"\x0f\x10/:@_`~",
        b"//",
        b"//.",
        b"/./",
        b"/.//",
        b"/./\\",
        b"/..\\/",
        b"aa\"\"/",
        b"/..\xff/",
    ];
    for set in sets.into_iter().step_by(STEP) {
        assert_eq!(index_of_any_char(text, set), first(text, is_one_of(set)));
        assert_eq!(
            last_index_of_any_char(text, set),
            last(text, is_one_of(set))
        );
    }
    for quote in *b"\"'`\\" {
        let stops = |it| it == quote || it == b'\\' || it == 0x7f || !is_plain(it);
        assert_eq!(
            index_of_interesting_character_in_string_literal(text, quote),
            first(text, stops)
        );
        assert_eq!(
            index_of_needs_escape_for_javascript_string(text, quote).map(|at| at as usize),
            first(text, |it| stops(it) || (quote, it) == (b'`', b'$'))
        );
    }
    assert_eq!(
        index_of_interesting_character_in_multiline_comment(text),
        first(text, |it| matches!(it, b'*' | b'\r' | b'\n' | 0xe2))
    );
    assert_eq!(
        index_of_interesting_character_in_line_comment(text),
        first(text, |it| b"#@\r\n\xe2".contains(&it))
    );
    assert_eq!(
        index_of_newline_or_non_ascii(text),
        first(text, |it| !is_plain(it))
    );
    assert_eq!(
        index_of_space_or_newline_or_non_ascii(text),
        first(text, |it| it == b' ' || !is_plain(it))
    );
    assert_eq!(
        contains_newline_or_non_ascii_or_quote(text),
        first(text, |it| it == b'"' || !is_plain(it)).is_some()
    );
    for set in [&TOKEN, &LINE] {
        let outside = first(text, |it| !set.contains(it));
        assert_eq!(set.prefix_len(text), outside.unwrap_or(text.len()));
    }
    assert_eq!(last_index_of_slash(text), last(text, |it| it == b'/'));
    assert_eq!(
        last_index_of_slash_or_dot(text),
        last(text, is_one_of(b"/."))
    );
    assert_eq!(count_slashes(text), count(text, b'/'));
    assert_eq!(is_ascii_path(text), text.is_ascii());
}

fn check_untidy(path: &[u8]) {
    let is_untidy = |at: usize| {
        matches!(
            path[at..],
            [b'/', b'/', ..]
                | [b'/', b'.']
                | [b'/', b'.', b'/', ..]
                | [b'/', b'.', b'.']
                | [b'/', b'.', b'.', b'/', ..]
        )
    };
    assert_eq!(
        index_of_untidy_slash(path),
        (0..path.len()).find(|&at| is_untidy(at))
    );
    assert_eq!(
        index_of_untidy_slash_or_non_ascii(path),
        (0..path.len()).find(|&at| !path[at].is_ascii() || is_untidy(at))
    );
}

fn check_stops(text: &[u8], stops: Stops<'_>, is_in_run: fn(u8) -> bool) {
    let is_stop = |at: usize| text.get(at).is_none_or(|&it| !is_in_run(it));
    let mut next = text.len();
    for at in (0..=text.len()).rev() {
        if is_stop(at) {
            next = at;
        }
        assert_eq!(stops.next(at), next);
        assert_eq!((stops.run(at) as usize).min(57), (next - at).min(57));
    }
    for block in 0..text.len() / 64 + 3 {
        let expected = bits((64 * block..64 * block + 64).map(is_stop));
        assert_eq!(stops.block(block), expected);
    }
}

fn check_blocks(text: &[u8], buffer: &mut ScannerStopsBuffer) {
    let newlines = (0..text.len()).filter(|&at| text[at] == b'\n');
    let starts: Vec<u32> = newlines.map(|at| at as u32 + 1).collect();
    assert_eq!(line_starts(text), [&[0], &starts[..]].concat());

    let mut found = vec![1; 3];
    for byte in [b'\n', 0, 0xff] {
        byte_bits(text, byte, &mut found);
        let block = |it: &[u8]| bits(it.iter().map(|&it| it == byte));
        assert_eq!(found, text.chunks(64).map(block).collect::<Vec<_>>());
    }

    odd_blocks(text, &mut found);
    let is_odd = |it| it == b'\\' || !matches!(it, b'\t' | b'\n' | b'\r' | 0x20..=0x7e);
    let group = |it: &[u8]| bits(it.chunks(64).map(|it| first(it, is_odd).is_some()));
    assert_eq!(found, text.chunks(4096).map(group).collect::<Vec<_>>());

    buffer.reserve(text).fill(MaybeUninit::new(0x55));
    buffer.find(text);
    assert!(buffer.reserve(text).is_empty());
    let stops = buffer.find_again(text);
    check_stops(text, stops.after_name, |it| {
        it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$')
    });
    check_stops(text, stops.after_blanks, |it| matches!(it, b' ' | b'\t'));
    check_stops(text, stops.in_string, |it| {
        matches!(it, 0x20..=0x7f) && !matches!(it, b'"' | b'\'' | b'`' | b'$' | b'\\')
    });
    buffer.forget();
}

fn check_words(words: &[[u32; 4]], slack: usize) {
    let (mut expected_controls, mut expected, mut starts) = (vec![], vec![], vec![]);
    for group in words {
        starts.push(expected.len());
        let mut control = 0;
        for (i, &word) in group.iter().enumerate() {
            let folded = word << 1 ^ (word as i32 >> 31) as u32;
            let (code, size) = match folded {
                0 => (0, 0),
                1..=0xff => (1, 1),
                0x100..=0xffff => (2, 2),
                _ => (3, 4),
            };
            control |= code << (2 * i);
            expected.extend_from_slice(&folded.to_le_bytes()[..size]);
        }
        expected_controls.push(control);
    }
    starts.push(expected.len());

    let (mut controls, mut data) = (vec![0; words.len()], vec![0; 16 * words.len()]);
    let used = pack_words(words, &mut controls, &mut data);
    assert_eq!((&controls, &data[..used]), (&expected_controls, &*expected));

    expected.resize(used + slack, 0xaa);
    let mut back = vec![[MaybeUninit::new(7); 4]; words.len()];
    let groups = (0..words.len())
        .take_while(|&group| starts[group] + 16 <= expected.len())
        .count();
    assert_eq!(
        unpack_words(&controls, &expected, &mut back),
        (groups, starts[groups])
    );
    // SAFETY: all were initialized, and the kernel writes numbers.
    let back = unsafe { back.as_flattened().assume_init_ref() };
    assert_eq!(&back[..4 * groups], words[..groups].as_flattened());
    assert!(back[4 * groups..].iter().all(|&it| it == 7));
}

/// The optimizer knows these lengths and sets.
fn check_constants(text: &[u8; 16]) {
    fn check<const N: usize>(text: &[u8; N]) {
        assert_eq!(index_of_char(text, b'/'), first(text, |it| it == b'/'));
        assert_eq!(last_index_of_char(text, b'/'), last(text, |it| it == b'/'));
        assert_eq!(index_of_not_char(text, b'/'), first(text, |it| it != b'/'));
        assert_eq!(count_char(text, b'/'), count(text, b'/'));
    }
    check::<0>(text.first_chunk().unwrap());
    check::<3>(text.first_chunk().unwrap());
    check::<15>(text.first_chunk().unwrap());
    check(text);
}

fn check_reuse() {
    let (mut text, mut buffer) = (vec![b'a'; 200], ScannerStopsBuffer::default());
    assert_eq!(buffer.reserve(&text).len(), 3 * (4 * 8 + 8));
    assert_eq!(buffer.find_again(&text).after_name.next(0), 200);
    assert_eq!(buffer.reserve(&[0; 257]).len(), 3 * 8);
    assert_eq!(buffer.find_again(&text[..199]).after_name.next(0), 199);
    assert_eq!(buffer.find_again(&text).after_name.next(0), 200);
    text[0] = b' ';
    buffer.forget();
    assert_eq!(buffer.find_again(&text[..199]).after_name.next(0), 0);
    let stops = buffer.find_again(&text[1..]).after_name;
    assert_eq!([0, 300, 1000].map(|at| stops.next(at)), [199, 300, 1000]);
    assert!(buffer.reserve(&[0; 256]).is_empty());
    buffer.find(&[]);
    assert!(buffer.reserve(&[0; 256]).is_empty());
    buffer.find(&text);
    text[0] = b'a';
    buffer.forget();
    assert_eq!(buffer.find_again(&text).after_name.next(0), 200);
}

fn check_refusals() {
    let panics = |f: fn()| assert!(std::panic::catch_unwind(f).is_err());
    panics(|| _ = pack_words(&[[0; 4]; 2], &mut [0; 1], &mut [0; 32]));
    panics(|| _ = pack_words(&[[0; 4]; 2], &mut [0; 2], &mut [0; 31]));
    panics(|| _ = unpack_words(&[0; 2], &[0; 32], &mut [[MaybeUninit::new(0); 4]; 1]));
    panics(|| encode_hex_lower(&[0; 40], &mut [0; 79]));
    panics(|| copy_u16_to_u8(&[0; 40], &mut [0; 39]));
    panics(|| fill_with_skip_mask([1; 4], &mut [0; 39], &[0; 40], false));
    #[cfg(debug_assertions)]
    panics(|| {
        let (mut text, mut buffer) = ([b'a'; 9], ScannerStopsBuffer::default());
        buffer.find(&text);
        text[3] = b' ';
        buffer.find_again(&text);
    });
}

fn check_edges() {
    check_reuse();
    check_refusals();
    for skip in 0..64 {
        for at in [32, 33, 95, 96, 97] {
            let mut text = [b'a'; 400];
            text[skip + at] = b'\n';
            check_searches(&text[skip..]);
        }
    }
    for code in (0..1 << 16).step_by(7) {
        check_constants(&core::array::from_fn(|i| b'.' + (code >> i & 1) as u8));
    }
    for len in [4095, 4096, 4097, 8192, 70_000] {
        let mut text = vec![b'\n'; len];
        text[len - 1] = b'\\';
        check_blocks(&text, &mut ScannerStopsBuffer::default());
    }
}

fn check_all() {
    if !cfg!(miri) {
        check_edges();
    }
    // One byte of each value among letters, and one slash at each place.
    for byte in (0..=255).step_by(STEP * STEP) {
        for (len, at) in [(1, 0), (5, 3), (12, 9), (16, 15), (40, 33), (300, 200)] {
            let mut text = vec![b'a'; len.min(LONGEST)];
            text[at.min(LONGEST - 1)] = byte;
            check_searches(&text);
            check_blocks(&text, &mut ScannerStopsBuffer::default());
        }
    }
    for len in (0..LONGEST).step_by(STEP) {
        let plain = vec![b'a'; len];
        let rising: Vec<u8> = (0..len).map(|at| (at % 251) as u8).collect();
        assert_eq!(is_ascii_path(&vec![0x80; len]), len == 0);
        for at in (0..len).step_by(STEP) {
            let mut text = plain.clone();
            text[at] = b'/';
            assert_eq!(index_of_char(&text, b'/'), Some(at));
            assert_eq!(last_index_of_char(&text, b'/'), Some(at));
            assert_eq!(last_index_of_slash(&text), Some(at));
            assert_eq!(index_of_any_char(&text, b"\\/"), Some(at));
            assert_eq!(TOKEN.prefix_len(&text), at);
            text[at] = 0x80;
            assert!(!is_ascii_path(&text));
            assert_eq!(common_prefix_length(&text, &plain), at);
            assert_eq!(common_prefix_length(&plain, &plain[..at]), at);
            assert_eq!(common_prefix_length(&plain[..at], &text), at);
            text[at..].fill(0xff);
            assert_eq!(index_of_char(&text, 0xff), Some(at));
            assert_eq!(last_index_of_char(&text, b'a'), at.checked_sub(1));
            assert!(!is_ascii_path(&text));
            text[..at].copy_from_slice(&rising[..at]);
            assert_eq!(common_prefix_length(&text, &rising), at);
        }
        check_searches(&plain);
    }
    // All short paths, at the start and at the end of a longer one.
    for code in (0..4usize.pow(6)).step_by(STEP * STEP) {
        let short = [0, 1, 2, 3, 4, 5].map(|i| b"/.a\x80"[code >> (2 * i) & 3]);
        for len in [0, 2, 3, 10, 11, 26, 27, 58, 59] {
            check_untidy(&[&short[..], &vec![b'a'; len]].concat());
            check_untidy(&[&vec![b'a'; len], &short[..]].concat());
        }
        check_untidy(&short[..code % 6]);
    }
    let (mut random, mut buffer) = (Random(1), ScannerStopsBuffer::default());
    for _ in 0..ROUNDS {
        let rare = b"/.\\\"'`$#@*\r\n\t \0\x1f\x7e\x7f\x80\xff_";
        random.text(LONGEST, rare, check_searches);
        random.text(LONGEST, b"//..", check_untidy);
        random.text(if cfg!(miri) { 200 } else { 9000 }, rare, |it| {
            check_blocks(it, &mut buffer)
        });
        let groups = random.below(40);
        let mut word = || ((random.below(1 << 31) << 1) as i32 >> random.below(32)) as u32;
        let words: Vec<_> = (0..groups).map(|_| [(); 4].map(|()| word())).collect();
        check_words(&words, random.below(20));
    }
    // More matches than a byte counts.
    let len = if cfg!(miri) { 300 } else { 70_000 };
    assert_eq!(count_char(&vec![b'/'; len], b'/'), len);
    assert_eq!(count_slashes(&vec![b'/'; len]), len);
}

/// One test, since the target is the same for all threads.
#[test]
fn on_each_target() {
    for &target in Target::ALL {
        if set_cpu(target) {
            check_all();
        }
    }
    reset_cpu();
}
