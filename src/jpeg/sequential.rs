//! Sequential scans with Huffman coding (jdhuff.c).

use crate::bit_reader::{BITS_IN_REFILL, Bits, Window};
use crate::block::{Block, Zigzag};
use crate::header::{MAX_COMPONENTS, Scan, Tables};
use crate::huffman::{Alphabet, Code, Codes, END, STANDARD_AC, STANDARD_DC, Spec, ZEROS, extend};
use crate::input::Input;
use crate::scan::{EntropyDecoder, Slot};
use crate::{Error, Result, wrapped, wrapped_mut};
use core::hint::{cold_path, select_unpredictable};
use core::ops::Range;

/// The length of what [`Sequential`] decodes to. A byte is an index into it.
pub(crate) const BATCH_ROOM: usize = 256;

const QUICK_BITS: u32 = 9;
const MAX_QUICK_LENGTH: u32 = 16;
/// What is left after so many is enough to look up the next.
const QUICK_STEPS_IN_REFILL: u32 = (BITS_IN_REFILL - QUICK_BITS) / MAX_QUICK_LENGTH;
/// With less data than this, finding the pairs takes longer than they save.
const MIN_LEN_FOR_PAIRS: usize = 2048;

/// One code, or two of the same block.
#[derive(Clone, Copy)]
#[repr(align(8))]
struct Step {
    /// In bits, with those that follow the codes.
    length: u8,
    /// How far it is to the coefficient after the first.
    first_advance: u8,
    /// How far it is to the coefficient after the last.
    advance: u8,
    ends_block: bool,
    first_value: i16,
    last_mask: u16,
}

impl Step {
    /// It fits in no block.
    const NONE: Self = Self {
        length: 0,
        first_advance: 64,
        advance: 65,
        ends_block: false,
        first_value: 0,
        last_mask: 0,
    };

    /// A run of 16 zeros is a zero after 15 others. At the end, a zero goes where the next coefficient would.
    #[inline(always)]
    fn single(code: Code) -> Self {
        let advance = match code.run() {
            END => 1,
            ZEROS => 16,
            run => run as u8 + 1,
        };
        Self {
            length: code.length() as u8,
            first_advance: advance,
            advance,
            ends_block: code.run() == END,
            first_value: 0,
            last_mask: code.mask() as u16,
        }
    }

    /// `self` is single, and the bits after its code stand for `value`.
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

struct StepTable {
    /// By the next bits. What is long is not here.
    quick: [Step; 1 << QUICK_BITS],
    codes: Codes,
}

impl StepTable {
    const NONE: Self = Self {
        quick: [Step::NONE; 1 << QUICK_BITS],
        codes: Codes::NONE,
    };

