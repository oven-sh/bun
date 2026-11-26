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

/// An FSE table.
struct Table {
    description: Vec<u8>,
    log: u32,
    /// The symbol, and the number of bits and the base for the next state.
    rows: Vec<(u8, u32, u32)>,
}

impl Table {
    fn repeated(symbol: u8) -> Self {
        Self {
            description: vec![symbol],
            log: 0,
            rows: vec![(symbol, 0, 0)],
        }
    }

    /// With 32 states. The most common symbol gets those that the others can spare.
    fn compressed(symbols: &[u8]) -> Self {
        let count_of = |symbol| symbols.iter().filter(|it| **it == symbol).count();
        let max = *symbols.iter().max().unwrap().max(&1);
        let common = (0..=max).max_by_key(|it| count_of(*it)).unwrap();
        let has_state = |it| u32::from(count_of(it) != 0 || it == u8::from(common == 0));
        let mut counts: Vec<_> = (0..=max).map(has_state).collect();
        counts[usize::from(common)] += 32 - counts.iter().sum::<u32>();

        let (mut description, mut remaining) = (Bits::default(), 33u32);
        description.add(0, 4);
        for run in counts.chunk_by(|a, b| a + b == 0) {
            let (threshold, value) = (1 << remaining.ilog2(), run[0] + 1);
            let short_values = 2 * threshold - 1 - remaining;
            let value = value + if value < threshold { 0 } else { short_values };
            let width = remaining.ilog2() + u32::from(value >= short_values);
            description.add(value.into(), width);
            remaining -= run[0];
            if run[0] == 0 {
                let more = run.len() as u64 - 1;
                (0..more / 3).for_each(|_| description.add(3, 2));
                description.add(more % 3, 2);
            }
        }

        let (mut spread, mut state) = ([0; 32], 0);
        for (symbol, &count) in (0..).zip(&counts) {
            for _ in 0..count {
                spread[state] = symbol;
                state = (state + 23) % 32;
            }
        }
        let rows = spread.map(|symbol| {
            let rank = &mut counts[usize::from(symbol)];
            let bits = 5 - rank.ilog2();
            *rank += 1;
            (symbol, bits, ((*rank - 1) << bits) - 32)
        });
        Self {
            description: description.bytes,
            log: 5,
            rows: rows.to_vec(),
        }
    }

    /// The state for `symbol` from which what it adds to `bits` leads to `next`. The way on from the last takes bits.
    fn state_before(&self, next: Option<u32>, symbol: u8, bits: &mut Bits) -> u32 {
        let fits = |&(its_symbol, width, base): &(u8, u32, u32)| {
            let leads_to = |next| (base..base + (1 << width)).contains(&next);
            its_symbol == symbol && next.map_or(width != 0 || self.log == 0, leads_to)
        };
        let state = self.rows.iter().position(fits).unwrap();
        if let Some(next) = next {
            bits.add((next - self.rows[state].2).into(), self.rows[state].1);
        }
        state as u32
    }
}

fn compressed_weights(weights: &[u8]) -> Vec<u8> {
    let table = Table::compressed(weights);
    // Two states take turns.
    let (mut bits, mut next) = (Bits::default(), [None; 2]);
    for &weight in weights.iter().rev() {
        next = [
            Some(table.state_before(next[1], weight, &mut bits)),
            next[0],
        ];
    }
    bits.add(next[1].unwrap().into(), table.log);
    bits.add(next[0].unwrap().into(), table.log);
    [table.description, bits.end()].concat()
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
    let listed = &weights[..weights.len() - 1];
    let mut content = if listed.len() > 128 {
        let compressed = compressed_weights(listed);
        [vec![compressed.len() as u8], compressed].concat()
    } else {
        let pairs = (listed.chunks(2)).map(|it| it[0] << 4 | it.get(1).unwrap_or(&0));
        [127 + listed.len() as u8]
            .into_iter()
            .chain(pairs)
            .collect()
    };

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
    /// How many bytes of the last compressed block are behind its literals.
    tail: usize,
    dictionary: Vec<u8>,
    /// Behind the dictionary.
    history: Vec<u8>,
    repeat_offsets: [usize; 3],
}

