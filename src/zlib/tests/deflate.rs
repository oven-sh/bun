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
fn calls_in_any_order_give_what_zlib_ng_gives() {
    /// From zlib-ng 2.3.3, by the level and the strategy at the start.
    #[rustfmt::skip]
    const EXPECTED: [[u32; 5]; 10] = [
        [0x7456_c348, 0xca2c_f35a, 0xb7a3_f7e0, 0x50b8_fec1, 0x4721_0046],
        [0xb6d8_b25b, 0xa7d2_807a, 0x7a9a_3e41, 0x2bb7_0661, 0x7b2f_62e2],
        [0xf04f_7c39, 0xad33_f143, 0x04fe_9f99, 0x0950_ca5f, 0x51d2_101f],
        [0x4be2_87ba, 0x7ae5_df72, 0xdfa5_0dae, 0xfd0e_4369, 0xda68_da84],
        [0xc751_9b89, 0xeca7_820b, 0xcfc5_afa2, 0xbe46_838f, 0x7867_1b97],
        [0x55cc_c07e, 0x3203_5aa3, 0x90a4_f9a8, 0xb7fe_6797, 0x67cf_6dbe],
        [0x4fa1_d2a0, 0xbdc6_1165, 0xca25_1029, 0x1872_17ab, 0x4aa9_9c4f],
        [0x95be_e3a9, 0x02e4_9533, 0x047b_ed37, 0x4fd7_950e, 0x72e1_e0a0],
        [0xb4ba_d80b, 0xfa24_0a61, 0x0580_4370, 0x883b_eeac, 0x7bdb_3e1e],
        [0x7c01_7d43, 0xbe1e_b051, 0x9623_575b, 0xe7c2_11fd, 0x5591_d790],
    ];
    let found: [[u32; 5]; 10] = std::array::from_fn(|level| {
        std::array::from_fn(|strategy| {
            (0..24).fold(0, |hash, seed| {
                hash ^ session(level as i32, strategy as i32, seed, Next::New)
            })
        })
    });
    assert_eq!(found, EXPECTED, "{found:x?}");
}

/// The first arguments of `session()`, and the result with zlib-ng 2.3.3.
#[rustfmt::skip]
const RARE: &[(i32, i32, u64, u32)] = &[
    (0, 0, 1153, 0xfa28_4898), (0, 0, 2998, 0xfcee_8f7c), (1, 0, 130, 0x3a3c_eed9), (1, 0, 1811, 0x996b_a1f0),
    (2, 0, 91, 0x06ff_1791), (2, 0, 141, 0x49ab_3ea9), (2, 0, 220, 0x50f3_16d3), (2, 0, 387, 0xf632_0ead),
    (5, 0, 248, 0x5331_8687), (5, 0, 296, 0xa03a_5b17), (5, 0, 21359, 0x1a0f_de83), (6, 0, 1774, 0xc12f_eeb3),
    (6, 2, 205, 0x11f0_a577), (6, 2, 2224, 0x2954_e4ca), (6, 3, 339, 0xdda6_19ed), (7, 0, 75, 0xb795_0925),
    (7, 0, 236, 0x6eb7_f4a7), (7, 0, 1446, 0x11d1_bf7a), (8, 0, 116, 0x44b9_e4a8), (8, 0, 420, 0x6661_01d5),
    (8, 0, 576, 0x1e19_a825), (8, 0, 1220, 0x98ca_b372), (8, 1, 51, 0xaaed_8204), (8, 1, 140, 0x7753_210c),
    (8, 1, 1076, 0x958a_7ff9), (9, 0, 182, 0xea16_3040), (9, 0, 270, 0x0cb9_ce59), (9, 0, 279, 0x3205_5af5),
    (9, 0, 290, 0x0dee_141e), (9, 0, 1958, 0x074c_9550), (9, 4, 665, 0x38c1_ccee), (9, 4, 1340, 0x6ddc_d3f7),
    (9, 4, 1474, 0xd885_d9ad), (9, 4, 1861, 0x475c_bdbd), (9, 4, 2217, 0xc947_f92f), (0, 0, 64, 0x7338_3b5e),
    (0, 0, 163, 0x7cc7_2afb), (7, 0, 103, 0x47a1_485f), (9, 0, 90, 0xa2b0_5f94),
];

#[test]
fn and_so_do_some_that_few_sequences_are_like() {
    for &(level, strategy, seed, expected) in RARE {
        let found = session(level, strategy, seed, Next::New);
        assert_eq!(found, expected, "{level} {strategy} {seed}");
    }
}

#[test]
fn a_deflater_is_as_good_as_new_after_reset() {
    let rare = RARE.iter().map(|it| (it.0, it.1, it.2));
    let all = (0..2000).map(|it| (it % 10, it / 10 % 5, it as u64 / 50));
    for (level, strategy, seed) in rare.chain(all) {
        let [new, reset] = [Next::New, Next::Reset].map(|it| session(level, strategy, seed, it));
        assert_eq!(new, reset, "{level} {strategy} {seed}");
    }
}

