//! Streams written bit by bit from the grammar of RFC 7932, with the shapes that no encoder chooses: many block types,
//! many trees, lopsided prefix codes, every way to write a code, every kind of distance. The generator keeps a model of
//! the output, so for a valid stream the result is known.
use crate::rng::Rng;
use std::collections::BTreeSet;
use std::ffi::{c_int, c_void};

#[repr(C)]
struct CDictionary {
    size_bits_by_length: [u8; 32],
    offsets_by_length: [u32; 32],
    data_size: usize,
    data: *const u8,
}

unsafe extern "C" {
    fn BrotliGetTransforms() -> *const c_void;
    fn BrotliTransformDictionaryWord(dst: *mut u8, word: *const u8, len: c_int, transforms: *const c_void, index: c_int) -> c_int;
    fn BrotliGetDictionary() -> *const CDictionary;
    static _kBrotliContextLookupTable: [u8; 2048];
}

/// The word of `len` bytes with this index, after the transform.
pub fn dictionary_word(len: usize, index: usize, transform: usize) -> Vec<u8> {
    let mut dst = vec![0u8; 24 * 3 + 64];
    let n = unsafe {
        let d = &*BrotliGetDictionary();
        let word = d.data.add(d.offsets_by_length[len] as usize + index * len);
        BrotliTransformDictionaryWord(dst.as_mut_ptr(), word, len as c_int, BrotliGetTransforms(), transform as c_int)
    };
    dst.truncate(n as usize);
    dst
}

pub fn size_bits(len: usize) -> u32 {
    unsafe { u32::from((*BrotliGetDictionary()).size_bits_by_length[len]) }
}

fn context(mode: usize, p1: u8, p2: u8) -> usize {
    let lut = unsafe { &_kBrotliContextLookupTable[mode << 9..] };
    usize::from(lut[usize::from(p1)] | lut[256 + usize::from(p2)])
}

#[derive(Default)]
pub struct Bits {
    pub bytes: Vec<u8>,
    n: usize,
}

impl Bits {
    pub fn put(&mut self, n: u32, value: u64) {
        for i in 0..n {
            if self.n % 8 == 0 {
                self.bytes.push(0);
            }
            *self.bytes.last_mut().unwrap() |= ((value >> i & 1) as u8) << (self.n % 8);
            self.n += 1;
        }
    }
    /// `fill` is 0 in a valid stream.
    fn align(&mut self, fill: u64) {
        let n = (8 - self.n % 8) % 8;
        self.put(n as u32, fill);
    }
    fn raw(&mut self, bytes: &[u8]) {
        assert!(self.n % 8 == 0);
        self.bytes.extend_from_slice(bytes);
        self.n += 8 * bytes.len();
    }
}

pub const INSERT_BASE: [usize; 24] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594];
pub const INSERT_EXTRA: [u32; 24] = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24];
pub const COPY_BASE: [usize; 24] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118];
pub const COPY_EXTRA: [u32; 24] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24];
const COUNT_BASE: [usize; 26] = [1, 5, 9, 13, 17, 25, 33, 41, 49, 65, 81, 97, 113, 145, 177, 209, 241, 305, 369, 497, 753, 1265, 2289, 4337, 8433, 16625];
const COUNT_EXTRA: [u32; 26] = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24];

/// The code whose range has `value`, and the extra bits.
fn range_code(base: &[usize], value: usize) -> (usize, u64) {
    let code = base.iter().rposition(|&b| b <= value).unwrap();
    (code, (value - base[code]) as u64)
}

fn command_symbol(ins: usize, copy: usize, implicit_distance: bool) -> usize {
    let bits64 = (copy & 7) | (ins & 7) << 3;
    if implicit_distance {
        assert!(ins < 8 && copy < 16);
        return if copy < 8 { bits64 } else { bits64 | 64 };
    }
    let offset = 2 * ((copy >> 3) + 3 * (ins >> 3));
    ((offset << 5) + 0x40 + ((0x520D40 >> offset) & 0xC0)) | bits64
}

/// `k` code lengths of at most `max` that fill the code space exactly.
fn random_lengths(rng: &mut Rng, k: usize, max: u8) -> Vec<u8> {
    assert!(k >= 1 && k <= 1 << max);
    let style = rng.below(4);
    let mut leaves = vec![0u8];
    while leaves.len() < k {
        let mut i = match style {
            0 => rng.below(leaves.len()),
            // A chain.
            1 => leaves.len() - 1,
            // Balanced.
            2 => (0..leaves.len()).min_by_key(|&i| leaves[i]).unwrap(),
            _ => if rng.chance(3, 4) { leaves.len() - 1 } else { rng.below(leaves.len()) },
        };
        // There has to be room below for the leaves still to come.
        if leaves[i] >= max {
            i = (0..leaves.len()).filter(|&i| leaves[i] < max).max_by_key(|&i| leaves[i]).unwrap();
        }
        leaves[i] += 1;
        let d = leaves[i];
        leaves.push(d);
    }
    leaves
}

/// A prefix code: for each symbol its length, and its bits in the order in which they are written.
#[derive(Clone, Default)]
struct Code {
    lengths: Vec<u8>,
    bits: Vec<u16>,
}

impl Code {
    fn from_lengths(lengths: Vec<u8>) -> Self {
        let mut order: Vec<usize> = (0..lengths.len()).filter(|&s| lengths[s] != 0).collect();
        order.sort_by_key(|&s| (lengths[s], s));
        let mut bits = vec![0u16; lengths.len()];
        let mut code = 0u32;
        let mut prev = 0u8;
        for &s in &order {
            code <<= lengths[s] - prev;
            prev = lengths[s];
            bits[s] = (code as u16).reverse_bits() >> (16 - u32::from(prev));
            code += 1;
        }
        Self { lengths, bits }
    }
    fn put(&self, w: &mut Bits, symbol: usize) {
        w.put(u32::from(self.lengths[symbol]), u64::from(self.bits[symbol]));
    }
}

/// What is wrong with the stream, if it was made wrong on purpose.
#[derive(Default)]
pub struct Evil {
    /// One chance in this many at each opportunity. 0: never.
    pub rate: usize,
    pub done: Option<&'static str>,
}

impl Evil {
    fn now(&mut self, rng: &mut Rng, what: &'static str) -> bool {
        if self.rate != 0 && self.done.is_none() && rng.chance(1, self.rate) {
            self.done = Some(what);
            return true;
        }
        false
    }
}

