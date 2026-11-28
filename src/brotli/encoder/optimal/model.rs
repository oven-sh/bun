//! What symbols are likely to cost, going by the commands so far.

use core::array::from_fn;

use crate::context::{DISTANCE_CONTEXTS, LITERAL_CONTEXTS};
use crate::encoder::command::{Command, codes_of_short_lengths, combine_length_codes};
use crate::encoder::log2::fixed_point_log2 as log2;
use crate::encoder::matching::array_at;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, CommandCodes, FIRST_COMMAND_WITH_DISTANCE,
    INSERT_LENGTH_CODES, LITERAL_SYMBOLS, LengthCode,
};

pub(super) type Cost = i32;
/// Costs leave so many low bits free.
pub(super) const FREE_BITS: u32 = 11;
const FRACTION_BITS: u32 = 4;
pub(super) const BIT: Cost = 1 << (FREE_BITS + FRACTION_BITS);
pub(super) const LANES: usize = 8;
pub(super) const CODES: usize = 24;
/// Copy lengths up to here have a cost in a table.
pub(super) const TABULATED: usize = 120;
pub(super) const RUNS: usize = 64;
const CELL: usize = 8;
/// Without postfix bits and direct codes.
pub(super) const DISTANCE_SYMBOLS: usize = 128;
/// One for each insert code, and then for those that can go without a distance symbol.
pub(super) const ROWS: usize = CODES + CELL;
/// In [`Model::distances`].
pub(super) const NO_SYMBOL: usize = DISTANCE_SYMBOLS - 1;

/// Plus a constant. Straight between the powers of two.
#[inline(always)]
fn rough_log2(value: f32) -> Cost {
    (value.to_bits() >> (f32::MANTISSA_DIGITS - 1 - FRACTION_BITS) << FREE_BITS) as Cost
}

/// Of a difference between results of [`log2`].
#[inline(always)]
fn rounded(bits: i32) -> Cost {
    const DROPPED: u32 = f32::MANTISSA_DIGITS - 1 - FRACTION_BITS;
    (bits + (1 << (DROPPED - 1))) >> DROPPED << FREE_BITS
}

#[inline(always)]
fn symbol_cost(log2_total: i32, count: f32) -> Cost {
    rounded(log2_total - log2(count)).clamp(BIT, 13 * BIT)
}

/// Where [`Margins`] have the kind of distance, the insert code, and the first copy code.
static CELLS: [[u8; 4]; COMMAND_SYMBOLS / CELL] = {
    let (mut cells, mut symbol) = ([[0; 4]; _], 0);
    while symbol < COMMAND_SYMBOLS {
        let CommandCodes { insert, copy } = CommandCodes::of(symbol);
        let kind = (symbol < FIRST_COMMAND_WITH_DISTANCE) as usize;
        cells[symbol / CELL] = [
            (KINDS + kind) as u8,
            (INSERTS + kind * CODES + insert) as u8,
            (COPIES + kind * CODES + copy) as u8,
            0,
        ];
        symbol += CELL;
    }
    cells
};

const fn extra_bits(codes: &[LengthCode; CODES]) -> [Cost; CODES] {
    let (mut costs, mut code) = ([0; _], 0);
    while code < CODES {
        costs[code] = codes[code].extra_bits as Cost * BIT;
        code += 1;
    }
    costs
}

/// How many of 1000 commands have each code. For another distance, and for the last one.
struct Guess {
    inserts: [[u16; CODES]; 2],
    copies: [[u16; CODES]; 2],
    short_codes: [u16; 16],
}

const GUESSED: f32 = 60.0;
/// The same for each of the other distance symbols.
const OTHER_DISTANCE: u16 = 35;

