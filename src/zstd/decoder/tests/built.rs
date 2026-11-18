//! Frames that are built here, as RFC 8878 says, to have the sizes at which the decoder goes another way.

use bun_zstd_decoder::format::{LITERAL_LENGTH_BITS, MATCH_LENGTH_BITS};
use bun_zstd_decoder::{Decoder, Dictionary, Error, Output, Result, Status, decompress};

#[derive(Default)]
struct Bits {
    bytes: Vec<u8>,
    len: usize,
}

impl Bits {
    fn add(&mut self, value: u64, count: u32) {
        for bit in 0..count {
            if self.len % 8 == 0 {
                self.bytes.push(0);
            }
            *self.bytes.last_mut().unwrap() |= ((value >> bit & 1) as u8) << (self.len % 8);
            self.len += 1;
        }
    }

    fn end(mut self) -> Vec<u8> {
        self.add(1, 1);
        self.bytes
    }
}

struct Noise(u32);

impl Noise {
    fn below(&mut self, end: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 as usize % end
    }

    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.below(256) as u8).collect()
    }
}

struct Literals {
    section: Vec<u8>,
    decoded: Vec<u8>,
}

fn raw(decoded: Vec<u8>) -> Literals {
    let header = (decoded.len() as u32) << 4 | 0b1100;
    let section = [&header.to_le_bytes()[..3], &decoded].concat();
    Literals { section, decoded }
}

fn repeated(byte: u8, count: usize) -> Literals {
    let [a, b, c, _] = ((count as u32) << 4 | 0b1101).to_le_bytes();
    Literals {
        section: vec![a, b, c, byte],
        decoded: vec![byte; count],
    }
}

/// `lengths` are those of the codes of the first symbols. 0 is for none.
fn huffman(lengths: &[u32], streams: usize, decoded: Vec<u8>) -> Literals {
    let longest = *lengths.iter().max().unwrap();
    let (mut codes, mut next) = (vec![0; lengths.len()], 0);
    for length in (1..=longest).rev() {
        for (code, _) in codes.iter_mut().zip(lengths).filter(|it| *it.1 == length) {
            *code = next >> (longest - length);
            next += 1 << (longest - length);
        }
    }
    assert_eq!(next, 1 << longest);
    let weight = |length| (longest + 1 - length) % (longest + 1);
    let weights: Vec<_> = lengths.iter().map(|it| weight(it) as u8).collect();
    let mut content = vec![126 + weights.len() as u8];
    let listed = weights[..weights.len() - 1].chunks(2);
    content.extend(listed.map(|it| it[0] << 4 | it.get(1).unwrap_or(&0)));

    let encode = |symbols: &[u8]| {
        let mut bits = Bits::default();
        for &symbol in symbols.iter().rev() {
            bits.add(codes[usize::from(symbol)], lengths[usize::from(symbol)]);
        }
        bits.end()
    };
    let mut segments: Vec<_> = decoded
        .chunks(decoded.len().div_ceil(streams))
        .map(encode)
        .collect();
    segments.resize(streams, vec![1]);
    for segment in &segments[..streams - 1] {
        content.extend((segment.len() as u16).to_le_bytes());
    }
    content.extend(segments.concat());

    let (format, size_bits, header_len) = if streams == 1 { (0, 10, 3) } else { (3, 18, 5) };
    let sizes = decoded.len() as u64 | (content.len() as u64) << size_bits;
    let header = (2 | format << 2 | sizes << 4).to_le_bytes();
    let section = [&header[..header_len], &content].concat();
    Literals { section, decoded }
}

#[derive(Clone, Copy)]
struct Sequence {
    literal_len: usize,
    /// 1 to 3 repeat an offset. The others are 3 more than the offset.
    offset_value: usize,
    match_len: usize,
}

/// The code for `value`, and its extra bits.
fn length_code(value: usize, mut base: usize, extra_bits: &[u8]) -> (u8, u64, u32) {
    for (code, &bits) in extra_bits.iter().enumerate() {
        if value < base + (1 << bits) {
            return (code as u8, (value - base) as u64, bits.into());
        }
        base += 1 << bits;
    }
    unreachable!()
}

