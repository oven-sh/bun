//! Register allocation in one walk over the blocks.
//!
//! A value is in one register or at home. When registers run out, the value that is wanted last leaves. The state at
//! the start of a block is taken from the most frequent of the predecessors that come before it, and moves on the
//! edges make the others agree.

use bun_engine_asm::{Bank, Reg, RegisterSet};

use super::code::{
    AT_HOME, Class, Code, Head, Home, LOCAL, NEVER, Operand, Place, Point, Registers, Role, Site,
    VReg, Wish,
};
use super::liveness::Liveness;
use super::moves::{Move, MoveKind, Sequencer, Spot, SpotKind};
use super::prospects::{Distance, FARTHEST, Prospect, Prospects};
use super::slots::Slots;
use crate::analysis::{Cfg, Frequencies, Loop};
use crate::bitset;
use crate::ir::{Block, Edge, Function, Pool, Span, State, Table};

pub(super) type Mask = u64;

#[inline]
pub(super) fn bit(reg: u8) -> Mask {
    1 << (reg & 63)
}

#[inline]
pub(super) fn registers_in(mut mask: Mask) -> impl Iterator<Item = u8> {
    core::iter::from_fn(move || {
        (mask != 0).then(|| {
            let reg = mask.trailing_zeros() as u8;
            mask &= mask - 1;
            reg
        })
    })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Stored {
    /// Only where a move puts it at home.
    OnDemand,
    /// Right after the definition.
    AtDefinition,
    /// It is at home from the start.
    Always,
}

#[derive(Clone, Copy)]
pub(super) struct Status {
    pub(super) reg: u8,
    pub(super) stored: Stored,
    /// Of a parameter, at the start of its block.
    pub(super) entry_reg: u8,
    /// Where it was last.
    pub(super) former_reg: u8,
    /// Where the header of the last loop that keeps it has it.
    pub(super) loop_reg: u8,
    /// For the values that have this one as their goal.
    pub(super) usual_reg: u8,
    /// The value is a parameter of a loop, which has it in `usual_reg`.
    pub(super) is_awaited: bool,
    /// The block whose scan set `next`.
    pub(super) scanned_in: Block,
    /// The position at which it is wanted next, as of the instruction that the walk is at.
    pub(super) next: Distance,
}

#[derive(Clone, Copy, Default)]
pub(super) struct Snapshot {
    pub(super) occupied: Mask,
    pub(super) clean: Mask,
    pub(super) values: Span<VReg>,
}

/// An instruction of the current block that takes registers for itself.
#[derive(Clone, Copy)]
struct Claim {
    position: u32,
    fixed: Mask,
    clobbered: Mask,
}

/// Registers that others claim while a value or an heir is live.
#[derive(Default)]
struct Contested {
    in_block: Mask,
    later: Mask,
    /// By the instruction that uses it last.
    finally: Mask,
}

/// The result, and tables to use again.
#[derive(Default)]
pub(crate) struct Allocation {
    /// To be done before the instruction at a position. Ascending.
    pub(crate) moves: Vec<(u32, Move)>,
    pub(crate) edge_moves: Table<Edge, Span<Move>>,
    pub(crate) move_lists: Pool<Move>,
    pub(crate) state_assigned: Pool<u8>,
    pub(crate) slots: Slots,
    pub(crate) sequencer: Sequencer,
    pub(super) statuses: Table<VReg, Status>,
    pub(super) entries: Table<Block, Snapshot>,
    pub(super) exits: Table<Block, Snapshot>,
    pub(super) snapshot_values: Pool<VReg>,
    pub(super) loop_registers: Table<Loop, Mask>,
    pub(super) live_out: Vec<u64>,
    /// For each bit of a set of live values, what it stands for where the walk is.
    pub(super) globals: Vec<VReg>,
    pub(super) pending: Vec<Move>,
    pub(super) candidates: Vec<(Distance, VReg)>,
    /// Values that only some predecessors have in a register, the first such register, and the weight of the edges.
    pub(super) sightings: Vec<(VReg, u8, f32)>,
    /// Descending by position.
    claims: Vec<Claim>,
    /// Values whose last use is in the state of the instruction at a position. Descending.
    state_deaths: Vec<(u32, VReg)>,
    scanned_states: Table<State, Block>,
    /// Values that have left the register in which the current instruction found them.
    pub(super) displaced: Vec<(VReg, u8)>,
}

impl Allocation {
    #[inline]
    pub(crate) fn stored(&self, vreg: VReg) -> Stored {
        self.statuses[vreg].stored
    }

    #[inline]
    pub(crate) fn entry_register(&self, param: VReg) -> u8 {
        self.statuses[param].entry_reg
    }

    fn drop_spills_of_what_is_stored_already(&mut self) {
        let statuses = &self.statuses;
        let is_needed = |step: &Move| match (step.kind, step.to.kind()) {
            (MoveKind::Spill, SpotKind::Home(vreg)) => statuses[vreg].stored == Stored::OnDemand,
            _ => true,
        };
        self.moves.retain(|(_, step)| is_needed(step));
        for span in self.edge_moves.values_mut().filter(|span| !span.is_empty()) {
            let (moves, mut kept) = (&mut self.move_lists[*span], 0);
            for index in 0..moves.len() {
                moves[kept] = moves[index];
                kept += usize::from(is_needed(&moves[index]));
            }
            span.truncate(kept);
        }
    }

    #[inline]
    pub(crate) fn moves_on(&self, edge: Edge) -> &[Move] {
        &self.move_lists[self.edge_moves[edge]]
    }
}

pub(super) struct Allocator<'a> {
    pub(super) function: &'a Function,
    pub(super) cfg: &'a Cfg,
    pub(super) frequencies: &'a Frequencies,
    pub(super) liveness: &'a Liveness,
    pub(super) prospects: &'a mut Prospects,
    pub(super) code: &'a mut Code,
    pub(super) out: &'a mut Allocation,
    pub(super) registers: Registers,
    pub(super) banks: [Mask; 2],
    pub(super) value: [VReg; Reg::COUNT],
    pub(super) next: [Distance; Reg::COUNT],
    pub(super) occupied: Mask,
    /// The value in the register has been stored at home on every way here.
    pub(super) clean: Mask,
    pub(super) block: Block,
    pub(super) position: u32,
    /// Registers that values return to at the end of the current loop.
    reserved: Mask,
    /// Changes whenever a value that is defined already changes its place.
    epoch: u32,
    last_state: (State, u32, Span<u8>),
}

