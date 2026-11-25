//! Sequential scans with Huffman coding (jdhuff.c).

use crate::bit_reader::{BITS_IN_REFILL, Bits, Window};
use crate::block::{Block, Zigzag};
use crate::header::{Scan, Tables};
use crate::huffman::{
    Alphabet, Code, Codes, RUN_OF_EOB, RUN_OF_ZRL, STANDARD_AC, STANDARD_DC, Spec, extend,
};
use crate::scan::{EntropyDecoder, Slot};
use crate::{Error, MAX_COMPONENTS, Result, wrapped, wrapped_mut};
use core::hint::{cold_path, select_unpredictable};
use core::ops::Range;

/// The length of the buffer that [`Sequential`] decodes into. A `u8` indexes it without a bounds check.
pub(crate) const BATCH_ROOM: usize = 256;

const QUICK_BITS: u32 = 9;
const MAX_QUICK_LENGTH: u32 = 16;
/// After this many, enough bits are left to look up the next step.
const QUICK_STEPS_IN_REFILL: u32 = (BITS_IN_REFILL - QUICK_BITS) / MAX_QUICK_LENGTH;
/// Below this many bytes of data, building pairs costs more than they save.
const MIN_LEN_FOR_PAIRS: usize = 2048;

/// One code, or two consecutive codes of a block.
#[derive(Clone, Copy)]
#[repr(align(8))]
struct Step {
    /// In bits, extra bits included.
    length: u8,
    /// How far the first code moves `k`.
    first_advance: u8,
    /// How far the whole step moves `k`.
    advance: u8,
    ends_block: bool,
    first_value: i16,
    last_mask: u16,
}

impl Step {
    /// Looks like two codes that overrun any block, so [`StepTable::slow`] searches.
    const NONE: Self = Self {
        length: 0,
        first_advance: 64,
        advance: 65,
        ends_block: false,
        first_value: 0,
        last_mask: 0,
    };

    /// ZRL writes a zero after 15 others. EOB writes a zero where the next coefficient would go.
    #[inline(always)]
    fn single(code: Code) -> Self {
        let advance = match code.run() {
            RUN_OF_EOB => 1,
            RUN_OF_ZRL => 16,
            run => run as u8 + 1,
        };
        Self {
            length: code.length() as u8,
            first_advance: advance,
            advance,
            ends_block: code.run() == RUN_OF_EOB,
            first_value: 0,
            last_mask: code.mask() as u16,
        }
    }

    /// `self` is single, and its extra bits stand for `value`.
    #[inline(always)]
    fn followed_by(self, value: i16, second: Self) -> Self {
        Self {
            length: self.length + second.length,
            first_advance: self.advance,
            advance: self.advance + second.advance,
            first_value: value,
            ..second
        }
    }
}

pub(crate) struct StepTable {
    /// By the next [`QUICK_BITS`]. Long codes are [`Step::NONE`].
    quick: [Step; 1 << QUICK_BITS],
    codes: Codes,
}

impl StepTable {
    const NONE: Self = Self {
        quick: [Step::NONE; 1 << QUICK_BITS],
        codes: Codes::NONE,
    };

    /// `second_steps[1 << n..]` is indexed by the `n` bits that a first code leaves.
    fn fill_quick(&mut self, second_steps: Option<&[Step; 1 << QUICK_BITS]>) {
        self.codes
            .for_each_prefix(&mut self.quick, |code, entries| {
                if code.length() > MAX_QUICK_LENGTH {
                    return;
                }
                let single = Step::single(code);
                let second_steps =
                    second_steps.filter(|_| code.length() < QUICK_BITS && code.run() != RUN_OF_EOB);
                let Some(second_steps) = second_steps else {
                    return entries.fill(single);
                };
                let len = 1 << (QUICK_BITS - code.length());
                let second_steps = second_steps.get(len..).unwrap_or_default();
                for (bits, entries) in (0..).zip(entries.chunks_exact_mut(len)) {
                    let value = code.value(bits) as i16;
                    for (entry, &second) in entries.iter_mut().zip(second_steps) {
                        *entry = match second.length {
                            0 => single,
                            _ => single.followed_by(value, second),
                        };
                    }
                }
            });
    }

    #[inline(always)]
    fn quick(&self, bits: u64) -> &Step {
        wrapped(&self.quick, (bits >> (64 - QUICK_BITS)) as usize)
    }

