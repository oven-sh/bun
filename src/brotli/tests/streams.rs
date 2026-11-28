//! The output of the encoder and of the decoder is the same on all CPUs.

mod writer;

use bun_brotli::{DecodeStatus, Decoder, EncodeStatus, Encoder, Operation, max_compressed_size};
use bun_core::vec::append_with;
use bun_sema_standalone as _;
use bun_simd::target::{Target, reset_cpu, set_cpu};
use writer::Numbers;

const SIZE: usize = 60_000;

/// Words in several scripts, of which some come again.
fn sample() -> Vec<u8> {
    let words = include_bytes!("../dictionary.bin");
    let (mut sample, mut state) = (Vec::new(), 1u32);
    while sample.len() < SIZE {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let (at, length) = ((state >> 8) as usize, 3 + (state >> 26) as usize);
        match sample.len().checked_sub(length) {
            Some(last) if state >> 25 & 1 != 0 => {
                sample.extend_from_within(at % (last + 1)..at % (last + 1) + length);
            }
            _ => sample.extend_from_slice(&words[at % (words.len() - length)..][..length]),
        }
    }
    sample
}

fn compressed(quality: u32, dictionary: &[u8], mut input: &[u8]) -> Vec<u8> {
    let mut encoder = Encoder::with_dictionary(dictionary).unwrap();
    assert!(encoder.set_parameter(1, quality));
    let mut stream = Vec::with_capacity(max_compressed_size(input.len()));
    let status = append_with(&mut stream, usize::MAX, |output| {
        encoder.compress(Operation::Finish, &mut input, output)
    });
    assert_eq!(status, Ok(EncodeStatus::Done));
    stream
}

fn decompressed(dictionary: &[u8], mut stream: &[u8]) -> Vec<u8> {
    let mut decoder = Decoder::with_dictionary(dictionary).unwrap();
    let mut output = Vec::with_capacity(2 * SIZE);
    let status = append_with(&mut output, usize::MAX, |output| {
        decoder.decompress(&mut stream, output)
    });
    assert_eq!(status, Ok(DecodeStatus::Finished));
    output
}

fn fnv1a(bytes: &[u8]) -> u32 {
    (bytes.iter()).fold(0x811C9DC5, |hash, &byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x01000193)
    })
}

/// What comes out, and how it ends, with so much input and so much room at a time.
fn decompressed_in_steps(mut stream: &[u8], piece: usize, room: usize) -> Vec<u8> {
    let (mut decoder, mut output) = (Decoder::default(), Vec::new());
    loop {
        let mut input = &stream[..piece.min(stream.len())];
        output.reserve(room);
        let status = append_with(&mut output, room, |to| decoder.decompress(&mut input, to));
        stream = &stream[piece.min(stream.len()) - input.len()..];
        match status {
            Ok(DecodeStatus::Finished) => return output,
            Ok(DecodeStatus::NeedsInput) if stream.is_empty() => return Vec::new(),
            Ok(_) => {}
            Err(error) => return vec![error as u8],
        }
    }
}

/// Few symbols, long copies, windows that are full, and counts beyond 16 bits.
fn hash_of_odd_inputs(sample: &[u8]) -> [u32; 12] {
    let mut numbers = Numbers(1);
    let mut of = |len: usize, symbols: &[u8]| -> Vec<u8> {
        (0..len).map(|_| numbers.one_of(symbols)).collect()
    };
    let mut inputs: Vec<_> = (1..8).map(|it| of(100 * it * it, &sample[..it])).collect();
    inputs.extend((0..40).map(|it| sample[99 * it..][..it * it / 4].to_vec()));
    let pieces = (0..150).map(|it| &sample[it % 7 * 40..][..60 + it.max(it * it / 90)]);
    inputs.push(pieces.collect::<Vec<_>>().join(&b'-'));
    inputs.push([&sample[..17_000], b"?", &sample[1..17_000], &sample[..300]].concat());
    inputs.push([&sample[..9], &[b'-'; 40_000], &sample[..300]].concat());
    let words = b" the world of the people, and the first. The number of ";
    inputs.extend(
        (930..1030)
            .step_by(3)
            .map(|it| [&[b'-'; 1030][..it], words, b"?"].concat()),
    );
    inputs.push(of(70_000, b"aaaaaaaabbbbccde"));
    core::array::from_fn(|quality| {
        let mut all = Vec::new();
        for (input, window) in inputs.iter().flat_map(|it| [(it, 10), (it, 18)]) {
            let (mut encoder, start) = (Encoder::with_quality(quality as i32), all.len());
            assert!(encoder.set_parameter(2, window));
            all.reserve(2 * input.len() + 99);
            let status = append_with(&mut all, usize::MAX, |output| {
                encoder.compress(Operation::Finish, &mut &input[..], output)
            });
            assert_eq!(status, Ok(EncodeStatus::Done));
            assert!(decompressed_in_steps(&all[start..], 70, 500) == *input);
        }
        fnv1a(&all)
    })
}