struct Frame {
    bytes: Vec<u8>,
    dictionary: Vec<u8>,
    /// Behind the dictionary.
    history: Vec<u8>,
    repeat_offsets: [usize; 3],
}

impl Frame {
    fn new(window_log: u8, dictionary: Vec<u8>) -> Self {
        Self {
            bytes: vec![0x28, 0xB5, 0x2F, 0xFD, 0, (window_log - 10) << 3],
            history: dictionary.clone(),
            dictionary,
            repeat_offsets: [1, 4, 8],
        }
    }

    fn block(&mut self, block_type: u32, size: usize, content: &[u8]) {
        let header = block_type << 1 | (size as u32) << 3;
        self.bytes.extend(&header.to_le_bytes()[..3]);
        self.bytes.extend(content);
    }

    fn raw(&mut self, bytes: &[u8]) {
        self.block(0, bytes.len(), bytes);
        self.history.extend(bytes);
    }

    fn rle(&mut self, byte: u8, count: usize) {
        self.block(1, count, &[byte]);
        self.history.resize(self.history.len() + count, byte);
    }

    /// All `sequences` have the same codes.
    fn compressed(&mut self, literals: &Literals, sequences: &[Sequence]) {
        let mut content = literals.section.clone();
        match sequences.len() {
            count @ ..0x80 => content.push(count as u8),
            count @ ..0x7F00 => content.extend((count as u16 + 0x8000).to_be_bytes()),
            count => content.extend([0xFF, count as u8, ((count - 0x7F00) >> 8) as u8]),
        }
        let (mut bits, mut codes) = (Bits::default(), None);
        for sequence in sequences.iter().rev() {
            let literal = length_code(sequence.literal_len, 0, &LITERAL_LENGTH_BITS);
            let matched = length_code(sequence.match_len, 3, &MATCH_LENGTH_BITS);
            let offset_code = sequence.offset_value.ilog2();
            bits.add(literal.1, literal.2);
            bits.add(matched.1, matched.2);
            bits.add(sequence.offset_value as u64, offset_code);
            let these = [literal.0, offset_code as u8, matched.0];
            assert_eq!(*codes.get_or_insert(these), these);
        }
        if let Some(codes) = codes {
            content.push(0b0101_0100);
            content.extend(codes);
            content.extend(bits.end());
        }
        self.block(2, content.len(), &content);

        let mut literals = &literals.decoded[..];
        for sequence in sequences {
            let [first, second, third] = self.repeat_offsets;
            let value = sequence.offset_value;
            self.repeat_offsets = match (value, value + usize::from(sequence.literal_len == 0)) {
                (4.., _) => [value - 3, first, second],
                (_, 1) => [first, second, third],
                (_, 2) => [second, first, third],
                (_, 3) => [third, first, second],
                _ => [first - 1, first, second],
            };
            self.history
                .extend(literals.split_off(..sequence.literal_len).unwrap());
            for _ in 0..sequence.match_len {
                self.history
                    .push(self.history[self.history.len() - self.repeat_offsets[0]]);
            }
        }
        self.history.extend(literals);
    }

    fn state_size(&mut self) {
        let size = (self.history.len() - self.dictionary.len()) as u32;
        self.bytes[4] = 0x80;
        self.bytes.splice(6..6, size.to_le_bytes());
    }

    /// In all ways there are.
    fn check(mut self) -> Result<()> {
        self.bytes.extend([1, 0, 0]);
        let expected = &self.history[self.dictionary.len()..];
        let dictionary = Dictionary::raw(&self.dictionary);
        for slack in [0, 32, 1 << 18] {
            let mut slice = vec![0xAA; expected.len() + slack];
            decompress(
                &self.bytes,
                &mut Output::slice(&mut slice),
                Some(&dictionary),
            )?;
            assert!(&slice[..expected.len()] == expected);

            let mut vec = Vec::with_capacity(expected.len() + slack);
            let mut out = Output::spare_capacity(&mut vec, expected.len());
            decompress(&self.bytes, &mut out, Some(&dictionary))?;
            drop(out);
            assert!(vec == expected);
        }

        let mut decoder = Decoder::new();
        decoder.load_dictionary(&self.dictionary)?;
        for [input_step, output_step] in [[usize::MAX; 2], [usize::MAX, 50_000], [1000, usize::MAX]]
        {
            let (mut src, mut out) = (&self.bytes[..], Vec::new());
            while !src.is_empty() {
                let (input, before) = (&src[..input_step.min(src.len())], out.len());
                let (consumed, status) = decoder.step_growing(input, &mut out, output_step);
                assert!(out.len() - before <= output_step);
                src = &src[consumed..];
                assert_eq!(status? == Status::Complete, src.is_empty());
            }
            assert!(out == expected);
        }
        Ok(())
    }
}

