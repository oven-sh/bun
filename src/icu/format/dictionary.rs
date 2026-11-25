//! A trie of words for break iterators. It is read where it is.

pub const DATA_FORMAT: [u8; 4] = *b"BDic";

pub const PAGE_SHIFT: u32 = 7;
/// In the entry of a code unit: the lower bits are not a symbol, but the value of the only word that has the unit.
pub const IS_LONE: u16 = 0x8000;
pub const BLOCK_SHIFT: u32 = 6;
pub const VALUE_BITS: u32 = 7;
/// The value is among the rare ones.
pub const RARE_VALUE: u32 = (1 << VALUE_BITS) - 1;
/// The sizes of the fields of an entry of `seconds_index`, from the lowest bit on.
pub const SECONDS_FIELDS: [u32; 3] = [18, 18, 4];
pub const SECONDS_ENTRY_SIZE: u32 = 5;
/// There are maps if there are fewer symbols.
pub const MAX_MAPPED_SYMBOLS: usize = 128 - 16;
/// Flags of a map.
pub const ENDS_WORD: u16 = 0x8000;
pub const HAS_CHILDREN: u16 = 0x4000;

/// The item after its header: these fields in 32 bits each, then the parts, of which the fields have the offsets.
/// The nodes after two code units, or three if there are maps, have the first numbers and no labels. The others follow by depth.
#[derive(Clone, Copy)]
pub struct Dictionary<'a> {
    bytes: &'a [u8],
    /// A byte for each page of code units.
    pages: &'a [u8; 0x10000 >> PAGE_SHIFT],
    /// For each unit of the pages: 0, or a symbol, or `IS_LONE`.
    entries: u32,
    /// A byte for each symbol: 0, or the value of the word plus one.
    symbol_values: u32,
    /// The symbols from this one on start no longer words.
    first_symbols: u32,
    /// For each such symbol and the end: an offset in `seconds`, the first node, and the number of low bits.
    seconds_index: u32,
    /// The symbols that can follow: their low bits, then for each value of the high bits as many ones and a zero.
    seconds: u32,
    /// For the nodes after one and after two code units: flags and the first child in 16 bits, and a bit for each symbol.
    maps: u32,
    map_size: u32,
    unlabelled: u32,
    /// For 64 nodes: which have children, which end words, the first child, and the number of words before if `values` is not 0.
    blocks: u32,
    block_size: u32,
    /// A bit for each label and the end: whether it is the first of its parent.
    firsts: u32,
    labels: u32,
    label_bits: u32,
    /// A symbol from this one on takes two labels: of the symbol less this, the high bits plus `escape`, and the low bits.
    rare_symbols: u32,
    escape: u32,
    /// For each other symbol and the end: its label. Those up to the next one are for the symbol and more code units.
    symbol_labels: u32,
    /// For each label and the end: the index in `tails`.
    tails_index: u32,
    tails: u32,
    values: u32,
    /// For the nodes without labels and for the others.
    common_values: u32,
    /// The number of the word and, in the lowest byte, its value.
    rare_values: &'a [[u8; 4]],
}

const ONES: u64 = u64::MAX / 0xff;

/// By byte and `n`: the position of the bit that has `n` set bits before it.
static SELECT_IN_BYTE: [[u8; 8]; 256] = {
    let (mut table, mut i) = ([[0; 8]; 256], 0);
    while let Some((_, [row, ..])) = table.split_at_mut_checked(i / 8) {
        let (byte, bit) = (i / 8, i % 8);
        let before = (byte & ((1 << bit) - 1)).count_ones() as usize;
        if byte >> bit & 1 != 0
            && let Some((_, [position, ..])) = row.split_at_mut_checked(before)
        {
            *position = bit as u8;
        }
        i += 1;
    }
    table
};