    /// The step at coefficient `k`, also for long codes and at the end of a block.
    #[inline(always)]
    fn slow(&self, bits: u64, k: usize) -> Step {
        let mut step = *self.quick(bits);
        if k + usize::from(step.first_advance) >= 64 && step.first_advance != step.advance {
            step = Step::single(self.codes.search(bits));
        }
        step.ends_block |= k + usize::from(step.advance) >= 64;
        step
    }
}

type DcAndAc = [StepTable; 2];

pub(crate) struct StepTables {
    /// [`DcAndAc`], flattened.
    tables: Vec<StepTable>,
    by_component: [usize; MAX_COMPONENTS],
}

impl StepTables {
    /// `data_len` is an upper bound for the length of the scan.
    pub(crate) fn new(tables: &Tables, scan: &Scan, data_len: usize) -> Result<Self> {
        /// Motion JPEG leaves the standard tables out.
        fn find<'s>(specs: &'s [Option<Spec>], standard: &'s [Spec], n: u8) -> Result<&'s Spec> {
            let spec = specs.get(usize::from(n)).and_then(Option::as_ref);
            spec.or_else(|| standard.get(usize::from(n)))
                .ok_or(Error::MissingTable)
        }

        let (mut built, mut by_component) = (Vec::new(), [0; MAX_COMPONENTS]);
        built.try_reserve_exact(2 * scan.components().len())?;
        for (nth, component) in scan.components().iter().enumerate() {
            let numbers = (component.dc_table, component.ac_table);
            let mut before = scan.components().iter().take(nth);
            if let Some(same) = before.position(|it| (it.dc_table, it.ac_table) == numbers) {
                *wrapped_mut(&mut by_component, nth) = *wrapped(&by_component, same);
                continue;
            }
            *wrapped_mut(&mut by_component, nth) = built.len() / 2;
            // One by one, so that the pair is not put together on the stack first.
            built.push(StepTable::NONE);
            built.push(StepTable::NONE);
            let [dc, ac] = built.last_chunk_mut().ok_or(Error::Internal)?;
            let dc_spec = find(&tables.dc, &STANDARD_DC, numbers.0)?;
            dc.codes.fill(dc_spec, Alphabet::Dc)?;
            let ac_spec = find(&tables.ac, &STANDARD_AC, numbers.1)?;
            ac.codes.fill(ac_spec, Alphabet::Ac)?;

            let second_steps = (data_len >= MIN_LEN_FOR_PAIRS).then(|| {
                let mut second_steps = [Step::NONE; 1 << QUICK_BITS];
                for left in 1..QUICK_BITS {
                    let entries = second_steps
                        .get_mut(1 << left..2 << left)
                        .unwrap_or_default();
                    ac.codes.for_each_prefix(entries, |code, entries| {
                        if QUICK_BITS - left + code.length() <= MAX_QUICK_LENGTH {
                            entries.fill(Step::single(code));
                        }
                    });
                }
                second_steps
            });
            dc.fill_quick(second_steps.as_ref());
            ac.fill_quick(second_steps.as_ref());
        }
        Ok(Self {
            tables: built,
            by_component,
        })
    }

    /// For [`Slot::pick`].
    pub(crate) fn by_component(&self) -> Result<[&DcAndAc; MAX_COMPONENTS]> {
        let all = self.tables.as_chunks().0;
        let mut tables = [all.first().ok_or(Error::Internal)?; MAX_COMPONENTS];
        for (to, &index) in tables.iter_mut().zip(&self.by_component) {
            *to = all.get(index).ok_or(Error::Internal)?;
        }
        Ok(tables)
    }
}

/// For each block of a batch, in the order of the data.
struct Plan<'t> {
    tables: [&'t DcAndAc; BATCH_ROOM],
    block: [u8; BATCH_ROOM],
    component: [u8; BATCH_ROOM],
}

/// Where the next code belongs.
struct Cursor<'t> {
    /// In the [`Plan`].
    nth: usize,
    k: usize,
    table: &'t StepTable,
}

