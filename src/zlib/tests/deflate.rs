use bun_zlib::deflate::{Container, Flush, Level, Options, Status, Strategy, compress};
use bun_zlib::{Deflater, Error, Result};

use crate::plain::{self, End, adler32, crc32};
use crate::samples::Random;

const FLUSHES: [Flush; 5] = [
    Flush::None,
    Flush::Block,
    Flush::Partial,
    Flush::Sync,
    Flush::Full,
];

pub(crate) fn options(level: i32, strategy: i32, window_bits: u8, memory_level: u8) -> Options {
    Options {
        level: level.try_into().unwrap(),
        strategy: strategy.try_into().unwrap(),
        window_bits,
        memory_level,
    }
}

pub(crate) fn raw(input: &[u8], level: i32, memory_level: u8) -> Vec<u8> {
    let mut out = Vec::new();
    compress(
        input,
        &mut out,
        Container::Raw,
        options(level, 0, 15, memory_level),
    )
    .unwrap();
    out
}

/// One call with exactly so much room.
fn step(
    deflater: &mut Deflater,
    input: &mut &[u8],
    out: &mut Vec<u8>,
    room: usize,
    flush: Flush,
) -> Result<Status> {
    let end = out.len() + room;
    let status = deflater.deflate_limited(input, out, room, flush);
    assert!(out.len() <= end);
    match status {
        Ok(Status::NeedsInput) => assert!(input.is_empty() && out.len() < end),
        Ok(Status::NeedsOutput) => assert_eq!(out.len(), end),
        _ => {}
    }
    status
}

/// The system in a gzip header is made the same everywhere.
fn check_stream(container: Container, stream: &mut [u8], dictionary: &[u8], input: &[u8]) {
    let (header_len, trailer) = match container {
        Container::Raw => (0, vec![]),
        Container::Zlib => (
            if dictionary.is_empty() { 2 } else { 6 },
            adler32(1, input).to_be_bytes().to_vec(),
        ),
        Container::Gzip => {
            stream[9] = 0;
            (
                10,
                [crc32(0, input), input.len() as u32]
                    .map(u32::to_le_bytes)
                    .concat(),
            )
        }
    };
    let (raw, found) = stream[header_len..].split_at(stream.len() - header_len - trailer.len());
    let inflated = plain::inflate(raw, dictionary);
    assert_eq!(inflated.end, End::Stream(raw.len()));
    assert!(inflated.bytes == input);
    assert_eq!(found, trailer);
}