/// Codes that need a large table, with a root table of 8 bits: the number of symbols, how many codes of 8 bits are left for
/// the longer ones, and how many have 9 bits. The other symbols have 10 and 11 bits, but for a chain at the end. With 26,
/// 258 and 272 symbols, and from 544 on, the table takes all the room that the decoders have for it, otherwise 2 to 6
/// entries less. Found by trying, with a model of how the table is built.
const LARGEST_TABLES: [(usize, usize, usize); 39] = [
    (26, 4, 1),
    (32, 4, 3),
    (64, 16, 9),
    (96, 16, 1),
    (128, 16, 1),
    (160, 64, 103),
    (192, 64, 71),
    (224, 64, 39),
    (256, 64, 7),
    (258, 64, 5),
    (272, 64, 3),
    (288, 64, 3),
    (320, 64, 3),
    (352, 64, 3),
    (384, 64, 3),
    (416, 64, 3),
    (448, 64, 3),
    (480, 64, 3),
    (512, 96, 3),
    (544, 256, 485),
    (576, 256, 453),
    (608, 256, 421),
    (640, 256, 389),
    (672, 256, 357),
    (704, 256, 325),
    (736, 256, 293),
    (768, 256, 261),
    (800, 256, 229),
    (832, 256, 197),
    (864, 256, 165),
    (896, 256, 133),
    (928, 256, 101),
    (960, 256, 69),
    (992, 256, 37),
    (1024, 256, 5),
    (1056, 256, 1),
    (1088, 256, 1),
    (1120, 256, 1),
    (1152, 256, 1),
];

/// The lengths of the largest of those codes that has from `least` to `most` symbols.
fn largest_table(least: usize, most: usize) -> Option<Vec<u8>> {
    let &(symbols, free, nine) = LARGEST_TABLES.iter().rev().find(|t| t.0 <= most).filter(|t| t.0 >= least)?;
    // As few short codes as possible.
    let mut lengths: Vec<u8> = (1..=8).filter(|l| (256 - free) >> (8 - l) & 1 != 0).collect();
    let room = 2 * (2 * free - nine);
    let ten = nine + 2 * room + 4 + lengths.len() - symbols;
    for (length, n) in [(9, nine), (10, ten), (11, 2 * (room - ten) - 1), (12, 1), (13, 1), (14, 1), (15, 2)] {
        lengths.resize(lengths.len() + n, length);
    }
    assert_eq!(lengths.len(), symbols);
    Some(lengths)
}

/// Writes a prefix code that has at least the symbols in `used`, and returns it.
fn write_code(w: &mut Bits, rng: &mut Rng, evil: &mut Evil, used: &BTreeSet<usize>, alphabet_max: usize, alphabet_limit: usize) -> Code {
    let mut symbols: Vec<usize> = used.iter().copied().collect();
    if symbols.is_empty() {
        symbols.push(rng.below(alphabet_limit));
    }
    // Symbols that never occur.
    let more = match rng.below(6) {
        0 => rng.below(4),
        1 => rng.below(alphabet_limit),
        2 => alphabet_limit,
        _ => 0,
    };
    for _ in 0..more {
        let s = if rng.chance(1, 8) { alphabet_limit - 1 } else { rng.below(alphabet_limit) };
        if !symbols.contains(&s) {
            symbols.push(s);
        }
    }
    let largest = if rng.chance(1, 8) { largest_table(symbols.len(), alphabet_limit) } else { None };
    if let Some(largest) = &largest {
        let mut others: Vec<usize> = (0..alphabet_limit).filter(|s| !symbols.contains(s)).collect();
        for i in (1..others.len()).rev() {
            others.swap(i, rng.below(i + 1));
        }
        symbols.extend(&others[..largest.len() - symbols.len()]);
        for i in (1..symbols.len()).rev() {
            symbols.swap(i, rng.below(i + 1));
        }
    }
    let k = symbols.len();
    let mut lengths = vec![0u8; alphabet_limit];
    if k == 1 || (k <= 4 && rng.chance(2, 3)) {
        // A simple code.
        let max_bits = usize::BITS - (alphabet_max - 1).leading_zeros();
        for i in (1..k).rev() {
            symbols.swap(i, rng.below(i + 1));
        }
        let tree_select = k == 4 && rng.chance(1, 2);
        let shape: &[u8] = match (k, tree_select) {
            (1, _) => &[0],
            (2, _) => &[1, 1],
            (3, _) => &[1, 2, 2],
            (_, false) => &[2, 2, 2, 2],
            _ => &[1, 2, 3, 3],
        };
        w.put(2, 1);
        w.put(2, k as u64 - 1);
        let same = k > 1 && evil.now(rng, "simple code: a symbol twice");
        let large = alphabet_limit < 1 << max_bits && evil.now(rng, "simple code: a symbol outside of the alphabet");
        for (i, &s) in symbols.iter().enumerate() {
            let mut s = s;
            if same && i == k - 1 {
                s = symbols[0];
            }
            if large && i == 0 {
                s = rng.range(alphabet_limit, (1 << max_bits) - 1);
            }
            w.put(max_bits, s as u64);
        }
        if k == 4 {
            w.put(1, u64::from(tree_select));
        }
        for (&s, &l) in symbols.iter().zip(shape) {
            lengths[s] = l;
        }
        return Code::from_lengths(lengths);
    }
    for (&s, l) in symbols.iter().zip(largest.unwrap_or_else(|| random_lengths(rng, k, 15))) {
        lengths[s] = l;
    }
    if evil.now(rng, "complex code: the lengths do not fill the space") {
        let s = *rng.pick(&symbols);
        lengths[s] = if rng.chance(1, 2) { lengths[s] % 15 + 1 } else { 0 };
    }
    write_lengths(w, rng, evil, lengths)
}