impl Guess {
    const fn margins(&self) -> Margins {
        let (mut margins, mut i) = ([OTHER_DISTANCE as f32; _], 0);
        (margins[KINDS], margins[KINDS + 1], margins[MADE_UP]) = (0.0, 0.0, 1000.0);
        while i < 2 * CODES {
            let (kind, code) = (i / CODES, i % CODES);
            margins[KINDS + kind] += self.inserts[kind][code] as f32;
            margins[INSERTS + i] = self.inserts[kind][code] as f32;
            margins[COPIES + i] = self.copies[kind][code] as f32;
            margins[DISTANCES + i % 16] = self.short_codes[i % 16] as f32;
            i += 1;
        }
        i = 0;
        while i < margins.len() {
            margins[i] *= GUESSED / 1000.0;
            i += 1;
        }
        margins
    }
}

/// Counts for one thing at a time, some of which are made up.
type Margins = [f32; 256];
const DISTANCES: usize = 0;
const INSERTS: usize = DISTANCES + DISTANCE_SYMBOLS;
const COPIES: usize = INSERTS + 2 * CODES;
const KINDS: usize = COPIES + 2 * CODES;
const MADE_UP: usize = KINDS + 2;

static GUESSES: [Margins; 2] = [
    Guess {
        inserts: [
            [
                150, 150, 45, 55, 25, 45, 60, 27, 40, 25, 28, 18, 22, 16, 22, 12, 10, 10, 8, 8, 4,
                2, 2, 1,
            ],
            [
                1, 100, 43, 19, 11, 8, 24, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
        ],
        copies: [
            [
                38, 300, 135, 93, 45, 50, 17, 15, 14, 11, 14, 14, 7, 5, 4, 3, 3, 2, 2, 5, 2, 2, 1,
                1,
            ],
            [
                45, 78, 15, 15, 10, 13, 3, 3, 6, 3, 12, 3, 3, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
        ],
        short_codes: [25, 80, 48, 34, 9, 6, 20, 14, 8, 3, 5, 5, 11, 11, 4, 2],
    }
    .margins(),
    Guess {
        inserts: [
            [
                510, 137, 92, 56, 38, 25, 30, 17, 14, 7, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            ],
            [
                2, 34, 13, 5, 3, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
        ],
        copies: [
            [
                5, 30, 180, 128, 120, 110, 51, 51, 67, 41, 40, 28, 34, 18, 14, 6, 7, 3, 3, 2, 1, 1,
                1, 1,
            ],
            [
                4, 4, 6, 3, 3, 2, 2, 2, 2, 2, 9, 4, 7, 3, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
        ],
        short_codes: [4, 10, 6, 5, 13, 13, 8, 8, 6, 5, 5, 6, 4, 5, 4, 5],
    }
    .margins(),
];

/// The sum of [`Model::literal_priors`], and their bits after the point.
const PRIOR_WEIGHT: u32 = 60;
const PRIOR_BITS: u32 = 9;

#[derive(Clone, Copy)]
pub(super) struct Model {
    literal_counts: [[u16; LITERAL_SYMBOLS]; LITERAL_CONTEXTS],
    literal_totals: [u32; LITERAL_CONTEXTS],
    /// In eighths.
    any_literals: [u16; LITERAL_SYMBOLS],
    command_counts: [[f32; CELL]; COMMAND_SYMBOLS / CELL],
    distance_counts: [[f32; DISTANCE_CONTEXTS]; DISTANCE_SYMBOLS],
    distance_totals: [f32; DISTANCE_CONTEXTS],
    margins: Margins,
    /// For each distance symbol, all bits or none.
    used: [Cost; DISTANCE_SYMBOLS],
    /// What a command counts for, less one. It grows, so that the old ones fade.
    interest: f32,
    pub(super) new_literals: usize,
    pub(super) new_commands: usize,
    pub(super) literals_due: usize,
    pub(super) commands_due: usize,

    literal_priors: [u16; LITERAL_SYMBOLS],
    log2_totals: [Cost; LITERAL_CONTEXTS],
    literal_bias: Cost,
    /// With the extra bits of both lengths. For another distance, whose cost is missing, and for the last one.
    pub(super) by_code: [[Cost; CODES]; ROWS],
    pub(super) by_length: [[Cost; TABULATED + LANES]; ROWS],
    /// From the longest to the shortest.
    pub(super) after_copy: [Cost; TABULATED + LANES],
    pub(super) distances: [[Cost; DISTANCE_CONTEXTS]; DISTANCE_SYMBOLS],
    /// For inserting so many literals or more.
    pub(super) runs: [Cost; RUNS],
    pub(super) longer_runs: [Cost; RUNS],
}

impl Model {
    pub(super) const EMPTY: Self = Self {
        literal_counts: [[0; _]; _],
        literal_totals: [0; _],
        any_literals: [0; _],
        command_counts: [[0.0; _]; _],
        distance_counts: [[0.0; _]; _],
        distance_totals: [0.0; _],
        margins: [0.0; _],
        interest: 0.0,
        used: [0; _],
        new_literals: 0,
        new_commands: 0,
        literals_due: 0,
        commands_due: 0,
        literal_priors: [0; _],
        log2_totals: [0; _],
        literal_bias: 0,
        by_code: [[0; _]; _],
        by_length: [[0; _]; _],
        after_copy: [0; _],
        distances: [[0; _]; _],
        runs: [0; _],
        longer_runs: [0; _],
    };

    pub(super) fn forget_contexts(&mut self) {
        for (counts, total) in self.literal_counts.iter_mut().zip(&mut self.literal_totals) {
            if core::mem::take(total) != 0 {
                counts.fill(0);
            }
        }
        self.literals_due = 0;
    }

    /// The costs are due.
    pub(super) fn reset(&mut self) {
        self.forget_contexts();
        self.any_literals.fill(0);
        self.command_counts.as_flattened_mut().fill(0.0);
        self.distance_counts.as_flattened_mut().fill(0.0);
        self.distances.as_flattened_mut().fill(0);
        self.used.fill(0);
        (self.distance_totals, self.margins[MADE_UP], self.interest) = Default::default();
        (self.new_literals, self.new_commands, self.commands_due) = (0, 0, 0);
    }

    /// Makes up for what has faded of it.
    #[inline(never)]
    pub(super) fn guess(&mut self, is_text: bool) {
        let (guess, missing) = (
            &GUESSES[usize::from(is_text)],
            1.0 + self.interest - self.margins[MADE_UP] / GUESSED,
        );
        if self.margins[MADE_UP] == 0.0 {
            self.margins = *guess;
        } else if missing > 0.5 * (1.0 + self.interest) {
            for (count, guess) in self.margins.iter_mut().zip(guess) {
                *count += guess * missing;
            }
        }
        self.used[..16].fill(-1);
    }

    /// The context is above the 8 bits.
    #[inline(always)]
    pub(super) fn add_literal(&mut self, tagged: u16) {
        let tagged = usize::from(tagged) % (LITERAL_CONTEXTS * LITERAL_SYMBOLS);
        self.literal_counts.as_flattened_mut()[tagged] += 1;
        self.literal_totals[tagged / LITERAL_SYMBOLS] += 1;
        self.any_literals[tagged % LITERAL_SYMBOLS] += 8;
    }

    #[inline(always)]
    pub(super) fn add_command(&mut self, command: &Command, distance_symbol: usize) {
        let (weight, symbol) = (1.0 + self.interest, command.symbol());
        let [kind, insert, copy, _] = CELLS[symbol / CELL].map(usize::from);
        self.command_counts[symbol / CELL][symbol % CELL] += weight;
        self.margins[kind] += weight;
        self.margins[insert] += weight;
        self.margins[copy | (symbol % CELL)] += weight;
        let weight = if kind == KINDS { weight } else { 0.0 };
        let (symbol, context) = (
            distance_symbol % DISTANCE_SYMBOLS,
            command.distance_context() % DISTANCE_CONTEXTS,
        );
        self.distance_counts[symbol][context] += weight;
        self.distance_totals[context] += weight;
        self.margins[DISTANCES + symbol] += weight;
        self.used[symbol] = -1;
    }

    #[inline(always)]
    pub(super) fn literal_costs<const N: usize>(&self, tagged: &[u16; N], costs: &mut [Cost; N]) {
        let (mut counts, mut priors) = ([0; N], [0; N]);
        for i in 0..N {
            let tagged = usize::from(tagged[i]) % (LITERAL_CONTEXTS * LITERAL_SYMBOLS);
            counts[i] = self.literal_counts.as_flattened()[tagged];
            priors[i] = self.literal_priors[tagged % LITERAL_SYMBOLS];
            costs[i] = self.log2_totals[tagged / LITERAL_SYMBOLS];
        }
        for i in 0..N {
            costs[i] = (costs[i]
                - rough_log2(((i32::from(counts[i]) << PRIOR_BITS) + i32::from(priors[i])) as f32))
            .clamp(BIT, 12 * BIT);
        }
    }

    #[inline(always)]
    pub(super) fn set_totals(&mut self) {
        for (log2, &total) in self.log2_totals.iter_mut().zip(&self.literal_totals) {
            *log2 = rough_log2((total + PRIOR_WEIGHT) as i32 as f32) + self.literal_bias;
        }
    }

    /// `ahead` counts the next bytes.
    #[inline(always)]
    pub(super) fn set_literal_costs(&mut self, ahead: &[u32; LITERAL_SYMBOLS]) {
        let total = self
            .any_literals
            .iter()
            .map(|&count| u32::from(count))
            .sum::<u32>();
        let bias = (5 * 480 / (480 + total)) as Cost - 3;
        self.literal_bias = (bias << FREE_BITS) + PRIOR_BITS as Cost * BIT;
        let contexts = self.literal_counts.iter_mut().zip(&mut self.literal_totals);
        for (counts, total) in contexts {
            if *total > 4096 {
                counts.iter_mut().for_each(|count| *count /= 2);
                *total = counts.iter().map(|&count| u32::from(count)).sum();
            }
        }
        let bytes_ahead = ahead.iter().sum::<u32>();
        // In sixteenths.
        let floor = if bytes_ahead == 0 { 4 } else { 1 };
        let all = 2 * (total + bytes_ahead) + floor * LITERAL_SYMBOLS as u32;
        let spare = all.leading_zeros();
        let scale =
            ((u64::from(PRIOR_WEIGHT) << (PRIOR_BITS + 32)) / u64::from(all << spare)) as u16;
        let faded = if total > 8 * 3000 { u16::MAX } else { 0 };
        for i in 0..LITERAL_SYMBOLS {
            self.literal_priors[i] =
                ((2 * (u32::from(self.any_literals[i]) + ahead[i]) + floor) << spare >> 16) as u16;
        }
        for (prior, count) in self.literal_priors.iter_mut().zip(&mut self.any_literals) {
            *prior = ((u32::from(*prior) * u32::from(scale)) >> 16) as u16;
            *count -= (*count + 3) >> 2 & faded;
        }
        self.new_literals = 0;
        self.literals_due = (total as usize / 32).clamp(24, 512);
    }

    #[cold]
    #[inline(never)]
    fn rescale(&mut self) {
        let factor = 1.0 / (1.0 + core::mem::take(&mut self.interest));
        let all = [
            self.command_counts.as_flattened_mut(),
            self.distance_counts.as_flattened_mut(),
            &mut self.distance_totals,
            &mut self.margins,
        ];
        all.into_iter().flatten().for_each(|count| {
            *count = if *count < 0.001 {
                *count
            } else {
                *count * factor
            }
        });
    }

    /// The symbols in `new` have only just come within reach. `growth` is what is left of the input, in relation to what is done.
    #[inline(always)]
    fn set_distance_costs(&mut self, symbols: usize, new: [usize; 2], growth: f32) {
        let weight = 1.0 + self.interest;
        let context_weight = 300.0 * weight;
        let scale = context_weight / self.margins[KINDS];
        let log2_totals = self
            .distance_totals
            .map(|total| log2(total + context_weight));
        let expected = f32::from(OTHER_DISTANCE)
            * 0.001
            * (self.distance_totals.iter().sum::<f32>() / weight + 4.0)
            * growth;
        let first_use = ((56.0 / (1.0 + expected) + 0.5) as Cost) << FREE_BITS;
        let priors: [_; DISTANCE_SYMBOLS] =
            from_fn(|symbol| self.margins[DISTANCES + symbol] * scale);
        let pairs = self
            .distances
            .as_chunks_mut::<2>()
            .0
            .iter_mut()
            .zip(self.distance_counts.as_chunks::<2>().0);
        for ((costs, counts), (priors, used)) in pairs
            .zip(
                priors
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .zip(self.used.as_chunks::<2>().0),
            )
            .take(symbols.div_ceil(2))
        {
            for i in 0..2 * DISTANCE_CONTEXTS {
                costs[i / 4][i % 4] =
                    symbol_cost(log2_totals[i % 4], counts[i / 4][i % 4] + priors[i / 4])
                        + (first_use & !used[i / 4]);
            }
        }
        for symbol in new[0].max(24)..symbols.min(new[1] + 1) {
            for i in 0..DISTANCE_CONTEXTS {
                self.distances[symbol][i] =
                    self.distances[symbol][i].min(self.distances[symbol - 2][i] + BIT / 4);
            }
        }
    }

    #[inline(always)]
    pub(super) fn set_command_costs(
        &mut self,
        distance_symbols: usize,
        new: [usize; 2],
        growth: f32,
    ) {
        const INSERT_BITS: [Cost; CODES] = extra_bits(&INSERT_LENGTH_CODES);
        const COPY_BITS: [Cost; CODES] = extra_bits(&COPY_LENGTH_CODES);
        const INSERT_CODES: [u8; RUNS] = codes_of_short_lengths(&INSERT_LENGTH_CODES);
        const COPY_CODES: [u8; TABULATED + LANES] = codes_of_short_lengths(&COPY_LENGTH_CODES);
        self.set_distance_costs(distance_symbols, new, growth);

        let weight = 1.0 + self.interest;
        let joint_weight = 300.0 * weight;
        let (kinds, inserts) = (
            array_at::<_, 2>(&self.margins, KINDS),
            array_at::<_, 64>(&self.margins, INSERTS),
        );
        let total = kinds[0] + kinds[1];
        let log2_total = log2(total - self.margins[MADE_UP] + joint_weight);
        let factors = kinds.map(|count| joint_weight / (total * count));
        let shares: [_; 64] = from_fn(|i| inserts[i] * factors[i / CODES % 2]);
        let mut costs = [[0; CELL]; COMMAND_SYMBOLS / CELL];
        for ((costs, counts), &[_, insert, copy, _]) in
            costs.iter_mut().zip(&self.command_counts).zip(&CELLS)
        {
            let (share, copies) = (
                shares[usize::from(insert % 64)],
                &self.margins.as_chunks::<CELL>().0[usize::from(copy) / CELL],
            );
            for i in 0..CELL {
                costs[i] = symbol_cost(log2_total, counts[i] + share * copies[i]);
            }
        }

        for (row, (by_code, by_length)) in
            self.by_code.iter_mut().zip(&mut self.by_length).enumerate()
        {
            let mut symbols = [Cost::MAX / 2; CODES + 1];
            for (copy, cell) in symbols[1..]
                .as_chunks_mut::<CELL>()
                .0
                .iter_mut()
                .enumerate()
            {
                *cell = costs[usize::from(combine_length_codes(
                    row % CODES,
                    copy * CELL,
                    row >= CODES,
                )) / CELL];
            }
            let last = if row >= CODES {
                self.distances[0][3]
            } else {
                0
            };
            symbols[1 + 2 * CELL..]
                .iter_mut()
                .for_each(|cost| *cost += last);
            for copy in 0..CODES {
                // What was never needed so far would otherwise never be tried.
                let symbol = symbols[copy + 1].min(symbols[copy] + 3 * BIT);
                by_code[copy] = symbol + INSERT_BITS[row % CODES] + COPY_BITS[copy];
            }
            by_length[2..10].copy_from_slice(&by_code[..8]);
            for (length, code) in [(10, 8), (12, 9), (14, 10), (18, 11)] {
                by_length[length..length + 4].fill(by_code[code]);
            }
            by_length[TABULATED..].fill(by_code[17]);
            for (group, costs) in by_length[22..]
                .as_chunks_mut::<LANES>()
                .0
                .iter_mut()
                .enumerate()
            {
                *costs = [by_code[usize::from(COPY_CODES[22 + group * LANES])]; _];
            }
        }
        self.after_copy = self.by_length[0];
        self.after_copy.reverse();

        let (mut exactly, mut at_least, mut left) = ([0.0; RUNS], [0.0; RUNS], total);
        for length in 0..RUNS {
            let code = usize::from(INSERT_CODES[length] % 16);
            let share = f32::from_bits(
                1f32.to_bits() - (u32::from(INSERT_LENGTH_CODES[code].extra_bits) << 23),
            );
            exactly[length] = (inserts[code] + inserts[CODES + code]) * share;
            at_least[length] = left;
            left -= exactly[length];
        }
        for length in 0..RUNS {
            let exactly = log2(exactly[length]);
            let at_least = log2(at_least[length]).max(exactly);
            self.runs[length] = at_least - ((at_least - exactly) >> 3);
        }
        let none = self.runs[0];
        self.runs
            .iter_mut()
            .for_each(|cost| *cost = rounded(none - *cost));
        for length in 1..RUNS {
            self.longer_runs[length - 1] = self.runs[length] - self.runs[length - 1];
        }
        self.interest += weight * self.new_commands as f32 / 5000.0;
        if self.interest > 65536.0 {
            self.rescale();
        }
        self.new_commands = 0;
        self.commands_due = ((total / weight) as usize / 4).clamp(16, 512);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::DistanceParams;
    use crate::memory::copied;

    /// After so many rounds with the same literals and commands.
    fn prices(model: &mut Model, is_text: bool, rounds: usize) -> [Vec<Cost>; 4] {
        let command = Command::new(&DistanceParams::new(0, 0, false), 3, 7, 7, 1);
        model.guess(is_text);
        for _ in 0..rounds {
            model.set_literal_costs(&[0; _]);
            model.set_command_costs(60, [30, 40], 1.0);
            for tagged in (0..2000).map(|i| i % 2 * 0x161) {
                model.add_literal(tagged);
                model.add_command(&command, 1);
            }
            (model.new_literals, model.new_commands) = (2000, 2000);
        }
        let mut literals = [0; 2];
        model.set_totals();
        model.literal_costs(&[0x161, 0x162], &mut literals);
        let (commands, distances) = (
            model.by_length.as_flattened(),
            model.distances.as_flattened(),
        );
        [&literals, commands, distances, &model.runs].map(|it| copied(it).unwrap())
    }

    #[test]
    fn what_is_frequent_gets_cheap() {
        let mut model = Model::EMPTY;
        assert_eq!(prices(&mut model, true, 500)[0], [BIT, 12 * BIT]);
        assert_eq!([model.by_length[3][7], model.distances[1][3]], [BIT; 2]);
        assert_eq!(
            [model.by_length[2][7], model.distances[2][3]],
            [13 * BIT; 2]
        );
        assert_eq!(model.distances[NO_SYMBOL], [0; _]);
    }

    #[test]
    fn nothing_is_left_after_a_reset() {
        let mut model = Model::EMPTY;
        let first = prices(&mut model, true, 2);
        prices(&mut model, false, 100);
        model.reset();
        assert_eq!(prices(&mut model, true, 2), first);
    }
}
