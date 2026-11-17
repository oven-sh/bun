use bun_core::vec::BorrowedBuf;
use bun_zlib::inflate::{Container, Status, has_zlib_header};
use bun_zlib::{Damage, Error, Inflater, Result};

use crate::plain::{self, End, adler32, crc32};
use crate::samples::Random;
use crate::writer::Writer;

const WINDOW_SIZE: usize = 1 << 15;

/// One call with exactly so much room.
fn step(
    inflater: &mut Inflater,
    input: &mut &[u8],
    room: usize,
    by_blocks: bool,
) -> (Vec<u8>, Result<Status>) {
    let mut bytes = vec![0; room];
    let mut out = BorrowedBuf::from(&mut bytes[..]);
    let status = match by_blocks {
        true => inflater.inflate_block(input, out.unfilled()),
        false => inflater.inflate(input, out.unfilled()),
    };
    let written = out.len();
    match status {
        Ok(Status::NeedsInput) => assert!(input.is_empty()),
        Ok(Status::NeedsOutput) => assert_eq!(written, room),
        Ok(Status::BlockEnd) => assert!(by_blocks),
        _ => {}
    }
    bytes.truncate(written);
    (bytes, status)
}

struct Run {
    bytes: Vec<u8>,
    end: End,
    /// Of what each call has read, written and returned, to compare with zlib-ng 2.3.3.
    calls: u32,
}

/// `sizes` gives those of the input and the output for each call.
fn run(
    inflater: &mut Inflater,
    input: &[u8],
    by_blocks: bool,
    mut sizes: impl FnMut() -> (usize, usize),
) -> Run {
    let (mut bytes, mut read, mut calls) = (Vec::new(), 0, 0);
    for _ in 0..1_000_000 {
        let (len, room) = sizes();
        let mut piece = &input[read..input.len().min(read + len)];
        let len = piece.len();
        let (written, status) = step(inflater, &mut piece, room, by_blocks);
        bytes.extend(&written);
        let end = match status {
            Err(Error::Damaged(damage)) => Some(End::Damaged(damage)),
            _ => {
                read += len - piece.len();
                let call = format!("{read} {} {status:?}", bytes.len());
                calls = crc32(calls, call.as_bytes());
                match status.unwrap() {
                    Status::StreamEnd => Some(End::Stream(read)),
                    Status::NeedsInput if read == input.len() => Some(End::CutShort),
                    _ => None,
                }
            }
        };
        if let Some(end) = end {
            return Run { bytes, end, calls };
        }
    }
    panic!("stuck after reading {read} and writing {}", bytes.len());
}

fn raw_with(dictionary: &[u8]) -> Inflater {
    let mut inflater = Inflater::new(Container::Raw);
    inflater.set_dictionary(dictionary).unwrap();
    inflater
}

/// At once and in pieces of many sizes. Returns a hash of the calls.
fn check(stream: &[u8], dictionary: &[u8], random: &mut Random) -> u32 {
    let expected = plain::inflate(stream, dictionary);
    let room = expected.bytes.len();
    let small = 1 + (stream.len() + room) / 300;
    let mut calls = 0;
    let largest = [
        (small, small),
        (small, 2 * room),
        (2 * stream.len(), small),
        (40 * small, 40 * small),
    ];
    let mut compare = |run: Run| {
        assert_eq!(run.end, expected.end);
        assert!(run.bytes == expected.bytes);
        calls ^= run.calls.rotate_left(calls);
    };
    compare(run(&mut raw_with(dictionary), stream, false, || {
        (stream.len(), room + 1)
    }));
    for (len, room) in largest {
        let by_blocks = random.below(4) == 0;
        compare(run(&mut raw_with(dictionary), stream, by_blocks, || {
            (random.up_to(len), random.up_to(room.max(1)))
        }));
    }
    calls
}

/// For `count` symbols out of `alphabet`, leaving no bits without a meaning.
fn any_code(random: &mut Random, alphabet: usize, count: usize) -> Vec<u8> {
    let mut lengths = vec![1, 1];
    let among_last = random.pick(&[2, 8, alphabet]);
    while lengths.len() < count {
        let mut at = lengths.len() - 1 - random.below(among_last.min(lengths.len()));
        while lengths[at] == 15 {
            at = random.below(lengths.len());
        }
        lengths[at] += 1;
        lengths.push(lengths[at]);
    }
    lengths.resize(alphabet, 0);
    random.shuffle(&mut lengths);
    lengths
}

/// From how many codes there are of each length.
fn code_with(random: &mut Random, counts: [u8; 15]) -> Vec<u8> {
    let mut lengths: Vec<_> = (1..)
        .zip(counts)
        .flat_map(|(bits, count)| vec![bits; count.into()])
        .collect();
    random.shuffle(&mut lengths);
    lengths
}

