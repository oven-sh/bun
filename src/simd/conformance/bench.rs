//! Each line has a name and one or two times in nanoseconds, separated by tabs.
use crate::lists::{self, Each};
use crate::room::Room;
use crate::{Random, columns, shared, shared_out, write_line};
use bun_simd_kernels::*;
use core::array::from_fn;
use core::fmt::{Arguments, Write};
use core::hint::black_box as opaque;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Part of the name of each line to run.
pub(crate) static ONLY: OnceLock<Vec<u8>> = OnceLock::new();

/// `dyn FnMut` has a second copy of the code, for `FnOnce`.
trait Run {
    fn run(&mut self, case: usize, times: u32);
}

impl<F: FnMut(usize, u32)> Run for F {
    fn run(&mut self, case: usize, times: u32) {
        self(case, times);
    }
}

/// A branch predictor can learn tens of thousands of outcomes by heart.
#[inline(never)]
fn forget_branches(random: &mut Random) {
    let start = Instant::now();
    // After 0.7 ms without wide vectors, Intel's cores are slow to run them again.
    while start.elapsed().as_micros() < 500 {
        for _ in 0..32 {
            let bits = random.next();
            #[rustc_unroll(full)]
            for bit in 0..64 {
                if bits >> bit & 1 == 0 {
                    opaque(bit);
                }
            }
        }
    }
}

/// Prints the best of many short runs, for each case.
#[optimize(size)]
fn time(name: Arguments<'_>, cases: usize, code: &mut dyn Run) {
    let mut line = name.to_string();
    if ONLY
        .get()
        .is_some_and(|part| memmem(line.as_bytes(), part).is_none())
    {
        return;
    }
    let random = &mut Random(1);
    let mut time = |case, times, forgets| {
        if forgets {
            forget_branches(random);
        }
        let start = Instant::now();
        code.run(case, times);
        start.elapsed().as_secs_f64() * 1e9 / f64::from(times)
    };
    let (mut times, mut enough) = (1, 2);
    while times < enough {
        let once = time(0, times, times < 16).min(time(0, times, times < 16));
        enough = (1e4 / once).ceil() as u32;
        times = enough.min(2 * times);
    }
    let (mut best, start) = (vec![f64::MAX; cases], Instant::now());
    for turn in 0..20 {
        if turn >= 5 && start.elapsed().as_millis() > 100 {
            break;
        }
        for (case, best) in best.iter_mut().enumerate() {
            *best = best.min(time(case, times, true));
        }
    }
    for best in best {
        _ = write!(line, "\t{best:.2}");
    }
    write_line(format_args!("{line}"));
}

/// M2 waits for a result if the store of it touches the place of the next arguments.
#[repr(C)]
struct Apart<T>(MaybeUninit<u64>, T, MaybeUninit<u64>);

impl<T> Apart<T> {
    #[inline(always)]
    fn new(result: T) -> Self {
        Self(MaybeUninit::uninit(), result, MaybeUninit::uninit())
    }
}

/// The result of a closure could not borrow what the closure has captured.
macro_rules! time {
    ($($name:literal, $code:expr);+ $(;)?) => {$(
        time(format_args!($name), 1, &mut #[optimize(speed)] |_, times: u32| {
            let mut result;
            for _ in 0..times {
                result = Apart::new($code);
                opaque(&mut result);
            }
        });
    )+};
}

impl<T> Each<T> for &[T] {
    fn kernel<R>(&mut self, name: &str, kernel: impl Fn(&[T]) -> R) {
        let n = self.len();
        time!("{name} {n}", kernel(opaque(self)));
    }
}

#[optimize(size)]
fn searches(plain: &[u8]) {
    for n in [16, 24, 48, 64, 100, 1000, 65536] {
        time! {
            "index_of_char miss {n}", index_of_char(opaque(&plain[..n]), b'x');
        }
    }
    for n in [64, 100, 65536] {
        let t = &plain[..n];
        time! {
            "last_index_of_char miss {n}", last_index_of_char(opaque(t), b'x');
            "any of 2 miss {n}", index_of_any_char(opaque(t), b"xy");
            "count_char {n}", count_char(opaque(t), b'a');
            "string_literal miss {n}", index_of_interesting_character_in_string_literal(opaque(t), b'"');
        }
    }
    for n in [12, 64, 100, 16384] {
        let (t, wide) = (&plain[..n], &vec![u16::from(b'a'); n]);
        time! {
            "any of 6 miss {n}", index_of_any_char(opaque(t), opaque(b"<>&\"'\n"));
            "any of 6 known miss {n}", index_of_any_char(opaque(t), b"<>&\"'\n");
            "last of 3 miss {n}", last_index_of_any_char(opaque(t), b"\n\r\xE2");
            "index_of_not_char miss {n}", index_of_not_char(opaque(t), b'a');
            "index_of_char16 miss {n}", index_of_char16(opaque(wide), 1);
            "last_index_of_char16 miss {n}", last_index_of_char16(opaque(wide), 1);
            "common_prefix_length {n}", common_prefix_length(opaque(t), opaque(&plain[1..]));
            "template miss {n}", index_of_needs_escape_for_javascript_string(opaque(t), b'`');
        }
        lists::of_bytes(&mut { t });
        lists::of_units(&mut &wide[..]);
    }
}