const BLOCK: usize = 128 << 10;

/// From 1 bit to `longest`, which two have.
fn skewed_lengths(longest: u32) -> Vec<u32> {
    (1..=longest).chain([longest]).collect()
}

#[test]
fn literals_of_all_sizes() -> Result<()> {
    let mut noise = Noise(1);
    let tables = [
        skewed_lengths(1),
        skewed_lengths(11),
        skewed_lengths(12),
        vec![4; 16],
        vec![6; 64],
        [vec![1], vec![8; 128]].concat(),
        [vec![2], vec![7; 96]].concat(),
        [vec![5; 16], vec![6; 32]].concat(),
        [vec![1, 2, 3, 4], vec![9; 16], vec![10; 24], vec![11; 16]].concat(),
    ];
    let sizes = [
        6,
        7,
        9,
        31,
        223,
        225,
        511,
        516,
        1023,
        9000,
        BLOCK / 2 + 9,
        BLOCK - 3,
    ];
    for lengths in tables {
        let mut frame = Frame::new(17, Vec::new());
        for (size, streams) in sizes
            .into_iter()
            .flat_map(|size| [(size, 4), (size.min(600), 1)])
        {
            // A stream with nothing but the first symbol is through long before one with all kinds of them.
            let symbol =
                |index| noise.below(1 + 4 * index / size % 3 * (lengths.len() - 1) / 2) as u8;
            let literals = huffman(&lengths, streams, (0..size).map(symbol).collect());
            frame.compressed(&literals, &[]);
            let sequence = Sequence {
                literal_len: 5,
                offset_value: 7,
                match_len: 3,
            };
            frame.compressed(&literals, &[sequence]);
        }
        frame.compressed(&huffman(&lengths, 4, vec![0; BLOCK]), &[]);
        frame.check()?;
    }
    Ok(())
}

#[test]
fn many_codes_of_one_length() -> Result<()> {
    for length in 2..8 {
        let shorter = if length == 7 { 5 } else { 1 };
        let mut lengths = vec![length; (1 << length) - 1 - 2 * shorter];
        lengths.extend(vec![length - 1; shorter]);
        lengths.push(0);
        lengths.extend((length + 1..=12).chain([12]));
        let symbols = (0..).zip(&lengths).filter(|it| *it.1 != 0).map(|it| it.0);
        let mut frame = Frame::new(17, Vec::new());
        frame.compressed(&huffman(&lengths, 4, symbols.collect()), &[]);
        frame.check()?;
    }
    Ok(())
}

#[test]
fn short_frames_take_little_room() -> Result<()> {
    let mut frame = Frame::new(20, Vec::new());
    frame.compressed(&huffman(&[4; 16], 4, vec![5; 5000]), &[]);
    frame.bytes.extend([1, 0, 0]);
    let mut decoder = Decoder::new();
    for _ in 0..30 {
        let mut out = Vec::new();
        decoder.step_growing(&frame.bytes, &mut out, usize::MAX).1?;
        assert!(out.len() == 5000 && out.capacity() < 6000);
    }
    Ok(())
}

#[test]
fn matches_of_all_periods_and_lengths() -> Result<()> {
    let mut noise = Noise(2);
    let mut frame = Frame::new(14, noise.bytes(100));
    for offset in (1..40).chain([100, 130]) {
        for match_len in [3, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65, 200] {
            for literal_len in [0, 1, 16, 17, 48, 49, 100] {
                let sequence = Sequence {
                    literal_len,
                    offset_value: offset + 3,
                    match_len,
                };
                frame.compressed(&raw(noise.bytes(4 * literal_len + 2)), &[sequence; 4]);
            }
        }
    }
    frame.check()
}