/// Any bits mean something in such a block, and a whole window is there to copy from.
fn blocks_of_noise(random: &mut Random, mut codes: impl FnMut(&mut Random) -> [Vec<u8>; 2]) -> u32 {
    let mut stream = Writer::default();
    for _ in 0..random.below(3) {
        let [mut literals, distances] = codes(random);
        let used: Vec<_> = (0..256).filter(|&it| literals[it] != 0).collect();
        if literals[256] == 0 && used.len() > 1 {
            literals.swap(256, used[0]);
        }
        stream.dynamic(false, &literals, &distances);
        for _ in 0..random
            .pick(&[0, 10, 3000])
            .min(1000 * used.len().saturating_sub(1))
        {
            stream.symbol(random.pick(&used[1..]));
        }
        stream.end_block();
    }
    let [mut literals, distances] = codes(random);
    let used: Vec<_> = (0..286).filter(|&it| literals[it] != 0).collect();
    let longest = used.iter().copied().max_by_key(|&it| literals[it]).unwrap();
    literals.swap(256, random.pick(&[longest, longest, used[0]]));
    stream.dynamic(random.below(2) == 0, &literals, &distances);
    let mut stream = stream.finish();
    let len = random.pick(&[20, 300, 2000]);
    stream.extend(random.bytes(len));
    check(&stream, &random.bytes(WINDOW_SIZE), random)
}