/// What terminals are sent, and text in another encoding.
#[optimize(size)]
fn escapes() {
    for (name, text) in [
        ("colored words", &b"\x1B[1;31merror\x1B[0m: not found "[..]),
        (
            "links",
            b"see \x1B]8;;https://bun.com/docs\x1B\\the docs\x1B]8;;\x1B\\ ",
        ),
        ("resets", b"\x1B[1mbold\x1B(B\x1B[m "),
        ("saved cursors", b"\x1B7"),
        ("8-bit colors", b"\x9B1mbold\x9Bm "),
        ("8-bit titles and colors", b"\x9D\x07\x9Bm"),
        ("8-bit titles", b"\x9D2;the title of a window\x9C"),
        ("C1 bytes", b"\x92"),
        ("control bytes", b"\x11"),
        ("lines", b"a line of text\n"),
        ("accented words", b"caf\xE9 au lait "),
        ("euro signs", b"10 \x80 each, "),
        (
            "curly quotes",
            b"it\x92s a sentence with a single such byte. ",
        ),
    ] {
        for n in [1, 3, 1000] {
            let text = &text.repeat(n);
            time! {
                "width of {n} {name}", visible_latin1_width_exclude_ansi(opaque(text));
            }
        }
        for n in [2, 1000] {
            let text = &text.repeat(n);
            time! {
                "width with escapes of {n} {name}", visible_latin1_width(opaque(text));
            }
        }
        let text = &text.repeat(1000);
        time! {
            "index_of_escape_char8 hops through 1000 {name}", hop(text, index_of_escape_char8);
        }
        let wide: &Vec<u16> = &text.iter().map(|&byte| byte.into()).collect();
        time! {
            "index_of_escape_char16 hops through 1000 {name}", hop(wide, index_of_escape_char16);
        }
    }
}

#[inline(always)]
fn each<R>(all: &[&[u8]], mut kernel: impl FnMut(&[u8]) -> R) {
    for piece in opaque(all) {
        opaque(kernel(piece));
    }
}

#[inline(always)]
fn branch_on(found: Option<usize>) {
    if let Some(at) = found {
        opaque(at);
    }
}

#[optimize(size)]
fn styled_words(js: &[u8]) {
    let (styles, random) = (["31", "1", "2", "38;5;208", "1;4;36"], &mut Random(3));
    let words = js.split(|byte| !byte.is_ascii_alphanumeric());
    let mut words = words.filter(|it| !it.is_empty()).cycle();
    let mut word = || words.next().unwrap_or_default();
    for (name, start, end) in [
        ("colored", "\x1B[", "\x1B[0m"),
        ("reset", "\x1B[", "\x1B(B\x1B[m"),
        ("linked", "\x1B]8;;a\x1B\\\x1B[", "\x1B]8;;\x07"),
    ] {
        let line = |_| {
            let style = [start, random.one_of(&styles), "m"].concat();
            let words = [style.as_bytes(), word(), end.as_bytes(), b" ", word()].concat();
            words.repeat(1 + random.below(3) / 2)
        };
        let lines: Vec<_> = (0..20_000).map(line).collect();
        let lines: &Vec<_> = &lines.iter().map(Vec::as_slice).collect();
        time! {
            "width of 20000 {name} words", each(lines, visible_latin1_width_exclude_ansi);
        }
    }
    for (name, scripts, stop) in [
        ("boxes", &[0][..], 0x2502),
        ("CJK", &[0x4E00], 0x3002),
        ("scripts", &[0, 0, 0x400, 0x4E00], 0x2014),
    ] {
        let mut units = |_| -> Vec<u16> {
            let [first, second] = [(); 2].map(|()| (word(), random.one_of(scripts)));
            let words = [first, second].into_iter().take(scripts.len());
            let letters = words.flat_map(|(word, a)| word.iter().map(move |&it| a + u16::from(it)));
            letters.chain([stop]).collect()
        };
        let text: &Vec<_> = &(0..20_000).flat_map(&mut units).collect();
        time! {
            "visible_utf16_width hops through {name}", hop(text, |t| Some(visible_utf16_width(t).0).filter(|&len| len < t.len()));
            "first_non_ascii16 hops through {name}", hop(&text[..100_000], first_non_ascii16);
        }
    }
    for (name, unit) in [("Cyrillic", 0x430), ("CJK", 0x4E00), ("emoji", 0xD83D)] {
        for (n, ascii) in [(2, 1), (3, 2), (6, 1), (12, 2), (100, 40), (16384, 2)] {
            let text = &[vec![0x61; ascii], vec![unit; n - ascii]].concat()[..];
            time! {
                "visible_utf16_width {n}, {name} after {ascii}", visible_utf16_width(opaque(text));
            }
        }
    }
}

/// The words and the lines of a program, in their order.
#[optimize(size)]
fn pieces(js: &[u8]) {
    let words: fn(&u8) -> bool = |byte| !byte.is_ascii_alphanumeric();
    let lines: fn(&u8) -> bool = |byte| matches!(byte, b'\n' | b'\r');
    let out = &mut vec![0; 1 << 16];
    for (name, ends) in [("words", words), ("lines", lines)] {
        let all = js
            .split(ends)
            .filter(|piece| (1..1 << 15).contains(&piece.len()));
        let all: &Vec<_> = &all.take(20_000).collect();
        time! {
            "index_of_char of 20000 {name}", each(all, |t| index_of_char(t, b'e'));
            "last_index_of_char of 20000 {name}", each(all, |t| last_index_of_char(t, b'e'));
            "branch on index_of_char of 20000 {name}", each(all, |t| branch_on(index_of_char(t, b'e')));
            "branch on last_index_of_char of 20000 {name}", each(all, |t| branch_on(last_index_of_char(t, b'e')));
            "string_literal of 20000 {name}", each(all, |t| index_of_interesting_character_in_string_literal(t, b'"'));
            "count_char of 20000 {name}", each(all, |t| count_char(t, b'e'));
            "memmem of 20000 {name}", each(all, |t| memmem(t, b"this"));
            "memrmem of 20000 {name}", each(all, |t| memrmem(t, b"this"));
            "any of 3 of 20000 {name}", each(all, |t| index_of_any_char(t, b"`\\$"));
            "any of 6 of 20000 {name}", each(all, |t| index_of_any_char(t, b"{}'\"`/"));
            "last_index_of_slash_or_dot of 20000 {name}", each(all, last_index_of_slash_or_dot);
            "index_of_untidy_slash of 20000 {name}", each(all, index_of_untidy_slash);
            "width of 20000 {name}", each(all, visible_latin1_width_exclude_ansi);
            "lower_ascii of 20000 {name}", each(all, |t| _ = lower_ascii(t, out.as_mut_slice().into()));
            "copy_ascii_prefix of 20000 {name}", each(all, |t| _ = copy_ascii_prefix_to_shared(t, shared_out(out)));
            "fill_with_mask of 20000 {name}", each(all, |t| _ = fill_with_mask([1, 2, 3, 4], out.as_mut_slice().into(), t));
            "encode_hex_lower of 20000 {name}", each(all, |t| _ = encode_hex_lower(t, out.as_mut_slice().into()));
        }
    }
}

