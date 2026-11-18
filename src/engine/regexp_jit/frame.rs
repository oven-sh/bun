//! Where the state of a match is kept.

use bun_engine_asm::Bank;
use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::{Direction, Loop, Op, Program, UNBOUNDED, Width};
use smallvec::{SmallVec, smallvec};

/// The address after the last unit of the subject.
pub(crate) const END: Gpr = abi::ARGUMENT_GPRS[0];
/// Positions count from the end, so none is above zero.
pub(crate) const POSITION: Gpr = abi::ARGUMENT_GPRS[1];
/// The position of the first unit.
pub(crate) const ORIGIN: Gpr = abi::ARGUMENT_GPRS[2];
const CAPTURES: Gpr = abi::ARGUMENT_GPRS[3];
pub(crate) const CONTEXT: Gpr = abi::ARGUMENT_GPRS[4];

/// Holds a constant or an address for the length of an operation.
#[cfg(target_arch = "x86_64")]
pub(crate) const CONSTANT: Gpr = abi::SCRATCH_GPR;
#[cfg(target_arch = "aarch64")]
pub(crate) const CONSTANT: Gpr = abi::TEMPORARY_GPRS[15];

const STACK_POINTER: Gpr = abi::STACK_POINTER;
const MAX_TEMPORARIES: usize = 5;
/// More than that are kept in the context.
const MAX_WORDS_ON_NATIVE_STACK: usize = 128;
/// From here on a cell is worth a register that has to be saved and restored.
const WEIGHT_FOR_SAVED_REGISTER: u32 = 8;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Location {
    Register(Gpr),
    Memory(Address),
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Use {
    None,
    /// Never has anything but the start of the subject.
    Origin,
    Alone,
    /// Is copied together with its neighbours.
    InMemory,
}

type Uses = SmallVec<[Use; 16]>;
type Assigned = SmallVec<[(u32, Gpr); 4]>;

/// What the operations ask for.
struct Demands {
    temporaries: usize,
    is_metered: bool,
    counts_turns: bool,
    has_long_runs: bool,
    moves_backward: bool,
    has_stack: bool,
    has_marks: bool,
    rescans: bool,
    uses: Uses,
}

fn survey(program: &Program) -> Demands {
    let mut demands = Demands {
        temporaries: 2,
        is_metered: false,
        counts_turns: false,
        has_long_runs: false,
        moves_backward: false,
        has_stack: false,
        has_marks: false,
        rescans: false,
        uses: smallvec![Use::None; program.cell_count()],
    };
    if program.width() == Width::Utf16 {
        demands.temporaries = 3;
    }
    for op in program.ops() {
        match *op {
            Op::Save { slot }
            | Op::WalkBack { slot, .. }
            | Op::Zero { slot }
            | Op::Choose { slot, .. }
            | Op::Mark { slot } => {
                let used = &mut demands.uses[slot.cell as usize];
                *used = Use::Alone.max(*used);
                demands.has_marks |= matches!(op, Op::Mark { .. });
            }
            Op::SaveStart { slot, .. } => {
                let is_in_frame = |it: &Loop| it.cells().start <= slot.cell;
                let used = &mut demands.uses[slot.cell as usize];
                *used = match program.loops().iter().any(is_in_frame) {
                    true => Use::Alone.max(*used),
                    false => Use::Origin.max(*used),
                };
            }
            Op::Scan { id, .. } => demands.rescans |= program.scan(id).stops_often(),
            Op::Cut { .. } => demands.has_marks = true,
            Op::SaveCaptures { slot, pairs } | Op::RestoreCaptures { slot, pairs } => {
                demands.uses[slot.cell as usize..][..pairs.entries().len()].fill(Use::InMemory);
            }
            Op::Enter { id } | Op::Push { id } | Op::Pop { id } | Op::Retreat { id, .. } => {
                let turns = program.loops()[id.index()].turns_cell();
                let used = &mut demands.uses[turns as usize];
                *used = Use::Alone.max(*used);
                demands.has_stack = true;
                demands.is_metered |= matches!(op, Op::Push { .. } | Op::Pop { .. });
            }
            Op::Load { metered: true, .. } | Op::Spend { .. } => demands.is_metered = true,
            Op::CountTurn => demands.counts_turns = true,
            Op::Advance { by } => demands.moves_backward |= by < 0,
            Op::Run {
                direction,
                code_points,
                is_long,
                is_counted,
                max,
                ..
            } => {
                demands.counts_turns |= is_counted;
                demands.has_long_runs |= is_long;
                demands.moves_backward |= direction == Direction::Backward;
                if code_points && max != UNBOUNDED {
                    demands.temporaries = demands.temporaries.max(4);
                }
            }
            Op::CodePoint { direction, .. } => {
                demands.moves_backward |= direction == Direction::Backward;
            }
            Op::BackReference { direction, .. } => {
                demands.moves_backward |= direction == Direction::Backward;
                demands.temporaries = MAX_TEMPORARIES;
            }
            _ => {}
        }
    }
    demands.has_stack |= demands.has_marks;
    demands
}

pub(crate) struct Frame {
    temporaries: [Gpr; MAX_TEMPORARIES],
    /// What is left of the work until the next poll.
    pub(crate) fuel: Option<Gpr>,
    /// Those of repeated groups since the last poll.
    pub(crate) turns: Option<Location>,
    /// By how much the work since then is less than the fuel that is used for it.
    pub(crate) saved_work: Option<Gpr>,
    pub(crate) moves_backward: bool,
    pub(crate) stack: Option<Stack>,
    pub(crate) context: Option<Location>,
    pub(crate) scanned: Option<Scanned>,
    pub(crate) captures: Address,
    /// Where the first cell is, or would be if it were in memory.
    pub(crate) cells: Address,
    /// The number of words from there on, if they are in the context.
    pub(crate) words_in_context: Option<usize>,
    uses: Uses,
    /// Ascending.
    cell_registers: Assigned,
    saved: RegisterSet,
    size: i32,
}

/// That of the match, on which loops keep their frames.
#[derive(Clone, Copy)]
pub(crate) struct Stack {
    /// The address above the last frame.
    pub(crate) top: Gpr,
    /// Has the highest `top` with room for any frame.
    pub(crate) limit: Address,
    pub(crate) start: Option<Address>,
    pub(crate) max_frame_words: usize,
}

/// What the last scan has found in the vector at which it stopped.
#[derive(Clone, Copy)]
pub(crate) struct Scanned {
    pub(crate) position: Gpr,
    pub(crate) bits: Gpr,
}

struct Pool {
    free: SmallVec<[Gpr; 16]>,
    saved: RegisterSet,
}

impl Pool {
    fn take_free(&mut self) -> Option<Gpr> {
        self.free.pop()
    }

    fn take_saved(&mut self) -> Option<Gpr> {
        let register = (SAVED - self.saved).gprs().next()?;
        self.saved.insert(register);
        Some(register)
    }

    fn take(&mut self) -> Option<Gpr> {
        self.take_free().or_else(|| self.take_saved())
    }

    fn take_required(&mut self) -> Gpr {
        self.take().expect("there are enough")
    }

    fn take_two(&mut self) -> Option<[Gpr; 2]> {
        let left = self.free.len() as u32 + (SAVED - self.saved).len();
        (left >= 2).then(|| [self.take_required(), self.take_required()])
    }
}

const SAVED: RegisterSet = abi::CALLEE_SAVED.in_bank(Bank::Gpr);
const TAKEN: [Gpr; 6] = [END, POSITION, ORIGIN, CAPTURES, CONTEXT, CONSTANT];
const FREE: RegisterSet =
    RegisterSet::of(&abi::TEMPORARY_GPRS, &[]).difference(RegisterSet::of(&TAKEN, &[]));

/// The fuel, the top of the stack and the address of the cells need one too.
const _: () = assert!(MAX_TEMPORARIES as u32 + 3 <= FREE.len() + SAVED.len());

impl Frame {
    pub(crate) fn new(program: &Program) -> Frame {
        let demands = survey(program);
        let own_entries = match program.reports_captures() {
            true => 0,
            false => program.capture_entries(),
        };
        let words = program.cell_count() + own_entries;
        let words_in_context = (words > MAX_WORDS_ON_NATIVE_STACK).then_some(words);
        let needs_context = demands.is_metered || demands.has_stack || words_in_context.is_some();

        let others = abi::TEMPORARY_GPRS.into_iter().rev();
        let mut pool = Pool {
            free: others.filter(|it| !TAKEN.contains(it)).collect(),
            saved: RegisterSet::EMPTY,
        };
        if !program.reports_captures() || program.capture_entries() == 0 {
            pool.free.insert(0, CAPTURES);
        }
        let used_cells = demands.uses.iter().filter(|&&it| it == Use::Alone).count();
        let wanted = demands.temporaries
            + usize::from(demands.is_metered)
            + usize::from(demands.has_stack)
            + usize::from(words_in_context.is_some())
            + 2 * usize::from(demands.rescans)
            + used_cells;
        let keeps_context = needs_context && wanted <= pool.free.len();
        if !keeps_context {
            pool.free.insert(0, CONTEXT);
        }

        let mut temporaries = [CONSTANT; MAX_TEMPORARIES];
        for temporary in &mut temporaries[..demands.temporaries] {
            *temporary = pool.take_required();
        }
        let fuel = demands.is_metered.then(|| pool.take_required());
        let top = demands.has_stack.then(|| pool.take_required());
        let cells_base = words_in_context.map(|_| pool.take_required());
        let scanned = demands.rescans.then(|| pool.take_two()).flatten();
        let turns = demands.counts_turns.then(|| pool.take_saved());
        let is_racing = demands.is_metered && program.counts_turns();
        let saved_work = (is_racing && demands.has_long_runs).then(|| pool.take_saved());
        let cell_registers = assign_registers(program, &demands.uses, &mut pool);

        let mut size = 8 * pool.saved.len() as i32;
        let mut reserve = |bytes: usize| {
            size += bytes as i32;
            Address::new(STACK_POINTER, size - bytes as i32)
        };
        let context = needs_context.then(|| match keeps_context {
            true => Location::Register(CONTEXT),
            false => Location::Memory(reserve(8)),
        });
        let turns =
            turns.map(|it| it.map_or_else(|| Location::Memory(reserve(8)), Location::Register));
        let stack = top.map(|top| Stack {
            top,
            limit: reserve(8),
            start: demands.has_marks.then(|| reserve(8)),
            max_frame_words: (program.loops().iter().map(Loop::frame_size).max()).unwrap_or(0),
        });
        let used = demands.uses.iter().filter(|&&it| it != Use::None).count();
        let has_memory = used > cell_registers.len() || own_entries != 0 || demands.has_stack;
        let cells = match cells_base {
            Some(base) => Address::new(base, 0),
            None => reserve(if has_memory { words * 4 } else { 0 }),
        };
        Frame {
            temporaries,
            fuel,
            turns,
            saved_work: saved_work.flatten(),
            moves_backward: demands.moves_backward,
            stack,
            context,
            scanned: scanned.map(|[position, bits]| Scanned { position, bits }),
            captures: match program.reports_captures() {
                true => Address::new(CAPTURES, 0),
                false => cells.plus(program.cell_count() as i32 * 4),
            },
            cells,
            words_in_context,
            uses: demands.uses,
            cell_registers,
            saved: pool.saved,
            size: size
                .cast_unsigned()
                .next_multiple_of(MacroAssembler::PUSH_SIZE as u32) as i32,
        }
    }

    /// Free for each operation.
    #[inline]
    pub(crate) fn temporary(&self, index: usize) -> Gpr {
        let register = self.temporaries[index];
        assert!(
            register != CONSTANT,
            "the survey has counted the temporary registers"
        );
        register
    }

    pub(crate) fn cell(&self, cell: u32) -> Location {
        match self.cell_registers.iter().find(|it| it.0 == cell) {
            Some(&(_, register)) => Location::Register(register),
            None => Location::Memory(self.cells.plus(cell as i32 * 4)),
        }
    }

    pub(crate) fn is_used(&self, cell: u32) -> bool {
        self.uses[cell as usize] != Use::None
    }

    pub(crate) fn cell_registers(&self) -> &[(u32, Gpr)] {
        &self.cell_registers
    }

    pub(crate) fn enter(&self, masm: &mut MacroAssembler) {
        if self.size == 0 {
            return;
        }
        masm.sub64(STACK_POINTER, STACK_POINTER, self.size);
        masm.store_registers(self.saved, 8, Address::new(STACK_POINTER, 0));
        if let Some(Location::Memory(address)) = self.context {
            masm.store64(address, CONTEXT);
        }
    }

    pub(crate) fn leave(&self, masm: &mut MacroAssembler) {
        if self.size != 0 {
            masm.load_registers(self.saved, 8, Address::new(STACK_POINTER, 0));
            masm.add64(STACK_POINTER, STACK_POINTER, self.size);
        }
        masm.ret();
    }

    /// Whether `leave` takes hardly more code than a jump to it.
    pub(crate) fn is_left_quickly(&self) -> bool {
        self.saved.is_empty()
    }
}

fn assign_registers(program: &Program, uses: &[Use], pool: &mut Pool) -> Assigned {
    const CANDIDATES: usize = 20;
    let weights = program.cell_weights();
    let by_weight = |&cell: &u32| core::cmp::Reverse(weights[cell as usize]);
    let cells = 0..uses.len() as u32;
    let mut candidates: SmallVec<[u32; 16]> = cells
        .filter(|&it| uses[it as usize] == Use::Alone)
        .collect();
    if candidates.len() > CANDIDATES {
        candidates.select_nth_unstable_by_key(CANDIDATES, by_weight);
        candidates.truncate(CANDIDATES);
    }
    candidates.sort_by_key(by_weight);
    let origins = (0..uses.len() as u32).filter(|&it| uses[it as usize] == Use::Origin);
    let mut assigned: Assigned = origins.map(|it| (it, ORIGIN)).collect();
    for cell in candidates {
        let is_heavy = weights[cell as usize] >= WEIGHT_FOR_SAVED_REGISTER;
        match pool
            .take_free()
            .or_else(|| is_heavy.then(|| pool.take_saved())?)
        {
            Some(register) => assigned.push((cell, register)),
            None => break,
        }
    }
    assigned.sort_unstable();
    assigned
}
