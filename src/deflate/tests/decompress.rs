use crate::support::{Random, copy, crc32, with_failing};
use bun_deflate::{Decompressed, Error, Output, Result, gunzip, inflate, inflate_message};
use core::mem::MaybeUninit;

type Decode = fn(&[u8], Output<'_>) -> Result<Decompressed>;

const END_OF_BLOCK: usize = 256;
const PRECODE_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];
const EVEN_PRECODE: [u8; 19] = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5];

/// RFC 1951 3.2.2
fn codewords(lens: &[u8]) -> Vec<(u32, u32)> {
    let (mut codewords, mut code) = (vec![(0, 0); lens.len()], 0u32);
    for len in 1..=15 {
        for (codeword, _) in codewords.iter_mut().zip(lens).filter(|it| *it.1 == len) {
            *codeword = (code.reverse_bits(), u32::from(len));
            code = code.wrapping_add(1 << (32 - len));
        }
    }
    codewords
}

/// The index, the extra bits and their number.
fn slot(mut distance: usize, group_len: usize) -> (usize, u32, u32) {
    for index in 0.. {
        let extra_bits = (index / group_len).saturating_sub(1);
        if distance < 1 << extra_bits {
            return (index, distance as u32, extra_bits as u32);
        }
        distance -= 1 << extra_bits;
    }
    unreachable!()
}

/// `count` lengths, zero but for those of `used`.
fn sparse(count: usize, used: &[(usize, u8)]) -> Vec<u8> {
    let mut lens = vec![0; count];
    used.iter().for_each(|&(symbol, len)| lens[symbol] = len);
    lens
}

/// As many of each length, from 1 on, as `counts` says, in no order.
fn shuffled(counts: &[usize; 15], random: &mut Random) -> Vec<u8> {
    let mut lens: Vec<u8> = (1..)
        .zip(counts)
        .flat_map(|(len, &count)| vec![len; count])
        .collect();
    for at in (1..lens.len()).rev() {
        lens.swap(at, random.below(at + 1));
    }
    lens
}

/// Symbols of the precode with their extra bits, each run as long as it can be.
fn runs(lens: &[u8]) -> Vec<(usize, u32)> {
    let (mut items, mut at) = (Vec::new(), 0);
    while let Some(&len) = lens.get(at) {
        let run = lens[at..].iter().take_while(|&&other| other == len).count();
        let (symbol, least, most) = match (len, run) {
            (0, 11..) => (18, 11, 138),
            (0, 3..) => (17, 3, 10),
            (_, 3..) if at > 0 && lens[at - 1] == len => (16, 3, 6),
            _ => (usize::from(len), 1, 1),
        };
        items.push((symbol, (run.min(most) - least) as u32));
        at += run.min(most);
    }
    items
}

/// A stream, and what it stands for.
#[derive(Clone, Default)]
struct Stream {
    bytes: Vec<u8>,
    bit_count: usize,
    data: Vec<u8>,
    litlen: Vec<(u32, u32)>,
    offset: Vec<(u32, u32)>,
}

impl Stream {
    fn bits(&mut self, (value, count): (u32, u32)) -> &mut Self {
        for bit in 0..count {
            if self.bit_count.is_multiple_of(8) {
                self.bytes.push(0);
            }
            self.bytes[self.bit_count / 8] |= (((value >> bit) & 1) as u8) << (self.bit_count % 8);
            self.bit_count += 1;
        }
        self
    }

    fn start(&mut self, is_final: bool, kind: u32) -> &mut Self {
        self.bits((is_final.into(), 1)).bits((kind, 2))
    }

    /// With ones up to the next byte.
    fn stored(&mut self, is_final: bool, data: &[u8]) -> &mut Self {
        self.start(is_final, 0);
        self.bits((u32::MAX, self.bit_count.wrapping_neg() as u32 % 8));
        self.bits((data.len() as u32, 16));
        self.bits((!data.len() as u32, 16));
        self.bytes.extend_from_slice(data);
        self.bit_count = 8 * self.bytes.len();
        self.data.extend_from_slice(data);
        self
    }

    fn fixed(&mut self, is_final: bool) -> &mut Self {
        let mut lens = [8; 288];
        lens[144..256].fill(9);
        lens[256..280].fill(7);
        (self.litlen, self.offset) = (codewords(&lens), codewords(&[5; 32]));
        self.start(is_final, 1)
    }