#[inline(always)]
fn hop<T>(text: &[T], find: impl Fn(&[T]) -> Option<usize>) -> &[T] {
    let mut rest = opaque(text);
    while let Some(at) = find(rest) {
        rest = &rest[at + 1..];
    }
    rest
}

/// Many short searches in a long text, like those of a lexer.
#[optimize(size)]
fn hops(js: &[u8]) {
    time! {
        "index_of_char hops through 1 MB", hop(js, |t| index_of_char(t, b'\n'));
        "string_literal hops through 1 MB", hop(js, |t| index_of_interesting_character_in_string_literal(t, b'"'));
        "any of 6 hops through 1 MB", hop(js, |t| index_of_any_char(t, b"{}'\"`/"));
        "memmem hops through 1 MB", hop(js, |t| memmem(t, b"function"));
        "newline_or_non_ascii hops through 1 MB", hop(js, index_of_newline_or_non_ascii);
        "multiline_comment hops through 1 MB", hop(js, index_of_interesting_character_in_multiline_comment);
    }
    time!("last_index_of_char hops through 1 MB", {
        let mut rest = opaque(js);
        while let Some(at) = last_index_of_char(rest, b'\n') {
            rest = &rest[..at];
        }
    });
}

impl Each<u8> for (&str, &[&[u8]]) {
    fn kernel<R>(&mut self, name: &str, kernel: impl Fn(&[u8]) -> R) {
        let (kind, all, n) = (self.0, self.1, self.1.len());
        time!("{name} of {n} {kind}", each(all, &kernel));
    }
}

/// From the `byte` before it, and to the end.
fn split_at_each(mut text: &[u8], byte: u8) -> impl Iterator<Item = (&[u8], &[u8])> {
    core::iter::from_fn(move || {
        let (before, rest) = text.split_at(index_of_char(text, byte)?);
        text = &rest[1..];
        Some((before, text))
    })
}

/// The lengths and the distances to the match are like those of Bun's own calls.
#[optimize(size)]
fn shapes_of_calls(js: &[u8], lockfile: &[u8]) {
    let after = |byte| split_at_each(js, byte).map(|(_, after)| after);
    let strings: &Vec<_> = &after(b'"').step_by(2).take(20_000).collect();
    let n = strings.len();
    time! {
        "string_literal after {n} quotes", each(strings, |t| branch_on(index_of_interesting_character_in_string_literal(t, b'"')));
    }
    let words: &Vec<_> = &after(b' ').take(20_000).collect();
    time! {
        "newline_or_non_ascii at 20000 words", each(words, |t| branch_on(index_of_newline_or_non_ascii(t)));
        "multiline_comment at 20000 words", each(words, |t| branch_on(index_of_interesting_character_in_multiline_comment(t)));
    }

    let quoted = || split_at_each(lockfile, b'"').map(|(before, _)| before);
    let paths_to = |files: [&str; 5]| -> Vec<_> {
        let packages = quoted().filter(|it| it.starts_with(b"node_modules/"));
        packages
            .flat_map(|it| files.map(|file| [b"/home/me/app/", it, file.as_bytes()].concat()))
            .collect()
    };
    let all = [
        ["/package.json", "/lib/index.js", "/./a.mjs", "", "/dist/"],
        ["/.bin/x", "/.cache/.x/a", "/..data/key", "/a.js", "/.git"],
        ["/../a.js", "/./b/../c", "//d", "/e/../../f/./g", "/.."],
    ]
    .map(paths_to);
    let random = &mut Random(5);
    let [paths, hidden, untidy] = &all.each_ref().map(|all| -> Vec<_> {
        let path = |_| &all[random.below(all.len())][..];
        (0..20_000).map(path).collect()
    });
    lists::of_paths(&mut ("paths", &paths[..]));
    lists::of_paths(&mut ("paths with dots", &hidden[..]));
    let dense = &vec![&b"/home//me/./app/../app/src/./a/../index.ts"[..]; 20_000];
    for (name, paths) in [("untidy paths", untidy), ("times the same path", dense)] {
        time! {
            "index_of_untidy_slash hops through 20000 {name}", each(paths, |t| hop(t, index_of_untidy_slash).len());
        }
    }
    time! {
        "last_index_of_char of 20000 paths", each(paths, |t| branch_on(last_index_of_char(t, b'.')));
        "common_prefix_length of 20000 paths", each(paths, |t| common_prefix_length(t, paths[0]));
    }
    for needle in [
        &b"/node_modules/"[..],
        b"/node_modules/.cache/",
        b"/node_modules/typescript/lib/tsc.js",
    ] {
        let len = needle.len();
        time! {
            "memmem of {len} of 20000 paths", each(paths, |t| branch_on(memmem(t, needle)));
            "memrmem of {len} of 20000 paths", each(paths, |t| branch_on(memrmem(t, needle)));
        }
    }

    let versions = quoted().filter(|it| it.len() < 16 && it.last().is_some_and(u8::is_ascii_digit));
    let parts: &Vec<_> = &versions
        .flat_map(|version| (0..=version.len()).map(move |at| &version[at..]))
        .take(20_000)
        .collect();
    time! {
        "any of 2 of 20000 ends of versions", each(parts, |t| branch_on(index_of_any_char(t, b"-+")));
        "any of 4 of 20000 ends of versions", each(parts, |t| branch_on(index_of_any_char(t, b" |<>")));
    }
}