/// What the operands of the current instruction take.
#[derive(Default)]
struct Taken {
    /// Nothing else may be there when the instruction starts.
    blocked_early: Mask,
    /// Overwritten by the time it ends.
    blocked_late: Mask,
    upper_halves: Mask,
    read: Mask,
    /// Not for results.
    held: Mask,
    /// Hold operands that can be read at home if others need the room.
    yielding: Mask,
}

impl Taken {
    #[inline]
    fn overwritten(&self, class: Class) -> Mask {
        self.blocked_late
            | if class == Class::Vector {
                self.upper_halves
            } else {
                0
            }
    }
}

const CLAIMS_LOOKED_AT: usize = 4;
const HEIRS_LOOKED_AT: usize = 4;
/// A value that can be read from memory is loaded if it is wanted again within this distance.
pub(super) const SOON: Distance = 64;
/// To keep a register for so long is not worth a move.
const FAR: Distance = 1 << 12;

pub(crate) fn allocate(
    function: &Function,
    cfg: &Cfg,
    frequencies: &Frequencies,
    liveness: &Liveness,
    prospects: &mut Prospects,
    registers: Registers,
    code: &mut Code,
    out: &mut Allocation,
) {
    out.moves.clear();
    out.edge_moves
        .refill(function.edge_count(), Span::default());
    out.move_lists.clear();
    out.state_assigned.clear();
    out.slots.share(function, cfg, code);
    out.sequencer.reset(code.vregs.len());
    out.statuses.clear();
    for data in code.vregs.values() {
        let stored = if data.home == Home::Spill {
            Stored::OnDemand
        } else {
            Stored::Always
        };
        out.statuses.push(Status {
            reg: AT_HOME,
            stored,
            entry_reg: AT_HOME,
            former_reg: AT_HOME,
            loop_reg: AT_HOME,
            usual_reg: AT_HOME,
            is_awaited: false,
            scanned_in: Block::NONE,
            next: FARTHEST,
        });
    }
    out.entries
        .refill(function.block_count(), Snapshot::default());
    out.exits
        .refill(function.block_count(), Snapshot::default());
    out.snapshot_values.clear();
    out.globals.clear();
    out.globals.resize(liveness.words() * 64, VReg::NONE);
    out.loop_registers.refill(cfg.loops().len(), 0);
    out.scanned_states
        .refill(function.state_count(), Block::NONE);
    let mut allocator = Allocator {
        function,
        cfg,
        frequencies,
        liveness,
        prospects,
        code,
        out,
        registers,
        banks: [Bank::Gpr, Bank::Fpr].map(|bank| registers.allocatable.in_bank(bank).bits()),
        value: [VReg::NONE; Reg::COUNT],
        next: [FARTHEST; Reg::COUNT],
        occupied: 0,
        clean: 0,
        block: Block::NONE,
        position: 0,
        reserved: 0,
        epoch: 0,
        last_state: (State::NONE, 0, Span::default()),
    };
    for &block in cfg.order() {
        allocator.allocate_block(block);
    }
    out.drop_spills_of_what_is_stored_already();
}