/// Returns the position of the set bit that has `n` set bits before it.
#[inline(always)]
fn select(bits: u64, n: u32) -> u32 {
    let pairs = bits - (bits >> 1 & (0x55 * ONES));
    let nibbles = (pairs & (0x33 * ONES)) + (pairs >> 2 & (0x33 * ONES));
    let sums = ((nibbles + (nibbles >> 4)) & (0x0f * ONES)).wrapping_mul(ONES);
    let not_past = (((u64::from(n) * ONES) | (0x80 * ONES)) - sums) & (0x80 * ONES);
    let shift = not_past.count_ones() * 8 % 64;
    let left = n.wrapping_sub((sums << 8 >> shift) as u32) as usize % 8;
    let row = SELECT_IN_BYTE.get(usize::from((bits >> shift) as u8));
    shift + u32::from(row.and_then(|it| it.get(left)).copied().unwrap_or(0))
}

/// The number of bits that one read is sure to give.
const WINDOW: u32 = 56;

impl<'a> Dictionary<'a> {
    pub const FIELDS: usize = 22;

    /// At least eight bytes follow the last part, and all bits of them are set.
    pub fn new(bytes: &'a [u8]) -> Option<Self> {
        let fields: &[_; Dictionary::FIELDS] = bytes.as_chunks().0.first_chunk()?;
        let [
            pages,
            entries,
            symbol_values,
            seconds_index,
            seconds,
            maps,
            blocks,
            firsts,
            labels,
            symbol_labels,
            tails_index,
            tails,
            values,
            common_values,
            rare_values,
            end,
            first_symbols,
            unlabelled,
            map_size,
            label_bits,
            rare_symbols,
            escape,
        ] = fields.map(u32::from_le_bytes);
        let has_values = common_values != rare_values;
        Some(Self {
            bytes,
            pages: bytes.get(pages as usize..)?.first_chunk()?,
            entries,
            symbol_values,
            first_symbols,
            seconds_index,
            seconds,
            maps,
            map_size,
            unlabelled,
            blocks,
            block_size: if has_values { 22 } else { 19 },
            firsts,
            labels,
            label_bits,
            rare_symbols,
            escape,
            symbol_labels,
            tails_index,
            tails,
            values: if has_values { values } else { 0 },
            common_values,
            rare_values: bytes.get(rare_values as usize..end as usize)?.as_chunks().0,
        })
    }

    #[inline(always)]
    fn read(&self, offset: u32) -> u64 {
        let bytes = self.bytes.get(offset as usize..offset as usize + 8);
        let bytes = bytes.and_then(|it| it.first_chunk());
        bytes.map_or(u64::MAX, |&it| u64::from_le_bytes(it))
    }

    #[inline(always)]
    fn bits(&self, part: u32, bit: u32) -> u64 {
        self.read(part + bit / 8) >> (bit % 8)
    }

    #[inline(always)]
    fn field(&self, part: u32, index: u32, width: u32) -> u32 {
        self.bits(part, index * width) as u32 & ((1 << width) - 1)
    }

    /// Returns two 16-bit numbers.
    #[inline(always)]
    fn range(&self, part: u32, index: u32) -> [u32; 2] {
        let both = self.read(part + 2 * index);
        [both as u16, (both >> 16) as u16].map(u32::from)
    }

    #[inline(always)]
    fn entry(&self, unit: u16) -> u32 {
        let page = self.pages.get(usize::from(unit >> PAGE_SHIFT)).copied();
        let slot = u32::from(page.unwrap_or(0)) << PAGE_SHIFT;
        (self.read(self.entries + 2 * (slot + u32::from(unit % (1 << PAGE_SHIFT)))) as u16).into()
    }

    /// Returns the position of the bit from `from` on that has `n` like it before it. `flip` turns them into set bits.
    #[inline(always)]
    fn select(&self, part: u32, mut from: u32, mut n: u32, flip: u64) -> u32 {
        loop {
            let bits = (self.bits(part, from) ^ flip) % (1 << WINDOW);
            if n < bits.count_ones() {
                return from + select(bits, n);
            }
            (from, n) = (from + WINDOW, n - bits.count_ones());
        }
    }