/// The lines of HTTP responses, and the names of the fields.
#[optimize(size)]
fn heads() {
    let random = &mut Random(7);
    for (fields, kinds) in [(1, 1), (3, 1), (12, 1), (3, 2000), (12, 2000)] {
        let mut head = |_| {
            let mut head = b"HTTP/1.1 200 OK\r\n".to_vec();
            for _ in 0..fields {
                let longest = random.one_of(&[8, 30, 30, 50, 70, 300]);
                let [name, value] = [3 + random.below(24), 1 + random.below(longest)];
                head.extend([&b"a".repeat(name)[..], b": ", &b"b".repeat(value), b"\r\n"].concat());
            }
            [&head[..], b"\r\n"].concat()
        };
        let heads: Vec<_> = (0..kinds).map(&mut head).collect();
        let heads: &Vec<_> = &heads.iter().cycle().take(2000).map(|it| &it[..]).collect();
        time!("ByteSet in 2000 heads, {kinds} of {fields} fields", {
            static TOKEN: ByteSet = ByteSet::new(&[b'-'..=b'-', b'A'..=b'Z', b'a'..=b'z']);
            static CONTENT: ByteSet = ByteSet::new(&[b' '..=b'~', 0x80..=0xFF]);
            each(heads, |head| {
                let (mut rest, mut names) = (&head[CONTENT.prefix_len(head) + 2..], 0);
                while rest[0] != b'\r' {
                    let line = CONTENT.prefix_len(rest);
                    names += TOKEN.prefix_len(rest);
                    rest = &rest[line + 2..];
                }
                names
            })
        });
    }
    for n in [1, 3, 12, 1000] {
        let text = &vec![b'a'; n][..];
        time!("ByteSet {n}", {
            static LETTERS: ByteSet = ByteSet::new(&[b'A'..=b'Z', b'a'..=b'z']);
            LETTERS.prefix_len(opaque(text))
        });
    }
}