/// Calls in any order, with little room or none. Returns a hash of what each has read, written and returned.
fn session(level: i32, mut strategy: i32, seed: u64) -> u32 {
    let mut random = Random::new(seed << 8 | (level << 4 | strategy) as u64);
    let window_bits = random.pick(&[9, 9, 9, 10, 10, 11, 12, 15]);
    let size = 1 << window_bits;
    let container = random.pick(&[Container::Raw, Container::Zlib, Container::Gzip]);
    let options = options(level, strategy, window_bits, 1 + random.below(9) as u8);
    let mut deflater = Deflater::new(container, options).unwrap();
    let len = random.pick(&[10, size / 2, 3 * size, 6 * size]).min(80_000);
    let source = random.mixed(len, size);
    let dictionary_len = random.pick(&[0, 0, 0, 1, 2, 3, 200, size - 1, size, size + 300]);
    let (dictionary, mut rest) = match container {
        Container::Gzip => source.split_at(0),
        _ => source.split_at(dictionary_len.min(len / 2)),
    };
    let max_len = random.pick(&[4, 40, 300, size, 3 * size]).max(len / 400);
    let max_room = random.pick(&[2, 9, 60, 600, 100_000]).max(len / 400);
    let (flushes, changes) = (random.pick(&[1, 3, 20]), random.pick(&[4, 30, 9999]));
    let completes_flushes = random.below(2) == 0;
    let mut hash = 0;
    let mut note = |what: String| hash = crc32(hash, what.as_bytes());

    while !rest.is_empty() {
        if !dictionary.is_empty() {
            deflater.set_dictionary(dictionary).unwrap();
        }
        let input = &rest[..random.pick(&[rest.len(), rest.len(), rest.len().div_ceil(3)])];
        rest = &rest[input.len()..];
        let given_up_at = random.pick(&[input.len(), input.len(), input.len() / 2]);
        let (mut read, mut out) = (0, Vec::new());
        for _ in 0..1_000_000 {
            if read >= given_up_at {
                break;
            }
            let flush = if random.below(flushes) == 0 {
                random.pick(&FLUSHES)
            } else {
                Flush::None
            };
            let mut piece = &input[read..input.len().min(read + random.up_to(max_len))];
            // With little room a flush goes on for ever, as each call starts another marker.
            for _ in 0..50 {
                let (len, room) = (piece.len(), random.up_to(max_room));
                let status = step(&mut deflater, &mut piece, &mut out, room, flush).unwrap();
                read += len - piece.len();
                note(format!("{read} {} {status:?}", out.len()));
                if status == Status::NeedsInput || !completes_flushes {
                    break;
                }
            }
            if random.below(changes) == 0 {
                let other = random.below(5) as i32;
                let new = (random.below(10) as i32, random.pick(&[strategy, other]));
                let is_set = deflater
                    .set_params(new.0.try_into().unwrap(), new.1.try_into().unwrap())
                    .unwrap();
                note(format!("{is_set}"));
                if is_set {
                    strategy = new.1;
                }
            }
        }
        let mut piece = &input[read..];
        if given_up_at < input.len() {
            step(&mut deflater, &mut piece, &mut out, 200_000, Flush::Block).unwrap();
        } else {
            for _ in 0..1_000_000 {
                let room = random.up_to(max_room);
                let status =
                    step(&mut deflater, &mut piece, &mut out, room, Flush::Finish).unwrap();
                note(format!("{} {}", piece.len(), out.len()));
                if status == Status::StreamEnd {
                    break;
                }
            }
            check_stream(container, &mut out, dictionary, input);
            note(format!("{}", crc32(0, &out)));
        }
        deflater.reset();
    }
    hash
}

#[test]
fn calls_in_any_order_give_what_zlib_ng_gives() {
    /// From zlib-ng 2.3.3, by the level and the strategy at the start.
    #[rustfmt::skip]
    const EXPECTED: [[u32; 5]; 10] = [
        [0xe969_54c2, 0x53cb_c4a4, 0xa4fe_03eb, 0x2ce1_9d89, 0x26a8_75ac],
        [0x4cdd_3380, 0x44c5_cb5e, 0x2105_e5c1, 0x38e9_0937, 0x0ace_49ce],
        [0xd763_2408, 0xa6b0_2956, 0xdf73_d3ba, 0xe86e_2922, 0x0bcd_6a26],
        [0x19a6_2241, 0x1273_9cda, 0x8c5f_68d7, 0xef06_92b8, 0xc3bf_6aa7],
        [0xe87b_9f2b, 0x4219_a3da, 0x49ac_db48, 0x4883_8e2a, 0x938c_9539],
        [0xb1d9_bbb8, 0x3a53_3439, 0x7155_0130, 0xac82_a261, 0xcf63_d7bb],
        [0x6ff0_5e4a, 0x2f91_f4fb, 0xdd8c_4b58, 0x31ec_bdfe, 0x42c4_527f],
        [0x17d6_21e7, 0xcd71_c27b, 0xd5e8_47b2, 0x4025_5bb5, 0xe50e_2072],
        [0x7881_9644, 0x9b45_d819, 0x2503_a2ea, 0xb87d_75c3, 0xcf7f_d25a],
        [0x616e_3ab9, 0xc5b9_389e, 0xc3d4_8c83, 0xa043_62c9, 0x35ca_8639],
    ];
    let found: [[u32; 5]; 10] = std::array::from_fn(|level| {
        std::array::from_fn(|strategy| {
            (0..24).fold(0, |hash, seed| {
                hash ^ session(level as i32, strategy as i32, seed)
            })
        })
    });
    assert_eq!(found, EXPECTED, "{found:x?}");
}