/// Writes a complex prefix code with these lengths, and returns it.
fn write_lengths(w: &mut Bits, rng: &mut Rng, evil: &mut Evil, lengths: Vec<u8>) -> Code {
    // The lengths as symbols 0 to 17, the last two with extra bits.
    let last = lengths.iter().rposition(|&l| l != 0).unwrap_or(0);
    let mut seq: Vec<(usize, u64)> = Vec::new();
    let rle = rng.below(3);
    let mut prev_nonzero = 8u8;
    let mut after_chain: Option<usize> = None;
    let mut i = 0;
    while i <= last {
        let v = lengths[i];
        let run = lengths[i..=last].iter().take_while(|&&l| l == v).count();
        let (symbol, shift) = if v == 0 { (17usize, 3u32) } else { (16, 2) };
        let can_repeat = (v == 0 || v == prev_nonzero) && run >= 3 && after_chain != Some(symbol);
        if can_repeat && (rle == 0 || (rle == 1 && rng.chance(1, 2))) {
            let n = if rng.chance(2, 3) { run } else { rng.range(3, run) };
            let mut digits = Vec::new();
            let mut reps = n - 3;
            loop {
                digits.push((reps & ((1 << shift) - 1)) as u64);
                reps >>= shift;
                if reps == 0 {
                    break;
                }
                reps -= 1;
            }
            seq.extend(digits.iter().rev().map(|&d| (symbol, d)));
            after_chain = Some(symbol);
            i += n;
        } else {
            seq.push((usize::from(v), 0));
            if v != 0 {
                prev_nonzero = v;
            }
            after_chain = None;
            i += 1;
        }
    }
    if evil.now(rng, "complex code: a repetition past the end of the alphabet") {
        for _ in 0..4 {
            seq.insert(rng.below(seq.len() + 1), (17, 7));
        }
    }
    // The code for those.
    let mut cl_used: Vec<usize> = seq.iter().map(|&(s, _)| s).collect::<BTreeSet<_>>().into_iter().collect();
    for _ in 0..rng.below(3) {
        let s = rng.below(18);
        if !cl_used.contains(&s) {
            cl_used.push(s);
        }
    }
    let mut cl = vec![0u8; 18];
    if cl_used.len() == 1 {
        cl[cl_used[0]] = rng.range(1, 5) as u8;
    } else {
        for (&s, l) in cl_used.iter().zip(random_lengths(rng, cl_used.len(), 5)) {
            cl[s] = l;
        }
    }
    if evil.now(rng, "complex code: the lengths of the code length code do not fill the space") {
        cl[rng.below(18)] = rng.below(6) as u8;
    }
    const ORDER: [usize; 18] = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let zeros = ORDER.iter().take_while(|&&s| cl[s] == 0).count();
    let skip = match zeros {
        0 | 1 => 0,
        2 => if rng.chance(3, 4) { 2 } else { 0 },
        _ => *rng.pick(&[3, 3, 3, 2, 0]),
    };
    w.put(2, skip as u64);
    let mut space = 32i32;
    let single = cl.iter().filter(|&&l| l != 0).count() == 1;
    for &s in &ORDER[skip..] {
        let l = usize::from(cl[s]);
        w.put([2, 4, 3, 2, 2, 4][l], [0, 7, 3, 2, 1, 15][l]);
        if l != 0 {
            space -= 32 >> l;
            if space <= 0 {
                break;
            }
        }
    }
    let cl_code = if single { Code { lengths: vec![0; 18], bits: vec![0; 18] } } else { Code::from_lengths(cl) };
    for &(s, extra) in &seq {
        cl_code.put(w, s);
        match s {
            16 => w.put(2, extra),
            17 => w.put(3, extra),
            _ => {}
        }
    }
    Code::from_lengths(lengths)
}

/// 1 to 256.
fn put_count(w: &mut Bits, n: usize) {
    if n == 1 {
        w.put(1, 0);
    } else {
        let bits = usize::BITS - 1 - (n - 1).leading_zeros();
        w.put(1, 1);
        w.put(3, u64::from(bits));
        w.put(bits, (n - 1 - (1 << bits)) as u64);
    }
}

enum Event {
    Symbol(usize, usize),
    Extra(u32, u64),
}

/// The blocks of one of the three categories.
struct Blocks {
    types: usize,
    current: usize,
    previous: usize,
    left: usize,
    first: usize,
    /// The numbers of the trees for the block types and for the block counts.
    type_tree: usize,
    count_tree: usize,
    typical: usize,
}

impl Blocks {
    fn count(rng: &mut Rng, typical: usize) -> usize {
        match rng.below(8) {
            0 => 1,
            1 => rng.range(1, 4),
            7 => rng.range(1, 20000),
            _ => rng.range(1, typical),
        }
    }
    /// Before each symbol of the category.
    fn step(&mut self, rng: &mut Rng, events: &mut Vec<Event>) {
        if self.left == 0 {
            let symbol = if rng.chance(1, 3) { rng.below(2) } else { rng.below(self.types + 2) };
            let mut t = match symbol {
                0 => self.previous,
                1 => self.current + 1,
                s => s - 2,
            };
            if t >= self.types {
                t -= self.types;
            }
            self.previous = self.current;
            self.current = t;
            self.left = Self::count(rng, self.typical);
            let (code, extra) = range_code(&COUNT_BASE, self.left);
            events.push(Event::Symbol(self.type_tree, symbol));
            events.push(Event::Symbol(self.count_tree, code));
            events.push(Event::Extra(COUNT_EXTRA[code], extra));
        }
        self.left -= 1;
    }
}

fn inverse_move_to_front(v: &mut [u8]) {
    let mut mtf: Vec<u8> = (0..=255).collect();
    for x in v {
        let i = usize::from(*x);
        let value = mtf[i];
        *x = value;
        mtf.copy_within(0..i, 1);
        mtf[0] = value;
    }
}

