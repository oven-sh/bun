//! The coefficients as bits whose probabilities are only known once all of them have been seen.

use core::hint::{cold_path, select_unpredictable};

use bun_highway::webp::MAX_SYMBOL;

use super::bool_writer::{BoolWriter, Symbol};
use super::cost::{LEVELS, bit_cost};
use crate::array::At;
use crate::error::Result;
use crate::lossy::tables::{
    BANDS, CATEGORY_3_TO_6, COEFFICIENT_UPDATE_PROBABILITIES, DEFAULT_COEFFICIENT_PROBABILITIES,
    ZIGZAG,
};
use crate::lossy::{BlockType, CoefficientProbabilities};
use crate::slice::{InBounds, known};
use crate::vec;

/// The quantized coefficients of a block.
#[derive(Default)]
pub(super) struct Residual {
    /// By row.
    pub(super) levels: [i16; 16],
    /// As in `bun_highway::webp::Candidates`.
    pub(super) symbols: [u8; 16],
    /// As in `bun_highway::webp::LumaCandidates`.
    pub(super) end: u8,
}

impl Residual {
    pub(super) const fn is_non_zero(&self) -> bool {
        self.end >= 4
    }
}

/// Twice the number of a node, plus the bit. The nodes are those of `CoefficientProbabilities`, then one for each fixed
/// probability.
type Token = u16;

const NODES: usize = 4 * 8 * 3 * 11;
/// For the tokens of a block, and those that are written only to be overwritten.
const ROOM: usize = 512 + 8;

const fn fixed(bit: bool, probability: u8) -> Token {
    (NODES as u16 + probability as u16) << 1 | bit as u16
}

/// The first node for the first context, by `BlockType` and position, 8 times over.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static ROOTS: [[[Token; 8]; 16]; 4] = {
    let mut roots = [[[0; 8]; 16]; 4];
    let mut i = 0;
    while i < 4 * 16 {
        let band = if i == 0 { BANDS[1] } else { BANDS[i % 16] };
        roots[i / 16][i % 16] = [2 * 3 * 11 * (band as u16 + 8 * (i / 16) as u16); 8];
        i += 1;
    }
    roots
};

/// The tokens for a symbol, other than the sign.
#[derive(Clone, Copy)]
struct Runs {
    /// Counted from the root.
    path: [Token; 8],
    /// Missing for `MAX_SYMBOL`.
    extra_bits: [Token; 8],
}

/// Where the parts of the tokens for a symbol end.
#[derive(Clone, Copy)]
struct Ends {
    path: u8,
    extra_bits: u8,
    /// Zero for `MAX_SYMBOL`.
    sign: u8,
}

const NO_TOKENS: (Runs, Ends) = (
    Runs {
        path: [0; 8],
        extra_bits: [0; 8],
    },
    Ends {
        path: 0,
        extra_bits: 0,
        sign: 0,
    },
);

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/token_enc.c#L117
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn tokens_for(context: usize, level: usize) -> (Runs, Ends) {
    const fn branch(
        (runs, ends): &mut (Runs, Ends),
        context: usize,
        node: usize,
        bit: bool,
    ) -> bool {
        runs.path[ends.path as usize] = ((11 * context + node) as u16) << 1 | bit as u16;
        ends.path += 1;
        bit
    }
    const fn extra((runs, ends): &mut (Runs, Ends), bit: bool, probability: u8) {
        runs.extra_bits[ends.extra_bits as usize] = fixed(bit, probability);
        ends.extra_bits += 1;
    }
    let it = &mut { NO_TOKENS };
    if context != 0 {
        branch(it, context, 0, true);
    }
    if !branch(it, context, 1, level != 0) || !branch(it, context, 2, level > 1) {
    } else if !branch(it, context, 3, level > 4) {
        if branch(it, context, 4, level != 2) {
            branch(it, context, 5, level == 4);
        }
    } else if !branch(it, context, 6, level > 10) {
        if !branch(it, context, 7, level > 6) {
            extra(it, level == 6, 159);
        } else {
            extra(it, level >= 9, 165);
            extra(it, level.is_multiple_of(2), 145);
        }
    } else {
        let category = (level - 3).ilog2() as usize - 3;
        let high = branch(it, context, 8, category >= 2);
        branch(it, context, 9 + high as usize, category % 2 == 1);
        let probabilities = CATEGORY_3_TO_6[category];
        let mut i = 0;
        while category < 3 && i < probabilities.len() {
            let bit = ((level - 3) >> (probabilities.len() - 1 - i)) & 1;
            extra(it, bit != 0, probabilities[i]);
            i += 1;
        }
    }
    it.1.extra_bits += it.1.path;
    if level != LEVELS - 1 {
        it.1.sign = it.1.extra_bits + (level != 0) as u8;
    }
    *it
}