#[test]
fn nothing_is_left_after_reset() {
    let mut random = Random::new(1);
    let (first, second) = (random.mixed(5000, 512), random.mixed(700, 512));
    for (level, strategy) in [
        (0, 0),
        (2, 0),
        (4, 0),
        (6, 0),
        (8, 0),
        (9, 1),
        (6, 2),
        (6, 3),
    ] {
        let options = options(level, strategy, 9, 2);
        let mut deflater = Deflater::new(Container::Zlib, options).unwrap();
        for len in (0..first.len()).step_by(61) {
            let (room, flush) = (random.pick(&[1, 5, 300, 9999]), random.pick(&FLUSHES));
            step(
                &mut deflater,
                &mut &first[..len],
                &mut Vec::new(),
                room,
                flush,
            )
            .unwrap();
            deflater.reset();
            let (mut out, input) = (Vec::new(), [&first[..len.min(99)], &second].concat());
            deflater
                .deflate_to_vec(&input, &mut out, Flush::Finish)
                .unwrap();
            check_stream(Container::Zlib, &mut out, &[], &input);
            deflater.reset();
        }
    }
}

/// The longest codes for code lengths and for literals, and the checksum of the stream to compare with zlib-ng 2.3.3's.
fn longest_codes(input: &[u8]) -> (u8, u8, u32) {
    let mut out = Vec::new();
    compress(input, &mut out, Container::Raw, options(6, 2, 15, 9)).unwrap();
    let inflated = plain::inflate(&out, &[]);
    assert!(inflated.bytes == input);
    (
        inflated.longest_codes[0],
        inflated.longest_codes[1],
        crc32(0, &out),
    )
}

#[test]
fn codes_for_literals_have_at_most_15_bits() {
    let mut random = Random::new(1);
    let found = [14, 15, 16, 17, 20].map(|count| longest_codes(&random.uneven(count)));
    let expected = [
        (4, 14, 0xec43_7a9e),
        (5, 15, 0xca9a_ca36),
        (5, 15, 0x2a7f_615c),
        (5, 15, 0x0856_687b),
        (4, 15, 0x7ca3_39dc),
    ];
    assert_eq!(found, expected);
}

#[test]
fn codes_for_code_lengths_have_at_most_7_bits() {
    // How many bytes get a code of each length. In this order no length comes often enough in a row for a repeat code.
    let lengths = [
        (4, 3),
        (6, 16),
        (7, 25),
        (8, 40),
        (9, 60),
        (10, 93),
        (11, 1),
        (12, 8),
        (14, 7),
    ];
    let lengths: Vec<_> = lengths
        .into_iter()
        .flat_map(|(bits, times)| vec![bits; times])
        .collect();
    let times = |byte| 1 << (14 - lengths[usize::from(byte) * 31 % lengths.len()]);
    let input: Vec<_> = (0..lengths.len() as u8)
        .flat_map(|it| vec![it; times(it)])
        .collect();
    assert_eq!(longest_codes(&input), (7, 14, 0x0956_06f0));
}

#[test]
fn matches_stay_within_the_window() {
    for window_bits in 9..=15 {
        let size = 1 << window_bits;
        let input = Random::new(window_bits.into()).mixed(5 * size, size);
        for level in 1..=9 {
            let mut out = Vec::new();
            compress(
                &input,
                &mut out,
                Container::Raw,
                options(level, 0, window_bits, 8),
            )
            .unwrap();
            assert!(plain::inflate(&out, &[]).max_distance <= size - 262);
        }
    }
}

#[test]
fn options_are_checked() {
    for level in [-2, 10, 256, i32::MIN, i32::MAX] {
        assert_eq!(Level::try_from(level), Err(Error::InvalidParameter));
    }
    assert_eq!(Level::try_from(-1), Level::try_from(6));
    for strategy in [-1, 5, 256] {
        assert_eq!(Strategy::try_from(strategy), Err(Error::InvalidParameter));
    }
    for container in [Container::Raw, Container::Zlib, Container::Gzip] {
        let is_valid = |window_bits, memory_level| {
            let options = options(6, 0, window_bits, memory_level);
            let error = Deflater::new(container, options).err();
            assert_eq!(
                compress(b"", &mut Vec::new(), container, options).err(),
                error
            );
            assert!(matches!(error, None | Some(Error::InvalidParameter)));
            error.is_none()
        };
        for number in 0..=u8::MAX {
            let min = if container == Container::Zlib { 8 } else { 9 };
            assert_eq!(is_valid(number, 1), (min..=15).contains(&number));
            assert_eq!(is_valid(9, number), (1..=9).contains(&number));
        }
    }
}