impl Allocator<'_> {
    fn allocate_block(&mut self, block: Block) {
        let previous = core::mem::replace(&mut self.block, block);
        let data = self.code.blocks[block];
        self.position = data.first;
        let position = self.cfg.position(block) as usize;
        for vreg in self.liveness.starting_at(self.code, position) {
            self.out.globals[self.code.vregs[vreg].global as usize] = vreg;
        }
        self.scan();
        self.enter(previous);
        self.reserved = self
            .cfg
            .loop_of(block)
            .expand()
            .map_or(0, |own| self.out.loop_registers[own]);
        self.epoch += 1;
        for position in data.first..data.end {
            self.position = position;
            if position + 1 == data.end {
                self.anticipate_loop_header();
            }
            self.allocate_instruction();
        }
        self.leave();
    }

    // The scan of a block from its end

    #[inline]
    pub(super) fn is_live_out(&self, vreg: VReg) -> bool {
        let data = &self.code.vregs[vreg];
        if data.global == LOCAL {
            data.is_floating() && data.end > self.code.blocks[self.block].exit()
        } else {
            bitset::contains(&self.out.live_out, data.global as usize)
        }
    }

    /// For a value that is live at the end of the block.
    pub(super) fn prospect_after_block(&self, vreg: VReg) -> Prospect {
        const EVEN: f32 = 0.5;
        let data = &self.code.vregs[vreg];
        let around = self.cfg.loop_of(self.block).expand();
        match around.filter(|_| data.global != LOCAL) {
            _ if data.global != LOCAL && self.prospects.are_known() => {
                self.prospects.after(self.cfg, self.block, data)
            }
            Some(around) => {
                let is_used = bitset::contains(self.liveness.used_in(around), data.global as usize);
                let losses = self.liveness.demand(around, data.class.bank()).losses;
                let is_wanted = is_used || self.prospects.is_kept(around, data.global);
                Prospect {
                    distance: if is_used { SOON / 2 } else { FAR },
                    chance: if is_wanted { 1.0 - losses } else { 0.0 },
                }
            }
            None => Prospect {
                distance: (data.end / 2).saturating_sub(self.code.blocks[self.block].end),
                chance: EVEN,
            },
        }
    }

    /// The position at which a value that is live at the end of the block is wanted after it.
    #[inline]
    pub(super) fn wanted_after_block(&self, vreg: VReg) -> Distance {
        self.code.blocks[self.block].end + self.prospect_after_block(vreg).distance
    }

    /// Returns whether the value is dead after the position that the scan is at.
    #[inline]
    fn sight(&mut self, vreg: VReg) -> bool {
        if self.out.statuses[vreg].scanned_in == self.block {
            return false;
        }
        let is_dead = !self.is_live_out(vreg);
        let next = if is_dead {
            FARTHEST
        } else {
            self.wanted_after_block(vreg)
        };
        let status = &mut self.out.statuses[vreg];
        (status.scanned_in, status.next) = (self.block, next);
        is_dead
    }

    fn scan(&mut self) {
        let data = self.code.blocks[self.block];
        self.liveness
            .live_out(self.function, self.cfg, self.block, &mut self.out.live_out);
        for edge in self.function.successors(self.block) {
            let wanted = data.end + if self.function.is_rare(edge) { FAR } else { 0 };
            for index in self.code.edge_args[edge].range() {
                if let Some(arg) = self.code.vreg_lists.item(index).expand() {
                    self.sight(arg);
                    let status = &mut self.out.statuses[arg];
                    status.next = status.next.min(wanted);
                }
            }
        }
        for position in (data.first..data.end).rev() {
            let head = self.code.heads[position as usize];
            if let Some(site) = head.site.expand() {
                self.scan_state(position, site);
            }
            head.results()
                .for_each(|index| self.scan_operand(index, position));
            if head.has_late_uses {
                // Of two uses of one value, it is the late one after which it dies.
                for role in [Role::LateUse, Role::Use] {
                    for index in head.uses() {
                        if self.code.operands[index].role == role {
                            self.scan_operand(index, position);
                        }
                    }
                }
            } else {
                head.uses()
                    .for_each(|index| self.scan_operand(index, position));
            }
            if head.is_constrained {
                let fixed = self.code.operands[head.operands()]
                    .iter()
                    .filter(|operand| operand.place == Place::Fixed);
                let site = self.code.sites.get(head.site);
                self.out.claims.push(Claim {
                    position,
                    fixed: fixed.fold(0, |mask, operand| mask | bit(operand.fixed_register())),
                    clobbered: site
                        .map_or(0, |site| (site.clobbers_early | site.clobbers_late).bits()),
                });
            }
        }
    }

    #[inline(always)]
    fn scan_operand(&mut self, index: usize, position: u32) {
        let vreg = self.code.operands[index].vreg;
        if !vreg.is_none() {
            let dies = self.sight(vreg);
            let (operand, status) = (&mut self.code.operands[index], &mut self.out.statuses[vreg]);
            operand.set_dies(dies);
            operand.next = status.next;
            if operand.place != Place::ColdAnywhere {
                status.next = position;
            }
        }
    }

    fn scan_state(&mut self, position: u32, site: Site) {
        let site = self.code.sites[site];
        if site.state.is_none()
            || core::mem::replace(&mut self.out.scanned_states[site.state], self.block)
                == self.block
        {
            return;
        }
        for index in site.state_vregs.range() {
            let vreg = self.code.vreg_lists.item(index);
            if vreg != site.recoverable && !self.code.vregs[vreg].is_floating() && self.sight(vreg)
            {
                self.out.state_deaths.push((position, vreg));
            }
        }
    }

    // Registers

    #[inline]
    pub(super) fn bank_of(&self, vreg: VReg) -> Mask {
        self.banks[self.code.vregs[vreg].class.bank() as usize]
    }

    #[inline]
    pub(super) fn occupy(&mut self, reg: u8, vreg: VReg, is_clean: bool) {
        debug_assert!(self.occupied & bit(reg) == 0);
        let status = &mut self.out.statuses[vreg];
        status.reg = reg;
        self.value[usize::from(reg & 63)] = vreg;
        self.next[usize::from(reg & 63)] = status.next;
        self.occupied |= bit(reg);
        self.clean = self.clean & !bit(reg) | if is_clean { bit(reg) } else { 0 };
    }

    #[inline]
    pub(super) fn vacate(&mut self, reg: u8) {
        debug_assert!(self.occupied & bit(reg) != 0);
        let status = &mut self.out.statuses[self.value[usize::from(reg & 63)]];
        (status.reg, status.former_reg) = (AT_HOME, reg);
        self.occupied &= !bit(reg);
    }

    #[inline]
    pub(super) fn is_clean(&self, reg: u8) -> bool {
        self.clean & bit(reg) != 0
            || self.out.statuses[self.value[usize::from(reg & 63)]].stored != Stored::OnDemand
    }

    #[inline]
    pub(super) fn home(&self, vreg: VReg) -> Spot {
        Spot::home(self.out.slots.owner(vreg))
    }

    /// Returns false if the value has to be stored at a place that is run with the given frequency.
    pub(super) fn try_to_store_at_definition(&mut self, vreg: VReg, frequency: f32) -> bool {
        self.out.slots.note_use(vreg);
        let data = &self.code.vregs[vreg];
        let last = self.code.blocks[data.block].end - 1;
        let ends_block = data.start / 2 == last && !self.code.heads[last as usize].site.is_none();
        let is_cheaper = !ends_block && self.frequencies.of_block(data.block) <= frequency;
        if is_cheaper {
            self.out.statuses[vreg].stored = Stored::AtDefinition;
        }
        is_cheaper
    }

    /// Where the value was when the walk came to the current instruction.
    fn origin(&self, vreg: VReg) -> Spot {
        let displaced = self.out.displaced.iter().find(|&&(known, _)| known == vreg);
        match displaced.map_or(self.out.statuses[vreg].reg, |&(_, reg)| reg) {
            AT_HOME => self.home(vreg),
            reg => Spot::register(reg),
        }
    }

    pub(super) fn note_origin(&mut self, vreg: VReg) {
        self.epoch += 1;
        if !self.out.displaced.iter().any(|&(known, _)| known == vreg) {
            self.out.displaced.push((vreg, self.out.statuses[vreg].reg));
        }
    }

    pub(super) fn make_clean(&mut self, reg: u8) {
        if !self.is_clean(reg) {
            let vreg = self.value[usize::from(reg & 63)];
            if !self.try_to_store_at_definition(vreg, self.frequencies.of_block(self.block)) {
                self.out.pending.push(Move::spill(
                    self.origin(vreg),
                    vreg,
                    self.code.vregs[vreg].class,
                ));
            }
            self.clean |= bit(reg);
        }
    }

    fn evict(&mut self, reg: u8) {
        self.make_clean(reg);
        self.note_origin(self.value[usize::from(reg & 63)]);
        self.vacate(reg);
    }

    /// Adds a move from where the value was, in place of any other move to the register.
    pub(super) fn fetch(&mut self, vreg: VReg, reg: u8) {
        let (from, to) = (self.origin(vreg), Spot::register(reg));
        self.out.pending.retain(|step| step.to != to);
        if from != to {
            self.out
                .pending
                .push(Move::new(from, to, self.code.vregs[vreg].class));
        }
    }

    /// Makes a free register the place of a value that is defined already.
    fn bring(&mut self, vreg: VReg, reg: u8) {
        let former = self.out.statuses[vreg].reg;
        self.note_origin(vreg);
        let mut is_clean = true;
        if former != AT_HOME {
            is_clean = self.is_clean(former);
            self.vacate(former);
            self.out
                .pending
                .retain(|step| step.to != Spot::register(former));
        } else if let Stored::OnDemand = self.out.statuses[vreg].stored {
            let is_spilled = |step: &Move| step.to == Spot::home(vreg);
            is_clean =
                self.origin(vreg) == self.home(vreg) || self.out.pending.iter().any(is_spilled);
        }
        self.fetch(vreg, reg);
        self.occupy(reg, vreg, is_clean);
    }

    /// The register among `candidates` whose value is missed least.
    pub(super) fn victim(&self, candidates: Mask) -> Option<u8> {
        registers_in(candidates).max_by_key(|&reg| {
            let distance = u64::from(self.next[usize::from(reg)].saturating_sub(self.position));
            let vreg = self.value[usize::from(reg)];
            if self.code.vregs[vreg].is_floating() {
                distance * 4
            } else if self.is_clean(reg) {
                distance * 2
            } else {
                distance
            }
        })
    }

    fn contested(&self, vreg: VReg) -> Contested {
        let data = &self.code.vregs[vreg];
        let heirs = core::iter::successors(Some(data), |data| self.code.vregs.get(data.heir));
        let ends = heirs.take(HEIRS_LOOKED_AT).map(|data| data.end);
        let end = ends.filter(|&end| end != NEVER).fold(data.end, Point::max);
        let (last, bank) = (end / 2, self.banks[data.class.bank() as usize]);
        let mut contested = Contested::default();
        let claims = self.out.claims.iter().rev();
        let ahead = claims.filter(|claim| claim.position > self.position);
        for claim in ahead
            .take(CLAIMS_LOOKED_AT)
            .take_while(|claim| claim.position <= last)
        {
            if bank & !claim.clobbered == 0 {
                contested.finally |= claim.fixed;
                return contested;
            }
            *if claim.position == last {
                &mut contested.finally
            } else {
                &mut contested.in_block
            } |= claim.fixed | claim.clobbered;
        }
        if end > self.code.blocks[self.block].exit() && end != NEVER {
            contested.later = match self.cfg.loop_of(self.block).expand() {
                Some(around) => self.liveness.claims(around).bits(),
                None => {
                    let edges = self.function.successors(self.block);
                    let likely = edges.filter(|&edge| !self.function.is_rare(edge)).take(2);
                    likely.fold(0, |mask, edge| {
                        mask | self.code.blocks[self.function.target(edge)].claimed.bits()
                    })
                }
            };
        }
        contested
    }

    /// The register in which a loop wants the value back.
    #[inline]
    fn awaited_in(&self, vreg: VReg) -> u8 {
        let goal = &self.out.statuses[self.code.vregs[vreg].goal];
        if goal.is_awaited {
            goal.usual_reg
        } else {
            AT_HOME
        }
    }

    /// The best of `free`, which is not empty.
    pub(super) fn choose(&mut self, vreg: VReg, free: Mask) -> u8 {
        let contested = self.contested(vreg);
        let (data, status) = (&self.code.vregs[vreg], &self.out.statuses[vreg]);
        let wished = match data.wish {
            Wish::Lasting(reg) if free & bit(reg) != 0 => return reg,
            Wish::None => AT_HOME,
            Wish::Weak(reg) | Wish::Firm(reg) | Wish::Lasting(reg) => reg,
        };
        let mut awaited = [status.loop_reg, self.awaited_in(vreg)];
        if awaited[0] != AT_HOME && !self.is_live_out(vreg) {
            awaited.swap(0, 1);
        }
        let is_among =
            |registers: Mask| move |&reg: &u8| reg != AT_HOME && registers & bit(reg) != 0;
        let (safe, usual) = (
            free & !contested.in_block,
            self.out.statuses[data.goal].usual_reg,
        );
        let others = [status.former_reg, wished, usual];
        let found = awaited.into_iter().find(is_among(safe));
        let found = found.or_else(|| others.into_iter().find(is_among(safe & !contested.later)));
        found.unwrap_or_else(|| {
            let mut best = free;
            for unwanted in [
                contested.in_block,
                contested.later,
                contested.finally,
                self.reserved,
                self.registers.kept_by_calls.bits(),
            ] {
                if best & !unwanted != 0 {
                    best &= !unwanted;
                }
            }
            best.trailing_zeros() as u8
        })
    }

    #[inline]
    pub(super) fn settle_preference(&mut self, vreg: VReg, reg: u8) {
        let usual = &mut self.out.statuses[self.code.vregs[vreg].goal].usual_reg;
        if *usual == AT_HOME {
            *usual = reg;
        }
    }

    /// Frees one of `allowed` if none is free.
    #[inline]
    fn free_for_result(&mut self, allowed: Mask, taken: &Taken) -> Mask {
        let free = allowed & !self.occupied;
        if free != 0 {
            return free;
        }
        let victim = self.victim(allowed & !taken.yielding).unwrap_or_else(|| {
            let victim = self
                .victim(allowed)
                .expect("an instruction needs more registers than there are");
            self.reassign_uses(victim, AT_HOME, |operand| operand.role == Role::LateUse);
            victim
        });
        self.evict(victim);
        bit(victim)
    }

    /// Frees one of `suitable` if none is free, for what is there when the instruction starts.
    fn free_at_start(&mut self, suitable: Mask, taken: &mut Taken) -> Mask {
        let allowed = suitable & !taken.blocked_early & !taken.read & !taken.held;
        let free = allowed & !self.occupied;
        if free != 0 {
            return free;
        }
        if allowed == 0 {
            return self.move_early_use_aside(suitable, taken);
        }
        let victim = self.victim(allowed & !taken.yielding).unwrap_or_else(|| {
            let victim = self.victim(allowed).unwrap();
            self.reassign_uses(victim, AT_HOME, |_| true);
            victim
        });
        self.evict(victim);
        bit(victim)
    }

    /// What is read at the start can make do with a register that is overwritten later.
    #[cold]
    fn move_early_use_aside(&mut self, suitable: Mask, taken: &mut Taken) -> Mask {
        let movable = suitable & taken.read & !taken.held & !taken.blocked_early;
        assert!(
            movable != 0,
            "an instruction needs more registers than there are"
        );
        let former = movable.trailing_zeros() as u8;
        let vreg = self.value[usize::from(former)];
        let reg = self
            .free_at_start(self.bank_of(vreg) & !suitable & !taken.read, taken)
            .trailing_zeros() as u8;
        self.make_clean(former);
        self.bring(vreg, reg);
        self.reassign_uses(former, reg, |_| true);
        taken.read = taken.read & !bit(former) | bit(reg);
        bit(former)
    }

    fn reassign_uses(&mut self, from: u8, to: u8, applies: impl Fn(Operand) -> bool) {
        for operand in &mut self.code.operands[self.code.heads[self.position as usize].operands()] {
            if operand.is_use()
                && operand.place != Place::Fixed
                && operand.assigned() == from
                && applies(*operand)
            {
                operand.assign(to);
            }
        }
    }

    // Instructions

    #[inline(always)]
    fn allocate_instruction(&mut self) {
        let head = self.code.heads[self.position as usize];
        let mut taken = Taken::default();
        if !head.is_plain || !self.find_uses_in_registers(head) {
            self.place_what_is_there_at_the_start(head, &mut taken);
        }
        for index in head.uses() {
            let operand = self.code.operands[index];
            if operand.place != Place::Given && operand.next != self.position {
                let status = &mut self.out.statuses[operand.vreg];
                status.next = operand.next;
                let reg = status.reg;
                if reg != AT_HOME {
                    self.next[usize::from(reg & 63)] = operand.next;
                    if operand.role == Role::Use && operand.dies() {
                        self.vacate(reg);
                    }
                }
            }
        }
        if head.is_constrained {
            self.drop_overwritten(&taken);
        }
        let mut results = 0;
        for index in head.results() {
            let operand = self.code.operands[index];
            if operand.role == Role::Def {
                self.out.statuses[operand.vreg].next = operand.next;
                let reg = self.register_for_result(operand, &head.operands(), &taken, results);
                self.code.operands[index].assign(reg);
                self.occupy(reg, operand.vreg, false);
                results |= bit(reg);
            } else if operand.role == Role::EarlyDef {
                results |= bit(operand.assigned());
            }
        }
        if let Some(site) = head.site.expand() {
            self.record_state(site, head.operands());
        }
        if !self.out.pending.is_empty() {
            self.flush_moves();
        }
        self.out.displaced.clear();

        for index in if head.has_late_uses {
            head.operands()
        } else {
            head.results()
        } {
            let operand = self.code.operands[index];
            if operand.dies() && operand.role != Role::Use {
                let reg = self.out.statuses[operand.vreg].reg;
                if reg != AT_HOME {
                    self.vacate(reg);
                }
            }
        }
        if let Some(site) = head.site.expand() {
            self.leave_site(site, results);
        }
        if head.is_constrained {
            self.out.claims.pop();
        }
    }

    /// Returns whether all are.
    #[inline(always)]
    fn find_uses_in_registers(&mut self, head: Head) -> bool {
        self.code.operands[head.uses()].iter_mut().all(|operand| {
            if operand.place != Place::Given {
                operand.assign(self.out.statuses[operand.vreg].reg);
            }
            operand.assigned() != AT_HOME
        })
    }

    fn place_what_is_there_at_the_start(&mut self, head: Head, taken: &mut Taken) {
        if head.is_constrained {
            self.make_way(head.operands(), head.site, taken);
        }
        let mut has_absent_uses = false;
        for index in head.uses() {
            let operand = self.code.operands[index];
            if matches!(operand.place, Place::Given | Place::Fixed) {
                continue;
            }
            let reg = self.out.statuses[operand.vreg].reg;
            let is_late = operand.role == Role::LateUse;
            if reg == AT_HOME
                || is_late && taken.overwritten(self.code.vregs[operand.vreg].class) & bit(reg) != 0
            {
                has_absent_uses = true;
            } else {
                self.assign_use(index, reg, taken);
            }
        }
        if has_absent_uses {
            self.bring_uses(head.uses(), taken);
        }
        self.assign_temps(head.results(), taken);
    }

    pub(super) fn flush_moves(&mut self) {
        let Allocation {
            sequencer,
            pending,
            moves,
            ..
        } = &mut *self.out;
        let position = self.position;
        sequencer.sequence(pending, self.registers.swaps_gprs, |step| {
            moves.push((position, step))
        });
    }

    /// Clears the registers that the instruction claims, and fills those that operands have to be in.
    fn make_way(&mut self, operands: core::ops::Range<usize>, site: Site, taken: &mut Taken) {
        if let Some(site) = site.expand() {
            let site = &self.code.sites[site];
            taken.blocked_early = site.clobbers_early.bits();
            taken.blocked_late = site.clobbers_late.bits();
            taken.upper_halves = site.clobbers_upper_halves.bits();
        }
        let (mut in_place, mut dying, mut wanted_elsewhere) = (0, 0, 0);
        for &operand in &self.code.operands[operands.clone()] {
            let current = if operand.is_use() && operand.place != Place::Given {
                self.out.statuses[operand.vreg].reg
            } else {
                AT_HOME
            };
            let current_bit = if current == AT_HOME { 0 } else { bit(current) };
            if operand.role == Role::Use && operand.dies() {
                dying |= current_bit;
            }
            if operand.place != Place::Fixed {
                wanted_elsewhere |= current_bit;
                continue;
            }
            let fixed = bit(operand.fixed_register());
            in_place |= fixed & current_bit;
            if operand.role == Role::Def {
                taken.blocked_late |= fixed;
            } else {
                taken.blocked_early |= fixed;
                taken.held |= if operand.role == Role::Use { 0 } else { fixed };
            }
        }

        let unsafe_registers = taken.blocked_early | taken.blocked_late | taken.upper_halves;
        for reg in registers_in(self.occupied & unsafe_registers) {
            let vreg = self.value[usize::from(reg)];
            let overwritten = taken.overwritten(self.code.vregs[vreg].class);
            let must_leave = taken.blocked_early & !in_place & bit(reg) != 0;
            let survives = dying & bit(reg) == 0;
            if !must_leave && !(survives && overwritten & bit(reg) != 0) {
                continue;
            }
            if !survives && wanted_elsewhere & bit(reg) == 0 {
                self.note_origin(vreg);
                self.vacate(reg);
                continue;
            }
            let shelters = self.bank_of(vreg)
                & !self.occupied
                & !taken.blocked_early
                & !if survives { overwritten } else { 0 };
            let is_worth_a_register = !self.code.vregs[vreg].is_floating()
                && (!self.is_clean(reg)
                    || self.next[usize::from(reg)]
                        - self.position.min(self.next[usize::from(reg)])
                        < FAR);
            if shelters != 0 && is_worth_a_register {
                let shelter = self.choose(vreg, shelters);
                self.bring(vreg, shelter);
            } else if must_leave {
                self.evict(reg);
            } else {
                self.make_clean(reg);
            }
        }

        for index in operands {
            let operand = self.code.operands[index];
            if operand.place != Place::Fixed {
                continue;
            }
            let reg = operand.fixed_register();
            self.code.operands[index].assign(reg);
            if !operand.is_use() {
                if operand.role == Role::EarlyDef {
                    self.out.statuses[operand.vreg].next = operand.next;
                    self.occupy(reg, operand.vreg, false);
                }
                continue;
            }
            taken.read |= bit(reg);
            let current = self.out.statuses[operand.vreg].reg;
            if current == reg {
                continue;
            }
            let overwritten = taken.overwritten(self.code.vregs[operand.vreg].class);
            let dies_early = current != AT_HOME && dying & bit(current) != 0;
            let is_settled = current != AT_HOME && taken.read & bit(current) != 0;
            if !is_settled && (dies_early || overwritten & bit(reg) == 0 && current == AT_HOME) {
                self.bring(operand.vreg, reg);
                dying |= if dies_early { bit(reg) } else { 0 };
            } else {
                self.fetch(operand.vreg, reg);
            }
        }
    }

    #[inline]
    fn assign_use(&mut self, index: usize, reg: u8, taken: &mut Taken) {
        let operand = self.code.operands[index];
        self.code.operands[index].assign(reg);
        if self.can_be_read_at_home(operand) {
            taken.yielding |= bit(reg);
        } else {
            taken.read |= bit(reg);
            taken.held |= if operand.role == Role::LateUse {
                bit(reg)
            } else {
                0
            };
        }
    }

    #[inline]
    fn can_be_read_at_home(&self, operand: Operand) -> bool {
        let data = &self.code.vregs[operand.vreg];
        match operand.place {
            Place::Anywhere | Place::ColdAnywhere => true,
            Place::RegisterOrMemory => {
                !data.is_floating()
                    || self.registers.addresses_float_constants && data.class.bank() == Bank::Fpr
            }
            _ => false,
        }
    }

    fn bring_uses(&mut self, operands: core::ops::Range<usize>, taken: &mut Taken) {
        for needs_register in [true, false] {
            for index in operands.clone() {
                let operand = self.code.operands[index];
                let is_open = operand.place != Place::Fixed && operand.assigned() == AT_HOME;
                if !is_open || self.can_be_read_at_home(operand) == needs_register {
                    continue;
                }
                let is_late = operand.role == Role::LateUse;
                let (bank, overwritten) = (
                    self.bank_of(operand.vreg),
                    taken.overwritten(self.code.vregs[operand.vreg].class),
                );
                let former = self.out.statuses[operand.vreg].reg;
                if former != AT_HOME && !(is_late && overwritten & bit(former) != 0) {
                    self.assign_use(index, former, taken);
                    continue;
                }
                let lasting = bank & !overwritten;
                let free_and_lasting =
                    lasting & !taken.blocked_early & !taken.read & !self.occupied;
                let free = if needs_register {
                    let has_choice = !is_late && (operand.dies() || free_and_lasting == 0);
                    self.free_at_start(if has_choice { bank } else { lasting }, taken)
                } else {
                    let wanted_in = operand.next - self.position;
                    if operand.place == Place::ColdAnywhere
                        || operand.dies()
                        || wanted_in >= SOON
                        || free_and_lasting == 0
                    {
                        continue;
                    }
                    free_and_lasting
                };
                let reg = self.choose(operand.vreg, free);
                let former = self.out.statuses[operand.vreg].reg;
                self.bring(operand.vreg, reg);
                if former != AT_HOME {
                    self.reassign_uses(former, reg, |_| true);
                    taken.read &= !bit(former) | taken.blocked_early;
                    for other in operands.clone() {
                        let other_operand = self.code.operands[other];
                        if other_operand.place != Place::Fixed && other_operand.assigned() == reg {
                            self.assign_use(other, reg, taken);
                        }
                    }
                }
                if !operand.dies() && overwritten & bit(reg) != 0 {
                    self.make_clean(reg);
                }
                self.assign_use(index, reg, taken);
            }
        }
    }

    fn assign_temps(&mut self, operands: core::ops::Range<usize>, taken: &mut Taken) {
        for index in operands {
            let operand = self.code.operands[index];
            if !matches!(operand.role, Role::EarlyDef | Role::Temp) || operand.place == Place::Fixed
            {
                continue;
            }
            let lasting = !taken.blocked_late & !taken.upper_halves;
            let reg = if operand.role == Role::Temp {
                let free =
                    self.free_at_start(self.banks[operand.temp_bank() as usize] & lasting, taken);
                let unwanted = self.registers.kept_by_calls.bits();
                (if free & !unwanted != 0 {
                    free & !unwanted
                } else {
                    free
                })
                .trailing_zeros() as u8
            } else {
                let free = self.free_at_start(self.bank_of(operand.vreg) & lasting, taken);
                let reg = self.choose(operand.vreg, free);
                self.settle_preference(operand.vreg, reg);
                self.out.statuses[operand.vreg].next = operand.next;
                self.occupy(reg, operand.vreg, false);
                reg
            };
            self.code.operands[index].assign(reg);
            taken.held |= bit(reg);
        }
    }

    /// Once the results have their registers.
    fn record_state(&mut self, site: Site, operands: core::ops::Range<usize>) {
        let data = &mut self.code.sites[site];
        if data.state.is_none() {
            return;
        }
        if (data.state, self.epoch) == (self.last_state.0, self.last_state.1) {
            data.state_assigned = self.last_state.2;
            return;
        }
        let place_of = |&vreg: &VReg| {
            if vreg == data.recoverable {
                let mut operands = self.code.operands[operands.clone()].iter();
                operands
                    .find(|operand| operand.vreg == vreg)
                    .map_or(AT_HOME, |operand| operand.assigned())
            } else if self.code.vregs[vreg].is_floating() {
                AT_HOME
            } else {
                self.out.statuses[vreg].reg
            }
        };
        let has_left = data.recoverable.expand().is_some_and(|vreg| {
            let reg = self.out.statuses[vreg].reg;
            reg == AT_HOME || reg != place_of(&vreg)
        });
        data.state_assigned = self
            .out
            .state_assigned
            .add(self.code.vreg_lists[data.state_vregs].iter().map(place_of));
        self.last_state = (
            if has_left { State::NONE } else { data.state },
            self.epoch,
            data.state_assigned,
        );
    }

    fn drop_overwritten(&mut self, taken: &Taken) {
        for reg in registers_in(self.occupied & (taken.blocked_late | taken.upper_halves)) {
            if taken.overwritten(self.code.vregs[self.value[usize::from(reg)]].class) & bit(reg)
                != 0
            {
                debug_assert!(self.is_clean(reg));
                self.epoch += 1;
                self.vacate(reg);
            }
        }
    }

    #[inline]
    fn register_for_result(
        &mut self,
        operand: Operand,
        operands: &core::ops::Range<usize>,
        taken: &Taken,
        results: Mask,
    ) -> u8 {
        if operand.place == Place::Fixed {
            return operand.fixed_register();
        }
        let allowed = self.bank_of(operand.vreg)
            & !taken.blocked_late
            & !taken.upper_halves
            & !taken.held
            & !results;
        let expected = match self.code.vregs[operand.vreg].wish {
            Wish::Lasting(reg) if allowed & !self.occupied & bit(reg) != 0 => return reg,
            Wish::Firm(reg) => reg,
            _ => self.awaited_in(operand.vreg),
        };
        if expected != AT_HOME && allowed & bit(expected) != 0 {
            if self.occupied & !taken.yielding & bit(expected) != 0 {
                self.clear_if_it_comes_to_that(expected, operands, taken, results);
            }
            if self.occupied & bit(expected) == 0
                && (self.out.claims.is_empty()
                    || self.contested(operand.vreg).in_block & bit(expected) == 0)
            {
                self.settle_preference(operand.vreg, expected);
                return expected;
            }
        }
        for tie in operand.ties().filter(|&tie| tie < operands.len()) {
            let reg = self.code.operands[operands.start + tie].assigned();
            if usize::from(reg) < Reg::COUNT
                && allowed & !self.occupied & bit(reg) != 0
                && (self.out.claims.is_empty()
                    || self.contested(operand.vreg).in_block & bit(reg) == 0)
            {
                self.settle_preference(operand.vreg, reg);
                return reg;
            }
        }
        let free = self.free_for_result(allowed, taken);
        let reg = self.choose(operand.vreg, free);
        self.settle_preference(operand.vreg, reg);
        reg
    }

    /// Has the value in the register leave now if it has to soon anyway.
    fn clear_if_it_comes_to_that(
        &mut self,
        reg: u8,
        operands: &core::ops::Range<usize>,
        taken: &Taken,
        results: Mask,
    ) {
        let vreg = self.value[usize::from(reg)];
        if self.out.displaced.iter().any(|&(known, _)| known == vreg) {
            return;
        }
        let bank = self.bank_of(vreg);
        let before_use = self.position + 1..self.next[usize::from(reg)];
        let ahead = self.out.claims.iter().rev().take(CLAIMS_LOOKED_AT);
        let mut barriers = ahead.filter(|claim| bank & !claim.clobbered == 0);
        if barriers.any(|claim| before_use.contains(&claim.position)) {
            return self.evict(reg);
        }
        let destination = match self.code.vregs[vreg].wish {
            Wish::Firm(wished) if self.code.vregs[vreg].global == LOCAL => wished,
            _ if self.is_live_out(vreg) => return,
            _ => self.awaited_in(vreg),
        };
        if destination == AT_HOME || bank & !self.occupied & bit(destination) == 0 {
            return;
        }
        let operands = self.code.operands[operands.clone()].iter();
        let assigned = operands.filter(|operand| operand.assigned() != AT_HOME);
        let unavailable = assigned.fold(0, |mask, it| mask | bit(it.assigned()))
            | taken.blocked_early
            | taken.overwritten(Class::Vector)
            | results;
        if (unavailable | self.contested(vreg).in_block) & bit(destination) == 0 {
            self.bring(vreg, destination);
        }
    }

    fn leave_site(&mut self, site: Site, results: Mask) {
        while let Some(&(position, vreg)) = self.out.state_deaths.last()
            && position == self.position
        {
            self.out.state_deaths.pop();
            let reg = self.out.statuses[vreg].reg;
            if reg != AT_HOME {
                self.vacate(reg);
            }
        }
        if self.code.sites[site].is_exit {
            return;
        }
        let live = self.occupied & !results;
        let is_vector =
            |&reg: &u8| self.code.vregs[self.value[usize::from(reg)]].class == Class::Vector;
        let vectors = registers_in(live & self.banks[Bank::Fpr as usize]).filter(is_vector);
        let live_vectors = vectors.fold(0, |mask, reg| mask | bit(reg));
        let data = &mut self.code.sites[site];
        data.live_registers = RegisterSet::from_bits(live);
        data.live_vectors = RegisterSet::from_bits(live_vectors);
    }
}
