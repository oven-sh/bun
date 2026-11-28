//! Writes streams that no encoder makes: any codes, block types, context modes and distances.

pub(crate) struct Numbers(pub(crate) u64);

impl Numbers {
    pub(crate) fn below(&mut self, end: usize) -> usize {
        self.0 = (self.0.wrapping_mul(6364136223846793005)).wrapping_add(1442695040888963407);
        (self.0 >> 33) as usize % end
    }

    pub(crate) fn one_of<T: Copy>(&mut self, choices: &[T]) -> T {
        choices[self.below(choices.len())]
    }

    /// The lengths of a complete code for so many symbols.
    fn lengths(&mut self, count: usize) -> Vec<u32> {
        let (mut lengths, skew) = (vec![1, 1], 1 + self.below(3));
        while lengths.len() < count {
            let at = match self.below(skew) {
                0 => self.below(lengths.len()),
                _ => lengths.len() - 1,
            };
            if lengths[at] < 15 {
                lengths[at] += 1;
                lengths.push(lengths[at]);
            }
        }
        lengths
    }
}

/// For each symbol, the length and the bits.
type Code = Vec<(u32, usize)>;

#[derive(Default)]
struct Bits(Vec<bool>);

impl Bits {
    fn put(&mut self, value: usize, count: u32) {
        self.0.extend((0..count).map(|bit| value >> bit & 1 == 1));
    }

    fn symbol(&mut self, (length, code): (u32, usize)) {
        self.0
            .extend((0..length).rev().map(|bit| code >> bit & 1 == 1));
    }

    fn count(&mut self, count: usize) {
        self.put(usize::from(count > 1), 1);
        if let Some(bits) = (count - 1).checked_ilog2() {
            self.put(bits as usize, 3);
            self.put(count - 1, bits);
        }
    }

    /// Deals `lengths` out among `size` symbols.
    fn code(&mut self, numbers: &mut Numbers, mut lengths: Vec<u32>, size: usize) -> Code {
        lengths.resize(size, 0);
        (1..size).for_each(|i| lengths.swap(i, numbers.below(i + 1)));
        // Four bits for each length, and no codes for repetitions.
        self.put(0, 2);
        (0..18).for_each(|i| self.put(usize::from(i != 6 && i != 8), 2));
        let used = lengths.iter().rposition(|&it| it != 0).unwrap();
        (lengths[..=used].iter()).for_each(|&it| self.symbol((4, it as usize)));
        let (mut code, mut next) = (vec![(0, 0); size], 0);
        for length in 1..=15 {
            next <<= 1;
            for symbol in (0..size).filter(|&it| lengths[it] == length) {
                code[symbol] = (length, next);
                next += 1;
            }
        }
        code
    }

    fn code_for_all(&mut self, numbers: &mut Numbers, size: usize) -> Code {
        let lengths = numbers.lengths(size);
        self.code(numbers, lengths, size)
    }

    /// Returns a number in the range of `symbol`, where the first range starts at zero.
    fn extra(&mut self, numbers: &mut Numbers, bits: &[u32], symbol: usize) -> usize {
        let extra = numbers.below(1 << bits[symbol].min(12));
        self.put(extra, bits[symbol]);
        bits[..symbol].iter().map(|it| 1 << it).sum::<usize>() + extra
    }

    fn context_map(&mut self, numbers: &mut Numbers, len: usize) -> (usize, Vec<usize>) {
        let trees = numbers.one_of(&[1, 2, 3, 7]);
        let map: Vec<_> = (0..len).map(|_| numbers.below(trees)).collect();
        self.count(trees);
        if trees > 1 {
            self.put(0, 1);
            let code = self.code_for_all(numbers, trees);
            map.iter().for_each(|&it| self.symbol(code[it]));
            self.put(0, 1);
        }
        (trees, map)
    }

    fn meta_block(&mut self, len: usize, is_stored: bool) {
        let nibbles = ((len - 1).max(1).ilog2() / 4 + 1).max(4);
        self.put(2 * (nibbles as usize - 4), 3);
        self.put(len - 1, 4 * nibbles);
        self.put(is_stored.into(), 1);
    }
}

struct Blocks {
    types: usize,
    codes: [Code; 2],
    /// The current type comes first.
    last: [usize; 2],
    left: usize,
}

impl Blocks {
    fn new(bits: &mut Bits, numbers: &mut Numbers) -> Self {
        let mut blocks = Self {
            types: numbers.one_of(&[1, 1, 2, 5]),
            codes: Default::default(),
            last: [0, 1],
            left: usize::MAX,
        };
        bits.count(blocks.types);
        if blocks.types > 1 {
            blocks.codes = [blocks.types + 2, 26].map(|size| bits.code_for_all(numbers, size));
            blocks.start(bits, numbers);
        }
        blocks
    }

    fn start(&mut self, bits: &mut Bits, numbers: &mut Numbers) {
        const BITS: [u32; 26] = [
            2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24,
        ];
        let symbol = numbers.below(26).min(numbers.below(26));
        bits.symbol(self.codes[1][symbol]);
        self.left = 1 + bits.extra(numbers, &BITS, symbol);
    }