#[optimize(size)]
fn substrings(js: &[u8]) {
    let (random, all, js) = (&mut Random(7), js, &js[js.len() / 2..]);
    let miss = |len: usize, needle: &[u8]| (vec![b'a'; len], needle.to_vec());
    let boundary = b"\r\n--boundary-of-24-bytes";
    let [url, sentence] = [
        &b"//# sourceMappingURL=data:"[..],
        b"the quick brown fox jumps over it",
    ];
    let almost = |period: &[u8], times: usize| {
        let mut needle = period.repeat(times);
        needle[times / 2 * period.len()] = b'b';
        (period.repeat(1 << 15), needle)
    };
    let absent = |text: &[u8], needle: &[u8]| (text.to_vec(), [needle, b"\x01", needle].concat());
    let at = |at: usize, needle: &[u8]| ([&js[..at], needle, &js[..at]].concat(), needle.to_vec());
    let letters = |len, needle, of| (Random(8).bytes(len, of), Random(9).bytes(needle, of));
    let broken_copies = |needle: &[u8], len: usize| {
        let (mut text, random) = (needle.repeat(len / needle.len()), &mut Random(4));
        for copy in text.chunks_mut(needle.len()) {
            copy[random.below(needle.len())] = b'#';
        }
        (text, needle.to_vec())
    };
    let before_letters =
        |(text, needle): (Vec<u8>, _)| ([text, Random(5).bytes(190_000, b"ab")].concat(), needle);
    let wide = js[..1 << 15].iter().flat_map(|&byte| [byte, 0]).collect();
    let mostly_zeros = Random(5).bytes(1 << 18, &[&[0; 32][..], &[2]].concat());
    let broken_runs = |len: usize| {
        let needle = vec![b'a'; len];
        (
            [&needle[1..], b"b"].concat().repeat((1 << 15) / len),
            needle,
        )
    };
    let mut record = || [&js[..20], &random.bytes(24, b"01")].concat();
    let records = ((0..1500).flat_map(|_| record()).collect(), record());
    for (name, (mut text, mut needle)) in [
        ("miss 12", miss(12, b"xyz")),
        ("miss 40", miss(40, b"xyz")),
        ("miss 64", miss(64, b"xyz")),
        ("miss 100", miss(100, b"xyz")),
        ("miss 1000", miss(1000, b"xyz")),
        ("miss 65536", miss(1 << 16, b"xyz")),
        ("miss 12", miss(12, boundary)),
        ("miss 1000", miss(1000, boundary)),
        ("miss 100", (js[..100].to_vec(), sentence.to_vec())),
        ("miss 1 MB", (all.to_vec(), url.to_vec())),
        ("miss 1 MB", (all.to_vec(), sentence.to_vec())),
        ("that almost match", almost(b"a", 2)),
        ("that almost match", almost(b"a", 3)),
        ("that almost match", almost(b"a", 15)),
        ("that almost match", almost(b"ab", 20)),
        ("that almost match", almost(b"ab", 400)),
        ("in shorter runs", broken_runs(9)),
        ("in shorter runs", broken_runs(40)),
        ("in shorter runs", broken_runs(512)),
        (
            "in far shorter runs",
            (b"aab".repeat(20_000), vec![b'a'; 40]),
        ),
        (
            "in source around runs",
            ([all, &broken_runs(80).0, all].concat(), vec![b'a'; 80]),
        ),
        ("in records that start alike", records),
        (
            "of two letters",
            absent(&random.bytes(1 << 15, b"ab"), b"abbab"),
        ),
        ("in 4 letters", letters(1 << 15, 12, b"acgt")),
        ("in 4 KB of digits", letters(4096, 8, b"0123456789abcdef")),
        (
            "in 32 KB of digits",
            letters(1 << 15, 8, b"0123456789abcdef"),
        ),
        ("in random bytes", letters(1 << 16, 24, b"")),
        ("in 2 KB of source", absent(&js[..2000], &js[3000..3150])),
        ("in 4 KB of source", absent(&js[..4096], b"e t")),
        ("in 64 KB of source", absent(&js[..1 << 16], b"e t")),
        (
            "in 64 KB of source",
            absent(&js[..1 << 16], b"\n--boundary-"),
        ),
        (
            "between spaces",
            (js[..1 << 16].to_vec(), b" frxm ".to_vec()),
        ),
        ("in zeros", (vec![0; 1 << 16], vec![0, 0, 1, 0xB3, 0])),
        (
            "in 500 zeros",
            (vec![0; 500], [&[0], &js[..32], &[0]].concat()),
        ),
        (
            "in mostly zeros",
            (
                mostly_zeros,
                [[0; 150], [1; 150], [1; 150], [0; 150]].concat(),
            ),
        ),
        ("in UTF-16", (wide, b"\0z\0q\0".to_vec())),
        ("in broken copies", broken_copies(&js[1000..1020], 1 << 15)),
        ("in broken copies", broken_copies(&js[1000..1032], 1 << 20)),
        ("in broken copies", broken_copies(&js[1000..1200], 1 << 15)),
        (
            "in broken copies",
            broken_copies(&b"abcdefghijklm".repeat(80), 1 << 15),
        ),
        (
            "in broken copies, then letters",
            before_letters(broken_copies(b"aacababbbabaabbczaabbbcbabaabb", 72_000)),
        ),
        (
            "in a period",
            (
                b"cababaab".repeat(512),
                b"baababaabaabaaaabaaaabbaaabbba".to_vec(),
            ),
        ),
        ("after 100", at(100, b"\r\n")),
        ("after 300", at(300, b"\r\n\r\n")),
        ("after 500", at(500, &random.bytes(1000, b""))),
    ] {
        let (len, t, n) = (needle.len(), &mut text, &mut needle);
        time! {
            "memmem of {len} {name}", memmem(opaque(t), opaque(n));
            "memrmem of {len} {name}", memrmem(opaque(t), opaque(n));
            "shared: memmem of {len} {name}", memmem_shared(shared(opaque(t)), shared(opaque(n)));
            "shared: memrmem of {len} {name}", memrmem_shared(shared(opaque(t)), shared(opaque(n)));
        }
        let widen = |bytes: &[u8]| -> (Vec<u16>, Vec<u8>) {
            let units = bytes.iter().map(|&byte| byte.into()).collect();
            (units, bytes.iter().flat_map(|&byte| [byte, 0]).collect())
        };
        let [(wide_t, mut t), (wide_n, mut n)] = [widen(t), widen(n)];
        let [t, n] = [shared(&mut t), shared(&mut n)].map(|it| it.as_chunks().0);
        time! {
            "memrmem16 of {len} {name}", memrmem16(opaque(&wide_t), opaque(&wide_n));
            "shared: memmem16 of {len} {name}", memmem16_shared(opaque(t), opaque(n));
            "shared: memrmem16 of {len} {name}", memrmem16_shared(opaque(t), opaque(n));
        }
    }
}

#[optimize(size)]
fn whole_files(js: &[u8], json: &[u8], map: &[u8]) {
    time!("line_starts 1 MB", line_starts(opaque(js)));
    let one_line = &vec![b'a'; js.len()];
    time!("line_starts miss 1 MB", line_starts(opaque(one_line)));
    for n in [3, 7, 12, 30, 100, 200, 300, 65536] {
        let text = &js[..n];
        time! {
            "xxhash32 {n}", xxhash32(opaque(0), opaque(text));
            "xxhash64 {n}", xxhash64(opaque(0), opaque(text));
        }
        time!("xxhash64 of 100 parts of {n}", {
            let mut state = XxHash64State::new(0);
            (0..100).for_each(|_| state.update(opaque(text)));
            state.digest()
        });
    }

    let text = &js[..1 << 18];
    let mut planes = [(); 3].map(|()| vec![[0; 8]; text.len() / 64]);
    time! {
        "scanner_run_stops 256 KB", scanner_run_stops(opaque(text), planes.each_mut().map(|plane| &mut plane[..]));
    }

    let (index, dirty) = (&mut vec![MaybeUninit::uninit(); 8192 + 66], &mut [0; 2]);
    time!("json 256 KB", {
        let mut state = [0; 3];
        for (i, chunk) in opaque(&json[..1 << 18]).chunks(8192).enumerate() {
            opaque(json_structural_index_chunk(
                chunk,
                i * 8192,
                index.as_mut_slice().into(),
                dirty,
                &mut state,
            ));
        }
    });

    let xml = &b"<item id=\"7\" kind='a'>\n  <name>fish &amp; chips</name>\n</item>\n".repeat(120);
    time! {
        "xml 8 KB", xml_structural_index_chunk(opaque(xml), 0, index.as_mut_slice().into(), &mut [0; 3]);
    }
    let xml: &Vec<u16> = &xml.iter().map(|&byte| byte.into()).collect();
    time! {
        "xml16 8 K", xml_structural_index16_chunk(opaque(xml), 0, index.as_mut_slice().into(), &mut [0; 3]);
    }
    let marks = &mut vec![0; js.len() / 4096];
    time! {
        "odd_blocks 1 MB", odd_blocks(opaque(js), marks.as_mut_slice().into());
    }

    let (random, segments) = (
        &mut Random(3),
        ["CAAC,", "EAAE,", "IAAI,", "gBAAgB,", "kCAAkC,"],
    );
    let one_line: String = (0..45_000).map(|_| random.one_of(&segments)).collect();
    for (name, map, has_names) in [
        ("of a bundle", map, true),
        ("of one line", one_line.as_bytes(), false),
        ("all alike", &b"CAAC,".repeat(50_000), false),
    ] {
        let cap = count_mapping_delims(map) + 1;
        let mut pairs = [(); 2].map(|()| Box::new_uninit_slice(cap));
        let mut indices = [(); 2].map(|()| Box::new_uninit_slice(cap));
        let pairs = &mut pairs.each_mut().map(|column| &mut column[..]);
        let indices = &mut indices.each_mut().map(|column| &mut column[..]);
        time!("mappings {name}", {
            let out = columns(pairs, indices, has_names);
            parse_mappings(opaque(map), out, 1 << 20, &mut Default::default())
        });
    }
}