#[test]
fn matches_at_the_end_of_the_dictionary() -> Result<()> {
    let mut noise = Noise(3);
    for distance in [1, 15, 16, 34, 35, 36, 70, 199, 200] {
        for match_len in [3, 20, 40, 130] {
            let mut frame = Frame::new(10, noise.bytes(200));
            let sequence = Sequence {
                literal_len: 2,
                offset_value: distance + 2 + 3,
                match_len,
            };
            frame.compressed(&raw(noise.bytes(6)), &[sequence; 3]);
            frame.check()?;
        }
    }
    Ok(())
}

#[test]
fn the_end_of_the_output_is_not_passed() -> Result<()> {
    let mut noise = Noise(7);
    for len in [0, 900, 990, 1000, 1030, 3000] {
        for (distance, match_len) in [(5, 3), (5, 30), (40, 3), (40, 39), (40, 41), (150, 20)] {
            for is_size_known in [false, true] {
                let mut frame = Frame::new(12, noise.bytes(200));
                let first = Sequence {
                    literal_len: len,
                    offset_value: 20,
                    match_len: 4,
                };
                let then = Sequence {
                    literal_len: 0,
                    offset_value: len + 4 + distance + 3,
                    match_len,
                };
                frame.compressed(&raw(noise.bytes(len)), &[first]);
                frame.compressed(&raw(noise.bytes(1)), &[then]);
                if is_size_known {
                    frame.state_size();
                }
                frame.check()?;
            }
        }
    }
    for len in 985..1030 {
        let mut frame = Frame::new(12, noise.bytes(200));
        let sequence = Sequence {
            literal_len: 1,
            offset_value: 100,
            match_len: 9,
        };
        frame.compressed(&raw(noise.bytes(len - 810)), &[sequence; 90]);
        frame.state_size();
        frame.check()?;
    }
    Ok(())
}

#[test]
fn offsets_are_repeated_across_many_sequences() -> Result<()> {
    let mut noise = Noise(4);
    let mut frame = Frame::new(17, Vec::new());
    frame.raw(&noise.bytes(5000));
    for count in [1, 2, 3, 28, 29, 63, 64, 65, 66, 129, 700] {
        for literal_len in [0, 1] {
            let new = |offset_value| Sequence {
                literal_len,
                offset_value,
                match_len: 4,
            };
            frame.compressed(&raw(noise.bytes(3)), &[4000, 3000, 3900].map(new));
            frame.compressed(&raw(noise.bytes(count)), &vec![new(1); count]);
            let sequences: Vec<_> = (0..count).map(|_| new(2 + noise.below(2))).collect();
            frame.compressed(&raw(noise.bytes(count)), &sequences);
        }
    }
    frame.check()
}

#[test]
fn sequences_that_take_no_bits() -> Result<()> {
    let mut frame = Frame::new(17, Vec::new());
    frame.raw(b"12345678");
    let sequence = Sequence {
        literal_len: 0,
        offset_value: 1,
        match_len: 3,
    };
    for count in [0x7F, 0x80, 0x7EFF, 0x7F00, BLOCK / 3] {
        frame.compressed(&raw(Vec::new()), &vec![sequence; count]);
    }
    let sequence = Sequence {
        literal_len: 0,
        offset_value: 9,
        match_len: 3,
    };
    frame.compressed(&repeated(7, 0), &[sequence; 500]);
    frame.check()
}

#[test]
fn long_lengths() -> Result<()> {
    let mut noise = Noise(5);
    let mut frame = Frame::new(17, Vec::new());
    frame.raw(&noise.bytes(300));
    for (literal_len, match_len, count) in [
        (32767, 3, 3),
        (32768, 3, 3),
        (65535, 3, 1),
        (65536, 3, 1),
        (BLOCK - 3, 3, 1),
        (0, 32770, 3),
        (0, 32771, 3),
        (0, 65535, 2),
        (0, 65536, 2),
        (0, 65539, 1),
        (0, BLOCK, 1),
        (16384, 16387, 3),
    ] {
        let sequence = Sequence {
            literal_len,
            offset_value: 260,
            match_len,
        };
        frame.compressed(
            &repeated(noise.below(256) as u8, count * literal_len),
            &vec![sequence; count],
        );
    }
    frame.check()
}