/// Writes a context map of `size` entries for `trees` trees, and returns it.
fn write_context_map(w: &mut Bits, rng: &mut Rng, evil: &mut Evil, size: usize, trees: usize) -> Vec<u8> {
    put_count(w, trees);
    if trees == 1 {
        return vec![0; size];
    }
    let zeros = *rng.pick(&[0, 2, 8, 30]);
    let mut sent: Vec<u8> = Vec::with_capacity(size);
    while sent.len() < size {
        if zeros != 0 && rng.chance(1, 3) {
            let n = rng.range(1, zeros * 4).min(size - sent.len());
            sent.extend(std::iter::repeat_n(0, n));
        } else {
            sent.push(if rng.chance(1, 8) { trees - 1 } else { rng.below(trees) } as u8);
        }
    }
    let rle_max = if rng.chance(1, 3) { 0 } else { rng.range(1, 16) };
    let mut seq: Vec<(usize, u64)> = Vec::new();
    let mut i = 0;
    while i < size {
        let run = sent[i..].iter().take_while(|&&x| x == 0).count();
        if run >= 2 && rle_max > 0 && rng.chance(7, 8) {
            // A run of 2^code to 2^(code + 1) - 1 zeros.
            let most = (usize::BITS - 1 - run.leading_zeros()) as usize;
            let code = if rng.chance(3, 4) { most.min(rle_max) } else { rng.range(1, most.min(rle_max)) };
            let n = run.min((2 << code) - 1);
            let n = if rng.chance(3, 4) { n } else { rng.range(1 << code, n) };
            seq.push((code, (n - (1 << code)) as u64));
            i += n;
        } else if sent[i] == 0 {
            seq.push((0, 0));
            i += 1;
        } else {
            seq.push((usize::from(sent[i]) + rle_max, 0));
            i += 1;
        }
    }
    if rle_max > 0 && evil.now(rng, "context map: a run past the end") {
        seq.push((rle_max, 0));
        let at = rng.below(seq.len());
        let n = seq.len() - 1;
        seq.swap(at, n);
    }
    w.put(1, u64::from(rle_max > 0));
    if rle_max > 0 {
        w.put(4, rle_max as u64 - 1);
    }
    let used = seq.iter().map(|&(s, _)| s).collect();
    let code = write_code(w, rng, evil, &used, trees + rle_max, trees + rle_max);
    for &(s, extra) in &seq {
        code.put(w, s);
        if s >= 1 && s <= rle_max {
            w.put(s as u32, extra);
        }
    }
    let imtf = rng.chance(1, 2);
    w.put(1, u64::from(imtf));
    if imtf {
        inverse_move_to_front(&mut sent);
    }
    sent
}

fn distance_alphabet(npostfix: u32, ndirect: usize, large_window: bool) -> (usize, usize) {
    if !large_window {
        let n = 16 + ndirect + (24usize << (npostfix + 1));
        return (n, n);
    }
    let max = 16 + ndirect + (62usize << (npostfix + 1));
    // BrotliCalculateDistanceCodeLimit(0x7FFFFFFC, npostfix, ndirect)
    let offset = ((0x7FFF_FFFDusize - ndirect - 1) >> npostfix) + 4;
    let ndistbits = (usize::BITS - 1 - (offset / 2).leading_zeros()) as usize;
    let half = (offset >> ndistbits) & 1;
    let group = (((ndistbits - 1) << 1) | half) - 1;
    (max, ((group << npostfix) | ((1 << npostfix) - 1)) + ndirect + 16 + 1)
}

/// The longest distance that there is a code for.
pub fn longest_distance(npostfix: u32, ndirect: usize, large_window: bool) -> usize {
    let code = distance_alphabet(npostfix, ndirect, large_window).1 - 1 - 16 - ndirect;
    let nbits = 1 + (code >> (npostfix + 1));
    let offset = ((2 + ((code >> npostfix) & 1)) << nbits) - 4;
    ((offset + (1 << nbits) - 1) << npostfix) + (code & ((1 << npostfix) - 1)) + ndirect + 1
}

/// The symbol and the extra bits for a distance that is not taken from the last ones.
fn distance_symbol(distance: usize, npostfix: u32, ndirect: usize) -> (usize, u32, u64) {
    if distance <= ndirect {
        return (distance + 15, 0, 0);
    }
    let dist = (1usize << (npostfix + 2)) + (distance - 1 - ndirect);
    let bucket = usize::BITS - 1 - dist.leading_zeros() - 1;
    let postfix = dist & ((1 << npostfix) - 1);
    let prefix = (dist >> bucket) & 1;
    let offset = (2 + prefix) << bucket;
    let nbits = bucket - npostfix;
    (16 + ndirect + ((2 * (nbits as usize - 1) + prefix) << npostfix) + postfix, nbits, ((dist - offset) >> npostfix) as u64)
}

/// How many values the field for a symbol of a simple distance code has.
pub fn distance_symbol_values(large_window: bool, npostfix: u32, ndirect: usize) -> usize {
    distance_alphabet(npostfix, ndirect, large_window).0.next_power_of_two()
}

/// A literal and a copy of 4 bytes. The distance code has one symbol, `symbol`, and its extra bits are all the same.
pub fn one_distance(large_window: bool, npostfix: u32, ndirect: usize, symbol: usize, ones: bool) -> Vec<u8> {
    let mut w = Bits::default();
    if large_window {
        w.put(14, (24 << 8) | 0x11);
    } else {
        w.put(1, 0);
    }
    // The last meta-block, not empty, of 5 bytes, with one block type of each kind.
    w.put(4, 1);
    w.put(16, 4);
    w.put(3, 0);
    w.put(2, u64::from(npostfix));
    w.put(4, (ndirect >> npostfix) as u64);
    // The context mode, and one tree each for the literals and the distances.
    w.put(4, 0);
    // Command 138: a literal, a copy of 4 bytes, and a distance follows.
    let bits = distance_symbol_values(large_window, npostfix, ndirect).trailing_zeros();
    for (bits, symbol) in [(8, 97), (10, 138), (bits, symbol)] {
        w.put(4, 1);
        w.put(bits, symbol as u64);
    }
    if symbol >= 16 + ndirect {
        // A symbol that would have more is not in any alphabet.
        let extra = 1 + ((symbol - 16 - ndirect) >> (npostfix + 1));
        w.put(extra.min(64) as u32, if ones { u64::MAX } else { 0 });
    }
    w.bytes
}

/// Nothing but a copy of 16,779,333 bytes, which is more than the meta-block has, from `distance` before the start.
pub fn one_long_copy(distance: usize) -> Vec<u8> {
    let mut w = Bits::default();
    // A window of 16 bits. The last meta-block, not empty, of 1 << 24 bytes, with one block type of each kind.
    w.put(3, 2);
    w.put(2, 2);
    w.put(24, 0xFF_FFFF);
    w.put(3, 0);
    // NPOSTFIX, NDIRECT, the context mode, and one tree each for the literals and the distances.
    w.put(10, 0);
    // No literal, and a copy of 2118 bytes and as many more as 24 bits say.
    let (symbol, nbits, extra) = distance_symbol(distance, 0, 0);
    assert!(symbol < 64);
    for (bits, symbol) in [(8, 0), (10, command_symbol(0, 23, false)), (6, symbol)] {
        w.put(4, 1);
        w.put(bits, symbol as u64);
    }
    w.put(24, 0xFF_FFFF);
    w.put(nbits, extra);
    w.bytes
}

