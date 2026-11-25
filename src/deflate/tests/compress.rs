use crate::cases::{CASES, Part};
use crate::support::{Random, adler32, bytes_allocated_by, copy, crc32, with_failing};
use bun_deflate::{
    Compressor, Error, Format, Level, Output, compress_bound, compress_to_vec, gunzip, inflate,
};

const FORMATS: [Format; 3] = [Format::Raw, Format::Zlib, Format::Gzip];

fn level(level: u8) -> Level {
    Level::new(level.into()).unwrap()
}

fn generate(seed: u32, parts: &[Part]) -> Vec<u8> {
    let (mut data, mut random) = (Vec::new(), Random(seed));
    for &part in parts {
        let start = data.len();
        match part {
            Part::Even(len, kinds, first) => {
                data.extend((0..len).map(|_| (first + random.below(kinds)) as u8));
            }
            Part::Skewed(len, per_mille) => data.extend((0..len).map(|_| {
                let count = (0..).take_while(|_| random.below(1000) < per_mille).count();
                count as u8
            })),
            Part::Again(len, offset) => copy(&mut data, len, offset),
            Part::Mixed(len, kinds, literals, [shortest, lens], [nearest, offsets]) => {
                while data.len() < start + len {
                    for _ in 0..random.below(literals + 1) + usize::from(data.is_empty()) {
                        data.push(random.below(kinds) as u8);
                    }
                    let len = shortest + random.below(lens);
                    copy(&mut data, len, nearest + random.below(offsets));
                }
            }
            Part::Rare(len, literals, match_len, per_mille, is_reversed) => {
                while data.len() < start + len {
                    data.extend(random.bytes(literals));
                    let steps = (0..27).take_while(|_| random.below(1000) < per_mille);
                    let slot = steps.count().abs_diff(27 * is_reversed);
                    let first = ((2 + slot % 2) << (slot / 2)) + 1;
                    copy(&mut data, match_len, first + random.below(1 << (slot / 2)));
                }
            }
            Part::Colliding(len, kinds) => {
                while data.len() < start + len {
                    let word = (random.below(kinds) as u32).wrapping_mul(0x22B5_4B95);
                    data.extend(word.to_le_bytes());
                }
            }
            Part::Stairs(steps, stride) => {
                let text = random.bytes(steps * (stride + 1) + 8);
                for step in 0..steps {
                    let (start, len) = (step * stride, step + 4);
                    data.extend(&text[start..start + len]);
                    data.push(!text[start + len]);
                }
                data.extend(text);
            }
        }
    }
    data
}

#[track_caller]
fn inflates_to(stream: &[u8], data: &[u8]) {
    let mut output = vec![0; data.len()];
    let result = inflate(stream, Output::Slice(&mut output)).unwrap();
    assert_eq!((result.read, result.written), (stream.len(), data.len()));
    assert!(output == data);
}

fn cases() -> impl DoubleEndedIterator<Item = (usize, Level, Vec<u8>, (usize, u32))> {
    let cases = CASES.iter().enumerate();
    cases.map(|(index, &(effort, seed, parts, len, crc))| {
        (index, level(effort), generate(seed, parts), (len, crc))
    })
}

#[test]
fn known_streams() {
    for (index, level, data, expected) in cases() {
        let stream = compress_to_vec(&data, Format::Raw, level).unwrap();
        assert_eq!((stream.len(), crc32(0, &stream)), expected, "case {index}");
        inflates_to(&stream, &data);
    }
}

#[test]
fn known_streams_one_after_the_other() {
    let mut compressor = Compressor::default();
    for (index, level, data, expected) in cases() {
        let mut room = vec![0xAA; expected.0 + 8];
        let len = compressor.compress(&data, Format::Raw, level, Output::Slice(&mut room));
        let stream = &room[..len.unwrap()];
        assert_eq!((stream.len(), crc32(0, stream)), expected, "case {index}");
    }
}

#[test]
fn known_streams_after_longer_ones_and_after_failures() {
    let mut compressor = Compressor::default();
    for (index, level, data, expected) in cases().rev() {
        let mut compress = |limit| {
            let vec = &mut vec![1, 2, 3];
            let len = compressor.compress(&data, Format::Raw, level, Output::Vec { vec, limit });
            assert_eq!(vec.len(), 3 + len.unwrap_or(0));
            len.map(|len| (len, crc32(0, &vec[3..])))
        };
        assert_eq!(compress(expected.0 / 2), Err(Error::InsufficientSpace));
        assert_eq!(compress(usize::MAX), Ok(expected), "case {index}");
    }
}

#[test]
fn long_block_after_failure_with_many_matches() {
    let (many, long) = (generate(1, &[Part::Even(190_000, 2, 65)]), vec![0; 300_000]);
    let (mut compressor, mut room) = (Compressor::default(), [0; 5000]);
    let mut compress =
        |data| compressor.compress(data, Format::Raw, level(10), Output::Slice(&mut room));
    assert_eq!(compress(&many), Err(Error::InsufficientSpace));
    let len = compress(&long).unwrap();
    assert!(room[..len] == compress_to_vec(&long, Format::Raw, level(10)).unwrap());
}