#[optimize(size)]
fn conversions(js: &[u8]) {
    for n in [3, 12, 16, 20, 32, 64, 100, 16384] {
        let (t, out, wide_out) = (&js[..n], &mut vec![0; 2 * n], &mut vec![0; n]);
        let wide: &Vec<u16> = &t.iter().map(|&byte| byte.into()).collect();
        time! {
            "copy_u16_to_u8 {n}", copy_u16_to_u8(opaque(wide), opaque(&mut out[..]).into());
            "lower_ascii16 {n}", lower_ascii16(opaque(wide), opaque(&mut wide_out[..]).into());
            "fill_with_mask {n}", fill_with_mask([1, 2, 3, 4], opaque(&mut out[..]).into(), opaque(t));
            "encode_hex_lower {n}", encode_hex_lower(opaque(t), opaque(&mut out[..]).into());
        }
        let hex = &encode_hex_lower(t, out.as_mut_slice().into()).to_vec();
        time! {
            "decode_hex {n}", decode_hex(opaque(hex.as_chunks().0), opaque(&mut out[..]).into());
        }
        let hex: &Vec<u16> = &hex.iter().map(|&byte| byte.into()).collect();
        time! {
            "decode_hex16 {n}", decode_hex16(opaque(hex.as_chunks().0), opaque(&mut out[..]).into());
            "lower_ascii {n}", lower_ascii(opaque(t), opaque(&mut out[..]).into());
            "mask_in_place {n}", mask_in_place([1, 2, 3, 4], opaque(&mut out[..n]));
        }
    }
    let words = &Random(7).words_of_all_sizes(4096);
    let (controls, data) = (&mut vec![0; 4096], &mut vec![0; 16 * 4096]);
    time! {
        "pack_words 16384", pack_words(opaque(words), controls.as_mut_slice().into(), data.as_mut_slice().into());
    }
    pack_words(
        words,
        controls.as_mut_slice().into(),
        data.as_mut_slice().into(),
    );
    let out = &mut vec![[0; 4]; 4096];
    time! {
        "unpack_words 16384", unpack_words(opaque(controls), data, out.as_mut_slice().into());
    }
}

#[optimize(size)]
fn jpeg() {
    const STRIDE: usize = 2048;
    let random = &mut Random(11);
    let (rows, out) = (&random.bytes(16 * STRIDE, b""), &mut vec![0; 16 * STRIDE]);
    for (name, count, one_in) in [
        ("flat", 24, 9999),
        ("busy", 24, 3),
        ("busy", 2, 3),
        ("mixed", 128, 90),
    ] {
        let block = |_| JpegBlock(from_fn(|i| i16::from(random.below(one_in) * i == 0) * 5));
        let blocks: &Vec<_> = &(0..64 * count).map(block).collect();
        let quant = &JpegBlock([3; 64]);
        for size in [2, 3, 4, 5, 6, 7, 8, 10, 12, 14] {
            time!(
                "jpeg_inverse_transform {size}, {name}, by {count}",
                blocks.chunks(count).for_each(|it| {
                    _ = jpeg_inverse_transform(it, quant, size, out, STRIDE);
                })
            );
        }
    }
    let blocks = &mut [JpegBlock([0; 64]); 32];
    let steps = &[[16385; 64], [128; 64]].map(JpegBlock);
    let (masks, planes) = (&mut [[0; 1]; 32], &mut [[0; 4]; 32]);
    for n in [1, 8, 32] {
        let (blocks, masks, planes) = (&mut blocks[..n], &mut masks[..n], &mut planes[..n]);
        time! {
            "jpeg_forward_transform {n}", jpeg_forward_transform(opaque(rows), STRIDE, steps, blocks, masks);
            "jpeg_forward_transform {n} with bit planes", jpeg_forward_transform(opaque(rows), STRIDE, steps, blocks, planes);
        }
    }
    let [y, cb, cr, c, d] = [0, 1, 2, 3, 4].map(|y| &rows[y * STRIDE..][..STRIDE]);
    let (pixels, planes) = (
        &mut Vec::with_capacity(STRIDE),
        &mut [(); 3].map(|()| rows.clone()),
    );
    for (name, chroma) in [
        ("4:4:4", JpegChroma::Full { cb, cr }),
        ("4:2:2", JpegChroma::HalfWidth { cb, cr }),
        (
            "4:2:0",
            JpegChroma::HalfSize {
                cb: [cb, c],
                cr: [cr, d],
            },
        ),
    ] {
        for n in [20, 200, 2000] {
            time!("jpeg_ycc_to_rgba {n} {name}", {
                pixels.clear();
                jpeg_ycc_to_rgba(opaque(y), chroma, n, pixels)
            });
        }
    }
    for n in [32, 480] {
        time!("jpeg_rgba_to_ycc420 {n}x16", {
            let into = planes.each_mut().map(|plane| &mut plane[..]);
            jpeg_rgba_to_ycc420(opaque(rows).as_chunks().0, n, n, 8, into, n / 2)
        });
    }
}