    fn next(&mut self, bits: &mut Bits, numbers: &mut Numbers) -> usize {
        if self.left == 0 {
            let symbol = numbers.below(self.types + 2);
            bits.symbol(self.codes[0][symbol]);
            let next = match symbol {
                0 => self.last[1],
                1 => (self.last[0] + 1) % self.types,
                _ => symbol - 2,
            };
            self.last = [next, self.last[0]];
            self.start(bits, numbers);
        }
        self.left -= 1;
        self.last[0]
    }
}

/// Also returns the length of what it holds. It is valid unless `least_distance` is zero.
pub(crate) fn stream(numbers: &mut Numbers, least_distance: usize) -> (Vec<u8>, usize) {
    const INSERT_BITS: [u32; 24] = [
        0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
    ];
    const COPY_BITS: [u32; 24] = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
    ];
    const WORD_BITS: [u32; 21] = [
        10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5,
    ];
    let mut all = Bits::default();
    let (window, code, code_len) =
        numbers.one_of(&[(10, 33, 7), (12, 65, 7), (16, 0, 1), (18, 3, 4)]);
    all.put(code, code_len);
    let (mut len, mut recent) = (16 + numbers.below(100), [4_usize, 11, 15, 16]);
    all.meta_block(len, true);
    all.0.resize(all.0.len().next_multiple_of(8), false);
    (0..len).for_each(|_| all.put(numbers.below(256), 8));

    for _ in 0..1 + numbers.below(3) {
        let (start, bits) = (len, &mut Bits::default());
        let mut blocks = [(); 3].map(|()| Blocks::new(bits, numbers));
        let (postfix, direct) = (numbers.below(4), numbers.one_of(&[0, 1, 15]));
        bits.put(postfix | direct << 2, 6);
        let direct = direct << postfix;
        (0..blocks[0].types).for_each(|_| bits.put(numbers.below(4), 2));
        let (literal_trees, _) = bits.context_map(numbers, 64 * blocks[0].types);
        let (distance_trees, distance_map) = bits.context_map(numbers, 4 * blocks[2].types);
        // All have the same codes for other symbols, so the context need not be known.
        let (count, mut literals) = (numbers.one_of(&[2, 20, 256]), Code::new());
        let lengths = numbers.lengths(count);
        for _ in 0..literal_trees {
            literals = bits.code(numbers, lengths.clone(), 256);
        }
        literals.retain(|it| it.0 != 0);
        let mut codes = |count, size| -> Vec<_> {
            let all = (0..count).map(|_| bits.code_for_all(numbers, size));
            all.collect()
        };
        let commands = codes(blocks[1].types, 704);
        let distances = codes(distance_trees, 16 + direct + (48 << postfix));

        let (usual, rare) = (numbers.one_of(&[192, 384]), numbers.one_of(&[30, 300]));
        for _ in 0..1 + numbers.below(400) {
            let end = if numbers.below(rare) == 0 { 704 } else { usual };
            let (symbol, block_type) = (numbers.below(end), blocks[1].next(bits, numbers));
            bits.symbol(commands[block_type][symbol]);
            let insert = [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16][symbol / 64] + symbol / 8 % 8;
            let copy = [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16][symbol / 64] + symbol % 8;
            let insert = bits.extra(numbers, &INSERT_BITS, insert);
            let copy = 2 + bits.extra(numbers, &COPY_BITS, copy);
            for _ in 0..insert {
                blocks[0].next(bits, numbers);
                bits.symbol(numbers.one_of(&literals));
            }
            let reach = (len + insert).min((1 << window) - 16);
            len += insert + copy;
            if symbol < 128 {
                continue;
            }
            let context = 4 * blocks[2].next(bits, numbers) + copy.min(5) - 2;
            let code = &distances[distance_map[context]];
            let words = WORD_BITS.get(copy.wrapping_sub(4)).map_or(0, |it| 1 << it);
            loop {
                let symbol = numbers.below(code.len());
                let far = symbol.saturating_sub(16 + direct);
                let extra_bits = if symbol < 16 + direct {
                    0
                } else {
                    1 + (far >> (postfix + 1)) as u32
                };
                let extra = numbers.below(1 << extra_bits);
                let offset = ((2 + (far >> postfix & 1)) << extra_bits) + extra;
                let distance = match symbol {
                    ..4 => recent[symbol],
                    4..16 => recent[symbol / 10]
                        .wrapping_add_signed([-1, 1, -2, 2, -3, 3][(symbol - 4) % 6]),
                    _ if extra_bits == 0 => symbol - 15,
                    _ => ((offset - 4) << postfix) + far % (1 << postfix) + direct + 1,
                };
                if (least_distance..=reach + words).contains(&distance) {
                    bits.symbol(code[symbol]);
                    bits.put(extra, extra_bits);
                    if symbol != 0 && distance <= reach {
                        recent = [distance, recent[0], recent[1], recent[2]];
                    }
                    break;
                }
            }
        }
        all.meta_block(len - start, false);
        all.0.append(&mut bits.0);
    }
    all.put(3, 2);
    let byte = |bits: &[bool]| bits.iter().rfold(0, |all, &bit| all << 1 | u8::from(bit));
    (all.0.chunks(8).map(byte).collect(), len)
}