#[test]
fn the_rolling_hash_starts_over_after_reset() {
    // From zero, so the second position is found, which starts with one.
    let input = b"1\0abcd2\0abcd345";
    let set_level = |deflater: &mut Deflater, level: i32| {
        let is_set = deflater.set_params(level.try_into().unwrap(), Strategy::Default);
        assert_eq!(is_set, Ok(true));
    };
    for dictionary in [&b""[..], b"xyz"] {
        let mut deflater = Deflater::new(Container::Raw, options(9, 0, 15, 8)).unwrap();
        deflater
            .deflate_to_vec(b"efghijklm", &mut Vec::new(), Flush::Sync)
            .unwrap();
        set_level(&mut deflater, 8);
        deflater.reset();
        deflater.set_dictionary(dictionary).unwrap();
        let mut out = Vec::new();
        deflater
            .deflate_to_vec(input, &mut out, Flush::None)
            .unwrap();
        set_level(&mut deflater, 9);
        deflater
            .deflate_to_vec(b"", &mut out, Flush::Finish)
            .unwrap();
        assert_eq!(out, raw(input, 9, 8));
    }
}

#[test]
fn the_rolling_hash_goes_on_behind_a_dictionary() {
    // One of two bytes is too short for a hash.
    for (dictionary, input) in [
        (&b"xy"[..], &b"1\0abcd2\0abcd345"[..]),
        (b"wxy", b"xyabcd2xyabcd345"),
    ] {
        let through = |level: i32| {
            let mut deflater = Deflater::new(Container::Raw, options(9, 0, 15, 8)).unwrap();
            let mut out = Vec::new();
            deflater.set_dictionary(dictionary).unwrap();
            for (level, input, flush) in [(level, input, Flush::None), (9, b"", Flush::Finish)] {
                let is_set = deflater.set_params(level.try_into().unwrap(), Strategy::Default);
                assert_eq!(is_set, Ok(true));
                deflater.deflate_to_vec(input, &mut out, flush).unwrap();
            }
            out
        };
        assert_eq!(through(8), through(9));
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
    let found = [2, 6, 7, 9].map(|level| {
        stored.iter().fold(0, |hash, &(len, piece)| {
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
            crc32(hash, &out)
        })
    });
    // From zlib-ng 2.3.3.
    assert_eq!(found, [0x8663_2ef7, 0xd183_39fb, 0x4fe5_3af9, 0xf8e7_fd96]);
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
fn codes_for_distances_have_at_most_15_bits() {
    let found = [15, 16, 17].map(|count| {
        let mut input = Planned::with_literals(13_000);
        for symbol in Random::new(1).uneven(count) {
            let (base, extra_bits) = plain::DISTANCES[10 + usize::from(symbol)];
            input.copy(3, base..base + (1 << extra_bits));
        }
        let out = raw(&input.bytes, 9, 9);
        let inflated = plain::inflate(&out, &[]);
        assert!(inflated.bytes == input.bytes);
        (inflated.longest_codes[2], crc32(0, &out))
    });
    assert_eq!(
        found,
        [(14, 0x7a56_5012), (15, 0xe5b7_f5ba), (15, 0x9248_949a)]
    );
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
fn level_9_looks_at_4096_candidates() {
    let found = [4094, 4095, 4096, 4097].map(|count| {
        [0, 1, 2000, count].map(|of_other_bytes| {
            let mut random = Random::new(1);
            let mut input = b"-abc0123456789".to_vec();
            for at in 0..count {
                // They have the same hash.
                input.extend(if at < count - of_other_bytes {
                    b"abc"
                } else {
                    b"Abc"
                });
                input.push(128 + random.below(100) as u8);
            }
            let len_with = |end: &[u8]| {
                let (input, mut out) = ([&input, end].concat(), Vec::new());
                compress(&input, &mut out, Container::Raw, options(9, 4, 15, 9)).unwrap();
                out.len()
            };
            // The first is one match if that is found, and else a literal and a match like the second.
            len_with(b"\xf0\xf1abc0123456789") < len_with(b"\xf0\xf1-bc0123456789")
        })
    });
    assert_eq!(found, [[true; 4], [true; 4], [false; 4], [false; 4]]);
}

#[test]
fn a_block_that_does_not_compress_is_stored_however_long_it_is() {
    // As many symbols as fit in a block: literals of 9 bits, matches of 3 bytes in 25 bits, and one of 258 bytes.
    let mut input = Planned::with_literals(16_513);
    for len in [vec![3; 16_253], vec![258]].concat() {
        input.copy(len, 16_385..input.bytes.len().min(32_000));
    }
    let mut input = input.bytes;
    input.extend([0; 300]);
    let mut out = Vec::new();
    compress(&input, &mut out, Container::Raw, options(9, 4, 15, 9)).unwrap();
    assert_eq!(out[..5], [0, 0xfa, 0xff, 5, 0]);
    check_stream(Container::Raw, &mut out, &[], &input);
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