#[optimize(size)]
fn images() {
    const WIDTH: usize = 1024;
    let random = &mut Random(9);
    let pixel = |i: usize| {
        let (x, y, noise) = (i % WIDTH, i / WIDTH, random.below(6));
        [
            (x / 4 + noise) as u8,
            (y / 3 + noise) as u8,
            ((x + y) / 7) as u8,
            255,
        ]
    };
    let image: &Vec<[u8; 4]> = &(0..WIDTH * 768).map(pixel).collect();
    for n in [3, 16, 25, 4096, image.len()] {
        let pixels = &mut image[..n].to_vec();
        time!("modulate {n} px", modulate(opaque(pixels), 1.0, 1.0));
    }
    let [above, row] = [299, 300].map(|y| &image[y * WIDTH..][..WIDTH]);
    let rows = &mut [(); 4].map(|()| vec![[0; 4]; WIDTH]);
    for n in [3, 7, 15, WIDTH] {
        time!("png_filter_rgba {n} px", {
            let into = rows.each_mut().map(|row| &mut row[..n]);
            png_filter_rgba(opaque(&row[..n]), &above[..n], into)
        });
    }
    for size in [1, 2, 4, 6, 8] {
        let [above, row] = [above, row].map(|row| &row.as_flattened()[..4080]);
        for (filter_type, name) in (1..).zip(["sub", "up", "average", "paeth"]) {
            let row = &mut row.to_vec();
            time! {
                "png_unfilter {size} {name}", png_unfilter(filter_type, size, opaque(row), above);
            }
        }
    }
    for (size, n) in [(1, 4096), (4, 4096), (8, 4096), (4, 128)] {
        let row = &mut row.as_flattened()[..n].to_vec();
        time! {
            "png_unfilter {size} paeth of {n} below one color", png_unfilter(4, size, opaque(row), &[7; 4 * WIDTH][..n]);
        }
    }
    for n in [3, 8, 16, 256] {
        time! {
            "nearest_in_palette {n}", nearest_in_palette(opaque(&row[..n]), opaque([9, 8, 7, 255]));
        }
    }
    for (width, height) in [
        (3, 3),
        (16, 16),
        (30, 20),
        (127, 129),
        (1, 4000),
        (3, 4000),
        (4000, 1),
        (4000, 3),
        (8, 70_000),
        (1000, 750),
        (1024, 1024),
        (4032, 3024),
    ] {
        let (image, out) = (
            &vec![[1; 4]; width * height],
            &mut vec![[0; 4]; width * height],
        );
        for (name, kernel) in lists::MOVES {
            time! {
                "{name} {width}x{height}", kernel(opaque(image), width, out.as_mut_slice().into());
            }
        }
    }
    let sizes = [
        ([WIDTH, 768], [400, 300]),
        ([WIDTH, 768], [32, 24]),
        ([200, 150], [800, 600]),
        ([17, 13], [9, 7]),
    ];
    for filter in [
        Filter::Lanczos3,
        Filter::Nearest,
        Filter::Bilinear,
        Filter::Mks2021,
    ] {
        for ([from_w, from_h], [w, h]) in sizes {
            let (from, out) = (&image[..from_w * from_h], &mut vec![[0; 4]; w * h]);
            time! {
                "{filter:?} {from_w}x{from_h} to {w}x{h}", resize(filter, opaque(from), from_w, out.as_mut_slice().into(), w);
            }
        }
    }
}

#[optimize(size)]
fn from_shared(js: &[u8]) {
    for n in [12, 64, 100, 1000, 65536] {
        let (t, out) = (&mut vec![b'a'; n], &mut vec![0; 2 * n]);
        time! {
            "shared: index_of_char miss {n}", index_of_char_shared(shared(opaque(t)), b'x');
            "shared: last_index_of_char miss {n}", last_index_of_char_shared(shared(opaque(t)), b'x');
            "shared: encode_hex_lower {n}", encode_hex_lower_shared(shared(opaque(t)), out.as_mut_slice().into());
            "shared: fill_with_mask {n}", fill_with_mask_from_shared([1; 4], out.as_mut_slice().into(), shared(opaque(t)));
        }
    }
    let (t, needle) = (&mut js.to_vec(), &mut b"function".to_vec());
    time!("shared: memmem hops through 1 MB", {
        let needle = shared(needle);
        hop(shared(t), |t| memmem_shared(t, needle)).len()
    });
    for n in [3, 7, 12, 30, 100, 200, 300, 65536] {
        let t = &mut js[..n].to_vec();
        for seed in [0, 1] {
            time! {
                "shared: xxhash3 with seed {seed} {n}", xxhash3_64_shared(opaque(seed), shared(opaque(t)));
            }
        }
        time! {
            "shared: xxhash32 {n}", xxhash32_shared(opaque(0), shared(opaque(t)));
            "shared: xxhash64 {n}", xxhash64_shared(opaque(0), shared(opaque(t)));
        }
    }
}