#[test]
fn long_matches_of_long_periods() -> Result<()> {
    let mut frame = Frame::new(17, Vec::new());
    frame.raw(&Noise(8).bytes(9000));
    // The pieces are not the same once the output is large.
    let offsets = [
        1, 2, 20, 513, 2047, 2048, 2049, 4096, 4097, 4351, 4352, 8999,
    ];
    for offset in [offsets; 3].concat() {
        let sequence = Sequence {
            literal_len: 3,
            offset_value: offset + 3,
            match_len: 20_000,
        };
        frame.compressed(&raw(Noise(9).bytes(12)), &[sequence; 4]);
    }
    frame.check()
}

#[test]
#[cfg_attr(miri, ignore = "takes tens of megabytes")]
fn far_matches() -> Result<()> {
    let mut noise = Noise(6);
    let mut frame = Frame::new(25, noise.bytes(1000));
    // Enough to go around the ring.
    for round in 0..300 {
        frame.rle(round as u8, BLOCK);
        frame.raw(&noise.bytes(100));
        if round < 130 || round % 20 != 0 {
            continue;
        }
        for (literal_len, match_len, count) in [(1, 20, 65), (0, 3, 1000), (1030, 520, 80)] {
            let new = |_| Sequence {
                literal_len,
                offset_value: (1 << 23) + noise.below(1 << 23),
                match_len,
            };
            let sequences: Vec<_> = (0..count).map(new).collect();
            frame.compressed(&repeated(9, count * literal_len), &sequences);
        }
    }
    let near = Sequence {
        literal_len: 1,
        offset_value: 100,
        match_len: 20,
    };
    frame.compressed(&repeated(9, 65), &[near; 65]);
    frame.check()
}

#[test]
fn what_does_not_add_up_is_refused() {
    let sequence = Sequence {
        literal_len: 1,
        offset_value: 9,
        match_len: 3,
    };
    let mut frame = Frame::new(17, Vec::new());
    frame.raw(b"12345678");
    let start = frame.bytes.len();
    frame.compressed(&repeated(0, 900), &[sequence; 900]);
    let decode = |block: &[u8], room| {
        let header = (block.len() as u32) << 3 | 2 << 1 | 1;
        let bytes = [&frame.bytes[..start], &header.to_le_bytes()[..3], block].concat();
        decompress(&bytes, &mut Output::slice(&mut vec![0; room]), None)
    };
    let block = &frame.bytes[start + 3..];
    assert_eq!(decode(block, 3608), Ok(()));
    for room in [8, 900, 908, 2000, 3607] {
        assert_eq!(decode(block, room), Err(Error::DstSizeTooSmall));
    }
    // Too few bits, too many bits, too few literals.
    let (headers, stream) = block.split_at(10);
    for stream in [&stream[1..], &stream[200..], &[&[0], stream].concat()] {
        assert_eq!(
            decode(&[headers, stream].concat(), 3608),
            Err(Error::CorruptionDetected)
        );
    }
    let fewer = [&repeated(0, 899).section, &block[4..]].concat();
    assert_eq!(decode(&fewer, 3608), Err(Error::CorruptionDetected));
}

#[test]
fn a_stream_of_literals_has_as_many_as_it_says() {
    let lengths = [4; 16];
    // The table is for many of them, or for few.
    for before in [40_000, 40] {
        let mut frame = Frame::new(17, Vec::new());
        frame.compressed(&huffman(&lengths, 4, vec![1; before]), &[]);
        let stream = &huffman(&lengths, 1, vec![2; 600]).section[3 + 9..];
        for count in [600, 596, 604, 1000] {
            let literals = 3 | count << 4 | (stream.len() as u32) << 14;
            let block = (3 + stream.len() as u32 + 1) << 3 | 2 << 1 | 1;
            let [literals, block] = [literals, block].map(u32::to_le_bytes);
            let bytes = [&frame.bytes, &block[..3], &literals[..3], stream, &[0]].concat();
            let result = decompress(&bytes, &mut Output::slice(&mut vec![0; 50_000]), None);
            let expected = (count != 600).then_some(Error::CorruptionDetected);
            assert_eq!(result.err(), expected);
        }
    }
}