    fn dynamic(&mut self, is_final: bool, litlen: &[u8], offset: &[u8]) -> &mut Self {
        let items = runs(&[litlen, offset].concat());
        self.described(is_final, litlen, offset, &EVEN_PRECODE, &items)
    }

    /// `items` are to describe the two codes.
    fn described(
        &mut self,
        is_final: bool,
        litlen: &[u8],
        offset: &[u8],
        precode: &[u8; 19],
        items: &[(usize, u32)],
    ) -> &mut Self {
        (self.litlen, self.offset) = (codewords(litlen), codewords(offset));
        let listed = PRECODE_ORDER.map(|symbol| precode[symbol]);
        let unlisted = listed.iter().rev().take_while(|&&len| len == 0).count();
        let listed = &listed[..(19 - unlisted).max(4)];
        self.start(is_final, 2);
        self.bits((litlen.len() as u32 - 257, 5));
        self.bits((offset.len() as u32 - 1, 5));
        self.bits((listed.len() as u32 - 4, 4));
        for &len in listed {
            self.bits((len.into(), 3));
        }
        let precode = codewords(precode);
        for &(symbol, extra) in items {
            let extra_bits = [2, 3, 7].get(symbol.wrapping_sub(16));
            self.bits(precode[symbol]);
            self.bits((extra, extra_bits.copied().unwrap_or(0)));
        }
        self
    }

    fn symbol(&mut self, symbol: usize) -> &mut Self {
        self.bits(self.litlen[symbol])
    }

    fn literals(&mut self, bytes: &[u8]) -> &mut Self {
        for &byte in bytes {
            self.symbol(byte.into()).data.push(byte);
        }
        self
    }

    fn length(&mut self, len: usize) -> &mut Self {
        match slot(len - 3, 4) {
            _ if len == 258 && self.litlen.len() > 285 => self.symbol(285),
            (index, extra, count) => self.symbol(257 + index).bits((extra, count)),
        }
    }

    fn offset(&mut self, offset: usize) -> &mut Self {
        let (symbol, extra, count) = slot(offset - 1, 2);
        self.bits(self.offset[symbol]).bits((extra, count))
    }

    fn copy(&mut self, len: usize, offset: usize) -> &mut Self {
        copy(&mut self.data, len, offset);
        self.length(len).offset(offset)
    }

    fn end(&mut self) -> &mut Self {
        self.symbol(END_OF_BLOCK)
    }

    #[track_caller]
    fn is_accepted(&self) {
        accepts(inflate, &self.bytes, &self.data);
    }

    /// Whatever follows.
    #[track_caller]
    fn is_refused(&self) {
        for filler in [0, 0x55, 0xFF] {
            refuses(
                inflate,
                &[&self.bytes[..], &[filler; 40]].concat(),
                self.data.len(),
            );
        }
        refuses(inflate, &self.bytes, self.data.len());
        refuses(inflate_message, &self.bytes, self.data.len());
    }
}

const PREFIX: [u8; 3] = [1, 2, 3];

/// Checks what holds for any call. Returns what was appended.
#[track_caller]
fn to_vec(decode: Decode, input: &[u8], spare: usize, limit: usize) -> Result<(usize, Vec<u8>)> {
    let mut vec = Vec::with_capacity(PREFIX.len() + spare);
    vec.extend_from_slice(&PREFIX);
    let (result, allocations) = with_failing(0..0, || {
        let vec = &mut vec;
        decode(input, Output::Vec { vec, limit })
    });
    let written = result.map_or(0, |result| result.written);
    assert_eq!(vec.len(), PREFIX.len() + written);
    assert_eq!(vec[..PREFIX.len()], PREFIX);
    assert!(vec.capacity() - PREFIX.len() <= spare.max(limit));
    assert!(allocations <= 20);
    if result.is_ok() {
        assert_eq!(allocations == 0, written <= spare);
        assert!(vec.capacity() <= (PREFIX.len() + spare).max(2 * vec.len()));
    }
    Ok((result?.read, vec.split_off(PREFIX.len())))
}

fn to_slice(decode: Decode, input: &[u8], room: usize) -> Result<(usize, Vec<u8>)> {
    let mut output = vec![0xAA; room];
    let Decompressed { read, written } = decode(input, Output::Slice(&mut output))?;
    output.truncate(written);
    Ok((read, output))
}