#[test]
fn levels() {
    assert_eq!(Level::new(6), Some(Level::DEFAULT));
    assert!(Level::new(0).is_some() && Level::new(12).is_some());
    for outside in [i32::MIN, -1, 13, 256, 262, i32::MAX] {
        assert_eq!(Level::new(outside), None);
    }
}

#[test]
fn headers_and_trailers() {
    const ZLIB: [u8; 13] = [
        0x01, 0x01, 0x5E, 0x5E, 0x5E, 0x5E, 0x9C, 0x9C, 0xDA, 0xDA, 0xDA, 0xDA, 0xDA,
    ];
    const GZIP: [u8; 13] = [4, 4, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2];
    let (data, raw) = (b"abc", [1, 3, 0, !3, 0xFF, b'a', b'b', b'c']);
    let (adler, crc) = ([0x02, 0x4D, 0x01, 0x27], [0xC2, 0x41, 0x24, 0x35]);
    for ((effort, zlib), gzip) in (0..).zip(ZLIB).zip(GZIP) {
        let compress = |format| compress_to_vec(data, format, level(effort)).unwrap();
        assert_eq!(compress(Format::Raw), raw);
        assert_eq!(
            compress(Format::Zlib),
            [&[0x78, zlib][..], &raw, &adler].concat()
        );
        let header = [0x1F, 0x8B, 8, 0, 0, 0, 0, 0, gzip, 255];
        assert_eq!(
            compress(Format::Gzip),
            [&header[..], &raw, &crc, &[3, 0, 0, 0]].concat()
        );
    }
}

#[test]
fn formats_wrap_the_same_stream() {
    let data = generate(1, &[Part::Mixed(70000, 60, 8, [3, 30], [1, 300])]);
    let adler = adler32(&data).to_be_bytes();
    let [crc, len] = [crc32(0, &data), data.len() as u32].map(u32::to_le_bytes);
    for effort in 0..=Level::MAX {
        let [raw, zlib, gzip] =
            FORMATS.map(|format| compress_to_vec(&data, format, level(effort)).unwrap());
        inflates_to(&raw, &data);
        assert!(zlib[2..] == [&raw[..], &adler].concat());
        assert!(gzip[10..] == [&raw[..], &crc, &len].concat());
        let (vec, limit) = (&mut Vec::new(), usize::MAX);
        assert!(gunzip(&gzip, Output::Vec { vec, limit }).is_ok());
        assert!(*vec == data);
    }
}

#[test]
fn short_inputs() {
    let mut compressor = Compressor::default();
    for effort in 0..=Level::MAX {
        for len in 0..70 {
            let (data, mut room) = (vec![b'a'; len], [0; 100]);
            let output = Output::Slice(&mut room);
            let written = compressor.compress(&data, Format::Raw, level(effort), output);
            let is_stored = effort == 0 || len <= usize::from(55 - 4 * effort);
            assert_eq!(written == Ok(len + 5), is_stored);
            inflates_to(&room[..written.unwrap()], &data);
        }
    }
}

#[test]
fn matches_end_with_the_input() {
    let run = [Part::Even(190, 256, 0), Part::Even(280, 1, 65)];
    let pairs = [Part::Even(300, 256, 0), Part::Even(2720, 2, 65)];
    let (mut compressor, mut room) = (Compressor::default(), [0; 1000]);
    for (parts, step, efforts) in [(run, 1, 1..=Level::MAX), (pairs, 5, 5..=8)] {
        let data = generate(1, &parts);
        for level in efforts.map(level) {
            // What a longer input left behind goes on matching.
            for data in (0..40).map(|steps| &data[..data.len() - steps * step]) {
                let output = Output::Slice(&mut room);
                let written = compressor.compress(data, Format::Raw, level, output);
                let stream = &room[..written.unwrap()];
                assert!(stream == compress_to_vec(data, Format::Raw, level).unwrap());
                inflates_to(stream, data);
            }
        }
    }
}

#[test]
fn many_codewords_of_one_length() {
    let data: Vec<u8> = (1..=255).flat_map(|byte| [0, byte]).collect();
    for level in (1..=Level::MAX).map(level) {
        let stream = compress_to_vec(&data, Format::Raw, level).unwrap();
        assert_eq!((stream.len(), crc32(0, &stream)), (346, 0xBCAC_51BE));
        inflates_to(&stream, &data);
    }
}

#[test]
fn stored_blocks() {
    let data = Random(1).bytes(3 * 65535);
    for (len, blocks) in [(65534, 1), (65535, 1), (65536, 2), (131070, 2), (131071, 3)] {
        let stream = compress_to_vec(&data[..len], Format::Raw, level(0)).unwrap();
        assert_eq!(stream.len(), len + 5 * blocks);
        inflates_to(&stream, &data[..len]);
    }
}