#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static SYMBOLS: ([Runs; 256], [Ends; 256]) = {
    let mut symbols = ([NO_TOKENS.0; 256], [NO_TOKENS.1; 256]);
    let mut symbol = 0;
    while symbol < 3 * LEVELS {
        (symbols.0[symbol], symbols.1[symbol]) = tokens_for(symbol / LEVELS, symbol % LEVELS);
        symbol += 1;
    }
    symbols
};

#[inline(always)]
fn put<const N: usize>(room: &mut [Token; ROOM], at: usize, tokens: [Token; N]) {
    room.set_chunk(at % (ROOM - 8), tokens);
}

/// Returns how many tokens there are.
#[inline(always)]
fn put_block(room: &mut [Token; ROOM], block_type: BlockType, residual: &Residual) -> usize {
    let mut len = 0;
    let roots = ROOTS.at(block_type as usize);
    let end = usize::from(residual.end / 4);
    if end != 0 {
        let first = usize::from(matches!(block_type, BlockType::LumaWithoutDc));
        // `SYMBOLS` has no "not the end" for the first context, which elsewhere comes behind a zero.
        room[0] = roots[0][0] | 1;
        len = usize::from(*residual.symbols.at(first) <= MAX_SYMBOL);
        for position in first..end {
            let symbol = usize::from(*residual.symbols.at(position));
            let (runs, ends) = (SYMBOLS.0.at(symbol), SYMBOLS.1.at(symbol));
            let (level, root) = (
                *residual.levels.at((*ZIGZAG.at(position)).into()),
                roots.at(position),
            );
            put::<8>(
                room,
                len,
                core::array::from_fn(|i| runs.path.at(i) + root.at(i)),
            );
            put(room, len + usize::from(ends.path), runs.extra_bits);
            put(
                room,
                len + usize::from(ends.extra_bits),
                [fixed(level < 0, 128)],
            );
            len += usize::from(ends.sign);
            if ends.sign == 0 {
                len += usize::from(ends.path);
                for token in last_category(level) {
                    put(room, len, [token]);
                    len += 1;
                }
            }
        }
    }
    put(
        room,
        len,
        [roots.at(end % 16)[0] + 2 * 11 * u16::from(residual.end % 4)],
    );
    len + usize::from(end < 16)
}

pub(super) struct Tokens {
    full_pages: Vec<Vec<Token>>,
    page: Vec<Token>,
    page_len: usize,
    /// How much of `page` is in use.
    len: usize,
    /// How much of it is in `statistics`.
    counted: usize,
    /// For each node, how often it was visited in the upper half and how often with a 1 in the lower.
    statistics: Box<[u32; 2048]>,
}

impl Tokens {
    pub(super) fn new(macroblocks: usize) -> Result<Self> {
        Ok(Self {
            full_pages: Vec::new(),
            page: Vec::new(),
            page_len: (macroblocks * 64).clamp(1 << 11, 1 << 15),
            len: 0,
            counted: 0,
            statistics: vec::array(0)?,
        })
    }

    #[cold]
    fn turn_page(&mut self) -> Result<()> {
        self.count();
        self.full_pages.try_reserve(1)?;
        let mut full = core::mem::replace(&mut self.page, vec::filled(0, self.page_len)?);
        full.truncate(self.len);
        self.full_pages.push(full);
        (self.len, self.counted) = (0, 0);
        Ok(())
    }

    pub(super) fn record(&mut self, block_type: BlockType, residuals: &[Residual]) -> Result<()> {
        for residual in residuals {
            if self.page.len() - self.len < ROOM {
                self.turn_page()?;
            }
            let room = self.page.get_mut(self.len..);
            let room = known(room.and_then(<[_]>::first_chunk_mut));
            self.len += room.map_or(0, |room| put_block(room, block_type, residual));
        }
        Ok(())
    }

    fn count(&mut self) {
        for &token in self.page.part(self.counted..self.len) {
            let counts = self.statistics.at_mut(usize::from(token >> 1));
            if *counts >= 0xfffe_0000 {
                cold_path();
                *counts = ((*counts + 1) >> 1) & 0x7fff_7fff;
            }
            *counts += 0x1_0000 + u32::from(token & 1);
        }
        self.counted = self.len;
    }

