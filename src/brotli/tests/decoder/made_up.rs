pub(super) struct Random(pub(super) u64);

impl Random {
    pub(super) fn below(&mut self, end: usize) -> usize {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mixed = (self.0 ^ (self.0 >> 32)).wrapping_mul(0xD6E8_FEB8_6659_FD93);
        (mixed ^ (mixed >> 32)) as usize % end
    }
}

struct Writer {
    bits: Vec<bool>,
    random: Random,
}

impl Writer {
    fn put(&mut self, count: usize, value: usize) {
        self.bits
            .extend((0..count).map(|bit| (value >> bit) % 2 != 0));
    }

    fn put_random(&mut self, count: usize) -> usize {
        let value = self.random.below(1 << count);
        self.put(count, value);
        value
    }

    fn put_count(&mut self, count: usize) {
        match (count - 1).checked_ilog2() {
            None => self.put(1, 0),
            Some(n) => self.put(
                4 + n as usize,
                1 + 2 * n as usize + 16 * (count - 1 - (1 << n)),
            ),
        }
    }

    fn put_symbol(&mut self, lengths: &[usize], symbol: usize) {
        let before =
            |&(other, &length): &(usize, &usize)| (length, other) < (lengths[symbol], symbol);
        let space = |(_, &length): (usize, &usize)| (1 << 15 >> length) % (1 << 15);
        let code: usize = lengths.iter().enumerate().filter(before).map(space).sum();
        self.put(
            lengths[symbol],
            usize::from((code as u16).reverse_bits() / 2),
        );
    }

    /// For `count` of `symbols`, which is two or more. Returns the lengths.
    fn put_code(&mut self, mut symbols: Vec<usize>, count: usize) -> Vec<usize> {
        let (mut leaves, shape) = (vec![1, 1], self.random.below(3));
        while leaves.len() < count.min(symbols.len()) {
            let at = match shape {
                0 => 0,
                1 if self.random.below(4) != 0 => leaves.len() - 1,
                _ => self.random.below(leaves.len()),
            };
            if leaves[at] < 15 {
                let depth = leaves.remove(at) + 1;
                leaves.extend([depth; 2]);
            }
        }
        let mut lengths = Vec::new();
        for length in leaves {
            let symbol = symbols.swap_remove(self.random.below(symbols.len()));
            lengths.resize(lengths.len().max(symbol + 1), 0);
            lengths[symbol] = length;
        }
        let for_lengths: Vec<_> = (0..18).map(|it| 4 + usize::from(it >= 14)).collect();
        self.put(2, 0);
        for symbol in [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15] {
            let (count, value) = [(2, 1), (4, 15)][for_lengths[symbol] - 4];
            self.put(count, value);
        }
        for run in lengths.chunk_by(|a, b| a == b) {
            let (symbol, extra_bits) = if run[0] == 0 { (17, 3) } else { (16, 2) };
            let plain = if run.len() < 4 {
                run.len()
            } else {
                17 - symbol
            };
            for _ in 0..plain {
                self.put_symbol(&for_lengths, run[0]);
            }
            let (mut rest, mut digits) = ((run.len() - plain).saturating_sub(2), Vec::new());
            while rest != 0 {
                digits.push((rest - 1) % (1 << extra_bits));
                rest = (rest - 1) >> extra_bits;
            }
            for digit in digits.into_iter().rev() {
                self.put_symbol(&for_lengths, symbol);
                self.put(extra_bits, digit);
            }
        }
        lengths
    }

    fn put_context_map(&mut self, size: usize, group: usize) -> usize {
        let trees = [1, 2, 3, 9][self.random.below(4)];
        self.put_count(trees);
        if trees > 1 {
            self.put(1, 0);
            let lengths = self.put_code((0..trees).collect(), trees);
            let (mut tree, mut changes) = (0, 0);
            for at in 0..size {
                if at % group == 0 {
                    (tree, changes) = (self.random.below(trees), self.random.below(3));
                } else if self.random.below(16) < 4 * changes * changes {
                    tree = self.random.below(trees);
                }
                self.put_symbol(&lengths, tree);
            }
            self.put_random(1);
        }
        trees
    }
}

/// Complete codes make sense of any bits. Without a `total` length, the input ends first.
pub(super) fn made_up(seed: u64, total: Option<usize>) -> Vec<u8> {
    let mut w = Writer {
        bits: Vec::new(),
        random: Random(seed << 32),
    };
    let window_bits = [10, 11, 15, 16][w.random.below(4)];
    match window_bits {
        16 => w.put(1, 0),
        _ => w.put(7, 1 + 16 * (window_bits - 8)),
    }
    let stored = [0, 1, 700, 1024, 3000][w.random.below(5)];
    if stored != 0 {
        w.put(20, (1 << 19) + 8 * (stored - 1));
        w.bits.resize(w.bits.len().next_multiple_of(8), false);
        for _ in 0..stored {
            w.put_random(8);
        }
    }
    let length = total.map_or(1 << 22, |total| total.max(stored + 1) - stored) - 1;
    let nibbles = (length.max(1).ilog2() as usize / 4 + 1).max(4);
    w.put(4 + 4 * nibbles, 1 + 4 * (nibbles - 4) + 16 * length);

    let types = [(); 3].map(|()| {
        let types = [1, 1, 2, 5][w.random.below(4)];
        w.put_count(types);
        if types > 1 {
            w.put_code((0..types + 2).collect(), types + 2);
            let shortest = w.random.below(13);
            let lengths = w.put_code((shortest..21).collect(), 21);
            w.put_symbol(&lengths, 12);
            w.put_random(5);
        }
        types
    });
    let params = w.random.below(64) * w.random.below(2);
    let (postfix_bits, direct_codes) = (params % 4, (params / 4) << (params % 4));
    w.put(6, params);
    let mode = w.random.below(4);
    for _ in 0..types[0] {
        let other = w.random.below(32);
        w.put(2, if other < 4 { other } else { mode });
    }
    let literal_trees = w.put_context_map(64 * types[0], 64);
    let distance_trees = w.put_context_map(4 * types[2], 4);

    for _ in 0..literal_trees {
        let count = [2, 17, 64, 66, 200, 256][w.random.below(6)];
        w.put_code((0..256).collect(), count);
    }
    let has_words = stored < 2 || w.random.below(3) == 0;
    let max_insert = [3, 8, 12, 21][w.random.below(4)];
    let copies = if has_words { 2..12 } else { 0..21 };
    for _ in 0..types[1] {
        let insert = |it: usize| [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16][it / 64] + it / 8 % 8;
        let copy = |it: usize| [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16][it / 64] + it % 8;
        let fit = (0..704).filter(|&it| insert(it) <= max_insert && copies.contains(&copy(it)));
        let count = 2 + w.random.below(400);
        w.put_code(fit.collect(), count);
    }
    let groups = 2 * (if has_words { 11 } else { 7 } - postfix_bits);
    for _ in 0..distance_trees {
        let size = 16 + direct_codes + (groups << postfix_bits);
        let (count, subtracts) = (2 + w.random.below(size), w.random.below(8) == 0);
        let fit = (0..size).filter(|it| subtracts || !(4..16).contains(it) || it % 2 != 0);
        w.put_code(fit.collect(), count);
    }
    for _ in 0..[20, 300, 3000][w.random.below(3)] {
        w.put_random(8);
    }
    let byte = |bits: &[bool]| bits.iter().rfold(0, |byte, &bit| 2 * byte + u8::from(bit));
    w.bits.chunks(8).map(byte).collect()
}