/// Literals up to `before_end` bytes before the end of a ring buffer of 1024 bytes, a word of the static dictionary, which the
/// decoder writes past that end, a literal, and a copy of 8 bytes from the end of the word. Returns the stream and what it
/// decodes to.
pub fn word_at_end(before_end: usize, len: usize, index: usize, transform: usize) -> (Vec<u8>, Vec<u8>) {
    let literals = 1024 - before_end;
    let mut output = vec![97; literals];
    output.extend(dictionary_word(len, index, transform));
    output.push(97);
    for _ in 0..8 {
        output.push(output[output.len() - 12]);
    }
    let mut w = Bits::default();
    // A window of 10 bits. The last meta-block, not empty, with one block type of each kind.
    w.put(7, 0x21);
    w.put(4, 1);
    w.put(16, output.len() as u64 - 1);
    w.put(3, 0);
    // NPOSTFIX, NDIRECT, the context mode, and one tree each for the literals and the distances.
    w.put(10, 0);
    w.put(4, 1);
    w.put(8, 97);
    let (insert, insert_extra) = range_code(&INSERT_BASE, literals);
    let (copy, copy_extra) = range_code(&COPY_BASE, len);
    let commands = [command_symbol(insert, copy, false), command_symbol(1, 6, false)];
    let far = distance_symbol(literals.min(1008) + 1 + index + (transform << size_bits(len)), 0, 0);
    let near = distance_symbol(12, 0, 0);
    let distances = [far.0, near.0];
    for (bits, symbols) in [(10, commands), (6, distances)] {
        w.put(4, 5);
        w.put(bits, symbols[0] as u64);
        w.put(bits, symbols[1] as u64);
    }
    // Of two symbols, the lower one is written as 0.
    w.put(1, u64::from(commands[0] > commands[1]));
    w.put(INSERT_EXTRA[insert], insert_extra);
    w.put(COPY_EXTRA[copy], copy_extra);
    w.put(1, u64::from(distances[0] > distances[1]));
    w.put(far.1, far.2);
    w.put(1, u64::from(commands[1] > commands[0]));
    w.put(1, u64::from(distances[1] > distances[0]));
    w.put(near.1, near.2);
    (w.bytes, output)
}

