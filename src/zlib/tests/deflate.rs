use bun_zlib::deflate::{Container, Flush, Level, Options, Status, Strategy, compress};
use bun_zlib::{Deflater, Error, Result};

use crate::plain::{self, End, adler32, crc32};
use crate::samples::{Planned, Random};

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

pub(crate) fn in_short_blocks(input: &[u8], level: i32) -> Vec<u8> {
    let mut deflater = Deflater::new(Container::Raw, options(level, 0, 15, 8)).unwrap();
    let mut out = Vec::new();
    let pieces = input.chunks(200).map(|it| (it, Flush::Block));
    for (piece, flush) in pieces.chain([(&[][..], Flush::Finish)]) {
        deflater.deflate_to_vec(piece, &mut out, flush).unwrap();
    }
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

/// For the next stream.
#[derive(Clone, Copy)]
enum Next {
    New,
    Reset,
}

/// Calls in any order, with little room or none. Returns a hash of what each has read, written and returned.
fn session(level: i32, mut strategy: i32, seed: u64, next: Next) -> u32 {
    let mut random = Random::new(seed << 8 | (level << 4 | strategy) as u64);
    let window_bits = random.pick(&[9, 9, 9, 10, 10, 11, 12, 15]);
    let size = 1 << window_bits;
    let container = random.pick(&[Container::Raw, Container::Zlib, Container::Gzip]);
    let mut options = options(level, strategy, window_bits, 1 + random.below(9) as u8);
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
        let input = &rest[..random.pick(&[rest.len(), rest.len().div_ceil(3), rest.len().min(90)])];
        rest = &rest[input.len()..];
        let in_pieces = random.pick(&[input.len(), input.len(), input.len() / 2, 0]);
        let (mut read, mut out) = (0, Vec::new());
        for _ in 0..1_000_000 {
            if read >= in_pieces {
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
                let any = random.below(10) as i32;
                let new = (
                    random.pick(&[any, any, 0, level]),
                    random.pick(&[strategy, other]),
                );
                let params = (new.0.try_into().unwrap(), new.1.try_into().unwrap());
                let is_set = deflater.set_params(params.0, params.1).unwrap();
                note(format!("{is_set}"));
                if is_set {
                    strategy = new.1;
                    (options.level, options.strategy) = params;
                }
            }
        }
        let mut piece = &input[read..];
        if random.below(4) == 0 {
            let status = step(&mut deflater, &mut piece, &mut out, 200_000, Flush::Block);
            // Behind the system in a gzip header.
            note(format!(
                "{status:?} {}",
                crc32(0, out.get(10..).unwrap_or_default())
            ));
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
        match next {
            Next::New => deflater = Deflater::new(container, options).unwrap(),
            Next::Reset => deflater.reset(),
        }
    }
    hash
}

#[test]
fn calls_in_any_order_do_the_same_after_reset() {
    let all = (0..2000).map(|it| (it % 10, it / 10 % 5, it as u64 / 50));
    for (level, strategy, seed) in all {
        let [new, reset] = [Next::New, Next::Reset].map(|it| session(level, strategy, seed, it));
        assert_eq!(new, reset, "{level} {strategy} {seed}");
    }
}

#[test]
fn neither_the_pieces_nor_the_room_matter() {
    let mut random = Random::new(3);
    for it in 0..180 {
        let (window_bits, memory_level) = (random.pick(&[9, 12, 15]), random.pick(&[1, 8, 9]));
        let options = options(1 + it % 9, it / 9 % 5, window_bits, memory_level);
        let len = random.pick(&[0, 300, 2047, 6655, 8191, 8480, 20_000, 150_000]) + random.below(3);
        let mut input = random.mixed(len, 1 << window_bits);
        input[len / 3..len / 2].fill(9);
        let (mut whole, mut out) = (Vec::new(), Vec::new());
        compress(&input, &mut whole, Container::Raw, options).unwrap();
        let mut deflater = Deflater::new(Container::Raw, options).unwrap();
        let pieces = input
            .chunks(50 + random.up_to(30_000))
            .map(|it| (it, Flush::None));
        for (mut piece, flush) in pieces.chain([(&[][..], Flush::Finish)]) {
            let room = 9 + random.up_to(9000);
            while step(&mut deflater, &mut piece, &mut out, room, flush) == Ok(Status::NeedsOutput)
            {
            }
        }
        assert!(out == whole, "{it}");
        check_stream(Container::Raw, &mut out, &[], &input);
    }
}

#[test]
fn what_came_before_is_found_whatever_the_level_was() {
    let known = Random::new(1).bytes(3000);
    for (before, after) in (0..=9).flat_map(|before| (1..=9).map(move |after| (before, after))) {
        let mut deflater = Deflater::new(Container::Raw, options(before, 0, 15, 8)).unwrap();
        let (dictionary, first) = known.split_at(1000);
        deflater.set_dictionary(dictionary).unwrap();
        let mut out = Vec::new();
        deflater
            .deflate_to_vec(first, &mut out, Flush::Sync)
            .unwrap();
        let is_set = deflater.set_params(after.try_into().unwrap(), Strategy::Default);
        assert_eq!(is_set, Ok(true));
        for piece in known.chunks(500) {
            out.clear();
            deflater
                .deflate_to_vec(piece, &mut out, Flush::Sync)
                .unwrap();
            assert!(out.len() < 20, "{before} {after}");
        }
    }
}

#[test]
fn strategies_keep_to_their_limits() {
    let input = Random::new(5).mixed(60_000, 4096);
    for level in 1..=9 {
        let [literals, runs, fixed] = [2, 3, 4].map(|strategy| {
            let mut out = Vec::new();
            compress(
                &input,
                &mut out,
                Container::Raw,
                options(level, strategy, 15, 8),
            )
            .unwrap();
            plain::inflate(&out, &[])
        });
        assert_eq!((literals.max_distance, runs.max_distance), (0, 1));
        assert_eq!(fixed.longest_codes, [0; 3]);
    }
}

#[test]
fn a_full_flush_does_away_with_the_dictionary() {
    let input = Random::new(1).mixed(600, 512);
    for level in 0..=9 {
        let mut deflater = Deflater::new(Container::Raw, options(level, 0, 15, 8)).unwrap();
        let mut out = Vec::new();
        deflater.set_dictionary(&input).unwrap();
        deflater.deflate_to_vec(b"", &mut out, Flush::Full).unwrap();
        deflater
            .deflate_to_vec(&input[200..], &mut out, Flush::Finish)
            .unwrap();
        deflater.reset();
        assert_eq!(
            out,
            [&[0, 0, 0, 0xff, 0xff], &raw(&input[200..], level, 8)[..]].concat()
        );
    }
}

#[test]
fn and_is_a_start_like_any_other() {
    let mut random = Random::new(2);
    for (level, strategy) in
        (0..4000).map(|it| (it % 10, [0, 0, 0, 1, 2, 3, 4][it as usize / 10 % 7]))
    {
        let options = options(level, strategy, random.pick(&[9, 10, 15]), 8);
        let [mut used, mut new] = [(); 2].map(|()| Deflater::new(Container::Raw, options).unwrap());
        let len = random.below(2500);
        // Stored blocks go by the room.
        let [mut out, mut expected] = [(); 2].map(|()| Vec::with_capacity(9999));
        let input = random.mixed(len + 600, 512);
        let (first, rest) = input.split_at(len);
        used.deflate_to_vec(first, &mut out, Flush::Full).unwrap();
        out.clear();
        for piece in rest.chunks(1 + random.up_to(40)) {
            let (flush, other) = (
                random.pick(&FLUSHES[1..4]),
                random.pick(&[level, level, 9 - level]),
            );
            for (deflater, out) in [(&mut used, &mut out), (&mut new, &mut expected)] {
                deflater.deflate_to_vec(piece, out, flush).unwrap();
                let params = (other.try_into().unwrap(), options.strategy);
                assert_eq!(deflater.set_params(params.0, params.1), Ok(true));
            }
        }
        assert!(out == expected, "{level} {strategy}");
    }
}

#[test]
fn the_window_may_slide_any_number_of_times_at_level_0() {
    let input = Random::new(53).mixed(1600, 512);
    let (first, last) = input.split_at(700);
    // How much is stored in between, and in pieces of what size.
    let stored = [
        (90, 90),
        (400, 90),
        (900, 90),
        (1500, 90),
        (138_000, 300),
        (511, 999),
        (512, 999),
        (700, 999),
    ];
    for level in [2, 6, 7, 9] {
        for (len, piece) in stored {
            let mut deflater = Deflater::new(Container::Zlib, options(level, 0, 9, 8)).unwrap();
            let (mut out, stored) = (Vec::new(), Random::new(60).mixed(len, 512));
            for (level, input, piece) in
                [(level, first, 700), (0, &stored, piece), (level, last, 900)]
            {
                let is_set = deflater.set_params(level.try_into().unwrap(), Strategy::Default);
                assert_eq!(is_set, Ok(true));
                for mut piece in input.chunks(piece) {
                    step(&mut deflater, &mut piece, &mut out, 9999, Flush::Block).unwrap();
                }
            }
            deflater
                .deflate_to_vec(b"", &mut out, Flush::Finish)
                .unwrap();
            check_stream(
                Container::Zlib,
                &mut out,
                &[],
                &[first, &stored, last].concat(),
            );
        }
    }
}

#[test]
fn slides_at_level_0_do_not_count_after_reset() {
    let input = Random::new(1).bytes(400);
    let with_dictionary = |deflater: &mut Deflater| {
        let mut out = Vec::new();
        deflater.set_dictionary(&input).unwrap();
        assert_eq!(
            deflater.set_params(Level::DEFAULT, Strategy::Default),
            Ok(true)
        );
        deflater
            .deflate_to_vec(&input[200..], &mut out, Flush::Finish)
            .unwrap();
        out
    };
    let new = || Deflater::new(Container::Raw, options(0, 0, 9, 8)).unwrap();
    for len in [1100, 5000] {
        let mut deflater = new();
        for piece in vec![7; len].chunks(100) {
            deflater
                .deflate_to_vec(piece, &mut Vec::new(), Flush::Sync)
                .unwrap();
        }
        deflater.reset();
        let out = with_dictionary(&mut deflater);
        assert!(out.len() < 9 && out == with_dictionary(&mut new()));
    }
}

#[test]
fn nothing_is_left_after_reset() {
    let mut random = Random::new(1);
    let (first, second) = (random.mixed(5000, 512), random.mixed(700, 512));
    for (level, strategy) in [
        (0, 0),
        (1, 0),
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

#[test]
fn uneven_frequencies_make_long_codes() {
    for count in [12, 13, 14, 15, 16, 17] {
        let input = (1u32..1 << count).map(|it| it.trailing_zeros() as u8);
        let (input, mut out) = (input.collect::<Vec<_>>(), Vec::new());
        compress(&input, &mut out, Container::Raw, options(6, 2, 15, 9)).unwrap();
        let inflated = plain::inflate(&out, &[]);
        assert!(inflated.bytes == input && (12..=14).contains(&inflated.longest_codes[1]));

        let mut input = Planned::with_literals(13_000);
        for symbol in Random::new(1).uneven(count) {
            let (base, extra_bits) = plain::DISTANCES[10 + usize::from(symbol)];
            input.copy(3, base..base + (1 << extra_bits));
        }
        assert!(plain::inflate(&raw(&input.bytes, 9, 9), &[]).bytes == input.bytes);
    }
}

#[test]
fn what_does_not_compress_is_stored_with_any_window() {
    let input = Random::new(1).bytes(100_000);
    for (window_bits, strategy) in (9..=15).flat_map(|bits| [(bits, 0), (bits, 4)]) {
        let (options, mut out) = (options(6, strategy, window_bits, 9), Vec::new());
        compress(&input, &mut out, Container::Raw, options).unwrap();
        assert!(out.len() < input.len() + 80);
        check_stream(Container::Raw, &mut out, &[], &input);
    }
}

#[test]
fn matches_stay_within_the_window() {
    for window_bits in 9..=15 {
        let size = 1 << window_bits;
        let input = Random::new(window_bits.into()).mixed(5 * size + 20_000, size);
        for level in 1..=9 {
            let mut out = Vec::new();
            compress(
                &input,
                &mut out,
                Container::Raw,
                options(level, 0, window_bits, 8),
            )
            .unwrap();
            let inflated = plain::inflate(&out, &[]);
            assert!(inflated.bytes == input && inflated.max_distance <= size - 262);
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
        let (mut with_empty, mut without) = (Vec::new(), Vec::new());
        deflater
            .deflate_to_vec(b"abc", &mut with_empty, Flush::Finish)
            .unwrap();
        compress(b"abc", &mut without, container, Options::default()).unwrap();
        assert_eq!(with_empty, without);
        deflater.reset();
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
    let input = Random::new(1).bytes(600_000);
    for level in [0, 1, 6] {
        let mut deflater = Deflater::new(Container::Gzip, options(level, 0, 15, 8)).unwrap();
        let mut stream = Vec::new();
        for (piece, flush) in input
            .chunks(200_000)
            .zip([Flush::None, Flush::Sync, Flush::Finish])
        {
            let mut out = b"ab".to_vec();
            deflater.deflate_to_vec(piece, &mut out, flush).unwrap();
            stream.extend(out.strip_prefix(b"ab").unwrap());
        }
        check_stream(Container::Gzip, &mut stream, &[], &input);
    }
}

#[test]
fn a_vec_has_room_for_the_marker_behind_a_short_input() {
    let mut random = Random::new(1);
    for len in 1..40 {
        let input: Vec<_> = (0..len).map(|_| 144 + random.below(112) as u8).collect();
        for (level, flush) in [0, 1, 6]
            .into_iter()
            .flat_map(|level| FLUSHES.map(|it| (level, it)))
        {
            let new = || Deflater::new(Container::Raw, options(level, 4, 15, 8)).unwrap();
            let (mut expected, mut out) = (Vec::new(), Vec::new());
            step(&mut new(), &mut &input[..], &mut expected, 99, flush).unwrap();
            new().deflate_to_vec(&input, &mut out, flush).unwrap();
            assert_eq!(out, expected);
        }
    }
}

#[test]
fn a_whole_stream_fits_in_what_is_reserved_at_first() {
    let mut random = Random::new(1);
    for len in (0..40).chain([999, 65_535, 65_536, 200_000]) {
        let input: Vec<_> = (0..len).map(|_| 144 + random.below(112) as u8).collect();
        for (container, around) in [
            (Container::Raw, 0),
            (Container::Zlib, 6),
            (Container::Gzip, 18),
        ] {
            for level in [0, 1, 2, 6, 9] {
                let mut out = Vec::new();
                compress(&input, &mut out, container, options(level, 4, 15, 8)).unwrap();
                let block = if len < 9 { 5 } else { 3 };
                let reserved = len + usize::div_ceil(len, 8) + block + around;
                // If nothing is left over, it takes another call to tell that the stream has ended.
                assert!(out.capacity() == reserved || out.len() == reserved);
                check_stream(container, &mut out, &[], &input);
            }
        }
    }
}

#[test]
fn the_defaults_are_those_of_zlib() {
    let input = Random::new(1).mixed(200_000, 1 << 15);
    let with = |options| {
        let mut out = Vec::new();
        compress(&input, &mut out, Container::Zlib, options).unwrap();
        out
    };
    assert!(with(Options::default()) == with(options(6, 0, 15, 8)));
    assert!(with(options(6, 0, 8, 8)) == with(options(6, 0, 9, 8)));
}

#[test]
fn matches_are_found_in_very_little() {
    for level in 1..=9 {
        let mut deflater = Deflater::new(Container::Raw, options(level, 0, 15, 8)).unwrap();
        deflater.set_dictionary(b"-abcdefgh").unwrap();
        let mut out = Vec::new();
        deflater.deflate_whole(b"abcdefgh", &mut out).unwrap();
        assert_eq!(out, [131, 209, 0], "{level}");
        assert_eq!(raw(b"-abcd1abcd2345", level, 8).len(), 13);
    }
    assert_eq!(raw(b"-abc1abc2345", 9, 8).len(), 12);
}

#[test]
fn short_streams_do_not_depend_on_those_before() {
    let mut random = Random::new(5);
    let known = random.mixed(20_000, 900);
    // Enough for the tables of the thread to be cleared several times.
    for it in 0..600 {
        let input = &known[random.below(3) * 50..][..random.up_to(7000)];
        let options = options(1 + it % 9, it / 9 % 5, random.pick(&[9, 15]), 8);
        let (mut whole, mut out) = (Vec::new(), Vec::new());
        compress(input, &mut whole, Container::Raw, options).unwrap();
        let mut deflater = Deflater::new(Container::Raw, options).unwrap();
        for (piece, flush) in [(input, Flush::None), (&[][..], Flush::Finish)] {
            deflater.deflate_to_vec(piece, &mut out, flush).unwrap();
        }
        assert!(out == whole, "{it}");
    }
}

#[test]
fn what_has_been_copied_is_found_again() {
    let mut random = Random::new(5);
    let (mut version, mut all) = (random.bytes(20000), Vec::new());
    for at in (0..40).map(|it| it * 7919 % 19000) {
        version.splice(at..at + 7, random.bytes(40));
        all.extend(&version);
    }
    for level in 3..=9 {
        let len = raw(&all, level, 8).len();
        assert!(len < 36000, "{level} {len}");
    }
}

#[test]
fn matches_are_found_after_noise() {
    let mut random = Random::new(6);
    let mut input = random.bytes(9000);
    (0..20000).for_each(|_| input.extend(random.bytes(3).repeat(3)));
    for level in 1..=9 {
        let len = raw(&input, level, 8).len();
        assert!(len < 120_000, "{level} {len}");
    }
}

#[test]
fn a_run_ends_with_the_strategy() {
    for start in 0..258 {
        let input = Random::new(7).bytes(50).repeat(400);
        let (first, rest) = input[start..].split_at(8480);
        let mut deflater = Deflater::new(Container::Raw, options(6, 0, 15, 8)).unwrap();
        let mut out = Vec::new();
        for piece in [&input[..start], first] {
            deflater
                .deflate_to_vec(piece, &mut out, Flush::Sync)
                .unwrap();
        }
        let only_literals = options(6, 2, 15, 8);
        let has_changed = deflater.set_params(only_literals.level, only_literals.strategy);
        assert_eq!(has_changed, Ok(true));
        out.clear();
        deflater
            .deflate_to_vec(rest, &mut out, Flush::Finish)
            .unwrap();
        assert!(out.len() > rest.len() / 2, "{start}");
    }
}

#[test]
fn older_copies_may_be_longer() {
    let mut random = Random::new(8);
    for period in [7, 75, 257, 3165] {
        let mut input = random.bytes(period).repeat(90_000 / period);
        for (at, byte) in random.bytes(2000).into_iter().enumerate() {
            input[43 * at + usize::from(byte % 32)] = byte;
        }
        input[40_000..43_000].fill(0);
        for level in 3..=9 {
            assert!(plain::inflate(&raw(&input, level, 8), &[]).bytes == input);
        }
    }
}

#[test]
fn a_run_may_end_where_a_block_does() {
    let noise = Random::new(8).bytes(9000);
    for end in (8200..8800).step_by(7) {
        let (mut input, mut out) = (noise.clone(), Vec::new());
        input[7700..end].fill(0);
        input[end..].iter_mut().for_each(|it| *it %= 128);
        let mut deflater = Deflater::new(Container::Raw, options(6, 0, 10, 8)).unwrap();
        let mut unread = &input[..];
        step(&mut deflater, &mut unread, &mut out, 9000, Flush::None).unwrap();
        while step(&mut deflater, &mut unread, &mut out, 99, Flush::Finish).unwrap()
            == Status::NeedsOutput
        {}
        check_stream(Container::Raw, &mut out, &[], &input);
    }
}
