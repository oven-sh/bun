//! How much a search reads. The limits are about a quarter above what it takes.
use super::{index_with, simd};
use bun_simd::{Memory, Source};
use core::cell::Cell;

/// Counts how often it is read, alone or as a part of a vector.
struct Counted(u8);

thread_local! {
    static READS: Cell<usize> = const { Cell::new(0) };
    /// Where the units are, and their values.
    static BYTES: Cell<(usize, &'static [u8])> = const { Cell::new((0, &[])) };
}

impl Source for Counted {
    type Lane = u8;
    const IS_SHARED: bool = false;

    fn get(&self) -> u8 {
        READS.set(READS.get() + 1);
        self.0
    }

    fn memory(slice: &[Self]) -> Memory<'_, u8> {
        READS.set(READS.get() + 1);
        let (start, bytes) = BYTES.get();
        Memory::Plain(&bytes[slice.as_ptr().addr() - start..][..slice.len()])
    }
}

fn at_all_widths<const FORWARD: bool>(text: &[u8], needle: &[u8]) {
    let mut units = Vec::<Counted>::with_capacity(64 + text.len() + needle.len());
    let before = units.as_ptr().addr().wrapping_neg() % 64;
    let bytes = [&[0; 64][..before], text, needle].concat().leak();
    units.extend(bytes.iter().map(|&it| Counted(it)));
    BYTES.set((units.as_ptr().addr(), bytes));
    let (a, b) = units[before..].split_at(text.len());
    let mut places = (0..text.len()).filter(|&at| text[at..].starts_with(needle));
    let want = match FORWARD {
        true => places.next(),
        false => places.next_back(),
    };
    for search in [
        simd::portable::find::<_, 16, 16, FORWARD>,
        simd::portable32::find::<_, 32, 16, FORWARD>,
        simd::portable64::find::<_, 64, 16, FORWARD>,
    ] {
        assert_eq!(index_with::<_, FORWARD>(a, b, search), want);
    }
}

/// Forward and, with both turned around, back.
#[track_caller]
fn reads_at_most(most: usize, cases: impl IntoIterator<Item = [Vec<u8>; 2]>) {
    READS.set(0);
    for [mut text, mut needle] in cases {
        at_all_widths::<true>(&text, &needle);
        text.reverse();
        needle.reverse();
        at_all_widths::<false>(&text, &needle);
    }
    assert!(READS.get() <= most, "{} reads", READS.get());
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

    reads_at_most(105_000, [[cycle(b"ab", 300_000), b"axb".into()]]);
    let sparse = [b"a.x.b", &[b'.'; 5000][..]].concat();
    let text = [cycle(b"ab", 20_000), sparse.repeat(80)].concat();
    reads_at_most(140_000, [[text, b"axb".into()]]);

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
    reads_at_most(11_000, late_misses);

    let cases = each(&[20, 40, 64, 70, 100, 200, 400, 700], &[3, 5, 9, 17, 40]);
    let short = cases.into_iter().flat_map(|(total, len)| {
        let needle = cycle(b"a", len);
        [
            [cycle(b"a", total), put(needle.clone(), len / 2, b'x')],
            [cycle(b".", total), needle.clone()],
            [broken(b"a", len, total), needle],
        ]
    });
    reads_at_most(125_000, short);
}

#[test]
fn once_it_has_learned() {
    let one_unit = |(len, at)| [cycle(b"a", 1000 + len), put(cycle(b"a", len), at, b'x')];
    reads_at_most(9450, inside(&LENGTHS[5..]).map(one_unit));

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
    reads_at_most(12_500, short_decoys);

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
    reads_at_most(115_000, then_other);

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
    reads_at_most(158_000, decoys);
    for (most, period) in [(300_000, &b"ab"[..]), (300_000, b"abc"), (320_000, b"abcd")] {
        let case = |(len, at)| [cycle(period, 20_000), out_of_step(period, len, at)];
        reads_at_most(most, inside(&LENGTHS[1..]).map(case));
    }

    let needle = |len| [cycle(b"a", len), cycle(b"b", 2 * len), cycle(b"a", len)].concat();
    let mostly_a = put(cycle(b"a", 32), 0, b'c');
    let cases = each(&[&b"ac"[..], b"aac", &mostly_a], &[20, 70, 150]).into_iter();
    reads_at_most(
        370_000,
        cases.map(|(it, len)| [noise(it, 20_000), needle(len)]),
    );
    let text = [
        noise(b"bc", 1000),
        noise(b"ac", 10_000),
        noise(b"bc", 10_000),
    ]
    .concat();
    reads_at_most(115_000, [70, 150].map(|len| [text.clone(), needle(len)]));

    let lengths = [24, 33, 70, 150, 700];
    reads_at_most(
        480_000,
        lengths.map(|it| [noise(b"ab", 20_000), noise(b"ab", it)]),
    );
}