/// Writes a code of 16 symbols with 1 to 15 bits, `others` among them, of which `deep` has 15, and returns it.
fn write_chain(w: &mut Bits, rng: &mut Rng, alphabet: usize, deep: usize, others: &[usize]) -> Code {
    let mut symbols = vec![deep];
    symbols.extend_from_slice(others);
    while symbols.len() < 16 {
        let s = rng.below(alphabet);
        if !symbols.contains(&s) {
            symbols.push(s);
        }
    }
    for i in (2..16).rev() {
        symbols.swap(i, rng.range(1, i));
    }
    let mut lengths = vec![0u8; alphabet];
    for (&s, length) in symbols.iter().zip([15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
        lengths[s] = length;
    }
    write_lengths(w, rng, &mut Evil::default(), lengths)
}

/// What takes the most bits of all that a decoder reads without looking how much input is left: a command without literals, the
/// next block of distances, and a distance, each symbol with 15 bits and each number with as many extra bits as there are.
/// There is no such distance, so it ends in an error. 40 more bytes follow. The command before ends with 24 extra bits and a
/// symbol, which can leave the decoder with as few as 2 bits that it has loaded.
pub fn longest_read(rng: &mut Rng, large_window: bool) -> Vec<u8> {
    let mut w = Bits::default();
    if large_window {
        w.put(14, (24 << 8) | 0x11);
    } else {
        w.put(1, 0);
    }
    // The last meta-block, not empty, of 1 << 24 bytes, with one block type each for the literals and the commands.
    w.put(4, 9);
    w.put(24, 0xFF_FFFF);
    w.put(2, 0);
    let types = rng.range(14, 256);
    put_count(&mut w, types);
    let next_type = rng.below(types + 2);
    let type_code = write_chain(&mut w, rng, types + 2, next_type, &[]);
    let count_code = write_chain(&mut w, rng, 26, 25, &[0]);
    // The first block has two distances.
    count_code.put(&mut w, 0);
    w.put(2, 1);
    // NPOSTFIX, NDIRECT, the context mode, and one tree each for the literals and the distances.
    w.put(10, 0);
    w.put(4, 1);
    w.put(8, 97);
    let (first, long) = (command_symbol(1, 0, false), command_symbol(0, 23, false));
    let command_code = write_chain(&mut w, rng, 704, long, &[first]);
    let far = distance_alphabet(0, 0, large_window).1 - 1;
    let (near, near_bits, near_extra) = distance_symbol(1, 0, 0);
    let distance_code = write_chain(&mut w, rng, far + 1, far, &[near, 0]);
    // A literal and a copy of it.
    command_code.put(&mut w, first);
    distance_code.put(&mut w, near);
    w.put(near_bits, near_extra);
    // A few thousand more, from the same distance.
    command_code.put(&mut w, long);
    w.put(24, rng.next() & 0xFFF);
    distance_code.put(&mut w, 0);
    command_code.put(&mut w, long);
    w.put(24, rng.next());
    type_code.put(&mut w, next_type);
    count_code.put(&mut w, 25);
    w.put(24, rng.next());
    distance_code.put(&mut w, far);
    w.put(1 + ((far as u32 - 16) >> 1), rng.next());
    for _ in 0..40 {
        w.put(8, rng.next());
    }
    w.bytes
}

pub struct Stream {
    pub bytes: Vec<u8>,
    /// What a valid stream decodes to.
    pub output: Vec<u8>,
    pub large_window: bool,
    pub dictionaries: Vec<Vec<u8>>,
    pub evil: Option<&'static str>,
}

#[derive(Clone, Copy)]
enum How {
    /// The command says that it is the last distance.
    Implicit,
    /// One of the 16 codes for the last distances.
    Short(usize),
    Explicit(usize),
}

struct Model {
    out: Vec<u8>,
    /// The last four distances, kept the way the reference decoder does.
    rb: [i64; 4],
    idx: usize,
    window: usize,
    dictionary: Vec<u8>,
}

fn literals(rng: &mut Rng, kind: usize, n: usize, out: &mut Vec<u8>) {
    for _ in 0..n {
        out.push(match kind {
            0 => rng.next() as u8,
            1 => b'a' + rng.below(4) as u8,
            2 => *rng.pick(b" etaoinshr,.\nETA019\xc3\xa9\xe4\xb8"),
            _ => (rng.below(3) * 127) as u8,
        });
    }
}

fn compressed_meta_block(w: &mut Bits, rng: &mut Rng, evil: &mut Evil, m: &mut Model, mlen: usize, is_last: bool, large_window: bool) {
    let start = m.out.len();
    let many = rng.chance(1, 6);
    let pick_types = |rng: &mut Rng| match rng.below(if many { 3 } else { 8 }) {
        0 => rng.range(2, 4),
        1 => if many { rng.range(2, 256) } else { 2 },
        2 if many => 256,
        _ => 1,
    };
    let types = [pick_types(rng), pick_types(rng), pick_types(rng)];
    let npostfix = if rng.chance(1, 2) { 0 } else { rng.below(4) as u32 };
    let ndirect = if rng.chance(1, 2) { 0 } else { rng.below(16) << npostfix };
    let modes: Vec<usize> = (0..types[0]).map(|_| rng.below(4)).collect();
    let pick_trees = |rng: &mut Rng, most: usize| match rng.below(6) {
        0 => rng.range(1, most.min(4)),
        1 => rng.range(1, most.min(40)),
        2 if many => most.min(256),
        _ => 1,
    };
    let trees_l = pick_trees(rng, 64 * types[0]);
    let trees_d = pick_trees(rng, 4 * types[2]);

    // The header cannot be written before the symbols are known, but the context maps decide which tree a symbol is for.
    let mut maps = Bits::default();
    let mut maps_rng = Rng(rng.next());
    let map_l = write_context_map(&mut maps, &mut maps_rng, evil, 64 * types[0], trees_l);
    let map_d = write_context_map(&mut maps, &mut maps_rng, evil, 4 * types[2], trees_d);

    // Trees 0 to 5 are for the block types and counts, then come the literals, the commands and the distances.
    let (tree_l, tree_i, tree_d) = (6, 6 + trees_l, 6 + trees_l + types[1]);
    let n_trees = tree_d + trees_d;
    let mut blocks: Vec<Blocks> = (0..3)
        .map(|c| {
            let typical = *rng.pick(&[3, 20, 200]);
            let first = if types[c] > 1 { Blocks::count(rng, typical) } else { 1 << 24 };
            Blocks { types: types[c], current: 0, previous: 1, left: first, first, type_tree: 2 * c, count_tree: 2 * c + 1, typical }
        })
        .collect();
    let mut events: Vec<Event> = Vec::new();
    let kind = rng.below(4);
    let style = rng.below(4);
    while m.out.len() - start < mlen {
        let left = mlen - (m.out.len() - start);
        let mut insert = match style {
            0 => rng.below(4),
            1 => rng.below(30),
            2 => if rng.chance(1, 20) { rng.below(3000) } else { rng.below(8) },
            _ => 0,
        }
        .min(left);
        if m.out.is_empty() && insert == 0 && rng.chance(7, 8) {
            insert = 1;
        }
        let after = left - insert;
        // What is copied. Nothing at the end of the meta-block: the length in the command does not count then.
        let pos = m.out.len() + insert;
        let max_distance = pos.min(m.window);
        let mut copy = match rng.below(8) {
            0 => 2,
            1 | 2 => rng.range(2, 9),
            3 | 4 => rng.range(4, 24),
            5 => rng.range(2, 200),
            6 => rng.range(2, 3000),
            _ => rng.range(2, 70),
        };
        // How the distance is written, the distance, what it adds to the output (`None`: a copy), and the index of the
        // ring of distances afterwards.
        let mut choice: Option<(How, usize, Option<Vec<u8>>, usize)> = None;
        if after > 0 {
            for _ in 0..12 {
                let mut len = copy;
                let how = match rng.below(12) {
                    0 | 1 if insert <= 9 => {
                        len = len.min(69);
                        How::Implicit
                    }
                    0..=3 => How::Short(rng.below(16)),
                    4..=6 if max_distance > 0 => How::Explicit(match rng.below(5) {
                        0 => rng.range(1, max_distance.min(4)),
                        1 => max_distance - rng.below(max_distance.min(3)),
                        2 => rng.range(1, max_distance.min(ndirect + 20)),
                        _ => rng.range(1, max_distance),
                    }),
                    7 | 8 if !m.dictionary.is_empty() => {
                        let back = if rng.chance(1, 4) { m.dictionary.len() - rng.below(m.dictionary.len().min(3)) } else { rng.range(1, m.dictionary.len()) };
                        len = len.min(back).max(2);
                        How::Explicit(max_distance + back)
                    }
                    _ => {
                        len = rng.range(4, 24);
                        let bits = size_bits(len);
                        let index = if rng.chance(1, 8) { (1 << bits) - 1 } else { rng.below(1 << bits) };
                        let transform = if rng.chance(1, 3) { 0 } else { rng.below(121) };
                        How::Explicit(max_distance + m.dictionary.len() + 1 + (transform << bits) + index)
                    }
                };
                // TakeDistanceFromRingBuffer
                let (distance, roll, idx) = match how {
                    How::Implicit => (m.rb[m.idx.wrapping_sub(1) & 3], 1, m.idx.wrapping_sub(1)),
                    How::Short(code) if code <= 3 => (m.rb[m.idx.wrapping_add(3).wrapping_sub(code) & 3], 1 >> code, m.idx.wrapping_sub(1 >> code)),
                    How::Short(code) => {
                        let (base, index_delta) = if code < 10 { (code - 4, 3) } else { (code - 10, 2) };
                        (m.rb[m.idx.wrapping_add(index_delta) & 3] + ((0x605142 >> (4 * base)) & 0xF) - 3, 0, m.idx)
                    }
                    How::Explicit(d) => (d as i64, 0, m.idx),
                };
                if distance <= 0 || (!large_window && distance > (1 << 26) - 100) {
                    continue;
                }
                let distance = distance as usize;
                let total = m.dictionary.len();
                let (added, idx) = if distance <= max_distance {
                    (None, idx)
                } else if distance - max_distance - 1 < total {
                    let at = total - (distance - max_distance);
                    if at + len > total {
                        continue;
                    }
                    (Some(m.dictionary[at..at + len].to_vec()), idx)
                } else if (4..=24).contains(&len) {
                    let address = distance - max_distance - 1 - total;
                    let bits = size_bits(len);
                    if address >> bits >= 121 {
                        continue;
                    }
                    let word = dictionary_word(len, address & ((1 << bits) - 1), address >> bits);
                    if word.is_empty() && distance <= 120 {
                        continue;
                    }
                    (Some(word), idx.wrapping_add(roll))
                } else {
                    continue;
                };
                if added.as_ref().map_or(len, Vec::len) <= after {
                    copy = len;
                    choice = Some((how, distance, added, idx));
                    break;
                }
            }
            if choice.is_none() {
                // Literals, and a copy of the last of them if there is room.
                insert = left.min(insert + rng.range(1, 3));
                if left - insert >= 2 {
                    copy = 2;
                    choice = Some((How::Explicit(1), 1, None, m.idx));
                } else {
                    insert = left;
                }
            }
        }
        if evil.now(rng, "a copy past the end of the meta-block") {
            copy = left + rng.range(1, 40);
            choice = Some((How::Explicit(1), 1, None, m.idx));
        }
        if evil.now(rng, "a distance that is too long") {
            let far = m.out.len() + insert + m.dictionary.len() + rng.range(1, 200);
            let far = if (4..=24).contains(&copy) { far + (121 << size_bits(copy)) } else { far };
            let far = if rng.chance(1, 3) { longest_distance(npostfix, ndirect, large_window) } else { far };
            choice = Some((How::Explicit(far), far, None, m.idx));
        }
        let (ins_code, ins_extra) = range_code(&INSERT_BASE, insert);
        let (copy_code, copy_extra) = range_code(&COPY_BASE, copy);
        let implicit = matches!(choice, Some((How::Implicit, ..)));
        blocks[1].step(rng, &mut events);
        events.push(Event::Symbol(tree_i + blocks[1].current, command_symbol(ins_code, copy_code, implicit)));
        events.push(Event::Extra(INSERT_EXTRA[ins_code], ins_extra));
        events.push(Event::Extra(COPY_EXTRA[copy_code], copy_extra));
        let mut bytes = Vec::new();
        literals(rng, kind, insert, &mut bytes);
        for b in bytes {
            blocks[0].step(rng, &mut events);
            let n = m.out.len();
            let (p1, p2) = (if n > 0 { m.out[n - 1] } else { 0 }, if n > 1 { m.out[n - 2] } else { 0 });
            let tree = map_l[64 * blocks[0].current + context(modes[blocks[0].current], p1, p2)];
            events.push(Event::Symbol(tree_l + usize::from(tree), usize::from(b)));
            m.out.push(b);
        }
        let Some((how, distance, added, idx)) = choice else { break };
        if !implicit {
            blocks[2].step(rng, &mut events);
            let tree = map_d[4 * blocks[2].current + (copy - 2).min(3)];
            let (symbol, nbits, extra) = match how {
                How::Short(code) => (code, 0, 0),
                _ => distance_symbol(distance, npostfix, ndirect),
            };
            events.push(Event::Symbol(tree_d + usize::from(tree), symbol));
            events.push(Event::Extra(nbits, extra));
        }
        if evil.done.is_some() && m.out.len() < distance {
            break;
        }
        m.idx = idx;
        // A word of the static dictionary does not count as a distance.
        let is_word = distance > (m.out.len()).min(m.window) + m.dictionary.len();
        match added {
            Some(bytes) => m.out.extend_from_slice(&bytes),
            None => {
                for _ in 0..copy {
                    m.out.push(m.out[m.out.len() - distance]);
                }
            }
        }
        if !is_word {
            m.rb[m.idx & 3] = distance as i64;
            m.idx = m.idx.wrapping_add(1);
        }
        if evil.done.is_some() && m.out.len() - start > mlen {
            break;
        }
    }

    // Which symbols each tree needs.
    let mut used: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n_trees];
    for e in &events {
        if let Event::Symbol(t, s) = e {
            used[*t].insert(*s);
        }
    }
    let first_counts: Vec<(usize, u64)> = blocks.iter().map(|b| range_code(&COUNT_BASE, b.first.min(1 << 24))).collect();
    for c in 0..3 {
        if types[c] > 1 {
            used[2 * c + 1].insert(first_counts[c].0);
        }
    }

    // The header.
    w.put(1, u64::from(is_last));
    if is_last {
        w.put(1, 0);
    }
    let bits = if mlen == 1 { 1 } else { usize::BITS - (mlen - 1).leading_zeros() };
    let mut nibbles = bits.div_ceil(4).max(4);
    if nibbles < 6 && evil.now(rng, "a length with a nibble too many") {
        nibbles += 1;
    }
    w.put(2, u64::from(nibbles) - 4);
    w.put(4 * nibbles, mlen as u64 - 1);
    if !is_last {
        w.put(1, 0);
    }
    let mut codes: Vec<Code> = vec![Code::default(); n_trees];
    for c in 0..3 {
        put_count(w, types[c]);
        if types[c] > 1 {
            codes[2 * c] = write_code(w, rng, evil, &used[2 * c], types[c] + 2, types[c] + 2);
            codes[2 * c + 1] = write_code(w, rng, evil, &used[2 * c + 1], 26, 26);
            codes[2 * c + 1].put(w, first_counts[c].0);
            w.put(COUNT_EXTRA[first_counts[c].0], first_counts[c].1);
        }
    }
    w.put(2, u64::from(npostfix));
    w.put(4, (ndirect >> npostfix) as u64);
    for &mode in &modes {
        w.put(2, mode as u64);
    }
    for i in 0..maps.n {
        w.put(1, u64::from(maps.bytes[i / 8] >> (i % 8) & 1));
    }
    let (dist_max, dist_limit) = distance_alphabet(npostfix, ndirect, large_window);
    for t in 6..n_trees {
        let (max, limit) = if t < tree_i { (256, 256) } else if t < tree_d { (704, 704) } else { (dist_max, dist_limit) };
        codes[t] = write_code(w, rng, evil, &used[t], max, limit);
    }
    for e in &events {
        match *e {
            Event::Symbol(t, s) => codes[t].put(w, s),
            Event::Extra(n, v) => w.put(n, v),
        }
    }
}