#[optimize(size)]
fn to_shared() {
    for n in [12, 32, 64, 100, 1000, 65536] {
        let (t, wide, out) = (&vec![b'a'; 2 * n], &vec![0x61; 2 * n], &mut vec![0; n]);
        time! {
            "to shared: decode_hex {n}", decode_hex_to_shared(opaque(t).as_chunks().0, shared_out(out));
            "to shared: decode_hex16 {n}", decode_hex16_to_shared(opaque(wide).as_chunks().0, shared_out(out));
            "to shared: copy_u16_to_u8 {n}", copy_u16_to_shared(opaque(&wide[..n]), shared_out(out));
            "to shared: copy_ascii_prefix {n}", copy_ascii_prefix_to_shared(opaque(&t[..n]), shared_out(out));
        }
        if n <= 64 {
            time! {
                "to shared: copy_short_ascii_prefix {n}", copy_short_ascii_prefix_to_shared(opaque(&t[..n]), shared_out(out));
            }
        }
        if n <= 16 {
            time! {
                "to shared: copy_few_ascii {n}", copy_few_ascii_to_shared(opaque(&t[..n]), shared_out(out));
            }
        }
        for (name, kernel) in lists::SWAPS {
            time!("{name} {n}", kernel(AtomicU8::from_mut_slice(opaque(out))));
        }
    }
}

#[optimize(size)]
pub(crate) fn of_kernels(js: &[u8], json: &[u8], map: &[u8]) {
    shapes_of_calls(&js[js.len() / 4..], json);
    let js = &js[js.len() / 2..][..1 << 20];
    searches(&vec![b'a'; 1 << 16]);
    pieces(js);
    hops(js);
    heads();
    escapes();
    styled_words(js);
    substrings(js);
    whole_files(js, json, map);
    conversions(js);
    images();
    jpeg();
    from_shared(js);
    to_shared();
}

fn both<R>(name: &str, texts: &mut [&mut [u8]; 2], mut kernel: impl FnMut(&mut [u8]) -> R) {
    let name = format_args!("{name} {}", texts[0].len());
    time(name, 2, &mut |case: usize, times| {
        for _ in 0..times {
            opaque(kernel(opaque(texts[case])));
        }
    });
}

/// In the middle of a page, then before an inaccessible page.
#[optimize(size)]
pub(crate) fn at_the_end_of_a_page() {
    let [mut a, mut b] = [(); 2].map(|()| Room::new());
    for n in [5, 20, 40] {
        let (text, wide) = (&vec![b'a'; n], &vec![1; n]);
        let texts = &mut [a.copy_of(text, 2000), b.copy_of(text, usize::MAX)];
        both("index_of_char", texts, |t| index_of_char(t, b'x'));
        both("last_index_of_char", texts, |t| last_index_of_char(t, b'x'));
        both("count_char", texts, |t| count_char(t, b'x'));
        both("memmem", texts, |t| memmem(t, b"xy"));
        both("line_starts", texts, |t| line_starts(t));
        both("shared", texts, |t| index_of_char_shared(shared(t), b'x'));
        both("fill_with_mask", texts, |t| {
            fill_with_mask([0; 4], t.into(), text);
        });
        both("copy_u16_to_u8", texts, |t| {
            _ = copy_u16_to_u8(wide, t.into())
        });
        both("encode_hex_lower", texts, |t| {
            encode_hex_lower(text, t.into());
        });
        both("png_unfilter", texts, |t| png_unfilter(2, 1, t, text));
    }
}

/// The CPU or the system may have to turn wide registers on again.
#[optimize(size)]
pub(crate) fn after_a_pause() {
    let pauses: [(_, fn()); 3] = [
        ("nothing", || {}),
        ("a system call", std::thread::yield_now),
        ("a sleep", || std::thread::sleep(Duration::from_millis(1))),
    ];
    for (name, pause) in pauses {
        for n in [10, 1000] {
            let text = &vec![b'a'; n][..];
            let time = |_| {
                pause();
                let start = Instant::now();
                opaque(index_of_char(opaque(text), b'x'));
                start.elapsed().as_secs_f64() * 1e9
            };
            // A tick of the clock can be longer than a search. The mean does not depend on it.
            let mut times: Vec<_> = (0..1000).map(time).collect();
            times.sort_by(f64::total_cmp);
            let mean = times[..990].iter().sum::<f64>() / 990.0;
            write_line(format_args!("index_of_char {n} after {name}\t{mean:.2}"));
        }
    }
}

/// A step of scalar code alone, then with a short search every so many steps.
pub(crate) fn of_scalar_code_between_searches() {
    const STEPS: u32 = 1 << 24;
    let text = &[b'a'; 256];
    for steps_between in [1 << 13, 1 << 16, 1 << 19] {
        let time = |searches: bool| {
            let (start, mut x) = (Instant::now(), 3u64);
            for _ in 0..STEPS / steps_between {
                if searches {
                    opaque(crate::simd::search_on_any_target(opaque(text)));
                }
                for _ in 0..steps_between {
                    x = x.wrapping_mul(x) | 1;
                }
            }
            opaque(x);
            start.elapsed().as_secs_f64() * 1e9 / f64::from(STEPS)
        };
        let mut times = [[0.0; 15]; 2];
        for turn in 0..15 {
            (times[0][turn], times[1][turn]) = (time(false), time(true));
        }
        let [alone, between] =
            times.map(|mut times| *times.select_nth_unstable_by(7, f64::total_cmp).1);
        write_line(format_args!(
            "a search every {steps_between} steps\t{alone:.4}\t{between:.4}"
        ));
    }
}