    /// `seconds` go by the bits that the first code leaves: `n` of them from `1 << n` on.
    fn fill_quick(&mut self, seconds: Option<&[Step; 1 << QUICK_BITS]>) {
        self.codes.share_out(&mut self.quick, |code, slots| {
            if code.length() > MAX_QUICK_LENGTH {
                return;
            }
            let single = Step::single(code);
            let seconds = seconds.filter(|_| code.length() < QUICK_BITS && code.run() != END);
            let Some(seconds) = seconds else {
                return slots.fill(single);
            };
            let len = 1 << (QUICK_BITS - code.length());
            let seconds = seconds.get(len..).unwrap_or_default();
            for (bits, slots) in (0..).zip(slots.chunks_exact_mut(len)) {
                let value = code.value(bits) as i16;
                for (slot, &second) in slots.iter_mut().zip(seconds) {
                    *slot = match second.length {
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

    /// What comes at coefficient `k`.
    #[inline(always)]
    fn find(&self, bits: u64, k: usize) -> Step {
        let mut step = *self.quick(bits);
        if k + usize::from(step.first_advance) >= 64 && step.first_advance != step.advance {
            step = Step::single(self.codes.search(bits));
        }
        step.ends_block |= k + usize::from(step.advance) >= 64;
        step
    }
}

/// For the first code of a block, and for the others.
type TablePair = [StepTable; 2];

pub(crate) struct StepTables {
    pairs: Vec<TablePair>,
    by_component: [usize; MAX_COMPONENTS],
}

impl StepTables {
    pub(crate) fn new(tables: &Tables, scan: &Scan, input: &Input<'_>) -> Result<Self> {
        /// Motion JPEG leaves the standard tables out.
        fn find<'s>(specs: &'s [Option<Spec>], standard: &'s [Spec], n: u8) -> Result<&'s Spec> {
            let spec = specs.get(usize::from(n)).and_then(Option::as_ref);
            spec.or_else(|| standard.get(usize::from(n)))
                .ok_or(Error::MissingTable)
        }

        let (mut pairs, mut by_component) = (Vec::new(), [0; MAX_COMPONENTS]);
        pairs.try_reserve_exact(scan.components().len())?;
        for (nth, component) in scan.components().iter().enumerate() {
            let numbers = (component.dc_table, component.ac_table);
            let mut before = scan.components().iter().take(nth);
            if let Some(same) = before.position(|it| (it.dc_table, it.ac_table) == numbers) {
                *wrapped_mut(&mut by_component, nth) = *wrapped(&by_component, same);
                continue;
            }
            *wrapped_mut(&mut by_component, nth) = pairs.len();
            let [dc, ac] = pairs.push_mut([StepTable::NONE, StepTable::NONE]);
            let dc_spec = find(&tables.dc, &STANDARD_DC, numbers.0)?;
            dc.codes.fill(dc_spec, Alphabet::Dc)?;
            let ac_spec = find(&tables.ac, &STANDARD_AC, numbers.1)?;
            ac.codes.fill(ac_spec, Alphabet::Ac)?;

            let seconds = (input.len_left() >= MIN_LEN_FOR_PAIRS).then(|| {
                let mut seconds = [Step::NONE; 1 << QUICK_BITS];
                for left in 1..QUICK_BITS {
                    let slots = seconds.get_mut(1 << left..2 << left).unwrap_or_default();
                    ac.codes.share_out(slots, |code, slots| {
                        if QUICK_BITS - left + code.length() <= MAX_QUICK_LENGTH {
                            slots.fill(Step::single(code));
                        }
                    });
                }
                seconds
            });
            dc.fill_quick(seconds.as_ref());
            ac.fill_quick(seconds.as_ref());
        }
        Ok(Self {
            pairs,
            by_component,
        })
    }
}

/// For each block of a batch, in the order of the data.
struct Plan<'t> {
    tables: [&'t TablePair; BATCH_ROOM],
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
    /// The end of a block cannot be foreseen, so it takes no branch. What the next step waits for comes first.
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

/// The blocks that it decodes to are zeros, but for coefficient 0.
pub(crate) struct Sequential<'i, 'a> {
    plan: Plan<'i>,
    predictions: [i16; MAX_COMPONENTS],
    window: Window<'i, 'a>,
    bits: Bits,
}

impl<'i, 'a> Sequential<'i, 'a> {
    /// `slots` are those of all batches, which have `batch_len` blocks at most.
    pub(crate) fn new(
        input: &'i mut Input<'a>,
        tables: &'i StepTables,
        slots: &[Slot],
        batch_len: usize,
    ) -> Result<Self> {
        let any = tables.pairs.first().ok_or(Error::Internal)?;
        let mut plan = Plan {
            tables: [any; BATCH_ROOM],
            block: [0; BATCH_ROOM],
            component: [0; BATCH_ROOM],
        };
        let mcus = (0..).flat_map(|mcu| slots.iter().map(move |slot| (mcu, slot)));
        for (nth, (mcu, slot)) in mcus.take(batch_len).enumerate() {
            let pair = tables.pairs.get(slot.pick(&tables.by_component));
            *wrapped_mut(&mut plan.tables, nth) = pair.ok_or(Error::Internal)?;
            *wrapped_mut(&mut plan.block, nth) = slot.index(mcu) as u8;
            *wrapped_mut(&mut plan.component, nth) = slot.component as u8;
        }
        let mut window = Window::new(input);
        Ok(Self {
            plan,
            predictions: [0; MAX_COMPONENTS],
            bits: window.bits_from(0),
            window,
        })
    }
}

impl EntropyDecoder for Sequential<'_, '_> {
    fn decode(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let blocks = blocks.first_chunk_mut().ok_or(Error::Internal)?;
        let (mut bits, window, plan) = (self.bits, &mut self.window, &self.plan);
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
                bits.start_block(window);
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
            let step = cursor.table.find(bits.peek(), cursor.k);
            cursor.advance(&step, plan, blocks, &mut bits);
            // It is less already. Knowing that, the compiler leaves a mask out of each step.
            cursor.k %= 64;
        }
        self.bits = bits;

        for nth in start..cursor.nth {
            let block = wrapped_mut(blocks, (*wrapped(&plan.block, nth)).into());
            let component = *wrapped(&plan.component, nth);
            let prediction = wrapped_mut(&mut self.predictions, component.into());
            *prediction = prediction.wrapping_add(block.0[0]);
            block.0[0] = *prediction;
        }
        Ok((cursor.nth - start) / slots.len())
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