#[test]
fn when_it_falls_back() {
    let case = |(period, len)| [broken(period, len, 20_000), cycle(period, len)];
    for (most, lengths) in [
        (1_450_000, &LENGTHS[1..5]),
        (710_000, &[33, 47, 70, 150, 700]),
    ] {
        reads_at_most(
            most,
            each(&[&b"a"[..], b"ab"], lengths).into_iter().map(case),
        );
    }
    let jumps = |len| [broken(b"b", len, 20_000), cycle(b"b", len)];
    reads_at_most(86_000, [9, 33, 150].map(jumps));
    let text = [broken(b"a", 27, 20_000), cycle(b".", 20_000)].concat();
    reads_at_most(92_000, [[text, cycle(b"a", 35)]]);
    for (most, [dense, calm, times]) in
        [(385_000, [3000, 100_000, 2]), (1_950_000, [400, 130, 150])]
    {
        let text = |len| [broken(b"a", len, dense), cycle(b".", calm)].concat();
        let case = |len| [text(len).repeat(times), cycle(b"a", len)];
        reads_at_most(most, [9, 18, 40].map(case));
    }
    let text = |len| [broken(b"ab", len - 1, 1500), cycle(b"a", 6000)].concat();
    let only_ends = |len| [text(len).repeat(20), cycle(b"ab", len)];
    reads_at_most(740_000, [71, 151].map(only_ends));
    // Each candidate differs far from its start, and at another place.
    let period = put(cycle(b"abcdef", 72), 71, b'e');
    let (mut text, needle) = (period.repeat(3600), cycle(&period, 900 * 72 + 18));
    (text[41..].iter_mut().step_by(450 * 72)).for_each(|it| *it = b'e');
    reads_at_most(3_250_000, [[text, needle]]);
}

#[test]
fn where_six_units_tell() {
    for (len, run) in each(&[6, 7, 8, 10, 30, 37, 74, 211], &[4, 5, 6]) {
        reads_at_most(93_000, [[broken(b"a", run, 30_000), cycle(b"a", len)]]);
    }
    let thue_morse = |len| (0..len).map(|i: u32| b"ab"[i.count_ones() as usize % 2]);
    let thue_morse = |len| thue_morse(len).collect::<Vec<_>>();
    for (most, needle, at, unit) in [
        (22_000, thue_morse(70), 69, b'c'),
        (14_500, thue_morse(100), 99, b'c'),
        (75_000, thue_morse(100), 0, b'b'),
        (19_000, thue_morse(144), 0, b'c'),
        (17_000, thue_morse(144), 142, b'c'),
        (21_000, thue_morse(163), 0, b'c'),
        (18_000, thue_morse(163), 161, b'c'),
        (31_000, thue_morse(244), 207, b'c'),
        (13_000, noise(b"ab", 100), 99, b'c'),
        (58_000, noise(b"ab", 700), 698, b'c'),
        (78_000, cycle(b"aab", 69), 1, b'#'),
    ] {
        let copies = cycle(&put(needle.clone(), at, unit), 30_000);
        reads_at_most(most, [[copies, needle]]);
    }
    let text = [cycle(b"aaaaaaaaaab", 1000), cycle(b"a", 60_000)].concat();
    reads_at_most(28_000, [[text, put(cycle(b"a", 150), 74, b'b')]]);
    let text = [cycle(b"babb", 500), cycle(b".", 30_000)].concat();
    reads_at_most(13_000, [[text, b"bbbb".into()]]);
}

#[test]
fn in_periods_and_phases() {
    let slip = |period: &[u8], a, b| [&cycle(period, a), &period[..1], &cycle(period, b)].concat();
    let then = |start: &[u8], len| [start, &cycle(&start[start.len() - 3..], len)].concat();
    for (most, period, needle) in [
        (70_000, &b"aab"[..], b"aaaaaba".into()),
        (30_000, b"aab", b"aaaabaaba".into()),
        (35_000, b"abb#bcabb", b"abbabcabb".into()),
        (20_000, b"bbaaaa", put(cycle(b"a", 20), 15, b'b')),
        (72_000, b"bbbbbabbbbbbbbbbb.....", cycle(b"b", 17)),
        (11_500, b"abaabaa#aabaaba#baabaab#", cycle(b"aba", 64)),
        (82_000, b"abababaa", cycle(b"ab", 72)),
        (27_000, b"cabcabcaccabcabccbcabcab", then(b"accab", 264)),
        (21_000, b"bcccbccbccbccbc", then(b"cbccbccbcccccb", 345)),
        (25_000, &broken(b"aca", 34, 34), slip(b"aca", 117, 111)),
        (25_000, &broken(b"ccb", 34, 34), slip(b"ccb", 63, 99)),
    ] {
        reads_at_most(most, [[cycle(period, 30_000), needle]]);
    }
    let phases = |[a, b]: [&[u8]; 2], [m, n]: [usize; 2]| [cycle(a, m), cycle(b, n)].concat();
    for lengths in [[700, 200], [700, 300], [700, 500], [700, 1000], [1000, 300]] {
        let text = cycle(&phases([b"bxa", b"bbbba"], lengths), 30_000);
        reads_at_most(29_000, [[text, b"abbbbxa".into()]]);
    }
    let text = cycle(&phases([b"a", b"abx"], [200, 200]), 30_000);
    reads_at_most(18_000, [[text, b"aax".into()]]);
}