/// Into a slice of `limit` bytes, or a `Vec` that has room for `spare`.
fn results<const N: usize>(
    decode: Decode,
    input: &[u8],
    rooms: [(Option<usize>, usize); N],
) -> impl Iterator<Item = Result<(usize, Vec<u8>)>> {
    rooms.into_iter().map(move |(spare, limit)| match spare {
        None => to_slice(decode, input, limit),
        Some(spare) => to_vec(decode, input, spare, limit),
    })
}

#[track_caller]
fn gives(decode: Decode, input: &[u8], read: usize, data: &[u8]) {
    let len = data.len();
    let enough = [
        (None, len + 400),
        (Some(0), len),
        (None, len),
        (Some(0), usize::MAX),
        (Some(len / 2), len),
        (Some(len), len),
        (Some(len), usize::MAX),
        (Some(len + 40000), usize::MAX),
    ];
    let expected = Ok((read, data.to_vec()));
    assert!(results(decode, input, enough).all(|result| result == expected));
    if let Some(less) = len.checked_sub(1) {
        let too_little = [(None, less), (Some(len + 400), less), (Some(0), less)];
        let mut results = results(decode, input, too_little);
        assert!(results.all(|result| result == Err(Error::InsufficientSpace)));
    }
}

/// Also with something after it.
#[track_caller]
fn accepts(decode: Decode, input: &[u8], data: &[u8]) {
    gives(decode, input, input.len(), data);
    gives(decode, &[input, &[0xFF; 40]].concat(), input.len(), data);
}

/// `room` is enough to get to what is wrong.
#[track_caller]
fn refuses(decode: Decode, input: &[u8], room: usize) {
    let rooms = [
        (None, room + 400),
        (Some(0), room),
        (None, room),
        (Some(0), usize::MAX),
        (Some(room + 20000), usize::MAX),
    ];
    assert!(results(decode, input, rooms).all(|result| result == Err(Error::BadData)));
}

/// All kinds of blocks and symbols.
fn sample() -> Stream {
    let litlen = [(97, 2), (98, 2), (256, 3), (257, 3), (265, 3), (285, 3)];
    let mut stream = Stream::default();
    stream.fixed(false).literals(b"abc\xF0").copy(9, 3).end();
    stream.stored(false, b"stored").stored(false, b"");
    stream.dynamic(false, &sparse(286, &litlen), &[2, 2, 2, 0, 2]);
    stream.literals(b"ab").copy(258, 2).literals(b"b");
    stream.copy(12, 6).copy(3, 1).copy(258, 1).end();
    stream.fixed(false).end().stored(false, &[7; 20]);
    stream.fixed(false).copy(100, 300).literals(b"xyz").end();
    stream
}

fn final_sample() -> Stream {
    let mut stream = sample();
    stream.fixed(true).literals(b"!").copy(3, 1).end();
    stream
}

#[test]
fn blocks_of_all_kinds() {
    final_sample().is_accepted();
    Stream::default().fixed(true).end().is_accepted();
    Stream::default().stored(true, b"").is_accepted();
    sample().stored(true, b"").is_accepted();
    sample().stored(true, b"end").is_accepted();
}

#[test]
fn stored_block_at_each_bit() {
    for count in 0..8 {
        for len in [0, 1, 7, 8, 9, 15, 16, 17, 40] {
            let mut stream = Stream::default();
            stream.fixed(false).literals(&[200; 8][..count]).end();
            stream.stored(false, &Random(1).bytes(len));
            stream.clone().stored(true, b"x").is_accepted();
            stream.fixed(true).literals(b"x").end().is_accepted();
        }
    }
}

#[test]
fn longest_stored_blocks() {
    let data = Random(2).bytes(65535);
    let mut stream = Stream::default();
    stream.stored(false, &data).fixed(false).copy(258, 32768);
    stream.end().stored(true, &data).is_accepted();
}

#[test]
fn matches_at_near_offsets() {
    for offset in (1..=140).chain([200, 257, 258, 259]) {
        let (mut stream, mut random) = (Stream::default(), Random(offset as u32));
        stream.fixed(true).literals(&random.bytes(offset));
        for len in 3..=258 {
            stream.copy(len, offset).literals(&random.bytes(len % 3));
        }
        stream.end().is_accepted();
    }
}