#[test]
fn a_dictionary_comes_first_and_once() {
    let new = |container| Deflater::new(container, Options::default()).unwrap();
    assert_eq!(
        new(Container::Gzip).set_dictionary(b"abc"),
        Err(Error::InvalidState)
    );
    for container in [Container::Raw, Container::Zlib] {
        let mut deflater = new(container);
        assert_eq!(deflater.set_dictionary(b""), Ok(()));
        assert_eq!(deflater.set_dictionary(b"abc"), Ok(()));
        assert_eq!(deflater.set_dictionary(b"abc"), Err(Error::InvalidState));
        deflater.reset();
        deflater
            .deflate_to_vec(b"", &mut Vec::new(), Flush::None)
            .unwrap();
        assert_eq!(deflater.set_dictionary(b"abc"), Err(Error::InvalidState));
        deflater.reset();
        assert_eq!(deflater.set_dictionary(b"abc"), Ok(()));
    }
}

#[test]
fn nothing_follows_the_last_block() {
    for level in 0..=9 {
        let options = options(level, 0, 15, 8);
        let mut whole = Vec::new();
        compress(b"abc", &mut whole, Container::Zlib, options).unwrap();
        // With the last block and the trailer pending, the trailer alone, and nothing.
        for room in [3, whole.len() - 2, whole.len() + 1] {
            let mut deflater = Deflater::new(Container::Zlib, options).unwrap();
            let mut out = Vec::new();
            step(
                &mut deflater,
                &mut &b"abc"[..],
                &mut out,
                room,
                Flush::Finish,
            )
            .unwrap();
            for flush in FLUSHES {
                let status = step(&mut deflater, &mut &b""[..], &mut out, 99, flush);
                assert_eq!(status, Err(Error::InvalidState));
            }
            let set = |deflater: &mut Deflater, it| deflater.set_params(options.level, it);
            assert_eq!(
                set(&mut deflater, Strategy::Fixed),
                Err(Error::InvalidState)
            );
            assert_eq!(set(&mut deflater, Strategy::Default), Ok(true));
            let mut more = &b"d"[..];
            let status = step(&mut deflater, &mut more, &mut out, 99, Flush::Finish);
            assert_eq!((status, more.len()), (Err(Error::InputAfterFinish), 1));
            let result = deflater.deflate_to_vec(more, &mut out, Flush::Finish);
            assert_eq!(result, Err(Error::InputAfterFinish));
            for _ in 0..2 {
                let status = step(&mut deflater, &mut &b""[..], &mut out, 99, Flush::Finish);
                assert_eq!((status, &out), (Ok(Status::StreamEnd), &whole));
            }
        }
    }
}

#[test]
fn a_vec_grows_as_needed() {
    let input = Random::new(1).bytes(200_000);
    for level in [0, 1, 6] {
        let mut deflater = Deflater::new(Container::Gzip, options(level, 0, 15, 8)).unwrap();
        let mut out = b"ab".to_vec();
        for (piece, flush) in input
            .chunks(70_000)
            .zip([Flush::None, Flush::Sync, Flush::Finish])
        {
            out.shrink_to_fit();
            deflater.deflate_to_vec(piece, &mut out, flush).unwrap();
        }
        assert_eq!(out[..2], *b"ab");
        check_stream(Container::Gzip, &mut out[2..], &[], &input);
    }
}

#[test]
fn a_whole_stream_fits_in_what_is_reserved_at_first() {
    let mut random = Random::new(1);
    for len in (0..40).chain([999, 65_535, 65_536, 200_000]) {
        let input: Vec<_> = (0..len).map(|_| 144 + random.below(112) as u8).collect();
        for level in [0, 1, 2, 6, 9] {
            let mut out = Vec::new();
            compress(&input, &mut out, Container::Gzip, options(level, 4, 15, 8)).unwrap();
            let block = if len < 9 { 5 } else { 3 };
            assert_eq!(out.capacity(), len + usize::div_ceil(len, 8) + block + 18);
            check_stream(Container::Gzip, &mut out, &[], &input);
        }
    }
}
