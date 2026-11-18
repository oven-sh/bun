//! The state of the registers where blocks start and end.

use bun_engine_asm::Reg;

use super::allocate::{Allocator, Snapshot, Stored, bit, registers_in};
use super::code::{AT_HOME, LOCAL, NEVER, VReg};
use super::moves::{Move, Spot};
use super::prospects::Distance;
use crate::bitset;
use crate::ir::{Block, Boundary, Edge, Entry, Op};

impl Allocator<'_> {
    fn snapshot(&mut self) -> Snapshot {
        let values = self
            .out
            .snapshot_values
            .add(registers_in(self.occupied).map(|reg| self.value[usize::from(reg)]));
        Snapshot {
            occupied: self.occupied,
            clean: self.clean & self.occupied,
            values,
        }
    }

    fn vacate_all(&mut self) {
        registers_in(self.occupied).for_each(|reg| self.vacate(reg));
    }

    fn restore(&mut self, snapshot: Snapshot) {
        self.vacate_all();
        for (reg, index) in registers_in(snapshot.occupied).zip(snapshot.values.range()) {
            self.occupy(
                reg,
                self.out.snapshot_values.item(index),
                snapshot.clean & bit(reg) != 0,
            );
        }
    }

    /// `live` is the set for an edge to `block`.
    #[inline]
    pub(super) fn is_live_in(&self, vreg: VReg, block: Block, live: &[u64]) -> bool {
        let data = &self.code.vregs[vreg];
        if data.global == LOCAL {
            data.is_floating() && data.end >= self.code.blocks[block].entry()
        } else {
            bitset::contains(live, data.global as usize)
        }
    }

    pub(super) fn is_used(&self, param: VReg) -> bool {
        !param.is_none() && self.code.vregs[param].end != NEVER
    }

    pub(super) fn know_next_use(&mut self, vreg: VReg) -> Distance {
        if self.out.statuses[vreg].scanned_in != self.block {
            let next = self.wanted_after_block(vreg);
            let status = &mut self.out.statuses[vreg];
            (status.scanned_in, status.next) = (self.block, next);
        }
        self.out.statuses[vreg].next
    }

    pub(super) fn leave(&mut self) {
        let mut needs_snapshot = false;
        for edge in self.function.successors(self.block) {
            if self.cfg.is_backward(self.function, edge) {
                self.conform(edge);
            } else {
                needs_snapshot = true;
            }
        }
        if needs_snapshot {
            self.out.exits[self.block] = self.snapshot();
        }
    }

    /// The registers are as `previous` left them.
    pub(super) fn enter(&mut self, previous: Block) {
        let (block, function, cfg) = (self.block, self.function, self.cfg);
        let predecessors = cfg.predecessors(block);
        let earlier = || {
            predecessors
                .iter()
                .copied()
                .filter(|&edge| !cfg.is_backward(function, edge))
        };
        let Some(main) = earlier().max_by(|&a, &b| self.weight(a).total_cmp(&self.weight(b)))
        else {
            let entry = *function
                .entries()
                .iter()
                .find(|entry| entry.block == block)
                .unwrap();
            return self.enter_function(entry);
        };
        if function.source(main) != previous {
            self.restore(self.out.exits[function.source(main)]);
        }
        let has_params = !self.code.params(block).is_empty();
        let live = self.liveness.live_along(function, cfg, main);
        if has_params {
            self.rename_dying_args(main, live);
        }
        for reg in registers_in(self.occupied) {
            let vreg = self.value[usize::from(reg)];
            if self.code.vregs[vreg].start == self.code.blocks[block].entry()
                || self.is_live_in(vreg, block, live)
            {
                self.next[usize::from(reg)] = self.know_next_use(vreg);
            } else {
                self.vacate(reg);
            }
        }
        if predecessors.len() == 1 && !has_params {
            return;
        }

        let headed = cfg.loop_headed_by(block);
        if let Some(headed) = headed {
            self.prepare_for_loop(headed, main);
        } else {
            self.reconcile_predecessors(main, live);
        }
        for index in self.code.blocks[block].params.range() {
            let param = self.code.vreg_lists.item(index);
            if self.is_used(param) {
                let status = &mut self.out.statuses[param];
                status.entry_reg = status.reg;
                if status.reg == AT_HOME {
                    status.stored = Stored::Always;
                    self.out.slots.note_use(param);
                }
            }
        }
        let entry = self.snapshot();
        self.out.entries[block] = entry;
        for edge in earlier() {
            self.restore(self.out.exits[function.source(edge)]);
            self.conform(edge);
        }
        self.restore(entry);
    }

    fn enter_function(&mut self, entry: Entry) {
        self.vacate_all();
        for (index, &boundary) in self.code.blocks[entry.block]
            .params
            .range()
            .zip(self.function.entry_params(entry))
        {
            let param = self.code.vreg_lists.item(index);
            if let Boundary::Register(reg) = boundary
                && self.is_used(param)
            {
                let reg = reg.index() as u8;
                self.out.statuses[param].entry_reg = reg;
                self.know_next_use(param);
                self.occupy(reg, param, false);
                self.settle_preference(param, reg);
            }
        }
    }

    fn rename_dying_args(&mut self, edge: Edge, live: &[u64]) {
        for (param, arg) in self.code.blocks[self.block]
            .params
            .range()
            .zip(self.code.edge_args[edge].range())
        {
            let (param, arg) = (
                self.code.vreg_lists.item(param),
                self.code.vreg_lists.item(arg),
            );
            if !self.is_used(param) {
                continue;
            }
            let reg = self.out.statuses[arg].reg;
            if reg != AT_HOME && !self.is_live_in(arg, self.block, live) {
                self.vacate(reg);
                self.occupy(reg, param, false);
                self.settle_preference(param, reg);
            }
        }
    }

    /// Before a branch that goes back to a header, does what the edge would have to do, as far as the other edge does
    /// not mind.
    pub(super) fn anticipate_loop_header(&mut self) {
        let mut edges = self.function.successors(self.block);
        if edges.len() != 2
            || !matches!(
                self.function.op(self.function.last(self.block)),
                Op::Branch(_)
            )
        {
            return;
        }
        let Some(edge) = edges.find(|&edge| {
            self.cfg.is_backward(self.function, edge) && !self.function.is_rare(edge)
        }) else {
            return;
        };
        let target = self.function.target(edge);
        let entry = self.out.entries[target];
        let mut wanted = [VReg::NONE; Reg::COUNT];
        for (reg, index) in registers_in(entry.occupied).zip(entry.values.range()) {
            wanted[usize::from(reg)] = self.out.snapshot_values.item(index);
        }
        for (param, arg) in self.code.blocks[target]
            .params
            .range()
            .zip(self.code.edge_args[edge].range())
        {
            let (param, arg) = (
                self.code.vreg_lists.item(param),
                self.code.vreg_lists.item(arg),
            );
            if !self.is_used(param) {
                continue;
            }
            let (entry_reg, reg) = (
                self.out.statuses[param].entry_reg,
                self.out.statuses[arg].reg,
            );
            if entry_reg != AT_HOME {
                wanted[usize::from(entry_reg)] = arg;
            } else if reg != AT_HOME && self.home(param) == self.home(arg) {
                self.make_clean(reg);
            }
        }

        let (mut targets, mut claimed_sources) = (0, 0);
        let is_settled = |reg: u8| {
            self.occupied & bit(reg) != 0
                && self.value[usize::from(reg)] == wanted[usize::from(reg)]
        };
        for reg in registers_in(entry.occupied).filter(|&reg| !is_settled(reg)) {
            let vreg = wanted[usize::from(reg)];
            let current = self.out.statuses[vreg].reg;
            let is_first =
                current == AT_HOME || !is_settled(current) && claimed_sources & bit(current) == 0;
            let is_repeated = registers_in(targets).any(|other| wanted[usize::from(other)] == vreg);
            if is_first && !is_repeated {
                targets |= bit(reg);
                claimed_sources |= if current == AT_HOME { 0 } else { bit(current) };
            }
        }
        // A register can be filled if it is free or its value moves on.
        loop {
            let currents =
                registers_in(targets).map(|reg| self.out.statuses[wanted[usize::from(reg)]].reg);
            let leaving = currents
                .filter(|&reg| reg != AT_HOME)
                .fold(0, |mask, reg| mask | bit(reg));
            let blocked = targets & self.occupied & !leaving;
            if blocked == 0 {
                break;
            }
            targets &= !blocked;
        }
        let mut clean = 0;
        for reg in registers_in(targets) {
            let vreg = wanted[usize::from(reg)];
            let current = self.out.statuses[vreg].reg;
            self.know_next_use(vreg);
            self.note_origin(vreg);
            if current == AT_HOME || self.is_clean(current) {
                clean |= bit(reg);
            }
            if current != AT_HOME {
                self.vacate(current);
            }
        }
        for reg in registers_in(targets) {
            self.fetch(wanted[usize::from(reg)], reg);
            self.occupy(reg, wanted[usize::from(reg)], clean & bit(reg) != 0);
        }
        self.flush_moves();
        self.out.displaced.clear();
    }

    #[inline]
    fn place_of(&self, vreg: VReg) -> Spot {
        match self.out.statuses[vreg].reg {
            AT_HOME => self.home(vreg),
            reg => Spot::register(reg),
        }
    }

    /// Finds the moves from the present state, that at the end of the source, to that at the start of the target.
    fn conform(&mut self, edge: Edge) {
        let target = self.function.target(edge);
        let entry = self.out.entries[target];
        let entry_point = self.code.blocks[target].entry();
        let live = self.liveness.live_along(self.function, self.cfg, edge);
        let (equal, constant) = self.code.edge_equalities[edge];
        let mut settled = 0;
        for (reg, index) in registers_in(entry.occupied).zip(entry.values.range()) {
            let vreg = self.out.snapshot_values.item(index);
            let data = &self.code.vregs[vreg];
            if data.start == entry_point && data.block == target {
                continue;
            }
            let current = self.out.statuses[vreg].reg;
            if current != reg {
                self.out.pending.push(Move::new(
                    self.place_of(vreg),
                    Spot::register(reg),
                    data.class,
                ));
            }
            if current != AT_HOME && entry.clean & bit(reg) == 0 {
                settled |= bit(current);
            }
        }
        for reg in registers_in(self.occupied & !settled) {
            let vreg = self.value[usize::from(reg)];
            if !self.is_clean(reg)
                && self.is_live_in(vreg, target, live)
                && !self.try_to_store_at_definition(vreg, self.frequencies.of_edge(edge))
            {
                self.out.pending.push(Move::spill(
                    Spot::register(reg),
                    vreg,
                    self.code.vregs[vreg].class,
                ));
            }
        }
        for (param, arg) in self.code.blocks[target]
            .params
            .range()
            .zip(self.code.edge_args[edge].range())
        {
            let (param, arg) = (
                self.code.vreg_lists.item(param),
                self.code.vreg_lists.item(arg),
            );
            if !self.is_used(param) {
                continue;
            }
            let (mut from, class) = (self.place_of(arg), self.code.vregs[param].class);
            let to = match self.out.statuses[param].entry_reg {
                AT_HOME => self.home(param),
                reg => Spot::register(reg),
            };
            if arg == equal && from != to && !from.is_register() {
                from = Spot::home(constant);
            }
            let is_there =
                from == to || to == self.home(arg) && self.is_clean(self.out.statuses[arg].reg);
            if !is_there {
                self.out.pending.push(Move::new(from, to, class));
            }
        }
        if !self.out.pending.is_empty() {
            let start = self.out.move_lists.end();
            let (sequencer, lists) = (&mut self.out.sequencer, &mut self.out.move_lists);
            sequencer.sequence(&mut self.out.pending, self.registers.swaps_gprs, |step| {
                lists.append(step)
            });
            self.out.edge_moves[edge] = self.out.move_lists.span_from(start);
        }
    }
}