#[test]
fn ends_of_all_slots() {
    let mut stream = Stream::default();
    stream.stored(false, &Random(3).bytes(32768)).fixed(false);
    let mut offsets = vec![1, 2, 3, 4];
    for power in 2..15 {
        let [first, half] = [(1 << power) + 1, 1 << (power - 1)];
        offsets.extend([first, first + half - 1, first + half, first + 2 * half - 1]);
    }
    for (len, &offset) in (3..=258).zip(offsets.iter().cycle()) {
        stream.copy(len, offset);
    }
    // 258 also is 227 + 31.
    stream
        .end()
        .dynamic(true, &sparse(285, &[(256, 1), (284, 1)]), &[1]);
    stream.copy(258, 1).end().is_accepted();
}

/// Each symbol of both codes, in a block after 32 KiB.
fn use_all(stream: &mut Stream, litlen: &[u8], offset: &[u8], random: &mut Random) {
    let used =
        |lens: &[u8]| -> Vec<usize> { (0..lens.len()).filter(|&at| lens[at] != 0).collect() };
    let (symbols, slots) = (used(litlen), used(offset));
    for turn in 0..4000 {
        let pick = |from: &[usize], random: &mut Random| match turn < 300 {
            true => from[turn % from.len()],
            false => from[random.below(from.len())],
        };
        let within = |index: usize, group_len: usize| {
            let extra_bits = |index: usize| (index / group_len).saturating_sub(1);
            let first: usize = (0..index).map(|index| 1 << extra_bits(index)).sum();
            let width = 1 << extra_bits(index);
            first + [0, width - 1, turn * 2731 % width][turn % 3]
        };
        match pick(&symbols, random) {
            END_OF_BLOCK => {}
            literal @ ..END_OF_BLOCK => _ = stream.literals(&[literal as u8]),
            symbol => {
                let len = match symbol {
                    285 => 258,
                    _ => (3 + within(symbol - 257, 4)).min(257),
                };
                let offset = 1 + within(pick(&slots, random), 2);
                stream.copy(len, offset);
            }
        }
    }
    stream.end();
}

#[test]
fn codes_of_all_shapes() {
    const LITLEN: [[usize; 15]; 6] = [
        [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 49, 109, 73, 50],
        [0, 0, 0, 0, 0, 0, 0, 226, 60, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 229, 54, 0, 0, 0],
        [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 232, 48],
        [0, 1, 1, 1, 2, 12, 20, 15, 20, 30, 23, 40, 40, 42, 28],
        [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 3, 7, 25, 154],
    ];
    const OFFSET: [[usize; 15]; 6] = [
        [1, 1, 0, 3, 1, 0, 0, 0, 13, 5, 1, 1, 1, 1, 2],
        [0, 0, 0, 2, 28, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 1, 0, 0, 0, 6, 20, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 16],
        [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 6, 3, 9, 1, 2],
        [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 3, 7, 5, 1, 2],
    ];
    let (mut stream, mut random) = (Stream::default(), Random(4));
    stream.stored(false, &random.bytes(32768));
    for (litlen, offset) in LITLEN.iter().zip(&OFFSET) {
        let (mut litlen, offset) = (shuffled(litlen, &mut random), shuffled(offset, &mut random));
        // The last ones, so that the end of the block is among them.
        litlen.splice(..0, vec![0; 286 - litlen.len()]);
        stream.dynamic(false, &litlen, &offset);
        use_all(&mut stream, &litlen, &offset, &mut random);
    }
    stream.stored(true, b"").is_accepted();
}

#[test]
fn longest_codewords_in_a_row() {
    for (end_len, length_len, offset_len) in [(15, 15, 8), (11, 11, 15), (10, 15, 15), (15, 11, 9)]
    {
        let mut left = vec![10, 11, 11, 11, 11, 11, 12, 13, 14, 15, 15];
        let mut take = |len| left.remove(left.iter().rposition(|&it| it == len).unwrap_or(0));
        let mut used = vec![(256, take(end_len)), (284, take(length_len))];
        used.extend((97..).zip(left));
        let litlen = sparse(285, &used);
        used.extend((1..=8).map(|len| (usize::from(len), len)));
        let mut offset: Vec<u8> = (1..=15).chain([15]).collect();
        let at = offset
            .iter()
            .rposition(|&len| len == offset_len)
            .unwrap_or(0);
        offset.swap(at, 15);
        offset.splice(..0, vec![0; 14]);
        let mut only_farthest = vec![0; 29];
        only_farthest.push(1);

        let (mut stream, mut random) = (Stream::default(), Random(5));
        stream.stored(false, &random.bytes(32768));
        stream.dynamic(true, &sparse(285, &used), &offset);
        use_all(&mut stream, &litlen, &only_farthest, &mut random);
        stream.is_accepted();
    }
}