#[test]
fn any_code_is_read_as_by_a_plain_decoder() {
    let calls = (0..600).fold(0, |calls, seed| {
        calls
            ^ blocks_of_noise(&mut Random::new(seed), |random| {
                let literals = random.pick(&[2, 5, 40, 150, 286]);
                let distances = random.pick(&[2, 4, 12, 30]);
                [
                    any_code(random, 286, literals),
                    any_code(random, 30, distances),
                ]
            })
    });
    assert_eq!(calls, 0xbd90_ceae, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn only_a_code_for_one_symbol_or_none_may_be_incomplete() {
    let with = |lengths: &[u8], first: usize, alphabet: usize| {
        let mut all = vec![0; alphabet];
        all[first..][..lengths.len()].copy_from_slice(lengths);
        all
    };
    let lengths: [&[u8]; _] = [
        &[],
        &[1],
        &[2],
        &[1, 1],
        &[1, 2],
        &[1, 1, 1],
        &[1, 2, 2],
        &[2, 1, 2, 15],
        &[0, 1],
    ];
    let mut random = Random::new(1);
    let mut calls = 0;
    for literals in lengths {
        for distances in lengths {
            for (first, noise) in [(255, 1), (255, 40), (256, 1), (256, 40)] {
                let mut stream = Writer::default();
                let earlier = [(286, 286), (30, 30)].map(|it| any_code(&mut random, it.0, it.1));
                stream.dynamic(false, &earlier[0], &earlier[1]).end_block();
                stream.dynamic(false, &with(literals, first, 260), &with(distances, 3, 9));
                for byte in random.bytes(noise) {
                    stream.put(byte.into(), 8);
                }
                calls ^= check(&stream.finish(), b"abcdefghijklmnopqrstuvwxyz", &mut random);
            }
        }
    }
    assert_eq!(calls, 0x03e1_4cf2, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn it_takes_a_bit_to_miss_the_distance_code() {
    let mut lengths = vec![0; 258];
    (lengths[0], lengths[256], lengths[257]) = (1, 2, 2);
    let ends = [0, 1, 2, 3, 4, 5, 6, 7].map(|literals| {
        let mut stream = Writer::default();
        stream
            .dynamic(true, &lengths, &[0])
            .literals(&vec![0; literals])
            .symbol(257);
        let stream = stream.finish();
        check(&stream, &[], &mut Random::new(1));
        plain::inflate(&stream, &[]).end
    });
    assert_eq!(ends.iter().filter(|&&it| it == End::CutShort).count(), 1);
}

#[test]
fn there_is_room_for_the_largest_tables() {
    // For 9 to 12 bits in the first table, and 7 to 10.
    let literals = [
        [1, 1, 1, 0, 0, 0, 0, 0, 0, 117, 1, 17, 17, 1, 130],
        [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 117, 1, 1, 1, 162],
        [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 101, 9, 9, 162],
        [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 77, 1, 202],
    ];
    let distances = [
        [1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 1, 1, 2],
        [1, 1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 1, 2],
        [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 2],
        [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 2],
    ];
    let mut random = Random::new(1);
    for (literals, distances) in literals.into_iter().zip(distances) {
        let [literals, distances] = [literals, distances].map(|it| code_with(&mut random, it));
        let mut stream = Writer::default();
        stream.dynamic(true, &literals, &distances);
        for byte in 0..=255 {
            stream.literals(&[byte]);
        }
        for (len, _) in plain::LENGTHS {
            for (distance, _) in plain::DISTANCES {
                stream.copy(len, distance);
            }
        }
        let dictionary = random.bytes(WINDOW_SIZE);
        check(&stream.end_block().finish(), &dictionary, &mut random);
    }
}

#[test]
fn damage_is_found_where_a_plain_decoder_finds_it() {
    let calls = (0..1500).fold(0, |calls, seed| {
        let mut random = Random::new(seed);
        let input = random.mixed(600, 512);
        let mut stream = crate::deflate::raw(&input, 1 + seed as i32 % 9, 1);
        for _ in 0..=random.below(2) {
            let within = random.pick(&[4, 40, stream.len()]).min(stream.len());
            let at = random.below(within);
            stream[at] ^= 1 << random.below(8);
        }
        stream.truncate(stream.len() - random.pick(&[0, 0, 0, 1, 9]));
        calls ^ check(&stream, &input[..random.pick(&[0, 0, 100])], &mut random)
    });
    assert_eq!(calls, 0x6a9e_afc4, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn a_long_period_may_be_broken_anywhere() {
    let calls = (0..150).fold(0, |calls, seed| {
        let mut random = Random::new(seed);
        let period = match random.below(4) {
            0 => 1 + random.below(40),
            1 => random.pick(&[1, 2, 3, 6, 43, 86, 129, 258]) * (1 + random.below(127)),
            2 => 1 << random.below(16),
            _ => 1 + random.below(WINDOW_SIZE),
        };
        let mut stream = Writer::default();
        stream.stored(false, &random.bytes(period));
        match random.below(2) {
            0 => stream.fixed(true),
            _ => stream.dynamic(
                true,
                &any_code(&mut random, 286, 286),
                &any_code(&mut random, 30, 30),
            ),
        };
        for _ in 0..random.below(4) {
            let len = random.pick(&[258, 258, 258, 257]);
            for _ in 0..100 + random.below(300) {
                stream.copy(len, period);
            }
            match random.below(5) {
                0 => stream.literals(b"x"),
                1 => stream.copy_with(27, 258, period),
                2 => stream.copy(3 + random.below(255), period),
                3 => stream.copy(258, (2 * period).min(WINDOW_SIZE)),
                _ => stream.copy(258, 1 + random.below(WINDOW_SIZE)),
            };
        }
        let mut stream = stream.end_block().finish();
        stream.truncate(stream.len() - random.pick(&[0, 0, 0, 50]).min(stream.len()));
        calls ^ check(&stream, &[], &mut random)
    });
    assert_eq!(calls, 0xed9a_0245, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn matches_reach_into_stored_blocks_and_dictionaries_of_any_size() {
    let sizes = [
        0, 1, 255, 700, 9000, 32767, 32768, 32769, 33151, 33472, 65535,
    ];
    let mut random = Random::new(1);
    for first in sizes {
        for second in sizes {
            let (dictionary, stored) = (random.bytes(first), random.bytes(second));
            let reach = (first + second + 1).min(WINDOW_SIZE);
            let mut stream = Writer::default();
            stream
                .fixed(false)
                .literals(b"a")
                .end_block()
                .stored(false, &stored)
                .fixed(false);
            for len in [258, 3, 33, 257] {
                stream.copy(len, reach).copy(len, 1 + random.below(reach));
            }
            stream
                .end_block()
                .stored(false, &stored)
                .fixed(true)
                .copy(258, reach);
            check(&stream.end_block().finish(), &dictionary, &mut random);
        }
    }
}

#[test]
fn a_few_literals_may_follow_a_stored_block() {
    let bytes = Random::new(1).bytes(320);
    let mut calls = 0;
    for (literals, is_match_next) in (0..20).flat_map(|it| [(it, false), (it, true)]) {
        let mut raw = Writer::default();
        raw.stored(false, &bytes[..300])
            .fixed(false)
            .literals(&bytes[300..][..literals]);
        if is_match_next {
            raw.copy(5, 299 + literals);
        }
        let raw = raw.end_block().fixed(true).end_block().finish();
        let plain = plain::inflate(&raw, &[]).bytes;
        for (container, stream) in [
            (Container::Raw, raw.clone()),
            (Container::Zlib, in_zlib(&raw, &plain, None)),
            (Container::Gzip, in_gzip(&raw, &plain)),
        ] {
            for (held_back, room) in
                (0..24).flat_map(|it| (298..plain.len() + 2).map(move |room| (it, room)))
            {
                let mut first = Some((stream.len() - held_back, room));
                let sizes = || first.take().unwrap_or((999, 999));
                let result = run(&mut Inflater::new(container), &stream, false, sizes);
                assert_eq!(
                    (&result.bytes, result.end),
                    (&plain, End::Stream(stream.len()))
                );
                calls = result.calls ^ u32::rotate_left(calls, 1);
            }
        }
    }
    assert_eq!(calls, 0x3384_ae00, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn a_small_window_is_all_that_is_kept_between_calls() {
    for window_bits in 8..15 {
        let size = 1 << window_bits;
        let stored = Random::new(1).bytes(size + 9);
        for (distance, len) in [(size, 258), (size + 1, 258), (size + 1, 3)] {
            let mut stream = Writer::default();
            stream
                .stored(false, &stored)
                .fixed(true)
                .copy(len, distance);
            let stream = stream.literals(&[0; 20]).end_block().finish();
            let with_first_room = |first| {
                let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
                let mut rooms = [first].into_iter();
                let sizes = || (stream.len(), rooms.next().unwrap_or(999));
                let result = run(&mut inflater, &stream, false, sizes);
                (result.bytes.len(), result.end)
            };
            let whole = (stored.len() + len + 20, End::Stream(stream.len()));
            assert_eq!(with_first_room(stored.len() + len), whole);
            for room in [0, 1, len - 1].map(|it| stored.len() + it) {
                let expected = match distance > size {
                    true => (room, Damage::DistanceTooFarBack.into()),
                    false => whole,
                };
                assert_eq!(with_first_room(room), expected);
            }
        }
    }
}

#[test]
fn a_match_that_is_out_of_reach_fails_when_there_is_room_for_it() {
    // One never was within reach, and the other is not any more.
    for (distance, room) in [(400, 300), (290, 301)] {
        let mut stream = Writer::default();
        let stream = stream
            .stored(false, &[7; 300])
            .fixed(true)
            .copy(9, distance)
            .finish();
        let mut inflater = Inflater::with_window_bits(Container::Raw, 8).unwrap();
        let mut input = &stream[..];
        for room in [room, 0, 0] {
            assert_eq!(
                step(&mut inflater, &mut input, room, false).1,
                Ok(Status::NeedsOutput)
            );
        }
        let error = Err(Damage::DistanceTooFarBack.into());
        assert_eq!(step(&mut inflater, &mut input, 1, false), (vec![], error));
    }
}

#[test]
fn a_small_window_is_all_that_is_kept_while_waiting_for_input() {
    for (distance, expected) in [
        (256, Ok(Status::StreamEnd)),
        (257, Err(Damage::DistanceTooFarBack.into())),
    ] {
        let mut stream = Writer::default();
        stream
            .stored(false, &[7; 300])
            .fixed(true)
            .copy(9, distance);
        let stream = stream.end_block().finish();
        let (mut first, mut rest) = stream.split_at(305);
        let mut inflater = Inflater::with_window_bits(Container::Raw, 8).unwrap();
        assert_eq!(
            step(&mut inflater, &mut first, 999, false).1,
            Ok(Status::NeedsInput)
        );
        assert_eq!(step(&mut inflater, &mut rest, 999, false).1, expected);
    }
}

#[test]
fn a_small_window_is_all_that_is_kept_in_a_long_period() {
    let mut stream = Writer::default();
    stream.stored(false, &Random::new(1).bytes(600)).fixed(true);
    (0..200).for_each(|_| _ = stream.copy(258, 600));
    let stream = stream.end_block().finish();
    for (window_bits, room) in [(9, 40_000), (9, 40_074), (9, 99_999), (10, 40_000)] {
        let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
        let result = run(&mut inflater, &stream, false, || (stream.len(), room));
        let expected = match (window_bits, room) {
            (9, ..99_999) => (room, Damage::DistanceTooFarBack.into()),
            _ => (600 + 200 * 258, End::Stream(stream.len())),
        };
        assert_eq!((result.bytes.len(), result.end), expected);
    }
}

#[test]
fn a_period_is_not_taken_for_longer_than_it_is() {
    for odd in 500..1000 {
        let mut start = vec![7; 1001];
        start[odd] = 8;
        let mut stream = Writer::default();
        stream.stored(false, &start).fixed(true);
        (0..130).for_each(|_| _ = stream.copy(258, 1));
        let stream = stream.copy(258, WINDOW_SIZE).end_block().finish();
        let result = run(&mut raw_with(&[]), &stream, false, || (9999, 99_999));
        assert!(result.bytes == plain::inflate(&stream, &[]).bytes, "{odd}");
    }
}

#[test]
fn a_period_that_has_just_been_broken_is_over() {
    for len in 700..1000 {
        for odd in [&[8][..], &[7, 8], &[8, 7]] {
            let mut stream = Writer::default();
            stream.stored(false, &vec![7; len]).fixed(true);
            (0..126).for_each(|_| _ = stream.copy(258, 2));
            let stream = stream
                .literals(odd)
                .copy(258, 2)
                .copy(258, 2)
                .end_block()
                .finish();
            let result = run(&mut raw_with(&[]), &stream, false, || (9999, 99_999));
            assert!(result.bytes == plain::inflate(&stream, &[]).bytes, "{len}");
        }
    }
}

#[test]
fn a_long_period_goes_on_in_the_next_call() {
    let mut random = Random::new(1);
    for period in [1, 2, 257, 258, 259, 16_383, 16_384, 16_385, 32_767, 32_768] {
        let start = random.bytes(period);
        let mut stream = Writer::default();
        stream.fixed(false);
        (0..300).for_each(|_| _ = stream.copy(258, period));
        stream
            .end_block()
            .fixed(true)
            .literals(b"a")
            .copy(258, WINDOW_SIZE)
            .copy(258, 700);
        let stream = stream.end_block().finish();
        let expected = plain::inflate(&stream, &start);
        // The first call ends around the start of the run, in the middle of it, or around its end.
        let firsts = (32_000..34_000)
            .step_by(129)
            .chain([50_000])
            .chain(300 * 258 - 259..300 * 258 + 2);
        for first in firsts.step_by(if period < 300 { 1 } else { 7 }) {
            let (len, room) = random.pick(&[
                (1, 9999),
                (9999, 257),
                (9999, 258),
                (9999, 259),
                (9999, 9999),
            ]);
            let mut firsts = [(stream.len().min(len * 300), first), (0, 0), (1, 1)].into_iter();
            let sizes = || firsts.next().unwrap_or((len, room));
            let result = run(&mut raw_with(&start), &stream, first % 2 == 0, sizes);
            assert!(
                result.end == expected.end && result.bytes == expected.bytes,
                "{period} {first}"
            );
        }
    }
}

#[test]
fn nothing_is_left_after_reset() {
    let mut random = Random::new(1);
    let first = [random.mixed(40_000, WINDOW_SIZE), vec![7; 80_000]].concat();
    let first = crate::deflate::raw(&first, 6, 3);
    let reaching = Writer::default()
        .fixed(true)
        .literals(b"ab")
        .copy(3, 3)
        .finish();
    let input = random.mixed(34_000, 512);
    let whole = crate::deflate::raw(&input, 6, 8);
    let mut inflater = Inflater::new(Container::Raw);
    let cuts = (0..200).chain((200..first.len()).step_by(499));
    let cuts = cuts.map(|cut| (cut, random.pick(&[0, 7, 30_000, 120_000])));
    // In the middle of the long period, and at the end.
    for (cut, room) in cuts.chain([(first.len(), 110_000), (first.len(), 120_000)]) {
        for (next, bytes, end) in [
            (
                &reaching,
                &b"ab"[..],
                End::Damaged(Damage::DistanceTooFarBack),
            ),
            (&whole, &input, End::Stream(whole.len())),
        ] {
            inflater.reset();
            step(&mut inflater, &mut &first[..cut], room, false)
                .1
                .unwrap();
            inflater.reset();
            let after = run(&mut inflater, next, false, || (999, 999));
            assert_eq!((&after.bytes[..], after.end), (bytes, end), "{cut}");
        }
    }
}

fn in_zlib(raw: &[u8], plain: &[u8], dictionary: Option<&[u8]>) -> Vec<u8> {
    let header = match dictionary {
        Some(it) => [&[0x78, 0xbb][..], &adler32(1, it).to_be_bytes()].concat(),
        None => vec![0x78, 0x9c],
    };
    [&header, raw, &adler32(1, plain).to_be_bytes()].concat()
}

fn in_gzip(raw: &[u8], plain: &[u8]) -> Vec<u8> {
    let mut header = b"\x1f\x8b\x08\x1e123456\x03\0abcthe name of the file\0a comment\0".to_vec();
    header.extend(&crc32(0, &header).to_le_bytes()[..2]);
    let len = plain.len() as u32;
    [
        &header,
        raw,
        &crc32(0, plain).to_le_bytes(),
        &len.to_le_bytes(),
    ]
    .concat()
}

#[test]
fn containers_are_read_in_pieces_of_any_size() {
    let plain = Random::new(1).mixed(500, 512);
    let raw = crate::deflate::raw(&plain, 6, 1);
    let mut calls = 0;
    for stream in [in_zlib(&raw, &plain, None), in_gzip(&raw, &plain)] {
        let followed = [&stream[..], &[0xff; 20]].concat();
        for len in 1..70 {
            for room in [1, 5, 499, 500, 501] {
                let mut inflater = Inflater::new(Container::ZlibOrGzip);
                let result = run(&mut inflater, &followed, len % 3 == 0, || (len, room));
                assert_eq!(
                    (&result.bytes, result.end),
                    (&plain, End::Stream(stream.len()))
                );
                calls = result.calls ^ u32::rotate_left(calls, 1);
            }
        }
    }
    assert_eq!(calls, 0x891b_6ea9, "zlib-ng 2.3.3 stops elsewhere");
}

#[test]
fn the_fields_of_containers_are_checked() {
    use Container::{Gzip, Zlib};
    use Damage::*;
    let end = |container, stream: &[u8]| {
        run(&mut Inflater::new(container), stream, false, || (99, 99)).end
    };
    let raw = Writer::default().stored(true, b"abc").finish();
    let (zlib, gzip) = (in_zlib(&raw, b"abc", None), in_gzip(&raw, b"abc"));
    let bare_gzip = [b"\x1f\x8b\x08\x00123456", &gzip[48..]].concat();
    for (container, stream, bits, expected) in [
        (Zlib, &zlib, 0..16, HeaderCheck.into()),
        (Zlib, &zlib, 8 * 10..8 * 14, DataCheck.into()),
        (Gzip, &bare_gzip, 0..16, HeaderCheck.into()),
        (Gzip, &bare_gzip, 16..24, UnknownMethod.into()),
        (Gzip, &bare_gzip, 24..25, End::Stream(bare_gzip.len())),
        (Gzip, &bare_gzip, 29..32, UnknownHeaderFlags.into()),
        (Gzip, &bare_gzip, 32..80, End::Stream(bare_gzip.len())),
        (Gzip, &gzip, 24..25, HeaderCrc.into()),
        (Gzip, &gzip, 8 * 4..8 * 10, HeaderCrc.into()),
        (Gzip, &gzip, 8 * 12..8 * 18, HeaderCrc.into()),
        (Gzip, &gzip, 8 * 38..8 * 45, HeaderCrc.into()),
        (Gzip, &gzip, 8 * 46..8 * 48, HeaderCrc.into()),
        (Gzip, &gzip, 8 * 49..8 * 53, StoredLengths.into()),
        (Gzip, &gzip, 8 * 53..8 * 60, DataCheck.into()),
        (Gzip, &gzip, 8 * 60..8 * 64, LengthCheck.into()),
    ] {
        for bit in bits {
            let mut stream = stream.clone();
            stream[bit / 8] ^= 1 << (bit % 8);
            assert_eq!(end(container, &stream), expected, "{bit}");
        }
    }
    assert_eq!(end(Gzip, &zlib), HeaderCheck.into());
    assert_eq!(end(Zlib, &gzip), HeaderCheck.into());
    assert_eq!(end(Zlib, &[0x79, 0x18]), UnknownMethod.into());
    assert_eq!(end(Zlib, &[0x88, 0x1c]), WindowSize.into());
}

#[test]
fn a_zlib_stream_keeps_to_the_window_in_its_header() {
    // With many bytes behind the match or few, and where the output starts over in the window.
    for (matches, trailing) in [(0, 0), (0, 40), (127, 40), (128, 40), (129, 40), (130, 40)] {
        for (distance, is_within) in [(256, true), (257, false), (258, false)] {
            let mut raw = Writer::default();
            raw.fixed(true).literals(&[7; 300]);
            (0..matches).for_each(|_| _ = raw.copy(258, 1));
            let raw = raw
                .copy(258, distance)
                .literals(&vec![7; trailing])
                .end_block()
                .finish();
            let plain = vec![7; 300 + 258 * (matches + 1) + trailing];
            let stream = [&[0x08, 0x1d], &in_zlib(&raw, &plain, None)[2..]].concat();
            let result = run(&mut Inflater::new(Container::Zlib), &stream, false, || {
                (999, 99_999)
            });
            let expected = match is_within {
                true => (plain.len(), End::Stream(stream.len())),
                false => (300 + 258 * matches, Damage::DistanceTooFarBack.into()),
            };
            assert_eq!((result.bytes.len(), result.end), expected);
        }
    }
}

#[test]
fn what_a_header_says_holds_for_its_stream_only() {
    let plain = vec![7; WINDOW_SIZE + 100];
    let mut raw = Writer::default();
    let raw = raw
        .stored(false, &plain[..WINDOW_SIZE])
        .fixed(true)
        .copy(100, WINDOW_SIZE)
        .end_block()
        .finish();
    let mut inflater = Inflater::new(Container::ZlibOrGzip);
    for header in [&[0x08, 0x1d][..], &in_gzip(&raw, &plain)[..40]] {
        for stream in [in_gzip(&raw, &plain), in_zlib(&raw, &plain, None)] {
            step(&mut inflater, &mut &*header, 9, false).1.unwrap();
            inflater.reset();
            let result = run(&mut inflater, &stream, false, || (999, 999));
            assert_eq!(result.end, End::Stream(stream.len()));
            inflater.reset();
        }
    }
}

#[test]
fn without_a_code_for_code_lengths_each_takes_a_bit() {
    let stream = Writer::default()
        .put(2 << 1, 3)
        .put(0, 14 + 12)
        .put(0, 50)
        .finish();
    for (len, end) in [(35, End::CutShort), (36, Damage::MissingEndOfBlock.into())] {
        let stream = [&stream[..], &[0xa5; 40]].concat();
        let result = run(
            &mut Inflater::new(Container::Raw),
            &stream[..len],
            false,
            || (99, 99),
        );
        assert_eq!(result.end, end);
    }
}

#[test]
fn what_was_read_ahead_and_put_back_is_forgotten() {
    let mut stream = Writer::default();
    let stream = stream
        .fixed(false)
        .literals(b"abc")
        .end_block()
        .stored(true, b"def")
        .finish();
    for stop in 0..3 {
        let (mut inflater, mut input) = (Inflater::new(Container::Raw), &stream[..]);
        let (mut bytes, _) = step(&mut inflater, &mut input, stop, false);
        let read = stream.len() - input.len();
        // Other bytes than were there before.
        let changed: Vec<_> = stream[..read].iter().copied().chain([0; 20]).collect();
        let result = run(&mut inflater, &changed[read..], false, || (99, 99));
        bytes.extend(result.bytes);
        assert_eq!(bytes, plain::inflate(&changed, &[]).bytes);
    }
}

#[test]
fn damage_has_the_messages_of_zlib() {
    use Damage::*;
    for (damage, message) in [
        (HeaderCheck, "incorrect header check"),
        (UnknownMethod, "unknown compression method"),
        (WindowSize, "invalid window size"),
        (UnknownHeaderFlags, "unknown header flags set"),
        (HeaderCrc, "header crc mismatch"),
        (BlockType, "invalid block type"),
        (StoredLengths, "invalid stored block lengths"),
        (TooManySymbols, "too many length or distance symbols"),
        (CodeLengthsSet, "invalid code lengths set"),
        (BitLengthRepeat, "invalid bit length repeat"),
        (MissingEndOfBlock, "invalid code -- missing end-of-block"),
        (LiteralLengthsSet, "invalid literal/lengths set"),
        (DistancesSet, "invalid distances set"),
        (LiteralLengthCode, "invalid literal/length code"),
        (DistanceCode, "invalid distance code"),
        (DistanceTooFarBack, "invalid distance too far back"),
        (DataCheck, "incorrect data check"),
        (LengthCheck, "incorrect length check"),
    ] {
        assert_eq!(Error::from(damage).to_string(), message);
    }
}

#[test]
fn the_end_and_errors_are_final() {
    let results = [
        (&[3, 0][..], Ok(Status::StreamEnd)),
        (&[7], Err(Damage::BlockType.into())),
    ];
    for (mut stream, result) in results {
        let mut inflater = Inflater::new(Container::Raw);
        assert_eq!(step(&mut inflater, &mut stream, 0, false).1, result);
        let mut more = &[3, 0][..];
        assert_eq!(step(&mut inflater, &mut more, 9, false), (vec![], result));
        assert_eq!(step(&mut inflater, &mut more, 9, true), (vec![], result));
        assert_eq!(more.len(), 2);
        assert_eq!(inflater.set_dictionary(b"a"), Err(Error::InvalidState));
    }
}

#[test]
fn a_dictionary_is_taken_only_when_it_is_asked_for() {
    let raw = Writer::default()
        .fixed(true)
        .copy(3, 3)
        .end_block()
        .finish();
    let stream = in_zlib(&raw, b"abc", Some(b"abc"));
    let (mut inflater, mut input) = (Inflater::new(Container::Zlib), &stream[..]);
    assert_eq!(inflater.set_dictionary(b"abc"), Err(Error::InvalidState));
    for _ in 0..2 {
        assert_eq!(
            step(&mut inflater, &mut input, 9, false).1,
            Ok(Status::NeedsDictionary)
        );
        assert_eq!(input.len(), stream.len() - 6);
        assert_eq!(inflater.set_dictionary(b"abd"), Err(Error::WrongDictionary));
    }
    assert_eq!(inflater.set_dictionary(b"abc"), Ok(()));
    assert_eq!(
        step(&mut inflater, &mut input, 9, true),
        (vec![], Ok(Status::BlockEnd))
    );
    assert_eq!(
        step(&mut inflater, &mut input, 1, false).1,
        Ok(Status::NeedsOutput)
    );
    assert_eq!(inflater.set_dictionary(b"abc"), Err(Error::InvalidState));
    assert_eq!(
        step(&mut inflater, &mut input, 2, false),
        (b"bc".to_vec(), Ok(Status::StreamEnd))
    );
}

#[test]
fn the_adler32_can_be_ignored() {
    let raw = Writer::default().stored(true, b"abc").finish();
    let stream = in_zlib(&raw, b"abd", None);
    let mut inflater = Inflater::new(Container::Zlib);
    let end = |inflater: &mut Inflater, len| {
        inflater.reset();
        run(inflater, &stream[..len], false, || (99, 99)).end
    };
    assert_eq!(
        end(&mut inflater, stream.len()),
        End::Damaged(Damage::DataCheck)
    );
    inflater.ignore_adler32();
    assert_eq!(end(&mut inflater, stream.len() - 1), End::CutShort);
    assert_eq!(end(&mut inflater, stream.len()), End::Stream(stream.len()));
}

#[test]
fn window_bits_tell_the_container() {
    for window_bits in (-40..70).chain([i32::MIN, i32::MAX, 256 + 15, -256 - 15]) {
        let expected = match window_bits {
            -15..=-8 => Ok(Container::Raw),
            0 | 8..=15 => Ok(Container::Zlib),
            16 | 24..=31 => Ok(Container::Gzip),
            32 | 40..=47 => Ok(Container::ZlibOrGzip),
            _ => Err(Error::InvalidParameter),
        };
        let inflater = Inflater::from_zlib_window_bits(window_bits);
        assert_eq!(inflater.map(|it| it.container()), expected, "{window_bits}");
    }
    for window_bits in 0..=u8::MAX {
        let inflater = Inflater::with_window_bits(Container::Raw, window_bits);
        assert_eq!(inflater.is_ok(), (8..=15).contains(&window_bits));
    }
}

#[test]
fn a_zlib_header_is_one_that_an_inflater_takes() {
    for header in (0..=u16::MAX).map(u16::to_be_bytes) {
        let status = step(
            &mut Inflater::new(Container::Zlib),
            &mut &header[..],
            0,
            false,
        )
        .1;
        assert_eq!(has_zlib_header(&header), status.is_ok());
    }
    assert!(has_zlib_header(&[0x78, 0x9c, 0]));
    assert!(!has_zlib_header(&[0x78]));
}

#[test]
fn a_vec_is_like_one_buffer_however_it_grows() {
    let mut random = Random::new(1);
    let start = random.bytes(9000);
    for is_stored in [false, true] {
        let mut stream = Writer::default();
        match is_stored {
            true => stream.stored(false, &start).fixed(true),
            false => stream.fixed(true).literals(&start),
        };
        let stream = stream.copy(258, 9000).copy(258, 257).end_block().finish();
        let plain = plain::inflate(&stream, &[]).bytes;
        for capacity in [0, 1, 300, 8999, 9000, 9001, 9257, 9258, 20_000] {
            let new = || Inflater::with_window_bits(Container::Raw, 8).unwrap();
            let mut out = Vec::with_capacity(capacity);
            let status = new().inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
            assert!(status == Ok(Status::StreamEnd) && out == plain);
            // The next call has only the window to copy from.
            for max in [8000, 9000, 9100, 9258] {
                let (mut inflater, mut input) = (new(), &stream[..]);
                let mut out = Vec::with_capacity(capacity);
                let status = inflater.inflate_to_vec(&mut input, &mut out, max);
                assert_eq!(status, Ok(Status::NeedsOutput));
                let status = inflater.inflate_to_vec(&mut input, &mut out, usize::MAX);
                assert_eq!(status, Err(Damage::DistanceTooFarBack.into()));
                assert!(out == plain[..max.max(9000)]);
            }
        }
    }
}

#[test]
fn a_vec_that_grows_has_the_largest_window_behind_it() {
    let start = Random::new(1).bytes(40_000);
    let mut stream = Writer::default();
    let stream = stream
        .stored(false, &start)
        .fixed(true)
        .copy(9, WINDOW_SIZE)
        .end_block()
        .finish();
    let (mut inflater, mut out) = (
        Inflater::new(Container::Raw),
        Vec::with_capacity(start.len()),
    );
    let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
    assert!(status == Ok(Status::StreamEnd) && out == plain::inflate(&stream, &[]).bytes);
}

#[test]
fn a_vec_grows_up_to_the_limit() {
    let plain = Random::new(1).mixed(50_000, WINDOW_SIZE);
    let stream = crate::deflate::raw(&plain, 6, 8);
    for capacity in [2, 3, 4098, 60_000] {
        for max in [0, 1, 4095, 4096, 4097, 49_999, 50_000, 50_001, usize::MAX] {
            let mut out = Vec::with_capacity(capacity);
            out.extend(b"ab");
            let status =
                Inflater::new(Container::Raw).inflate_to_vec(&mut &stream[..], &mut out, max);
            let expected = match max < plain.len() {
                true => Status::NeedsOutput,
                false => Status::StreamEnd,
            };
            assert_eq!(status, Ok(expected));
            assert!(out[..2] == *b"ab" && out[2..] == plain[..max.min(plain.len())]);
        }
    }
    let mut out = Vec::new();
    let mut inflater = Inflater::new(Container::Raw);
    let status = inflater.inflate_to_vec(&mut &stream[..100], &mut out, usize::MAX);
    assert_eq!(status, Ok(Status::NeedsInput));
    let status = Inflater::new(Container::Raw).inflate_to_vec(&mut &[7][..], &mut out, 9);
    assert_eq!(status, Err(Damage::BlockType.into()));
}

#[test]
fn a_small_window_is_kept_over_many_short_calls() {
    let mut random = Random::new(7);
    for (window_bits, to_vec) in [(8, false), (9, true), (12, false), (13, true), (14, false)] {
        let window = 1 << window_bits;
        let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
        let mut plain = random.mixed(window, 512);
        inflater.set_dictionary(&plain).unwrap();
        loop {
            let start = plain.len();
            let distance = window + usize::from(start > 80_000);
            let (len, others) = (3 + random.below(256), random.up_to(90));
            let others = random.mixed(others, 512);
            let mut raw = Writer::default();
            raw.fixed(false).copy(len, distance).literals(&others);
            let raw = raw.end_block().stored(false, &others).finish();
            (0..len).for_each(|_| plain.push(plain[plain.len() - distance]));
            plain.extend([&others[..], &others].concat());
            let (mut input, mut out) = (&raw[..], Vec::with_capacity(random.up_to(99)));
            let status = match to_vec {
                true => inflater.inflate_to_vec(&mut input, &mut out, 999),
                false => loop {
                    let room = if out.is_empty() { 259 } else { 40 };
                    let (more, status) = step(&mut inflater, &mut input, room, false);
                    out.extend(more);
                    if status != Ok(Status::NeedsOutput) {
                        break status;
                    }
                },
            };
            if distance > window {
                assert_eq!(status, Err(Damage::DistanceTooFarBack.into()));
                break;
            }
            assert_eq!(
                (&out[..], status),
                (&plain[start..], Ok(Status::NeedsInput))
            );
        }
    }
}

#[test]
fn the_rest_of_a_match_adds_to_what_a_small_window_keeps() {
    for (distance, end) in [
        (456, None),
        (457, Some(End::Damaged(Damage::DistanceTooFarBack))),
    ] {
        let mut stream = Writer::default();
        stream.stored(false, &Random::new(1).bytes(600)).fixed(true);
        let stream = stream.copy(258, 200).copy(3, distance).end_block().finish();
        let mut inflater = Inflater::with_window_bits(Container::Raw, 8).unwrap();
        let mut first = Some((999, 658));
        let result = run(&mut inflater, &stream, false, || {
            first.take().unwrap_or((999, 999))
        });
        assert_eq!(result.end, end.unwrap_or(End::Stream(stream.len())));
        assert!(
            plain::inflate(&stream, &[])
                .bytes
                .starts_with(&result.bytes)
        );
    }
}

#[test]
fn a_long_period_may_start_before_the_window_has_all_of_its_memory() {
    for len in (3..=258).step_by(5) {
        let mut stream = Writer::default();
        stream.stored(false, &[7; WINDOW_SIZE]).fixed(true);
        stream.copy(258, 1).copy(len, 1);
        (0..20).for_each(|_| _ = stream.copy(258, 1));
        let stream = stream.end_block().finish();
        let mut inflater = Inflater::with_window_bits(Container::Raw, 8).unwrap();
        let mut first = Some((stream.len(), WINDOW_SIZE + 1100));
        let result = run(&mut inflater, &stream, false, || {
            first.take().unwrap_or((99, 500))
        });
        assert!(result.bytes == plain::inflate(&stream, &[]).bytes, "{len}");
    }
}