impl<'t> Cursor<'t> {
    /// Branchless, because the end of a block is unpredictable. What the next step depends on is computed first.
    #[inline(always)]
    #[expect(
        clippy::trivially_copy_pass_by_ref,
        reason = "loading the fields one by one is faster than taking a word apart"
    )]
    fn advance(
        &mut self,
        step: &Step,
        plan: &Plan<'t>,
        blocks: &mut [Block; BATCH_ROOM],
        bits: &mut Bits,
    ) {
        let Self { nth, k, .. } = *self;
        let [_, ac] = *wrapped(&plan.tables, nth);
        let [next_dc, _] = *wrapped(&plan.tables, nth + 1);
        let taken = bits.take(step.length.into());
        let after_last = k + usize::from(step.advance);
        *self = Self {
            table: select_unpredictable(step.ends_block, next_dc, ac),
            k: select_unpredictable(step.ends_block, 0, after_last),
            nth: nth + usize::from(step.ends_block),
        };
        let block = wrapped_mut(blocks, (*wrapped(&plan.block, nth)).into());
        *block.before_mut(k + usize::from(step.first_advance)) = step.first_value;
        *block.before_mut(after_last) = extend(taken, step.last_mask.into()) as i16;
    }
}

/// The blocks that it decodes into have to be zero, except for coefficient 0.
pub(crate) struct Sequential<'i, 'a> {
    plan: Plan<'i>,
    predictions: [i16; MAX_COMPONENTS],
    window: &'i mut Window<'i, 'a>,
    bits: Bits,
}

impl<'i, 'a> Sequential<'i, 'a> {
    /// `slots` are the same for all batches, which have at most `batch_len` blocks.
    pub(crate) fn new(
        window: &'i mut Window<'i, 'a>,
        tables: [&'i DcAndAc; MAX_COMPONENTS],
        slots: &[Slot],
        batch_len: usize,
    ) -> Self {
        let mut plan = Plan {
            tables: [tables[0]; BATCH_ROOM],
            block: [0; BATCH_ROOM],
            component: [0; BATCH_ROOM],
        };
        let mcus = (0..).flat_map(|mcu| slots.iter().map(move |slot| (mcu, slot)));
        for (nth, (mcu, slot)) in mcus.take(batch_len).enumerate() {
            *wrapped_mut(&mut plan.tables, nth) = slot.pick(&tables);
            *wrapped_mut(&mut plan.block, nth) = slot.index(mcu) as u8;
            *wrapped_mut(&mut plan.component, nth) = slot.component as u8;
        }
        Self {
            plan,
            predictions: [0; MAX_COMPONENTS],
            bits: window.bits_from(0),
            window,
        }
    }
}

impl EntropyDecoder for Sequential<'_, '_> {
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>) -> Result<bool> {
        let blocks = blocks.first_chunk_mut().ok_or(Error::Internal)?;
        let (mut bits, window, plan) = (self.bits, &mut *self.window, &self.plan);
        let (start, end) = (mcus.start * slots.len(), mcus.end * slots.len());
        let end = end.min(BATCH_ROOM - 1);
        let mut cursor = Cursor {
            nth: start,
            k: 0,
            table: &wrapped(&plan.tables, start)[0],
        };
        'refill: while cursor.nth < end {
            if window.is_running_low(bits) {
                cold_path();
                let starts_mcu = || cursor.k == 0 && cursor.nth.is_multiple_of(slots.len());
                if !window.has_data(bits) && starts_mcu() {
                    break;
                }
                bits.ensure_margin(window);
                bits.refill(window);
            } else {
                let mut step = cursor.table.quick(bits.peek());
                bits.refill(window);
                let mut left = QUICK_STEPS_IN_REFILL;
                while cursor.k + usize::from(step.advance) < 64 {
                    cursor.advance(step, plan, blocks, &mut bits);
                    left -= 1;
                    if left == 0 || cursor.nth >= end {
                        continue 'refill;
                    }
                    step = cursor.table.quick(bits.peek());
                }
                bits.refill(window);
            }
            cold_path();
            let step = cursor.table.slow(bits.peek(), cursor.k);
            cursor.advance(&step, plan, blocks, &mut bits);
            // A no-op that lets the compiler drop a mask from each step.
            cursor.k %= 64;
        }
        self.bits = bits;

        for nth in start..cursor.nth {
            let block = wrapped_mut(blocks, (*wrapped(&plan.block, nth)).into());
            let component = *wrapped(&plan.component, nth);
            let prediction = wrapped_mut(&mut self.predictions, component.into());
            *prediction = prediction.wrapping_add(block.dc());
            *block.dc_mut() = *prediction;
        }
        Ok(true)
    }

    fn restart(&mut self, number: u8) {
        self.bits = self.window.restart(self.bits, number);
        self.predictions = [0; MAX_COMPONENTS];
    }

    fn has_data(&self) -> bool {
        self.window.has_data(self.bits)
    }

    fn is_over(&self) -> bool {
        self.window.is_over(self.bits)
    }
}