#[test]
fn headers_of_all_forms() {
    let check = |litlen: &[u8], offset: &[u8], precode: &[(usize, u8)], items: &[(usize, u32)]| {
        let precode = sparse(19, precode).try_into().unwrap_or([0; 19]);
        let mut stream = Stream::default();
        stream.described(true, litlen, offset, &precode, items);
        let literals = (0..=255).filter(|&it| litlen[usize::from(it)] != 0);
        let literals = literals.collect::<Vec<u8>>().repeat(4);
        stream.literals(&literals);
        for distance in (1..=offset.len().min(4)).filter(|it| offset[it - 1] != 0) {
            stream.copy(3, distance).literals(&literals);
        }
        stream.end().is_accepted();
    };

    // Runs from one code into the other
    let litlen = sparse(259, &[(0, 3), (1, 3), (256, 2), (257, 2), (258, 2)]);
    let precode = [(2, 2), (3, 2), (16, 2), (18, 2)];
    for (before, run) in [(1, 3), (1, 6), (2, 3), (2, 5), (3, 3), (3, 4)] {
        let mut items = vec![(3, 0), (3, 0), (18, 127), (18, 105)];
        items.extend(vec![(2, 0); before]);
        items.push((16, run as u32 - 3));
        items.extend(vec![(2, 0); 7 - before - run]);
        check(&litlen, &[2; 4], &precode, &items);
    }
    for (unused, symbol) in [(1, 17), (8, 17), (9, 18), (28, 18)] {
        let litlen = sparse(258 + unused, &[(0, 2), (256, 2), (257, 1)]);
        let items = runs(&[&litlen[..], &[0, 0, 1, 1]].concat());
        assert_eq!(items[items.len() - 3].0, symbol);
        let precode = [(1, 2), (2, 2), (17, 2), (18, 2)];
        check(&litlen, &[0, 0, 1, 1], &precode, &items);
    }

    // What 16 repeats after 17 or 18 is zero.
    let litlen = sparse(258, &[(0, 2), (256, 2), (257, 1)]);
    let precode = [(1, 3), (2, 3), (16, 2), (17, 2), (18, 2)];
    let items = [(2, 0), (17, 7), (16, 3), (18, 127), (16, 0), (18, 87)];
    let items = [&items[..], &[(2, 0), (1, 0), (1, 0)]].concat();
    check(&litlen, &[1], &precode, &items);

    // The fewest lengths that can describe a block, and no offset code
    let litlen = [&[0][..], &[8; 256]].concat();
    let items = runs(&[&litlen[..], &[0]].concat());
    check(&litlen, &[0], &[(0, 2), (8, 2), (16, 1)], &items);

    // Items of 14 bits
    let used = [
        (11, 3),
        (23, 3),
        (35, 3),
        (47, 3),
        (59, 3),
        (256, 3),
        (257, 2),
    ];
    let litlen = sparse(258, &used);
    let precode = [
        (1, 1),
        (2, 2),
        (4, 3),
        (5, 4),
        (6, 5),
        (7, 6),
        (3, 7),
        (18, 7),
    ];
    let mut items = runs(&[&litlen[..], &[1, 1]].concat());
    items.splice(10..12, [(18, 0); 16].into_iter().chain([(18, 9)]));
    check(&litlen, &[1, 1], &precode, &items);

    // Each number of lengths in the header
    for &last in &PRECODE_ORDER[5..] {
        let precode = [(0, 2), (8, 2), (16, 2), (last, 2)];
        let litlen = [&[0][..], &[8; 256]].concat();
        check(
            &litlen,
            &[0],
            &precode,
            &runs(&[&litlen[..], &[0]].concat()),
        );
    }
}

#[test]
fn codes_of_one_codeword() {
    let only_end = sparse(257, &[(256, 1)]);
    let mut stream = Stream::default();
    stream.dynamic(false, &only_end, &[0]).end();
    stream.clone().stored(true, b"x").is_accepted();
    stream
        .dynamic(true, &only_end, &[0])
        .bits((1, 1))
        .is_refused();

    let litlen = sparse(258, &[(97, 2), (256, 2), (257, 1)]);
    let mut stream = Stream::default();
    stream.dynamic(true, &litlen, &[0, 1]).literals(b"aa");
    stream.clone().copy(3, 2).end().is_accepted();
    stream.length(3).data.extend([0; 3]);
    stream.bits((1, 1)).end().is_refused();
}