    /// The probabilities that suit the tokens so far, where they are worth storing.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/frame_enc.c#L151
    pub(super) fn probabilities(&mut self) -> CoefficientProbabilities {
        self.count();
        let mut probabilities = DEFAULT_COEFFICIENT_PROBABILITIES;
        let nodes = probabilities
            .as_flattened_mut()
            .as_flattened_mut()
            .as_flattened_mut();
        let updates = COEFFICIENT_UPDATE_PROBABILITIES
            .as_flattened()
            .as_flattened()
            .as_flattened();
        let trees = nodes.as_chunks_mut::<11>().0.iter_mut();
        let trees = trees
            .zip(updates.as_chunks::<11>().0)
            .zip(self.statistics.as_chunks::<11>().0);
        // Every way through a tree takes in one of the first two nodes.
        for ((tree, updates), counts) in
            trees.filter(|(_, [first, second, ..])| first | second != 0)
        {
            // The quotient is rounded too finely to reach the next integer.
            let shares = counts.map(|it| ((it & 0xffff) as f32 * 255.0 / (it >> 16) as f32) as i32);
            for (((probability, &update), counts), share) in
                tree.iter_mut().zip(updates).zip(counts).zip(shares)
            {
                let (ones, total) = (counts & 0xffff, counts >> 16);
                let cost = |probability| {
                    ones * u32::from(bit_cost(true, probability))
                        + (total - ones) * u32::from(bit_cost(false, probability))
                };
                let new = (255 - share) as u8;
                let old_cost = cost(*probability) + u32::from(bit_cost(false, update));
                let new_cost = cost(new) + u32::from(bit_cost(true, update)) + 8 * 256;
                *probability = select_unpredictable(old_cost > new_cost, new, *probability);
            }
        }
        probabilities
    }

    /// As the last partition of `frame`, which is padded to an even length.
    #[inline(never)]
    pub(super) fn append_to(
        mut self,
        frame: Vec<u8>,
        probabilities: &CoefficientProbabilities,
    ) -> Result<Vec<u8>> {
        let mut symbols = vec::array::<_, 4096>(Symbol(0))?;
        let (adaptive, fixed) = symbols.split_at_mut(2 * NODES);
        let probabilities = probabilities.as_flattened().as_flattened().as_flattened();
        for (to, &probability) in adaptive.as_chunks_mut().0.iter_mut().zip(probabilities) {
            *to = [false, true].map(|bit| Symbol::new(bit, probability));
        }
        for (to, symbol) in fixed.iter_mut().zip(0..512) {
            *to = Symbol(symbol);
        }
        self.page.truncate(self.len);
        let mut writer = BoolWriter::new(frame);
        for page in self.full_pages.into_iter().chain([self.page]) {
            writer.write_all(page.iter().map(|&token| *symbols.at(token.into())));
        }
        let mut frame = writer.finish()?;
        frame.try_reserve(1)?;
        frame.resize(frame.len().next_multiple_of(2), 0);
        Ok(frame)
    }
}

/// The extra bits of a magnitude from `MAX_SYMBOL` on, and the sign.
#[cold]
fn last_category(level: i16) -> [Token; 12] {
    let magnitude = level.unsigned_abs();
    let mut tokens = [fixed(level < 0, 128); 12];
    let bits = CATEGORY_3_TO_6[3].iter().zip((0..11).rev());
    for (token, (&probability, bit)) in tokens.iter_mut().zip(bits) {
        *token = fixed(
            ((magnitude - u16::from(MAX_SYMBOL)) >> bit) & 1 != 0,
            probability,
        );
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_lead_to_their_level() {
        // RFC 6386 section 13.2. A leaf is minus the lowest level that it stands for.
        const TREE: [[i8; 2]; 11] = [
            [i8::MIN, 1],
            [0, 2],
            [-1, 3],
            [4, 6],
            [-2, 5],
            [-3, -4],
            [7, 8],
            [-5, -7],
            [9, 10],
            [-11, -19],
            [-35, -67],
        ];
        for symbol in 0..3 * LEVELS {
            let (context, level) = (symbol / LEVELS, symbol % LEVELS);
            let (runs, ends) = tokens_for(context, level);
            let mut node = i8::from(context == 0);
            for &token in runs.path.part(..ends.path.into()) {
                assert_eq!(usize::from(token / 2), 11 * context + node as usize);
                node = *TREE.at(node as usize).at((token % 2).into());
            }
            let extra_bits = runs.extra_bits.part(..(ends.extra_bits - ends.path).into());
            let extra = extra_bits.iter().fold(0, |sum, it| 2 * sum + it % 2);
            assert_eq!(-node as usize + usize::from(extra), level);
        }
    }
}