    /// Returns the number of bits from `from` on before the first that `flip` turns into a set bit.
    #[inline(always)]
    fn run_length(&self, part: u32, from: u32, flip: u64) -> u32 {
        let mut length = 0;
        loop {
            match (self.bits(part, from + length) ^ flip) % (1 << WINDOW) {
                0 => length += WINDOW,
                bits => return length + bits.trailing_zeros(),
            }
        }
    }

    /// Returns the index of the last of `count` rising fields that is not above `limit`, or of the first, and the field.
    #[inline(always)]
    fn search(
        &self,
        (part, width): (u32, u32),
        (mut first, mut count): (u32, u32),
        limit: u32,
    ) -> (u32, u32) {
        while count > 1 {
            let half = count / 2;
            let is_above = self.field(part, first + half, width) > limit;
            first = core::hint::select_unpredictable(is_above, first, first + half);
            count -= half;
        }
        (first, self.field(part, first, width))
    }

    /// Returns the node after two symbols, and the number of symbols read.
    #[inline(always)]
    fn second(&self, first: u32, second: u32) -> (Option<u32>, usize) {
        let [offset_bits, node_bits, low_bits] = SECONDS_FIELDS;
        let [(offset, node, width), (end, node_end, _)] = [first - 1, first].map(|i| {
            let entry = self.read(self.seconds_index + SECONDS_ENTRY_SIZE * i);
            let field = |shift: u32, bits: u32| (entry >> shift) as u32 % (1 << bits);
            let width = field(offset_bits + node_bits, low_bits);
            (field(0, offset_bits), field(offset_bits, node_bits), width)
        });
        let (part, count) = (self.seconds + offset, node_end - node);
        let (high_part, high) = (count * width, second >> width);
        if high >= 8 * (end - offset) - high_part - count {
            return (None, 1 + usize::from(count != 0));
        }
        let ones = match high.checked_sub(1) {
            Some(before) => self.select(part, high_part, before, u64::MAX) + 1,
            None => high_part,
        };
        let candidates = (
            ones - high_part - high,
            self.run_length(part, ones, u64::MAX),
        );
        let low = second % (1 << width);
        let (index, found) = self.search((part, width), candidates, low);
        (
            (found == low && candidates.1 != 0).then_some(node + index),
            2,
        )
    }

    /// Returns the first node without a label on the way, and the number of units read.
    #[inline(always)]
    fn start(&self, text: &[u16], found: &mut impl FnMut(usize, u8)) -> (Option<u32>, usize) {
        let Some(&unit) = text.first() else {
            return (None, 0);
        };
        let first = self.entry(unit);
        if first >= IS_LONE.into() {
            found(1, first as u8);
            return (None, 1);
        }
        if self.map_size != 0 {
            let mut node = first;
            for length in 1..3 {
                let map = self.maps + self.map_size * node;
                let [low, high] = [map, map + 8].map(|it| self.read(it));
                if low as u16 & ENDS_WORD != 0 {
                    found(length, 0);
                }
                let Some(&unit) = text.get(length).filter(|_| low as u16 & HAS_CHILDREN != 0)
                else {
                    return (None, length);
                };
                let (position, symbols) = (self.entry(unit) + 16, low & !0xffff);
                let (bits, before) = match position {
                    ..64 => (symbols, 0),
                    _ => (high, symbols.count_ones()),
                };
                let bit = 1 << (position % 64);
                if bits & bit == 0 || position >= 128 {
                    return (None, length + 1);
                }
                node = u32::from(low as u16 % HAS_CHILDREN) + before + (bits % bit).count_ones();
            }
            return (Some(node), 3);
        }
        if let Some(value) = (self.read(self.symbol_values + first) as u8).checked_sub(1) {
            found(1, value);
        }
        match text
            .get(1)
            .filter(|_| (1..self.first_symbols).contains(&first))
        {
            Some(&unit) => self.second(first, self.entry(unit)),
            None => (None, 1),
        }
    }