#[test]
fn match_without_offset_code() {
    let litlen = sparse(258, &[(97, 2), (256, 2), (257, 1)]);
    for bit in 0..2 {
        let mut stream = Stream::default();
        stream.dynamic(true, &litlen, &[0]).literals(b"aa");
        stream.length(3).data.extend([0; 3]);
        stream.bits((bit, 1)).end().is_refused();
    }
}

#[test]
fn reserved_values() {
    Stream::default().start(true, 3).is_refused();
    for symbol in [286, 287] {
        let mut stream = Stream::default();
        stream.fixed(true).literals(b"a").symbol(symbol);
        stream.clone().is_refused();
        stream.offset(1).end().is_refused();
    }
    for symbol in [30, 31] {
        let mut stream = Stream::default();
        stream.stored(false, &[0; 40000]).stored(false, &[0; 40000]);
        stream
            .fixed(true)
            .literals(b"a")
            .length(3)
            .data
            .extend([0; 3]);
        stream.bits(stream.offset[symbol]).bits((0, 13));
        stream.clone().end().is_refused();
        stream.bits((0, 1)).end().is_refused();
    }
    for (litlens, offsets) in [(287, 30), (288, 1), (286, 31), (257, 32)] {
        let litlen = sparse(litlens, &[(256, 1)]);
        let mut stream = Stream::default();
        stream.dynamic(true, &litlen, &vec![0; offsets]);
        stream.end().is_refused();
    }
    let mut stream = Stream::default();
    stream.dynamic(true, &sparse(286, &[(256, 1)]), &[0; 30]);
    stream.end().is_accepted();
}