pub fn stream(rng: &mut Rng, evil_rate: usize, max_output: usize) -> Stream {
    let mut w = Bits::default();
    let mut evil = Evil { rate: evil_rate, done: None };
    let large_window = rng.chance(1, 6);
    let lgwin = if large_window { rng.range(10, 30) } else if rng.chance(1, 2) { rng.range(10, 13) } else { rng.range(10, 24) };
    if large_window {
        w.put(14, ((lgwin as u64) << 8) | 0x11);
    } else if lgwin == 16 {
        w.put(1, 0);
    } else if lgwin == 17 {
        w.put(7, 1);
    } else if lgwin > 17 {
        w.put(4, ((lgwin as u64 - 17) << 1) | 1);
    } else {
        w.put(7, ((lgwin as u64 - 8) << 4) | 1);
    }
    let mut dictionaries: Vec<Vec<u8>> = Vec::new();
    if rng.chance(1, 5) {
        for _ in 0..if rng.chance(1, 4) { 15 } else { rng.range(1, 3) } {
            let mut d = Vec::new();
            let most = if rng.chance(1, 4) { 3000 } else { 40 };
            let n = rng.range(1, most);
            literals(rng, 2, n, &mut d);
            dictionaries.push(d);
        }
    }
    let mut m = Model { out: Vec::new(), rb: [16, 15, 11, 4], idx: 0, window: (1 << lgwin) - 16, dictionary: dictionaries.concat() };
    let blocks = if rng.chance(1, 3) { 1 } else { rng.range(1, 6) };
    let mut ended = false;
    for b in 0..blocks {
        if evil.done.is_some() || m.out.len() >= max_output {
            break;
        }
        let is_last = b + 1 == blocks && rng.chance(1, 2);
        let mlen = match rng.below(8) {
            0 => rng.range(1, 4),
            1 | 2 => rng.range(1, 100),
            3 | 4 | 5 => rng.range(1, 3000),
            6 => rng.range(60000, 70000),
            _ => rng.range(1, 20000),
        };
        match rng.below(8) {
            0 if !is_last => {
                // Metadata.
                let n = match rng.below(4) { 0 => 0, 1 => rng.range(1, 256), 2 => rng.range(257, 400), _ => rng.range(65536, 65800) };
                w.put(1, 0);
                w.put(2, 3);
                w.put(1, u64::from(evil.now(rng, "metadata: the reserved bit")));
                let mut bytes = if n == 0 { 0 } else { (usize::BITS - (n - 1).leading_zeros()).div_ceil(8).max(1) };
                if bytes > 0 && bytes < 3 && evil.now(rng, "metadata: a length with a byte too many") {
                    bytes += 1;
                }
                w.put(2, u64::from(bytes));
                if n > 0 {
                    w.put(8 * bytes, n as u64 - 1);
                }
                w.align(u64::from(w.n % 8 != 0 && evil.now(rng, "metadata: padding")) * 0x55);
                let mut skipped = Vec::new();
                literals(rng, 0, n, &mut skipped);
                w.raw(&skipped);
            }
            1 if !is_last => {
                // Uncompressed.
                let bits = if mlen == 1 { 1 } else { usize::BITS - (mlen - 1).leading_zeros() };
                let nibbles = bits.div_ceil(4).max(4);
                w.put(1, 0);
                w.put(2, u64::from(nibbles) - 4);
                w.put(4 * nibbles, mlen as u64 - 1);
                w.put(1, 1);
                w.align(u64::from(w.n % 8 != 0 && evil.now(rng, "uncompressed: padding")) * 0x55);
                let at = m.out.len();
                let kind = rng.below(4);
                literals(rng, kind, mlen, &mut m.out);
                w.raw(&m.out[at..]);
            }
            _ => {
                compressed_meta_block(&mut w, rng, &mut evil, &mut m, mlen, is_last, large_window);
                ended = is_last;
            }
        }
    }
    if !ended && evil.done.is_none() {
        w.put(2, 3);
    }
    w.align(u64::from(w.n % 8 != 0 && evil.now(rng, "padding after the last meta-block")) * 0x55);
    Stream { bytes: w.bytes, output: m.out, large_window, dictionaries, evil: evil.done }
}