    /// Returns the first label and the number of labels below a node that has children.
    #[inline(always)]
    fn children(&self, block: u32, parents_before: u64) -> (u32, u32) {
        let (mut from, mut n) = (
            self.read(block + 16) as u32 % (1 << 24),
            parents_before.count_ones(),
        );
        loop {
            let bits = self.bits(self.firsts, from) % (1 << WINDOW);
            if n < bits.count_ones() {
                let at = select(bits, n);
                return (
                    from + at,
                    1 + match bits >> at >> 1 {
                        0 => self.run_length(self.firsts, from + at + 1, 0),
                        after => after.trailing_zeros(),
                    },
                );
            }
            (from, n) = (from + WINDOW, n - bits.count_ones());
        }
    }

    #[inline(always)]
    fn block(&self, node: u32) -> u32 {
        self.blocks + self.block_size * (node >> BLOCK_SHIFT)
    }

    #[inline(always)]
    fn value(&self, node: u32, block: u32, words_before: u64) -> u8 {
        if self.values == 0 {
            return 0;
        }
        let word = self.read(block + 19) as u32 % (1 << 24) + words_before.count_ones();
        match self.field(self.values, word, VALUE_BITS) {
            RARE_VALUE => self.rare_value(word),
            common if node < self.unlabelled => self.read(self.common_values + common) as u8,
            common => self.read(self.common_values + RARE_VALUE + common) as u8,
        }
    }

    #[cold]
    #[inline(never)]
    fn rare_value(&self, word: u32) -> u8 {
        let is_before = |it: &[u8; 4]| u32::from_le_bytes(*it) >> 8 < word;
        let found = self
            .rare_values
            .get(self.rare_values.partition_point(is_before));
        found.map_or(0, |&[value, ..]| value)
    }

    /// Returns the index of the second label.
    #[cold]
    #[inline(never)]
    fn rare_child(&self, children: (u32, u32), symbol: u32) -> Option<u32> {
        let (labels, rare) = ((self.labels, self.label_bits), symbol - self.rare_symbols);
        let high = self.escape + (rare >> self.label_bits);
        let (index, label) = self.search(labels, children, high);
        let node = (label == high).then_some(self.unlabelled + index)?;
        let (block, low) = (self.block(node), rare % (1 << self.label_bits));
        let children = self.children(block, self.read(block) % (1 << (node % 64)));
        let (index, label) = self.search(labels, children, low);
        (label == low).then_some(index)
    }

    /// Calls `found(length, value)` for each word that starts `text`, shortest first. Returns the number of units read.
    #[inline(always)]
    pub fn matches(&self, text: &[u16], mut found: impl FnMut(usize, u8)) -> usize {
        let (node, mut length) = self.start(text, &mut found);
        let Some(mut node) = node else {
            return length;
        };
        loop {
            let (block, bit) = (self.block(node), 1 << (node % 64));
            let (parents, words) = (self.read(block), self.read(block + 8));
            if words & bit != 0 {
                found(length, self.value(node, block, words % bit));
            }
            let Some(&unit) = text.get(length).filter(|_| parents & bit != 0) else {
                return length;
            };
            length += 1;
            let (symbol, children) = (self.entry(unit), self.children(block, parents % bit));
            let index = if symbol < self.rare_symbols {
                let [alone, end] = self.range(self.symbol_labels, symbol);
                let labels = (self.labels, self.label_bits);
                let (index, label) = self.search(labels, children, end.wrapping_sub(1));
                if !(alone..end).contains(&label) {
                    return length;
                }
                if label != alone {
                    let [start, end] = self.range(self.tails_index, label);
                    for i in start..end {
                        let Some(&unit) = text.get(length) else {
                            return length;
                        };
                        length += 1;
                        if unit != self.read(self.tails + 2 * i) as u16 {
                            return length;
                        }
                    }
                }
                index
            } else if symbol < IS_LONE.into()
                && let Some(index) = self.rare_child(children, symbol)
            {
                index
            } else {
                return length;
            };
            node = self.unlabelled + index;
        }
    }
}