#[test]
fn codes_that_do_not_add_up() {
    let good = sparse(257, &[(0, 1), (256, 1)]);
    let codes: [(&[u8], &[u8]); 9] = [
        (&sparse(257, &[(0, 2), (256, 1)]), &[1]),
        (&sparse(257, &[(0, 1), (1, 1), (256, 1)]), &[1]),
        (&sparse(257, &[(0, 15), (1, 1), (256, 1)]), &[1]),
        (&sparse(257, &[(256, 2)]), &[1]),
        (&good, &[2]),
        (&good, &[1, 2]),
        (&good, &[1, 1, 1]),
        (&good, &[1, 1, 15]),
        (&good, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    ];
    for (litlen, offset) in codes {
        for blocks_before in 0..2 {
            let mut stream = Stream::default();
            for _ in 0..blocks_before {
                stream.dynamic(false, &good, &[1]).end();
            }
            stream.dynamic(true, litlen, offset).end().is_refused();
        }
    }
    Stream::default()
        .dynamic(true, &[0; 257], &[0])
        .is_refused();
}

#[test]
fn headers_that_do_not_add_up() {
    let litlen = sparse(257, &[(0, 1), (256, 1)]);
    let check = |precode: &[(usize, u8)], items: &[(usize, u32)]| {
        let precode = sparse(19, precode).try_into().unwrap_or([0; 19]);
        let mut stream = Stream::default();
        stream.described(true, &litlen, &[0], &precode, items);
        stream.end().is_refused();
    };
    let items = [(1, 0), (18, 127), (18, 106), (1, 0), (0, 0)];
    check(&[(0, 2), (1, 2), (18, 2)], &items);
    check(&[(0, 1), (1, 1), (18, 1)], &items);
    check(&[], &[]);
    let precode = [(0, 2), (1, 2), (16, 3), (17, 3), (18, 2)];
    for last in [(16, 0), (17, 0), (18, 0), (18, 127)] {
        check(&precode, &[&items[..4], &[last]].concat());
    }
    check(&precode, &[(16, 3); 43]);

    let mut stream = Stream::default();
    let precode = sparse(19, &[(1, 1)]).try_into().unwrap_or([0; 19]);
    stream.described(true, &litlen, &[0], &precode, &[]);
    for &len in litlen.iter().chain(&[0]) {
        stream.bits((1 - u32::from(len), 1));
    }
    stream.end().is_refused();
}

#[test]
fn nothing_to_repeat() {
    for len in [0, 15] {
        let shorter = (1..=13).take(len.into()).skip(1);
        let mut litlen: Vec<u8> = [len; 4].into_iter().chain(shorter).collect();
        litlen.resize(256, 0);
        litlen.push(1);
        let mut items = vec![(16, 0), (len.into(), 0)];
        items.extend(runs(&[&litlen[4..], &[0]].concat()));
        let mut stream = Stream::default();
        stream.described(true, &litlen, &[0], &EVEN_PRECODE, &items);
        stream.end().is_refused();
    }
}

#[test]
fn stored_lengths_that_do_not_match() {
    let stream = Stream::default().stored(true, b"abc").clone();
    for bit in 8..40 {
        let mut bytes = stream.bytes.clone();
        bytes[bit / 8] ^= 1 << (bit % 8);
        refuses(inflate, &bytes, 0);
    }
}

#[test]
fn offset_before_the_start() {
    for count in [0, 1, 2, 20] {
        for len in [3, 258] {
            let mut stream = Stream::default();
            stream.fixed(true).literals(&vec![b'a'; count]);
            stream.length(len).data.extend(vec![0; len]);
            stream.offset(count + 1).end().is_refused();
        }
    }
}

#[test]
fn each_truncation() {
    let streams = [final_sample(), sample().stored(true, &[9; 30]).clone()];
    for stream in streams {
        for len in 0..stream.bytes.len() {
            refuses(inflate, &stream.bytes[..len], stream.data.len() + 3000);
        }
    }
}

/// With these codes zeros are literals, matches, or the end of the block.
#[test]
fn zeros_after_the_end_of_the_input() {
    for first in [0, 256, 285] {
        let others = [0, 256, 285].into_iter().filter(|&it| it != first);
        let used: Vec<_> = others.map(|it| (it, 2)).chain([(first, 1)]).collect();
        for count in 1..=8 {
            let mut stream = Stream::default();
            stream.dynamic(true, &sparse(286, &used), &[1]);
            stream.literals(&vec![0; count]).copy(258, 1);
            let padding = stream.bit_count.wrapping_neg() % 8;
            match first == END_OF_BLOCK && padding != 0 {
                true => stream.is_accepted(),
                false if first == 0 => refuses(inflate, &stream.bytes, 500),
                false => refuses(inflate, &stream.bytes, 30000),
            }
        }
    }
}

#[test]
fn each_room() {
    let Stream { bytes, data, .. } = final_sample();
    for room in 0..data.len() + 340 {
        let expected = match room < data.len() {
            true => Err(Error::InsufficientSpace),
            false => Ok((bytes.len(), data.clone())),
        };
        assert!(to_slice(inflate, &bytes, room) == expected);
        for spare in [0, room / 2, room, room + 1] {
            assert!(to_vec(inflate, &bytes, spare, room) == expected);
        }
        assert!(to_vec(inflate, &bytes, room, usize::MAX) == Ok((bytes.len(), data.clone())));
    }
}

#[test]
fn capacity_far_ahead_is_left_alone() {
    const UNUSED: u8 = 0xAA;
    /// The longest step, a page, and the room that the fast loop leaves.
    const AFTER_LONG: usize = 13 * 1024;
    const AFTER_SHORT: usize = 1024;
    let check = |stream: &Stream, ahead: usize| {
        let prefix = [UNUSED; 30000];
        let vec = &mut Vec::with_capacity(200_000);
        vec.spare_capacity_mut().fill(MaybeUninit::new(UNUSED));
        vec.extend(prefix);
        let (allocation, limit) = ((vec.as_ptr(), vec.capacity()), usize::MAX);
        assert!(inflate(&stream.bytes, Output::Vec { vec, limit }).is_ok());
        assert!(*vec == [&prefix, &stream.data[..]].concat());
        assert_eq!((vec.as_ptr(), vec.capacity()), allocation);
        let mut far = vec.spare_capacity_mut()[ahead..].iter();
        // SAFETY: all of this allocation was written to above.
        assert!(far.all(|byte| unsafe { byte.assume_init() } == UNUSED));
    };
    check(Stream::default().stored(true, &[1; 20000]), 0);
    check(Stream::default().fixed(true).end(), AFTER_SHORT);
    check(
        Stream::default().fixed(true).literals(&[1; 5000]).end(),
        AFTER_LONG,
    );
    let mut stream = Stream::default();
    stream.fixed(true).literals(&[1]);
    for _ in 0..6 {
        (0..50).for_each(|_| _ = stream.copy(258, 1));
        check(stream.clone().end(), AFTER_LONG);
    }
}

#[test]
fn stored_block_that_neither_is_there_nor_fits() {
    refuses(inflate, &[1, 9, 0, !9, 0xFF, 1, 2, 3], 8);
}

#[test]
fn messages() {
    for count in 0..8 {
        let mut stream = sample();
        stream.fixed(false).literals(&[200; 8][..count]).end();
        let before = stream.bit_count;
        for is_final in [false, true] {
            let bytes = &stream.clone().start(is_final, 0).bytes.clone();
            gives(inflate_message, bytes, bytes.len(), &stream.data);
            refuses(inflate, bytes, stream.data.len());
            for more in 1..4 {
                let longer = [bytes, &[0, 0, 0xFF][..more]].concat();
                refuses(inflate_message, &longer, stream.data.len());
            }
        }
        if before.wrapping_neg() % 8 < 3 {
            refuses(inflate_message, &stream.bytes, stream.data.len());
        }
    }
    gives(inflate_message, &[0], 1, b"");
    refuses(inflate_message, &[], 0);
    refuses(inflate_message, &[3], 0);
    let stream = final_sample();
    accepts(inflate_message, &stream.bytes, &stream.data);
}

fn gzip(flags: u8, field_len: usize, stream: &Stream) -> Vec<u8> {
    let mut file = vec![0x1F, 0x8B, 8, flags, 1, 2, 3, 4, 5, 6];
    if flags & 4 != 0 {
        file.extend((field_len as u16).to_le_bytes());
        file.extend(vec![0; field_len]);
    }
    for flag in [8, 16] {
        if flags & flag != 0 {
            file.extend(vec![flag; field_len]);
            file.push(0);
        }
    }
    if flags & 2 != 0 {
        file.extend((crc32(0, &file) as u16).to_le_bytes());
    }
    file.extend_from_slice(&stream.bytes);
    file.extend(crc32(0, &stream.data).to_le_bytes());
    file.extend((stream.data.len() as u32).to_le_bytes());
    file
}

#[test]
fn gzip_headers() {
    let stream = Stream::default()
        .fixed(true)
        .literals(b"gzip")
        .end()
        .clone();
    for flags in 0..32 {
        for field_len in [0, 1, 300] {
            accepts(gunzip, &gzip(flags, field_len, &stream), &stream.data);
        }
        let file = gzip(flags, 20, &stream);
        for len in 0..file.len() {
            refuses(gunzip, &file[..len], 100);
        }
    }
    accepts(
        gunzip,
        &gzip(0, 0, Stream::default().fixed(true).end()),
        b"",
    );
    let stream = final_sample();
    accepts(gunzip, &gzip(0, 0, &stream), &stream.data);
    refuses(gunzip, &gzip(0, 0, sample().start(true, 0)), 1000);
}

#[test]
fn gzip_bits_that_count() {
    let stream = Stream::default().stored(true, b"gzip").clone();
    for (flags, ignored) in [(0, 32..80), (2, 0..0)] {
        let file = gzip(flags, 0, &stream);
        let padding = 8 * (file.len() - 8 - stream.bytes.len()) + 3;
        for bit in 0..8 * file.len() {
            let mut changed = file.clone();
            changed[bit / 8] ^= 1 << (bit % 8);
            let is_text_flag = flags == 0 && bit == 24;
            match ignored.contains(&bit) || is_text_flag || (padding..padding + 5).contains(&bit) {
                true => accepts(gunzip, &changed, &stream.data),
                false => refuses(gunzip, &changed, 400),
            }
        }
    }
}

#[test]
fn allocation_that_fails() {
    let Stream { bytes, data, .. } = final_sample();
    for failing in 0.. {
        let mut vec = PREFIX.to_vec();
        let (result, allocations) = with_failing(failing..failing + 1, || {
            let (vec, limit) = (&mut vec, usize::MAX);
            inflate(&bytes, Output::Vec { vec, limit })
        });
        if failing == allocations {
            assert_eq!(vec[PREFIX.len()..], data);
            break;
        }
        assert!(matches!(result, Err(Error::Alloc(_))));
        assert_eq!(vec, PREFIX);
    }
}
