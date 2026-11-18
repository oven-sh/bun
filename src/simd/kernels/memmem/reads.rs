//! How much a search reads. The limits are about a quarter above what it takes.
use super::{index_with, simd};
use bun_simd::{Memory, Source};
use core::cell::Cell;

/// Counts how often it is read, alone or as a part of a vector.
struct Counted(#[expect(dead_code)] u8);

/// The values that a vector gets, from the reads so far and from its place.
type Choice = fn(usize, usize) -> usize;

thread_local! {
    static READS: Cell<usize> = const { Cell::new(0) };
    static MOST: Cell<usize> = const { Cell::new(0) };
    /// Where the units are, and their values. The last ones are for single units.
    static BYTES: Cell<(usize, [&'static [u8]; 3], Choice)> =
        const { Cell::new((0, [&[]; 3], |_, _| 0)) };
}

fn read(units: &[Counted]) -> &'static [u8] {
    let (reads, (start, values, choice)) = (READS.get(), BYTES.get());
    assert!(reads < MOST.get(), "over {reads} reads");
    READS.set(reads + 1);
    let (at, len) = (units.as_ptr().addr() - start, units.len());
    &values[if len == 1 { 2 } else { choice(reads, at) }][at..][..len]
}

impl Source for Counted {
    type Lane = u8;
    const IS_SHARED: bool = false;

    fn get(&self) -> u8 {
        read(core::slice::from_ref(self))[0]
    }

    fn memory(slice: &[Self]) -> Memory<'_, u8> {
        Memory::Plain(read(slice))
    }
}

type Case = [Vec<u8>; 2];

fn at_all_widths<const FORWARD: bool>(cases: &[Case], choice: Choice) -> [Option<usize>; 3] {
    let [text, needle] = cases[0].each_ref().map(Vec::len);
    let mut units = Vec::<Counted>::with_capacity(64 + text + needle);
    let before = units.as_ptr().addr().wrapping_neg() % 64;
    units.resize_with(before + text + needle, || Counted(0));
    let values: Vec<_> = cases.iter().map(|it| &*it.concat().leak()).collect();
    let values = [0, 1, 2].map(|i| values[i % values.len()]);
    let units = &units[before..];
    BYTES.set((units.as_ptr().addr(), values, choice));
    let (a, b) = units.split_at(text);
    [
        simd::portable::find::<_, 16, 16, FORWARD>,
        simd::portable32::find::<_, 32, 16, FORWARD>,
        simd::portable64::find::<_, 64, 16, FORWARD>,
    ]
    .map(|search| index_with::<_, FORWARD>(a, b, search))
}

fn turned(case: &Case) -> Case {
    case.each_ref().map(|it| it.iter().rev().copied().collect())
}

/// Forward and, with both turned around, back.
#[track_caller]
fn search(case @ [text, needle]: &Case) {
    let want = (0..text.len()).find(|&at| text[at..].starts_with(needle));
    let want_back = want.map(|at| text.len() - needle.len() - at);
    let (forward, back) = (core::slice::from_ref(case), [turned(case)]);
    assert_eq!(at_all_widths::<true>(forward, |_, _| 0), [want; 3]);
    assert_eq!(at_all_widths::<false>(&back, |_, _| 0), [want_back; 3]);
}

#[track_caller]
fn reads_at_most(most: usize, cases: impl IntoIterator<Item = Case>) {
    let cases: Vec<_> = cases.into_iter().collect();
    READS.set(0);
    MOST.set(2 * most);
    for case in &cases {
        search(case);
    }
    assert!(READS.get() <= most, "{} reads, not {most}", READS.get());
    // A search that leaves something out reads little too.
    MOST.set(usize::MAX);
    for [text, needle] in cases {
        let last = text.len().checked_sub(needle.len());
        for at in last.into_iter().flat_map(|it| [it / 2, it]) {
            let text = [&text[..at], &needle, &text[at + needle.len()..]].concat();
            search(&[text, needle.clone()]);
        }
    }
}

fn cycle(period: &[u8], len: usize) -> Vec<u8> {
    period.iter().copied().cycle().take(len).collect()
}

fn put(mut units: Vec<u8>, at: usize, unit: u8) -> Vec<u8> {
    units[at] = unit;
    units
}

fn each<A: Copy, B: Copy>(a: &[A], b: &[B]) -> Vec<(A, B)> {
    a.iter()
        .flat_map(|&a| b.iter().map(move |&b| (a, b)))
        .collect()
}

const LENGTHS: [usize; 9] = [3, 6, 9, 16, 17, 33, 70, 150, 700];
const LETTERS: &[u8] = b"abcdefghijklmnopqrs";

/// A length, and a place that is not at an end.
fn inside(lengths: &[usize]) -> impl Iterator<Item = (usize, usize)> {
    let places = |&len: &usize| [1, len / 2, len - 2].map(|at| (len, at));
    lengths.iter().flat_map(places)
}

fn noise(letters: &[u8], len: usize) -> Vec<u8> {
    let mut x = len as u32;
    let letter = |_| {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        letters[(x >> 16) as usize % letters.len()]
    };
    (0..len).map(letter).collect()
}

fn thue_morse(len: u32) -> Vec<u8> {
    (0..len)
        .map(|i| b"ab"[i.count_ones() as usize % 2])
        .collect()
}

fn phases([a, b]: [&[u8]; 2], [m, n]: [usize; 2]) -> Vec<u8> {
    [cycle(a, m), cycle(b, n)].concat()
}

/// Runs that are too short for a needle of `len`. What ends them has the bit of `a`.
fn broken(period: &[u8], len: usize, total: usize) -> Vec<u8> {
    cycle(&put(cycle(period, len), len - 1, b'!'), total)
}

#[test]
fn without_many_candidates() {
    for (most, len) in [(10_500, 4000), (49_500, 20_000)] {
        reads_at_most(
            most,
            LENGTHS.map(|it| [cycle(b".", len), cycle(b"abc", it)]),
        );
    }
    let gap = [b'.'; 100];
    let one_end = [&b"x"[..], b"y", b"x..", b".y", &put(gap.into(), 0, b'x')];
    let needle = |len| [b"x", &cycle(b"a", len)[..], b"y"].concat();
    let cases = each(&one_end, &LENGTHS).into_iter();
    reads_at_most(
        285_000,
        cases.map(|(it, len)| [cycle(it, 20_000), needle(len)]),
    );

    reads_at_most(83_500, [[cycle(b"ab", 300_000), b"axb".into()]]);
    let sparse = [b"a.x.b", &[b'.'; 5000][..]].concat();
    let text = [cycle(b"ab", 20_000), sparse.repeat(80)].concat();
    reads_at_most(130_000, [[text, b"axb".into()]]);

    let text = [gap.repeat(600), b"a".into(), gap.repeat(200)].concat();
    reads_at_most(23_000, [[text, b"axb".into()]]);

    let cases = each(&[20, 40, 5000], &[0, 100]).into_iter();
    let cases = cases.map(|(len, after)| (cycle(b"abcdefg", len), &gap[..after]));
    reads_at_most(6100, cases.map(|(it, after)| [[&it, after].concat(), it]));

    let lengths = [3, 4, 5, 7, 8, 9, 15, 16, 17, 32];
    let cases = each(&lengths, &each(&[1, 3], &[0, 100])).into_iter();
    let few_misses = cases.map(|(len, (misses, before))| {
        let needle: Vec<u8> = (b'A'..).take(len).collect();
        let almost = [&put(needle.clone(), len / 2, b'#')[..], b"."].concat();
        let parts = [
            &gap[..before],
            &almost.repeat(misses),
            &needle,
            &gap.repeat(10),
        ];
        [parts.concat(), needle]
    });
    reads_at_most(6450, few_misses);

    let late_misses = [(9, 20), (70, 1)].map(|(len, misses)| {
        let needle: Vec<u8> = (b'A'..).take(len).collect();
        let almost = put(needle.clone(), len / 2, b'#');
        [
            [gap.repeat(200), almost.repeat(misses), gap.into()].concat(),
            needle,
        ]
    });
    reads_at_most(12_000, late_misses);

    let cases = each(&[20, 40, 64, 70, 100, 200, 400, 700], &[3, 5, 9, 17, 40]);
    let short = cases.into_iter().flat_map(|(total, len)| {
        let needle = cycle(b"a", len);
        [
            [cycle(b"a", total), put(needle.clone(), len / 2, b'x')],
            [cycle(b".", total), needle.clone()],
            [broken(b"a", len, total), needle],
        ]
    });
    reads_at_most(148_000, short);
}

#[test]
fn once_it_has_learned() {
    let one_unit = |(len, at)| [cycle(b"a", 1000 + len), put(cycle(b"a", len), at, b'x')];
    reads_at_most(8600, inside(&LENGTHS[5..]).map(one_unit));

    let near_copies = inside(&LENGTHS).map(|(len, at)| {
        let needle: Vec<_> = (0..len).map(|i| ((i * i + i / 7) % 26) as u8).collect();
        [cycle(&put(needle.clone(), at, b'#'), 20_000), needle]
    });
    reads_at_most(270_000, near_copies);

    let needle = noise(b"abcdefghijklmnopqrstuvwxyz", 5000);
    let differ_early = (0..22).flat_map(|i| put(needle.clone(), 70 + 5 * i, b'#'));
    reads_at_most(62_000, [[differ_early.collect(), needle]]);

    let short_decoys = inside(&LENGTHS[2..7]).map(|(len, at)| {
        let needle = put(cycle(b"a", len), at, b'x');
        [
            [put(needle.clone(), 3, b'#'), cycle(b"a", 700)].concat(),
            needle,
        ]
    });
    reads_at_most(15_000, short_decoys);

    let cases = each(&[3, 9, 16, 33], &[2500, 5000]).into_iter();
    let sparse = cases.map(|(len, many)| {
        let period = [cycle(b"a", many), put(cycle(b".", 2 * len + 1), len, b'x')].concat();
        [cycle(&period, 60_000), put(cycle(b"a", len), len / 2, b'x')]
    });
    reads_at_most(155_000, sparse);

    let then_other = (0..4).map(|len| {
        let period = [b"aaab", &b"aaa"[..len], b"ab"].concat();
        let text = [cycle(&period, 2000), cycle(b"a", 100_000)].concat();
        [text, b"aaaabaaaa".into()]
    });
    reads_at_most(112_000, then_other);

    let then_one_end = each(&[10, 16, 34, 70], b"ab")
        .into_iter()
        .map(|(len, end)| {
            let text = [broken(b"ab", len, 3000), vec![end; 100_000]].concat();
            [text, cycle(b"ab", len)]
        });
    reads_at_most(480_000, then_one_end);

    let out_of_step = |period: &[u8], len, at: usize| {
        put(cycle(period, len), at, period[(at + 1) % period.len()])
    };
    let cases = each(&[&b"ab"[..], b"abc"], &[70, 150, 300]).into_iter();
    let decoys = cases.flat_map(|(period, len)| {
        [2, len - 3].map(|at| {
            let needle = out_of_step(period, len, at);
            let decoy = put(needle.clone(), len / 2, b'#');
            [[decoy, cycle(period, 20_000)].concat(), needle]
        })
    });
    reads_at_most(237_000, decoys);
    for (most, period) in [(300_000, &b"ab"[..]), (300_000, b"abc"), (320_000, b"abcd")] {
        let case = |(len, at)| [cycle(period, 20_000), out_of_step(period, len, at)];
        reads_at_most(most, inside(&LENGTHS[1..]).map(case));
    }

    let needle = |len| [cycle(b"a", len), cycle(b"b", 2 * len), cycle(b"a", len)].concat();
    let mostly_a = put(cycle(b"a", 32), 0, b'c');
    let cases = each(&[&b"ac"[..], b"aac", &mostly_a], &[20, 70, 150]).into_iter();
    reads_at_most(
        615_000,
        cases.map(|(it, len)| [noise(it, 20_000), needle(len)]),
    );
    let text = [
        noise(b"bc", 1000),
        noise(b"ac", 10_000),
        noise(b"bc", 10_000),
    ]
    .concat();
    reads_at_most(130_000, [70, 150].map(|len| [text.clone(), needle(len)]));

    let lengths = [24, 33, 70, 150, 700];
    reads_at_most(
        415_000,
        lengths.map(|it| [noise(b"ab", 20_000), noise(b"ab", it)]),
    );
}

#[test]
fn when_it_falls_back() {
    let case = |(period, len)| [broken(period, len, 20_000), cycle(period, len)];
    for (most, lengths) in [
        (1_130_000, &LENGTHS[1..5]),
        (510_000, &[33, 47, 70, 150, 700]),
    ] {
        reads_at_most(
            most,
            each(&[&b"a"[..], b"ab"], lengths).into_iter().map(case),
        );
    }
    let jumps = |len| [broken(b"b", len, 20_000), cycle(b"b", len)];
    reads_at_most(88_000, [9, 33, 150].map(jumps));
    let text = [broken(b"a", 27, 20_000), cycle(b".", 20_000)].concat();
    reads_at_most(62_000, [[text, cycle(b"a", 35)]]);
    for (most, [dense, calm, times]) in
        [(350_000, [3000, 100_000, 2]), (1_450_000, [400, 130, 150])]
    {
        let text = |len| [broken(b"a", len, dense), cycle(b".", calm)].concat();
        let case = |len| [text(len).repeat(times), cycle(b"a", len)];
        reads_at_most(most, [9, 18, 40].map(case));
    }
    let text = |len| [broken(b"ab", len - 1, 1500), cycle(b"a", 6000)].concat();
    let only_ends = |len| [text(len).repeat(20), cycle(b"ab", len)];
    reads_at_most(575_000, [71, 151].map(only_ends));
    // Each candidate differs far from its start, and at another place.
    let period = put(cycle(b"abcdef", 72), 71, b'e');
    let (mut text, needle) = (period.repeat(3600), cycle(&period, 900 * 72 + 18));
    (text[41..].iter_mut().step_by(450 * 72)).for_each(|it| *it = b'e');
    reads_at_most(2_700_000, [[text, needle]]);
    // The same place each time, but the unit there is no help.
    let needle = put(cycle(b"ababb", 60_001), 59_797, b'b');
    reads_at_most(6_350_000, [[cycle(b"ababb", 180_003), needle]]);
    let needle = put(cycle(b"abb", 30_002), 29_901, b'b');
    let last_block = |more: usize| [cycle(b"abb", 30_002 + more), needle.clone()];
    reads_at_most(1_150_000, [70, 100, 120].map(last_block));
    let record = |i: usize, gap| [put(cycle(b"en", 30), 13 * i % 30, b'#'), cycle(b".", gap)];
    let gaps = (0..282).map(|i| if i < 30 { 4 } else { 3 }).enumerate();
    let dense_then_calm: Vec<_> = gaps.flat_map(|(i, gap)| record(i, gap).concat()).collect();
    reads_at_most(
        190_000,
        [[cycle(&dense_then_calm, 100_000), cycle(b"ne", 30)]],
    );
    let almost = put(phases([b"a", b"."], [500, 100]), 443, b'#');
    reads_at_most(155_000, [[cycle(&almost, 100_000), cycle(b"a", 500)]]);
    let islands = cycle(&phases([b"a", b"."], [6, 994]), 16_000);
    let text = [broken(b"a", 5, 17_500), islands].concat();
    reads_at_most(65_000, [[text, cycle(b"a", 7)]]);
}

#[test]
fn where_six_units_tell() {
    for (len, run) in each(&[6, 7, 8, 10, 30, 37, 74, 211], &[4, 5, 6]) {
        reads_at_most(79_500, [[broken(b"a", run, 30_000), cycle(b"a", len)]]);
    }
    for (most, needle, at, unit) in [
        (29_500, thue_morse(70), 69, b'c'),
        (33_500, thue_morse(100), 99, b'c'),
        (80_000, thue_morse(100), 0, b'b'),
        (82_000, thue_morse(144), 0, b'c'),
        (82_000, thue_morse(144), 142, b'c'),
        (87_000, thue_morse(163), 0, b'c'),
        (89_000, thue_morse(163), 161, b'c'),
        (91_000, thue_morse(244), 207, b'c'),
        (34_000, noise(b"ab", 100), 99, b'c'),
        (91_000, noise(b"ab", 700), 698, b'c'),
        (78_000, cycle(b"aab", 69), 1, b'#'),
    ] {
        let copies = cycle(&put(needle.clone(), at, unit), 30_000);
        reads_at_most(most, [[copies, needle]]);
    }
    let text = [cycle(b"aaaaaaaaaab", 1000), cycle(b"a", 60_000)].concat();
    reads_at_most(27_000, [[text, put(cycle(b"a", 150), 74, b'b')]]);
    let text = [cycle(b"babb", 500), cycle(b".", 30_000)].concat();
    reads_at_most(14_000, [[text, b"bbbb".into()]]);
}

#[test]
fn in_periods_and_phases() {
    let slip = |period: &[u8], a, b| [&cycle(period, a), &period[..1], &cycle(period, b)].concat();
    let then = |start: &[u8], len| [start, &cycle(&start[start.len() - 3..], len)].concat();
    for (most, period, needle) in [
        (67_000, &b"aab"[..], b"aaaaaba".into()),
        (77_000, b"aab", b"aaaabaaba".into()),
        (64_000, b"abb#bcabb", b"abbabcabb".into()),
        (75_000, b"bbaaaa", put(cycle(b"a", 20), 15, b'b')),
        (72_000, b"bbbbbabbbbbbbbbbb.....", cycle(b"b", 17)),
        (33_000, b"abaabaa#aabaaba#baabaab#", cycle(b"aba", 64)),
        (78_000, b"abababaa", cycle(b"ab", 72)),
        (77_000, b"cabcabcaccabcabccbcabcab", then(b"accab", 264)),
        (95_000, b"bcccbccbccbccbc", then(b"cbccbccbcccccb", 345)),
        (83_000, &broken(b"aca", 34, 34), slip(b"aca", 117, 111)),
        (30_000, &broken(b"ccb", 34, 34), slip(b"ccb", 63, 99)),
        (9600, b"abaabaa", put(cycle(b"abb", 14), 2, b'x')),
        (89_000, b"aaaaaaacaabab", cycle(b"a", 12)),
        (54_000, b"aaaaaaaa!bbaaaaba", cycle(b"a", 33)),
        (140_000, b"a!aaaaa", cycle(b"a", 63)),
        (84_000, b"aaaaaaabaaaaaa!!baaaaaaabaa!aaa", cycle(b"a", 63)),
        (64_000, b"aaaaaabb!", cycle(b"a", 70)),
        (105_000, b"aaa!a!aaaaaab", cycle(b"a", 70)),
        (57_000, b"!ba!aaaaaac!baaaaacbaaaabb!acaa", cycle(b"a", 150)),
        (92_500, b"!abababa", cycle(b"ba", 8)),
        (61_000, b"aababaaaba!", cycle(b"aababa", 200)),
    ] {
        reads_at_most(most, [[cycle(period, 30_000), needle]]);
    }
    for lengths in [[700, 200], [700, 300], [700, 500], [700, 1000], [1000, 300]] {
        let text = cycle(&phases([b"bxa", b"bbbba"], lengths), 30_000);
        reads_at_most(46_500, [[text, b"abbbbxa".into()]]);
    }
    let text = cycle(&phases([b"a", b"abx"], [200, 200]), 30_000);
    reads_at_most(17_500, [[text, b"aax".into()]]);
    for (most, second, first_len) in [(74_500, &b"aabbb"[..], 3000), (22_000, b"abbbbbbc", 600)] {
        let text = cycle(&phases([b"cbbbbbb", second], [first_len, 6000]), 30_000);
        reads_at_most(most, [[text, b"abbbbbbbbbbb".into()]]);
    }
    for (most, dense, lengths, needle) in [
        (74_000, &b"aaaaaaa!a!"[..], [200, 300], cycle(b"a", 12)),
        (76_500, b"aaaaaaa!a!", [600, 1000], cycle(b"a", 12)),
        (24_500, b"aaaaaaa!a!", [120, 3000], cycle(b"a", 12)),
        (63_500, b"abababa!", [1500, 400], cycle(b"ab", 8)),
    ] {
        let text = cycle(&phases([dense, b"."], lengths), 30_000);
        reads_at_most(most, [[text, needle]]);
    }
    let text = phases([b"abbbbbb", b"0bb0"], [10_000, 60_000]);
    reads_at_most(115_000, [[text, b"bbbbbbb0".into()]]);
}

#[test]
fn in_copies_that_differ_at_one_place() {
    for (most, needle, at, unit, total) in [
        (57_500, thue_morse(7), 0, b'#', 30_000),
        (108_000, b"aebfaebf".into(), 2, b'.', 30_000),
        (64_000, b"aabaaaaa".into(), 1, b'#', 30_000),
        (62_500, b"aabaabaaaaaaaa".into(), 7, b'b', 30_000),
        (10_500, cycle(b"a", 16), 5, b'b', 1500),
        (85_000, noise(b"aaab", 16), 0, b'b', 30_000),
        (3350, cycle(b"ab", 17), 0, b'b', 6000),
        (21_500, put(cycle(b"a", 20), 18, b'y'), 16, b'!', 30_000),
        (430, thue_morse(24), 12, b'#', 150),
        (81_500, cycle(b"aaab", 24), 18, b'#', 30_000),
        (19_400, cycle(b"a", 40), 30, b'#', 6000),
        (44_500, phases([b"a", b"aaab"], [1, 39]), 37, b'!', 30_000),
        (890, put(cycle(b"ab", 64), 0, b'b'), 61, b'#', 700),
        (65_500, cycle(b"aabab", 128), 96, b'b', 30_000),
        (58_000, thue_morse(256), 128, b'#', 30_000),
        (76_000, put(cycle(b"aab", 385), 384, b'b'), 0, b'b', 60_000),
        (1400, cycle(b"a", 1000), 999, b'b', 1030),
    ] {
        let copies = cycle(&put(needle.clone(), at, unit), total);
        reads_at_most(most, [[copies, needle]]);
    }
    for (most, period, run, unit, total, needle) in [
        (850, &b"ab"[..], 5, b'!', 700, cycle(b"ab", 12)),
        (61_500, b"abcd", 20, b'a', 20_000, cycle(b"abcd", 63)),
        (59_500, b"abb", 40, b'b', 60_000, b"abaabb".into()),
        (
            450,
            b"abc",
            255,
            b'!',
            300,
            put(cycle(b"abc", 255), 192, b'x'),
        ),
        (120_000, b"abb", 1666, b'b', 30_000, cycle(b"abb", 5000)),
    ] {
        let runs = cycle(&put(cycle(period, run), run - 1, unit), total);
        reads_at_most(most, [[runs, needle]]);
    }
}

#[test]
fn in_other_texts() {
    let late = |before, text: Vec<u8>| [cycle(b".", before), text].concat();
    for (most, text, needle) in [
        (115, late(90, noise(b"ab", 10)), b"aab".into()),
        (450, late(80, noise(b"aab", 70)), b"axb".into()),
        (600, noise(b"ab", 100), thue_morse(8)),
        (810, noise(b"aaab", 150), thue_morse(40)),
        (900, noise(b"abx", 700), cycle(b"abc", 8)),
        (2400, noise(b"abc", 500), noise(b"abc", 24)),
        (265, cycle(b"b", 700), thue_morse(20)),
        (2350, cycle(b"aabab", 1500), b"abb".into()),
        (350, cycle(b".", 6000), noise(b"ab", 5000)),
        (
            11_100,
            cycle(b"ababb", 20_000),
            phases([b"a", b"aabab"], [1, 254]),
        ),
        (170_000, cycle(b"aab", 60_000), noise(b"aab", 2000)),
        (
            21_000,
            noise(b"aab", 60_000),
            put(cycle(b"abc", 100), 1, b'a'),
        ),
        (70_000, noise(b"abc", 60_000), noise(b"aaab", 150)),
        (125_000, noise(b"abcdefgh", 100_000), cycle(b"hc", 1000)),
        (
            390_000,
            noise(b"aab", 60_000),
            put(cycle(b"a", 300), 0, b'b'),
        ),
        (
            252_000,
            noise(b"ab", 150_000),
            put(cycle(b"ab", 600), 595, b'a'),
        ),
    ] {
        reads_at_most(most, [[text, needle]]);
    }
    for (most, len, step, before) in [
        (38_500, 62, 13, 0),
        (41_000, 62, 13, 5000),
        (35_000, 70, 7, 0),
    ] {
        let needle = noise(LETTERS, len);
        let copies = (0..30_000 / len).flat_map(|i| put(needle.clone(), step * i % len, b'#'));
        let text = [cycle(&needle[..1], before), copies.collect()].concat();
        reads_at_most(most, [[text, needle]]);
    }
}

#[test]
fn in_ordinary_texts() {
    let (digits, genes) = (noise(b"0123456789", 100_000), noise(b"ACGT", 100_000));
    let needle = cycle(b"bcacbbcacaacc", 192);
    let copies = cycle(&put(needle.clone(), 106, b'b'), 100_000);
    let ends = put(put(cycle(b".", 200), 0, b'z'), 100, b'x');
    let rare = phases([&ends, b"."], [4200, 3000]);
    let zeros = noise(b"0000000000000002", 100_000);
    let with_ones = [[b'0'; 150], [b'1'; 150], [b'1'; 150], [b'0'; 150]].concat();
    let now_and_then = |common| cycle(&put(common, 0, b'#'), 300_000);
    let sparse = now_and_then(cycle(b"ab", 12_000));
    let once_dense = [&sparse[..60_000], &cycle(b"a#b", 3000), &sparse].concat();
    for (most, text, needle) in [
        (29_000, digits.clone(), b"192.168.0.1".into()),
        (28_500, digits, b"2001-02-03".into()),
        (28_500, genes.clone(), b"GATTNACA".into()),
        (170_000, genes, b"ACGGTCATTGCA".into()),
        (230_000, zeros, with_ones),
        (
            1_950_000,
            cycle(b"aaaa!", 200_000),
            cycle(b"aaaaab", 50_000),
        ),
        (240_000, copies, needle),
        (
            235_000,
            cycle(b"bcxabaaabaaabaa", 100_000),
            b"baxabaaabaaabaa".into(),
        ),
        (
            58_500,
            [rare, cycle(&ends, 200_000)].concat(),
            b"z#x".into(),
        ),
        (127_000, once_dense, b"b#a".into()),
        (
            89_000,
            now_and_then(noise(LETTERS, 7000)),
            put(LETTERS.into(), 9, b'#'),
        ),
    ] {
        reads_at_most(most, [[text, needle]]);
    }
}

#[test]
fn while_the_input_changes() {
    let choices: [Choice; 5] = [
        |_, _| 0,
        |_, _| 1,
        |reads, _| reads / 3000 % 2,
        // The right half of "abab" is at odd places.
        |_, at| 1 - at % 2,
        |reads, at| usize::from(at % 2 == 0 && reads % 61 < 9),
    ];
    let lengths = [(17, 40), (20, 300), (24, 5000), (35, 30_000)];
    let cases = each(&[&b"a"[..], b"ab"], &lengths);
    for ((period, (most, len)), choice) in each(&cases, &choices) {
        let (text, whole) = (cycle(period, 20_000 + 3 * len), cycle(period, len));
        let late = put(whole.clone(), len - 1 - len / 8, b'!');
        let cases = [put(late.clone(), 2, b'!'), late, whole].map(|it| [text.clone(), it]);
        READS.set(0);
        MOST.set(most * text.len());
        let back = cases.each_ref().map(turned);
        assert_eq!(at_all_widths::<true>(&cases, choice), [None; 3]);
        assert_eq!(at_all_widths::<false>(&back, choice), [None; 3]);
    }
}