/// 2^24 commands that put out nothing, in a meta-block with one block type: the count of the only block runs out. That
/// of the commands, or with `distances` that of the distances.
pub fn empty_commands(distances: bool) -> Vec<u8> {
    let mut w = Bits::default();
    let simple = |w: &mut Bits, bits: u32, symbol: u64| {
        w.put(2, 1);
        w.put(2, 0);
        w.put(bits, symbol);
    };
    w.put(1, 0); // lgwin 16
    w.put(1, 1); // ISLAST
    w.put(1, 0);
    w.put(2, 0);
    w.put(16, 9); // MLEN 10
    w.put(1, 0); // one block type
    if distances {
        // Two for the commands. The first block is as long as a block can be, which is longer than 2^24.
        put_count(&mut w, 2);
        simple(&mut w, 2, 0);
        simple(&mut w, 5, 25);
        w.put(COUNT_EXTRA[25], (1 << 24) - 1);
    } else {
        w.put(1, 0);
    }
    w.put(1, 0);
    w.put(2, 0);
    w.put(4, 0);
    w.put(2, 0); // context mode
    w.put(1, 0); // one literal tree
    w.put(1, 0); // one distance tree
    simple(&mut w, 8, 65);
    // No literals, a copy of 4 bytes, an explicit distance.
    for _ in 0..1 + usize::from(distances) {
        simple(&mut w, 10, command_symbol(0, 2, false) as u64);
    }
    // Transform 34 omits the first 4 bytes of the word.
    let (omit, _) = (0..121).map(|t| (t, dictionary_word(4, 0, t))).find(|(_, word)| word.is_empty()).expect("a transform that leaves nothing");
    let (symbol, nbits, extra) = distance_symbol(1 + (omit << size_bits(4)), 0, 0);
    simple(&mut w, 6, symbol as u64);
    for _ in 0..(1 << 24) + 8 {
        w.put(nbits, extra);
    }
    w.align(0);
    w.bytes
}