#[test]
fn bounds() {
    for (format, header) in FORMATS.into_iter().zip([0, 2, 10]) {
        for (len, blocks) in [(0, 1), (1, 1), (5000, 1), (5001, 2), (1_000_000, 200)] {
            assert_eq!(compress_bound(len, format), len + header + 5 * blocks + 8);
        }
        assert_eq!(compress_bound(usize::MAX, format), usize::MAX);
    }
}

#[test]
fn each_room() {
    let inputs = [
        generate(1, &[]),
        generate(1, &[Part::Even(5, 256, 0)]),
        generate(1, &[Part::Even(100, 256, 0)]),
        generate(1, &[Part::Even(20, 256, 0), Part::Again(100, 20)]),
        generate(1, &[Part::Skewed(300, 618)]),
    ];
    let mut compressor = Compressor::default();
    for (data, spare) in inputs.iter().zip([8, 3, 0, 8, 8]) {
        for (format, trailer) in FORMATS.into_iter().zip([0, 4, 8]) {
            for level in [1, 4, 6, 9, 10].map(level) {
                let stream = compress_to_vec(data, format, level).unwrap();
                let least = stream.len() + usize::saturating_sub(spare, trailer);
                for room in 0..=compress_bound(data.len(), format) {
                    let expected = match room < least {
                        true => Err(Error::InsufficientSpace),
                        false => Ok(stream.len()),
                    };
                    let mut slice = vec![0xAA; room];
                    let output = Output::Slice(&mut slice);
                    assert_eq!(compressor.compress(data, format, level, output), expected);
                    assert!(expected.is_err() || slice.starts_with(&stream));

                    let (vec, limit) = (&mut vec![7], room);
                    let output = Output::Vec { vec, limit };
                    assert_eq!(compressor.compress(data, format, level, output), expected);
                    assert_eq!(vec[1..], stream[..expected.unwrap_or(0)]);
                    assert!(vec.capacity() <= 1 + room);
                }
            }
        }
    }
}

#[test]
fn room_for_each_number_of_bits() {
    for len in 60..90 {
        let data = generate(1, &[Part::Even(len, 20, 134), Part::Again(len, 9)]);
        let stream = compress_to_vec(&data, Format::Raw, Level::DEFAULT).unwrap();
        assert_eq!(stream.capacity(), compress_bound(data.len(), Format::Raw));
        let into = |room| {
            let output = Output::Slice(&mut vec![0; room]);
            Compressor::default().compress(&data, Format::Raw, Level::DEFAULT, output)
        };
        assert_eq!(into(stream.len() + 7), Err(Error::InsufficientSpace));
        assert_eq!(into(stream.len() + 8), Ok(stream.len()));
    }
}

#[test]
fn allocations_that_fail() {
    let data = generate(1, &[Part::Even(20000, 3, 65)]);
    for failing in [0..1, 1..2] {
        let compress = || compress_to_vec(&data, Format::Gzip, Level::DEFAULT);
        let (result, _) = with_failing(failing, compress);
        assert!(matches!(result, Err(Error::Alloc(_))));
    }
    let levels = (0..=Level::MAX).map(level);
    for (level, data) in levels.flat_map(|level| [(level, &data[..]), (level, &data[..300])]) {
        let expected = compress_to_vec(data, Format::Gzip, level).unwrap();
        for first in 0.. {
            let asked_for = [first + 1, usize::MAX].map(|end| {
                let (mut compressor, mut vec) = (Compressor::default(), vec![1, 2, 3]);
                let mut compress = |vec: &mut Vec<u8>| {
                    let limit = usize::MAX;
                    compressor.compress(data, Format::Gzip, level, Output::Vec { vec, limit })
                };
                let (result, asked_for) = with_failing(first..end, || compress(&mut vec));
                if result.is_err() {
                    assert!(matches!(result, Err(Error::Alloc(_))));
                    assert_eq!(vec, [1, 2, 3]);
                    assert_eq!(compress(&mut vec), Ok(expected.len()));
                }
                assert!(vec[3..] == expected);
                asked_for
            });
            if asked_for == [first; 2] {
                break;
            }
        }
    }
}

#[test]
fn memory_is_limited_and_kept() {
    let data = generate(1, &[Part::Even(80000, 3, 65), Part::Again(900_000, 20000)]);
    let mut room = vec![0; compress_bound(data.len(), Format::Raw)];
    let most_kib = [
        (0, 0, 0),
        (1, 136, 336),
        (4, 272, 800),
        (6, 272, 1344),
        (9, 272, 1344),
        (10, 864, 11000),
    ];
    for (effort, for_little, for_much) in most_kib {
        let mut kib = |compressor: &mut Compressor, data| {
            let output = Output::Slice(&mut room);
            let compress = || compressor.compress(data, Format::Raw, level(effort), output);
            bytes_allocated_by(|| assert!(compress().is_ok())).div_ceil(1024)
        };
        let mut compressor = Compressor::default();
        assert!(kib(&mut Compressor::default(), &data[..500]) <= for_little);
        assert!(kib(&mut compressor, &data[..]) <= for_much);
        assert_eq!(kib(&mut compressor, &data[..]), 0);
        assert_eq!(kib(&mut compressor, &data[..500]), 0);
    }
}