/// Long copies to choose from.
fn hash_of_long_copies() -> [u32; 3] {
    let noise = |numbers: &mut Numbers, len: usize| -> Vec<u8> {
        (0..len).map(|_| numbers.below(256) as u8).collect()
    };
    let [a, b] = [(216, 11), (849, 10)].map(|(seed, quality)| {
        let mut numbers = Numbers(seed);
        let mut input = noise(&mut numbers, 400);
        for _ in 0..20 {
            let at = numbers.below(input.len() - 330);
            input.extend_from_within(at..at + numbers.below(330));
        }
        fnv1a(&compressed(quality, &[], &input))
    });
    // Only the last distance leads to the start of 16 KiB.
    let all = noise(&mut Numbers(1), 17_000);
    let (start, long, end) = (&all[..50], &all[51..16_500], &all[16_900..]);
    let before = [&long[8..], end, &all[..16_510], &long[..140]].concat();
    let input = [&before, start, b"?", long, end].concat();
    [a, b, fnv1a(&compressed(10, &[], &input))]
}

/// As they are, and with a bit changed or a distance of zero.
fn hash_of_handmade(streams: &[(Vec<u8>, usize)]) -> [u32; 2] {
    let (mut hashes, mut numbers) = ([0; 2], Numbers(1));
    for (stream, len) in streams {
        let output = decompressed_in_steps(stream, usize::MAX, *len);
        assert_eq!(output.len(), *len);
        let (piece, room) = (33 + numbers.below(200), 50 + numbers.below(3000));
        assert!(decompressed_in_steps(stream, piece, room) == output);
        hashes[0] ^= fnv1a(&output);
        for _ in 0..4 {
            let mut stream = stream.clone();
            let at = numbers.below(stream.len());
            stream[at] ^= 1 << numbers.below(8);
            let output = decompressed_in_steps(&stream, usize::MAX, 1 << 16);
            hashes[1] = hashes[1].rotate_left(1) ^ fnv1a(&output);
        }
    }
    for seed in 0..20 {
        let (stream, len) = writer::stream(&mut Numbers(seed), 0);
        hashes[1] ^=
            fnv1a(&decompressed_in_steps(&stream, usize::MAX, len)).rotate_left(len as u32);
    }
    hashes
}

#[test]
#[cfg_attr(miri, ignore = "takes too long")]
fn streams_do_not_depend_on_the_cpu() {
    /// For each quality, without and with a dictionary.
    const HASHES: [[u32; 2]; 12] = [
        [0xA2EC8614, 0xEB2884E7],
        [0xBB5F15C5, 0xFA9E1A77],
        [0x2C7795E8, 0xC2C2F782],
        [0x83BA1A28, 0x76B3C2AD],
        [0x68199AF7, 0x6EC11D72],
        [0x065A4835, 0x2536CA0C],
        [0xA3B1A121, 0xB07EBD4E],
        [0xCD96BE6C, 0xB18DFFFC],
        [0x7F60FBDB, 0x9C305AC6],
        [0xE457F6D7, 0x38746765],
        [0x2D1B09BF, 0x74B7792F],
        [0x99CA7F4B, 0xB22C61B9],
    ];
    const ODD: [u32; 12] = [
        2069039867, 494485961, 1907591282, 3803103840, 232595941, 234967249, 1552098016,
        1030801508, 2113153340, 195381323, 1730793147, 4235546274,
    ];
    const HANDMADE: [u32; 2] = [3361762641, 2214057213];
    const LONG: [u32; 3] = [4028200455, 4066236216, 3181635547];
    let sample = sample();
    let handmade = (0..100).map(|seed| writer::stream(&mut Numbers(seed), 1));
    let handmade: Vec<_> = handmade.collect();
    let (start, rest) = sample.split_at(SIZE / 3);
    for &target in Target::ALL {
        if !set_cpu(target) {
            continue;
        }
        let hashes: [_; 12] = core::array::from_fn(|quality| {
            [(&[][..], &sample[..]), (start, rest)].map(|(dictionary, input)| {
                let stream = compressed(quality as u32, dictionary, input);
                assert!(decompressed(dictionary, &stream) == input);
                fnv1a(&stream)
            })
        });
        assert_eq!(hashes, HASHES, "{target:?}");
        let more = (hash_of_odd_inputs(&sample), hash_of_handmade(&handmade));
        assert_eq!(more, (ODD, HANDMADE), "{target:?}");
        assert_eq!(hash_of_long_copies(), LONG, "{target:?}");
    }
    reset_cpu();
}
