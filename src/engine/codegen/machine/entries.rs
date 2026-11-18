//! Chooses what is in registers at the start of a block that several edges lead to.

use bun_engine_asm::{Bank, Reg};

use super::allocate::{Allocator, Mask, SOON, bit, registers_in};
use super::code::{AT_HOME, LOCAL, VReg, Wish};
use super::prospects::Distance;
use crate::analysis::Loop;
use crate::bitset;
use crate::ir::Edge;

/// An edge that weighs this many times less than the main one adapts to it at any cost.
const NEGLIGIBLE: f32 = 16.0;
/// Moves on an edge that shares both its source and its target with others take a jump as well.
const WEIGHT_OF_DETOUR: f32 = 1.5;
/// What a value in memory costs an instruction that can read it there, compared to a load.
const COST_OF_MEMORY_OPERAND: f32 = 0.25;
/// Loops that matter take more turns than the frequencies say.
const WEIGHT_OF_USE_AFTER_LOOP: f32 = 0.25;
const SPARE_REGISTERS: i32 = 2;

impl Allocator<'_> {
    /// What a move on the edge costs.
    pub(super) fn weight(&self, edge: Edge) -> f32 {
        let is_alone = self.function.successors(self.function.source(edge)).len() == 1;
        self.frequencies.of_edge(edge) * if is_alone { 1.0 } else { WEIGHT_OF_DETOUR }
    }

    fn give_register(&mut self, vreg: VReg, free: Mask, is_clean: bool) {
        let reg = self.choose(vreg, free);
        self.settle_preference(vreg, reg);
        self.occupy(reg, vreg, is_clean);
    }

    fn is_param(&self, vreg: VReg) -> bool {
        self.code.vregs[vreg].start == self.code.blocks[self.block].entry()
    }

    fn collect_absent_params(&mut self) {
        for index in self.code.blocks[self.block].params.range() {
            let param = self.code.vreg_lists.item(index);
            if self.is_used(param) && self.out.statuses[param].reg == AT_HOME {
                let next = self.know_next_use(param);
                self.out.candidates.push((next, param));
            }
        }
    }

    /// The chance that a value is wanted in a register before all are lost, from the start of the block.
    fn chance_of_use(&self, vreg: VReg, next: Distance) -> f32 {
        let (block, data) = (&self.code.blocks[self.block], &self.code.vregs[vreg]);
        let barrier = block.barrier[data.class.bank() as usize];
        if barrier != 0 {
            f32::from(next < block.first + barrier)
        } else if next <= block.end {
            1.0
        } else if self.is_live_out(vreg) {
            self.prospect_after_block(vreg).chance
        } else {
            0.0
        }
    }

    /// The loads that it saves to have the value in a register, each time the block runs.
    fn benefit(&self, vreg: VReg, next: Distance) -> f32 {
        let data = &self.code.vregs[vreg];
        let is_addressable = data.is_floating()
            && data.class.bank() == Bank::Fpr
            && self.registers.addresses_float_constants;
        self.chance_of_use(vreg, next)
            * if is_addressable {
                COST_OF_MEMORY_OPERAND
            } else {
                1.0
            }
    }

    /// The edges from earlier blocks whose state counts, with their weights.
    fn contenders(&self, main: Edge) -> impl Iterator<Item = (Edge, f32)> + use<'_> {
        let least = self.weight(main) / NEGLIGIBLE;
        let edges = self.cfg.predecessors(self.block).iter();
        edges
            .filter(|&&edge| !self.cfg.is_backward(self.function, edge))
            .map(|&edge| (edge, self.weight(edge)))
            .filter(move |&(_, weight)| weight > least)
    }

    /// The registers are as the source of `main` left them.
    pub(super) fn reconcile_predecessors(&mut self, main: Edge, live: &[u64]) {
        let (mut absent, mut dirty) = ([0.0; Reg::COUNT], [0.0; Reg::COUNT]);
        let (mut total, mut disputed) = (0.0, 0);
        let mut sightings = core::mem::take(&mut self.out.sightings);
        sightings.clear();
        for (edge, weight) in self.contenders(main) {
            total += weight;
            let exit = self.out.exits[self.function.source(edge)];
            let (mut present, mut unsaved) = (self.occupied, self.occupied & !self.clean);
            if edge != main {
                (present, unsaved) = (0, 0);
                let values = &self.out.snapshot_values[exit.values];
                for (reg, &vreg) in registers_in(exit.occupied).zip(values) {
                    let here = self.out.statuses[vreg].reg;
                    if here != AT_HOME {
                        present |= bit(here);
                        unsaved |= if exit.clean & bit(reg) == 0 {
                            bit(here)
                        } else {
                            0
                        };
                    } else if self.prospects.are_known() && self.is_live_in(vreg, self.block, live)
                    {
                        match sightings.iter_mut().find(|known| known.0 == vreg) {
                            Some(known) => known.2 += weight,
                            None => sightings.push((vreg, reg, weight)),
                        }
                    }
                }
                disputed |= self.occupied & !present | unsaved ^ (present & !self.clean);
            }
            registers_in(self.occupied & !present).for_each(|reg| absent[reg as usize] += weight);
            registers_in(unsaved).for_each(|reg| dirty[reg as usize] += weight);
        }

        let frequency = self.frequencies.of_block(self.block);
        for reg in registers_in(disputed) {
            let (vreg, index) = (self.value[usize::from(reg)], usize::from(reg));
            if self.is_param(vreg) {
                continue;
            }
            let benefit = self.benefit(vreg, self.next[index]);
            if benefit * frequency < absent[index] {
                self.vacate(reg);
            } else if (1.0 - benefit) * frequency > dirty[index] {
                self.clean |= bit(reg);
            } else {
                self.clean &= !bit(reg);
            }
        }
        self.place_params(main);

        for &(vreg, reg, weight) in &sightings {
            let (next, bank) = (self.know_next_use(vreg), self.code.vregs[vreg].class.bank());
            let free = self.banks[bank as usize] & !self.occupied;
            let needed = self.code.blocks[self.block].pressure[bank as usize].max(SPARE_REGISTERS);
            if free.count_ones() as i32 > needed
                && self.benefit(vreg, next) * frequency > total - weight
            {
                self.out.statuses[vreg].former_reg = reg;
                self.give_register(vreg, free, false);
            }
        }
        self.out.sightings = sightings;
    }

    /// The weight of the edges whose argument is in the slot of the parameter and nowhere else, and of the others.
    fn weigh_args(&self, main: Edge, position: usize, param: VReg) -> (f32, f32) {
        let (mut at_home, mut elsewhere) = (0.0, 0.0);
        for (edge, weight) in self.contenders(main) {
            let arg = self.code.args(edge)[position];
            let exit = self.out.exits[self.function.source(edge)];
            let is_at_home = self.home(arg) == self.home(param)
                && !self.out.snapshot_values[exit.values].contains(&arg);
            *if is_at_home {
                &mut at_home
            } else {
                &mut elsewhere
            } += weight;
        }
        (at_home, elsewhere)
    }

    fn place_params(&mut self, main: Edge) {
        self.out.candidates.clear();
        let frequency = self.frequencies.of_block(self.block);
        for (position, index) in self.code.blocks[self.block].params.range().enumerate() {
            let param = self.code.vreg_lists.item(index);
            if !self.is_used(param) {
                continue;
            }
            let (next, reg) = (self.know_next_use(param), self.out.statuses[param].reg);
            let chance = self.chance_of_use(param, next);
            let is_worth_a_register = chance == 1.0 || {
                let (at_home, elsewhere) = self.weigh_args(main, position, param);
                at_home + (1.0 - chance) * frequency <= elsewhere + chance * frequency
            };
            if is_worth_a_register && reg == AT_HOME {
                self.out.candidates.push((next, param));
            } else if !is_worth_a_register && reg != AT_HOME {
                self.vacate(reg);
            }
        }
        self.out.candidates.sort_unstable();
        for index in 0..self.out.candidates.len() {
            let (next, param) = self.out.candidates[index];
            let bank = self.bank_of(param);
            let mut free = bank & !self.occupied;
            if free == 0
                && let Some(victim) = self
                    .victim(bank)
                    .filter(|&victim| self.next[usize::from(victim)] > next)
            {
                self.vacate(victim);
                free = bit(victim);
            }
            if free != 0 {
                self.give_register(param, free, false);
            }
        }
    }

    /// Keeps and fetches what the loop wants first, as far as it is likely to be still there after a turn.
    pub(super) fn prepare_for_loop(&mut self, headed: Loop, main: Edge) {
        let (liveness, cfg) = (self.liveness, self.cfg);
        let (live, used) = (liveness.live_in(cfg, self.block), liveness.used_in(headed));
        self.out.candidates.clear();
        self.collect_absent_params();
        for reg in registers_in(self.occupied) {
            let vreg = self.value[usize::from(reg)];
            if self.code.vregs[vreg].global == LOCAL && !self.is_param(vreg) {
                self.vacate(reg);
            } else {
                (self.out.candidates).push((self.next[usize::from(reg)], vreg));
            }
        }
        for (index, (&live, &used)) in live.iter().zip(used).enumerate() {
            for global in bitset::iter(&[live & used]) {
                let vreg = self.out.globals[index * 64 + global];
                if self.out.statuses[vreg].reg == AT_HOME {
                    let next = self.know_next_use(vreg);
                    self.out.candidates.push((next, vreg));
                }
            }
        }
        for (next, vreg) in &mut self.out.candidates {
            if self.code.vregs[*vreg].is_floating() {
                *next += (*next - self.position).min(SOON) * 3;
            }
        }
        self.out.candidates.sort_unstable();

        let (mut free, mut invariants) = (self.banks.map(Mask::count_ones), [0; 2]);
        let mut absent = 0;
        for index in 0..self.out.candidates.len() {
            let vreg = self.out.candidates[index].1;
            let (status, data) = (self.out.statuses[vreg], &self.code.vregs[vreg]);
            let bank = data.class.bank();
            let demand = liveness.demand(headed, bank);
            let losses = if self.prospects.are_known() {
                self.prospects.losses(headed, bank)
            } else {
                demand.losses
            };
            let benefit = self.benefit(vreg, status.next);
            let is_param = self.is_param(vreg);
            let is_kept = free[bank as usize] != 0
                && if is_param {
                    benefit + (1.0 - losses) / 2.0 >= losses
                } else {
                    let left =
                        self.banks[bank as usize].count_ones() - invariants[bank as usize] - 1;
                    let cost = (losses + demand.more_than(left)).min(1.0);
                    let is_used = bitset::contains(used, data.global as usize);
                    benefit
                        * if is_used {
                            1.0
                        } else {
                            WEIGHT_OF_USE_AFTER_LOOP
                        }
                        >= cost
                };
            if is_kept {
                free[bank as usize] -= 1;
                invariants[bank as usize] += u32::from(!is_param);
                if status.reg == AT_HOME {
                    self.out.candidates[absent].1 = vreg;
                    absent += 1;
                }
            } else if status.reg != AT_HOME {
                self.vacate(status.reg);
            }
        }
        self.leave_claimed_registers(headed);
        for index in 0..absent {
            let vreg = self.out.candidates[index].1;
            let free = self.bank_of(vreg) & !self.occupied;
            self.give_register(vreg, free, !self.is_param(vreg));
        }

        let mut unsaved = 0;
        for (edge, _) in self.contenders(main).filter(|&(edge, _)| edge != main) {
            let exit = self.out.exits[self.function.source(edge)];
            let values = registers_in(exit.occupied).zip(&self.out.snapshot_values[exit.values]);
            for (_, &vreg) in values.filter(|&(reg, _)| exit.clean & bit(reg) == 0) {
                let here = self.out.statuses[vreg].reg;
                unsaved |= if here == AT_HOME { 0 } else { bit(here) };
            }
        }
        self.clean &= !unsaved;

        for reg in registers_in(self.occupied) {
            let vreg = self.value[usize::from(reg)];
            let is_param = self.is_param(vreg);
            let status = &mut self.out.statuses[vreg];
            status.loop_reg = reg;
            if is_param {
                (status.usual_reg, status.is_awaited) = (reg, true);
            } else {
                (self.prospects).note_kept(headed, self.code.vregs[vreg].global);
            }
        }
        let outer = cfg.loops()[headed].parent.expand();
        let outer = outer.map_or(0, |outer| self.out.loop_registers[outer]);
        self.out.loop_registers[headed] = self.occupied | outer;
    }

    fn leave_claimed_registers(&mut self, headed: Loop) {
        let claimed = self.liveness.claims(headed).bits();
        for of_params in [false, true] {
            for reg in registers_in(self.occupied & claimed) {
                let vreg = self.value[usize::from(reg)];
                let shelters = self.bank_of(vreg) & !claimed & !self.occupied;
                let belongs = matches!(
                    self.code.vregs[vreg].wish,
                    Wish::Firm(wished) | Wish::Lasting(wished) if wished == reg
                );
                if shelters != 0 && !belongs && self.is_param(vreg) == of_params {
                    let is_clean = self.is_clean(reg);
                    self.vacate(reg);
                    self.give_register(vreg, shelters, is_clean);
                }
            }
        }
    }
}