impl Frame {
    fn new(window_log: u8, dictionary: Vec<u8>) -> Self {
        Self {
            bytes: vec![0x28, 0xB5, 0x2F, 0xFD, 0, (window_log - 10) << 3],
            tail: 0,
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

    fn compressed(&mut self, literals: &Literals, sequences: &[Sequence]) {
        let mut content = literals.section.clone();
        match sequences.len() {
            count @ ..0x80 => content.push(count as u8),
            count @ ..0x7F00 => content.extend((count as u16 + 0x8000).to_be_bytes()),
            count => content.extend([0xFF, count as u8, ((count - 0x7F00) >> 8) as u8]),
        }
        let codes = |it: &Sequence| {
            let offset_code = it.offset_value.ilog2();
            [
                length_code(it.literal_len, 0, &LITERAL_LENGTH_BITS),
                (offset_code as u8, it.offset_value as u64, offset_code),
                length_code(it.match_len, 3, &MATCH_LENGTH_BITS),
            ]
        };
        if let Some(first) = sequences.first() {
            let tables = [0, 1, 2].map(|kind| {
                let all: Vec<_> = sequences.iter().map(|it| codes(it)[kind].0).collect();
                if all.iter().all(|it| *it == codes(first)[kind].0) {
                    Table::repeated(all[0])
                } else {
                    Table::compressed(&all)
                }
            });
            let (mut bits, mut states) = (Bits::default(), [None; 3]);
            for codes in sequences.iter().rev().map(codes) {
                for kind in [1, 2, 0] {
                    let state = tables[kind].state_before(states[kind], codes[kind].0, &mut bits);
                    states[kind] = Some(state);
                }
                for kind in [0, 2, 1] {
                    bits.add(codes[kind].1, codes[kind].2);
                }
            }
            for kind in [2, 1, 0] {
                bits.add(states[kind].unwrap().into(), tables[kind].log);
            }
            let mode = |modes: u8, table: &Table| modes << 2 | if table.log == 0 { 1 } else { 2 };
            content.push(tables.iter().fold(0, mode) << 2);
            content.extend(tables.iter().flat_map(|it| &it.description));
            content.extend(bits.end());
        }
        self.tail = content.len() - literals.section.len();
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
fn as_many_codes_of_one_weight_as_can_be() -> Result<()> {
    let mut tables = vec![[vec![1], vec![0; 254], vec![1]].concat()];
    for (weight, has_next) in (1..=12).flat_map(|it| [(it, false), (it, it != 12)]) {
        let longest = 12.min(weight + 7);
        let length = longest + 1 - weight;
        // One code of that length is split up into longer ones, and some are merged if there are too many.
        let mut lengths: Vec<u32> = (length + 1..=longest).chain([longest]).collect();
        let mut count = (1 << length) - 1;
        if has_next {
            lengths.push(length - 1);
            count -= 2;
        }
        while let too_many @ 1.. = (lengths.len() + count).saturating_sub(256) {
            let shorter_by = (too_many + 1).ilog2();
            lengths.push(length - shorter_by);
            count -= 1 << shorter_by;
        }
        lengths.extend(vec![length; count]);
        lengths.splice(1..1, vec![0; 256 - lengths.len()]);
        tables.push(lengths);
    }
    for mut lengths in tables {
        for turn in [0, 255, 100] {
            lengths.rotate_left(turn);
            let lengths = &lengths[..=lengths.iter().rposition(|it| *it != 0).unwrap()];
            let symbols = (0..=255)
                .zip(lengths)
                .filter(|it| *it.1 != 0)
                .map(|it| it.0);
            let mut frame = Frame::new(17, Vec::new());
            // One at a time, and two where that is quicker.
            for count in [600, 40_000] {
                let literals = symbols.clone().cycle().take(count).collect();
                frame.compressed(&huffman(lengths, 4, literals), &[]);
            }
            frame.check()?;
        }
    }
    Ok(())
}

#[test]
fn raw_literals_with_little_behind_them() -> Result<()> {
    // More than 224 literals with less than the padding of 32 bytes behind them are taken as they are.
    let (mut noise, mut unpadded) = (Noise(10), 0);
    let mut count_unpadded = |frame: &Frame, literals: &Literals| {
        unpadded += usize::from(frame.tail < 32 && literals.decoded.len() > 224);
    };
    for (literal_len, count) in [
        (0, 0),
        (0, 3),
        (1, 230),
        (16, 14),
        (16, 15),
        (500, 1),
        (3000, 2),
    ] {
        for left in (0..40).chain([224, 225]) {
            // These offsets take no bits, or up to 200 in all.
            for offset_value in [1, 1 << (200 / count.max(20))] {
                let sequence = Sequence {
                    literal_len,
                    offset_value,
                    match_len: 3,
                };
                let mut frame = Frame::new(17, Vec::new());
                frame.raw(&noise.bytes(1 << 10));
                let literals = raw(noise.bytes(count * literal_len + left));
                frame.compressed(&literals, &vec![sequence; count]);
                count_unpadded(&frame, &literals);
                frame.check()?;
            }
        }
    }
    // From 25 to 38 bytes behind many literals, and behind few.
    for count in (150..260).step_by(8) {
        for (literal_len, left) in [(1, 100), (2, 0), (0, 0), (0, 5)] {
            let sequence = Sequence {
                literal_len,
                offset_value: 2,
                match_len: 3,
            };
            let mut frame = Frame::new(17, Vec::new());
            frame.raw(&noise.bytes(8));
            let literals = raw(noise.bytes(count * literal_len + left));
            frame.compressed(&literals, &vec![sequence; count]);
            count_unpadded(&frame, &literals);
            frame.check()?;
        }
    }
    assert_eq!(unpadded, 436);
    for (literal_len, count, offset_value) in [(300, 1, 1), (16, 15, 1), (1, 100, 1), (1, 130, 4)] {
        let sequence = Sequence {
            literal_len,
            offset_value,
            match_len: 3,
        };
        let mut frame = Frame::new(17, Vec::new());
        let literals = raw(noise.bytes(count * literal_len));
        frame.compressed(&literals, &vec![sequence; count]);
        frame.bytes.extend([1, 0, 0]);
        let mut room = vec![0; frame.history.len() - 1];
        let result = decompress(&frame.bytes, &mut Output::slice(&mut room), None);
        assert_eq!(result, Err(Error::DstSizeTooSmall));

        // What follows them does not make up for one that is missing.
        let fewer = raw(literals.decoded[1..].to_vec()).section;
        let block_len = frame.bytes.len() - 6 - 3 - 3 - 1;
        let header = (2 << 1 | (block_len as u32) << 3).to_le_bytes();
        frame
            .bytes
            .splice(6..10 + fewer.len(), [&header[..3], &fewer].concat());
        let result = decompress(&frame.bytes, &mut Output::slice(&mut [0; 600]), None);
        assert_eq!(result, Err(Error::CorruptionDetected));
    }
    Ok(())
}

#[test]
fn long_matches_among_the_last_raw_literals() -> Result<()> {
    let mut noise = Noise(11);
    let new = |(literal_len, match_len)| Sequence {
        literal_len,
        offset_value: 1,
        match_len,
    };
    for match_len in [4, 2500, 70_000] {
        let mut frame = Frame::new(17, Vec::new());
        let lens = [(290, 3), (1, 3), (1, match_len), (1, 3), (1, 3)];
        frame.compressed(&raw(noise.bytes(296)), &lens.map(new));

        // Too much to move for the sake of the overshoot.
        let (before, mut out) = (2 << 20, Vec::new());
        out.reserve_exact(before + frame.history.len());
        out.resize(before, 0);
        let bytes = [&frame.bytes[..], &[1, 0, 0]].concat();
        Decoder::new()
            .step_growing(&bytes, &mut out, usize::MAX)
            .1?;
        assert!(out[before..] == frame.history);
        frame.check()?;
    }
    Ok(())
}

#[test]
fn a_large_sequence_does_not_fit_behind_the_last_that_does() {
    let new = |match_len| Sequence {
        literal_len: 1,
        offset_value: 1,
        match_len,
    };
    let mut frame = Frame::new(17, Vec::new());
    frame.compressed(&raw(vec![1, 2]), &[3, 70_000].map(new));
    frame.bytes.extend([1, 0, 0]);
    let result = decompress(&frame.bytes, &mut Output::slice(&mut [0; 20]), None);
    assert_eq!(result, Err(Error::DstSizeTooSmall));
}

#[test]
fn a_sequence_takes_all_bits_that_are_loaded() -> Result<()> {
    let mut noise = Noise(12);
    let new = |&(literal_len, offset_value, match_len): &(usize, usize, usize)| Sequence {
        literal_len,
        offset_value,
        match_len,
    };
    // 14, 17 and 14 bits, and 5 for each state. How many are loaded depends on those that the last one takes.
    let (short, large) = ((1, 1, 3), (30_000, 250_000, 30_000));
    for (before, offset_bits) in (1..4).flat_map(|it| (2..10).map(move |bits| (it, bits))) {
        let last = (1, 1 << offset_bits, 3);
        let all = [vec![short; before], vec![large, short, short, short, last]].concat();
        let mut frame = Frame::new(19, Vec::new());
        (0..2).for_each(|_| frame.raw(&noise.bytes(BLOCK)));
        let literals = repeated(2, all.iter().map(|it| it.0).sum());
        frame.compressed(&literals, &all.iter().map(new).collect::<Vec<_>>());
        frame.check()?;
    }
    Ok(())
}

#[test]
fn all_codes_of_one_length() -> Result<()> {
    for length in 1..8 {
        let mut frame = Frame::new(17, Vec::new());
        for count in [300, 40_000] {
            let symbols = (0..count).map(|it: u32| (it * 7 % (1 << length)) as u8);
            frame.compressed(
                &huffman(&vec![length; 1 << length], 4, symbols.collect()),
                &[],
            );
        }
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
fn a_frame_fills_its_room_the_same_after_any_other() -> Result<()> {
    let frame = |byte, literal_len| {
        let mut frame = Frame::new(12, Vec::new());
        let sequence = Sequence {
            literal_len,
            offset_value: 4,
            match_len: 3,
        };
        frame.compressed(&repeated(byte, literal_len), &[sequence]);
        frame.state_size();
        frame.bytes.extend([1, 0, 0]);
        frame.bytes
    };
    let room = |decoder: &mut Decoder, frame: &[u8]| -> Result<_> {
        let mut room = vec![0xAA; 2000];
        let (_, status) = decoder.step(frame, &mut Output::slice(&mut room));
        assert_eq!(status?, Status::Complete);
        Ok(room)
    };
    for literal_len in 290..330 {
        let mut used = Decoder::new();
        room(&mut used, &frame(1, 1000))?;
        let frame = frame(2, literal_len);
        assert!(room(&mut used, &frame)? == room(&mut Decoder::new(), &frame)?);
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
        // One is enough for the table to have them, and leaves raw literals without padding.
        let new = |index| Sequence {
            literal_len: 4,
            offset_value: if index == 0 { 3 << 22 } else { 1 },
            match_len: 5,
        };
        let sequences: Vec<_> = (0..70).map(new).collect();
        frame.compressed(&raw(noise.bytes(280)), &sequences);
    }
    let near = Sequence {
        literal_len: 1,
        offset_value: 100,
        match_len: 20,
    };
    frame.compressed(&repeated(9, 65), &[near; 65]);
    // Some of them long, up to the end of the output.
    let far = |index| Sequence {
        literal_len: 1,
        offset_value: (1 << 23) + noise.below(1 << 23),
        match_len: if index % 9 == 0 { 2050 } else { 1027 },
    };
    let sequences: Vec<_> = (1..80).map(far).collect();
    frame.compressed(&repeated(9, 79), &sequences);
    // One that no slot can hold, among many that it can: first a match, then the literals.
    for (literal_len, match_len) in [(1, 70_000), (66_000, 3)] {
        let large = |index: usize| Sequence {
            literal_len: if index == 3 { literal_len } else { 1 },
            offset_value: (1 << 23) + noise.below(1 << 23),
            match_len: if index == 7 { match_len } else { 3 },
        };
        let sequences: Vec<_> = (0..70).map(large).collect();
        frame.compressed(&repeated(9, 69 + literal_len as usize), &sequences);
    }
    frame.check()
}

#[test]
fn what_does_not_add_up_is_refused() {
    // Far offsets have a loop of their own.
    for (blocks_before, offset_value) in [(0, 9), (130, 1 << 24)] {
        let sequence = Sequence {
            literal_len: 1,
            offset_value,
            match_len: 3,
        };
        let mut frame = Frame::new(25, Vec::new());
        (0..blocks_before).for_each(|_| frame.rle(1, BLOCK));
        frame.raw(b"12345678");
        let (start, before) = (frame.bytes.len(), frame.history.len());
        frame.compressed(&repeated(0, 900), &[sequence; 900]);
        let decode = |block: &[u8], room| {
            let header = (block.len() as u32) << 3 | 2 << 1 | 1;
            let bytes = [&frame.bytes[..start], &header.to_le_bytes()[..3], block].concat();
            let mut out = Vec::with_capacity(before + room);
            let mut out = Output::spare_capacity(&mut out, before + room);
            let result = decompress(&bytes, &mut out, None);
            let mut out = vec![0; before + room];
            assert_eq!(
                decompress(&bytes, &mut Output::slice(&mut out), None),
                result
            );
            result
        };
        let block = &frame.bytes[start + 3..];
        assert_eq!(decode(block, 3600), Ok(()));
        for room in [0, 892, 900, 1992, 3599] {
            assert_eq!(decode(block, room), Err(Error::DstSizeTooSmall));
        }
        // Too few bits, too many bits, too few literals.
        let (headers, stream) = block.split_at(10);
        for stream in [&stream[1..], &stream[200..], &[&[0], stream].concat()] {
            assert_eq!(
                decode(&[headers, stream].concat(), 3600),
                Err(Error::CorruptionDetected)
            );
        }
        for count in [500, 899] {
            let fewer = [&repeated(0, count).section, &block[4..]].concat();
            assert_eq!(decode(&fewer, 3600), Err(Error::CorruptionDetected));
        }
    }
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

#[test]
fn pairs_are_built_from_the_shortest_code_up() -> Result<()> {
    // A tree of 15 symbols: one code of 3 bits and fourteen of 4.
    let lengths: Vec<u32> = [3].into_iter().chain([4; 14]).collect();
    let mut noise = Noise(7);
    let decoded: Vec<u8> = (0..20_000)
        .map(|_| noise.below(lengths.len()) as u8)
        .collect();
    let mut frame = Frame::new(20, Vec::new());
    frame.compressed(&huffman(&lengths, 4, decoded), &[]);
    frame.check()
}

/// A table of one code is a byte, which has to be there and to be a code of that kind.
#[test]
fn a_table_of_one_code_holds_a_code_that_exists() {
    let mut frame = Frame::new(20, Vec::new());
    frame.raw(b"12345678");
    let start = frame.bytes.len();
    let literals = raw(b"abcd".to_vec());
    let sequence = Sequence {
        literal_len: 2,
        offset_value: 4,
        match_len: 3,
    };
    frame.compressed(&literals, &[sequence]);
    let block = frame.bytes[start + 3..].to_vec();
    let decode = |block: &[u8]| {
        let header = (block.len() as u32) << 3 | 2 << 1 | 1;
        let bytes = [&frame.bytes[..start], &header.to_le_bytes()[..3], block].concat();
        let mut out = Vec::with_capacity(1 << 12);
        decompress(&bytes, &mut Output::spare_capacity(&mut out, 1 << 12), None)
    };
    assert_eq!(decode(&block), Ok(()));
    // The counts and the modes come first, then one byte for each of the three tables.
    let at = literals.section.len() + 2;
    for (kind, highest) in [(0, 35), (1, 31), (2, 52)] {
        let mut damaged = block.clone();
        damaged[at + kind] = highest + 1;
        assert_eq!(decode(&damaged), Err(Error::CorruptionDetected), "{kind}");
    }
    for len in 0..3 {
        assert_eq!(
            decode(&block[..at + len]),
            Err(Error::CorruptionDetected),
            "{len}"
        );
    }
}
