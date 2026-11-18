//! Proves that every operand finds its value where allocation says it is.

use core::fmt::Write;
use std::collections::{BTreeMap, BTreeSet};

use bun_engine_asm::{Bank, Reg, RegisterSet};

use super::code::{AT_HOME, Class, NEVER, Operand, Place, Role, VReg};
use super::emit::{Isa, Places};
use super::moves::{Move, MoveKind};
use crate::analysis::Cfg;
use crate::ir::{Block, Boundary, Edge, Location, Table};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Cell {
    Register(Reg),
    /// Eight bytes at this offset.
    Frame(i32),
}

/// The values that each cell is known to hold. A vector in the frame is in both of its cells.
#[derive(Clone, PartialEq, Default)]
struct Contents(BTreeMap<Cell, BTreeSet<VReg>>);

fn cells(location: Location, class: Class) -> impl Iterator<Item = Cell> {
    let (first, second) = match location {
        Location::Gpr(reg) => (Some(Cell::Register(reg.into())), None),
        Location::Fpr(reg) => (Some(Cell::Register(reg.into())), None),
        Location::Frame(offset) => (
            Some(Cell::Frame(offset)),
            (class == Class::Vector).then_some(Cell::Frame(offset + 8)),
        ),
        _ => (None, None),
    };
    first.into_iter().chain(second)
}

struct Checker<'a, I> {
    places: Places<'a>,
    cfg: &'a Cfg,
    instructions: &'a [I],
}

impl<I: Isa> Checker<'_, I> {
    fn class(&self, vreg: VReg) -> Class {
        self.places.code.vregs[vreg].class
    }

    fn holds(&self, contents: &Contents, location: Location, vreg: VReg) -> bool {
        if self.places.code.vregs[vreg].is_floating() && location == self.places.home(vreg) {
            return true;
        }
        let mut cells = cells(location, self.class(vreg)).peekable();
        cells.peek().is_some()
            && cells.all(|cell| {
                contents
                    .0
                    .get(&cell)
                    .is_some_and(|known| known.contains(&vreg))
            })
    }

    fn apply(&self, contents: &mut Contents, step: Move) {
        let (from, to) = (
            self.places.spot::<I>(step.from, step.class),
            self.places.spot::<I>(step.to, step.class),
        );
        if from == to {
            return;
        }
        let read = |location| -> BTreeSet<VReg> {
            let first = cells(location, step.class)
                .next()
                .and_then(|cell| contents.0.get(&cell));
            let fits = |vreg: VReg| {
                let class = self.class(vreg);
                step.kind == MoveKind::Swap
                    || class == step.class
                    || step.class == Class::Int64 && class == Class::Int32
            };
            first
                .into_iter()
                .flatten()
                .copied()
                .filter(|&vreg| fits(vreg) && self.holds(contents, location, vreg))
                .collect()
        };
        let (mut moved, displaced) = (read(from), read(to));
        if let super::moves::SpotKind::Home(vreg) = step.from.kind()
            && self.places.code.vregs[vreg].is_floating()
        {
            moved.insert(vreg);
        }
        if matches!(to, Location::Frame(_)) && !matches!(from, Location::Gpr(_) | Location::Fpr(_))
        {
            for bank in [Bank::Gpr, Bank::Fpr] {
                cells(I::scratch(bank), step.class).for_each(|cell| drop(contents.0.remove(&cell)));
            }
        }
        cells(to, step.class).for_each(|cell| drop(contents.0.insert(cell, moved.clone())));
        if step.kind == MoveKind::Swap {
            cells(from, step.class)
                .for_each(|cell| drop(contents.0.insert(cell, displaced.clone())));
        }
    }

    fn check_operands(&self, contents: &Contents, position: u32) -> Result<(), String> {
        let code = self.places.code;
        let head = code.heads[position as usize];
        let operands = &code.operands[head.operands()];
        let site = head.site.expand().map(|site| &code.sites[site]);
        let early = site.map_or(RegisterSet::EMPTY, |site| site.clobbers_early);
        let late = |class: Class| {
            site.map_or(RegisterSet::EMPTY, |site| {
                if class == Class::Vector {
                    site.clobbers_late | site.clobbers_upper_halves
                } else {
                    site.clobbers_late
                }
            })
        };
        let allocatable = I::registers(self.places.function).allocatable;
        let registers_of = |wanted: fn(Role) -> bool| -> RegisterSet {
            let allocated = operands
                .iter()
                .filter(|operand| operand.place != Place::Given && operand.assigned() != AT_HOME);
            allocated
                .filter(|operand| wanted(operand.role))
                .map(|operand| Reg::from_index(operand.assigned().into()))
                .collect()
        };
        let written_early =
            registers_of(|role| matches!(role, Role::EarlyDef | Role::Temp)) | early;
        let results = registers_of(|role| role == Role::Def);
        let mut written = RegisterSet::EMPTY;
        for operand in operands
            .iter()
            .filter(|operand| operand.place != Place::Given)
        {
            let complain = |problem: &str| Err(format!("{:?} {problem}", operand.vreg));
            if operand.assigned() == AT_HOME {
                let is_addressable = !code.vregs[operand.vreg].is_floating()
                    || I::registers(self.places.function).addresses_float_constants
                        && self.class(operand.vreg).bank() == Bank::Fpr;
                match operand.place {
                    Place::Anywhere | Place::ColdAnywhere => {}
                    Place::RegisterOrMemory if is_addressable => {}
                    _ => return complain("has no register"),
                }
            } else {
                let reg = Reg::from_index(operand.assigned().into());
                if !allocatable.contains(reg)
                    || operand.place == Place::Fixed
                        && operand.fixed_register() != operand.assigned()
                {
                    return complain("is in the wrong register");
                }
                if !operand.vreg.is_none() && reg.bank() != self.class(operand.vreg).bank() {
                    return complain("is in the wrong bank");
                }
                if operand.is_use() {
                    let is_late = operand.role == Role::LateUse;
                    if written_early.contains(reg)
                        || is_late && (results | late(self.class(operand.vreg))).contains(reg)
                    {
                        return complain("is overwritten before it is read");
                    }
                } else {
                    let clobbered = early.contains(reg) && operand.role != Role::Def
                        || late(Class::Vector).contains(reg);
                    if written.contains(reg) || operand.place != Place::Fixed && clobbered {
                        return complain("shares its register");
                    }
                    written.insert(reg);
                }
            }
            if operand.is_use()
                && !self.holds(
                    contents,
                    self.places.location(operand.vreg, operand.assigned()),
                    operand.vreg,
                )
            {
                return complain("is not there");
            }
        }
        let Some(site) = site else { return Ok(()) };
        for (&vreg, &assigned) in code.vreg_lists[site.state_vregs]
            .iter()
            .zip(&self.places.allocation.state_assigned[site.state_assigned])
        {
            if !self.holds(contents, self.places.location(vreg, assigned), vreg) {
                return Err(format!("{vreg:?} of the state is not there"));
            }
            let lost = written_early
                | late(self.class(vreg))
                | if vreg == site.recoverable {
                    RegisterSet::EMPTY
                } else {
                    results
                };
            if assigned != AT_HOME && lost.contains(Reg::from_index(assigned.into())) {
                return Err(format!("{vreg:?} of the state is overwritten"));
            }
        }
        Ok(())
    }

    fn execute(&self, contents: &mut Contents, position: u32) {
        let code = self.places.code;
        let head = code.heads[position as usize];
        for bank in [Bank::Gpr, Bank::Fpr] {
            cells(I::scratch(bank), Class::Int64).for_each(|cell| drop(contents.0.remove(&cell)));
        }
        if let Some(site) = head.site.expand().map(|site| &code.sites[site]) {
            for reg in site.clobbers_early | site.clobbers_late {
                contents.0.remove(&Cell::Register(reg));
            }
            for reg in site.clobbers_upper_halves {
                if let Some(known) = contents.0.get_mut(&Cell::Register(reg)) {
                    known.retain(|&vreg| self.class(vreg) != Class::Vector);
                }
            }
        }
        for operand in code.operands[head.operands()]
            .iter()
            .filter(|operand| !operand.is_use())
        {
            contents
                .0
                .values_mut()
                .for_each(|known| known.retain(|&vreg| vreg != operand.vreg));
            let known = operand.vreg.expand().into_iter().collect();
            contents.0.insert(
                Cell::Register(Reg::from_index(operand.assigned().into())),
                known,
            );
        }
    }

    fn run_block(&self, block: Block, mut contents: Contents) -> Result<Contents, String> {
        let (data, moves) = (
            self.places.code.blocks[block],
            &self.places.allocation.moves,
        );
        let incoming = if let [only] = *self.cfg.predecessors(block) {
            self.places.allocation.moves_on(only).len()
        } else {
            0
        };
        self.places
            .moves_at_start(self.cfg, block)
            .skip(incoming)
            .for_each(|step| self.apply(&mut contents, step));
        let mut next_move = moves.partition_point(|&(position, _)| position < data.first);
        for position in data.first..data.end {
            while let Some(&(before, step)) = moves.get(next_move)
                && before == position
            {
                self.apply(&mut contents, step);
                next_move += 1;
            }
            self.check_operands(&contents, position)
                .map_err(|problem| format!("at {position}: {problem}"))?;
            self.execute(&mut contents, position);
            let operands =
                &self.places.code.operands[self.places.code.heads[position as usize].operands()];
            self.places
                .moves_after(operands)
                .for_each(|step| self.apply(&mut contents, step));
        }
        Ok(contents)
    }

    fn cross(&self, edge: Edge, mut contents: Contents) -> Contents {
        let code = self.places.code;
        let params = code.params(self.places.function.target(edge));
        // The moves have the class of the parameter, which may be wider or narrower than that of its argument.
        let twins: Vec<_> = params
            .iter()
            .zip(code.args(edge))
            .filter(|(param, _)| !param.is_none())
            .collect();
        self.places
            .allocation
            .moves_on(edge)
            .iter()
            .for_each(|&step| self.apply(&mut contents, step));
        let (equal, constant) = code.edge_equalities[edge];
        for known in contents.0.values_mut() {
            let arrived: Vec<VReg> = twins
                .iter()
                .filter(|&&(_, arg)| {
                    known.contains(arg) || *arg == equal && known.contains(&constant)
                })
                .map(|&(&param, _)| param)
                .collect();
            known.retain(|vreg| !params.contains(vreg));
            known.extend(arrived);
        }
        contents
    }

    fn run(&self) -> Result<(), String> {
        let function = self.places.function;
        let mut at_start: Table<Block, Option<Contents>> = function.block_table(None);
        for &entry in function.entries() {
            let mut contents = Contents::default();
            for (&param, &boundary) in self
                .places
                .code
                .params(entry.block)
                .iter()
                .zip(function.entry_params(entry))
            {
                if param.is_none() {
                    continue;
                }
                match boundary {
                    Boundary::Register(reg) => {
                        drop(contents.0.insert(Cell::Register(reg), [param].into()))
                    }
                    Boundary::Frame(offset) => cells(Location::Frame(offset), self.class(param))
                        .for_each(|cell| contents.0.entry(cell).or_default().extend([param])),
                }
            }
            at_start[entry.block] = Some(contents);
        }
        let mut changed = true;
        while core::mem::take(&mut changed) {
            for &block in self.cfg.order() {
                let at_end = self.run_block(block, at_start[block].clone().unwrap())?;
                for edge in function.successors(block) {
                    let mut arriving = self.cross(edge, at_end.clone());
                    let known = &mut at_start[function.target(edge)];
                    if let Some(known) = known {
                        arriving.0.retain(|cell, values| {
                            values.retain(|vreg| {
                                known.0.get(cell).is_some_and(|known| known.contains(vreg))
                            });
                            !values.is_empty()
                        });
                    }
                    arriving.0.retain(|_, values| !values.is_empty());
                    changed |=
                        known.as_ref() != Some(&arriving) && self.cfg.is_backward(function, edge);
                    *known = Some(arriving);
                }
            }
        }
        Ok(())
    }

    fn describe_operand(&self, operand: Operand) -> String {
        let place = if operand.place == Place::Given {
            format!("r{}", operand.assigned())
        } else if operand.assigned() == AT_HOME {
            format!("{:?}", self.places.code.vregs[operand.vreg].home)
        } else {
            format!("{:?}", Reg::from_index(operand.assigned().into()))
        };
        format!(
            "{:?} {:?}{} {place}",
            operand.role,
            operand.vreg,
            if operand.dies() { "!" } else { "" }
        )
    }

    fn listing(&self) -> String {
        let Places {
            function,
            code,
            allocation,
            ..
        } = self.places;
        let mut text = String::new();
        let mut moves = allocation.moves.iter().peekable();
        for &block in self.cfg.order() {
            writeln!(text, "{block:?}{:?}:", code.params(block)).unwrap();
            self.places
                .moves_at_start(self.cfg, block)
                .for_each(|step| writeln!(text, "      {step:?}").unwrap());
            for position in code.blocks[block].first..code.blocks[block].end {
                while let Some((_, step)) = moves.next_if(|&&(before, _)| before == position) {
                    writeln!(text, "      {step:?}").unwrap();
                }
                let operands = &code.operands[code.heads[position as usize].operands()];
                let described: Vec<_> = operands
                    .iter()
                    .map(|&operand| self.describe_operand(operand))
                    .collect();
                writeln!(
                    text,
                    "{position:4}  {:?} {described:?}",
                    self.instructions[position as usize]
                )
                .unwrap();
                self.places
                    .moves_after(operands)
                    .for_each(|step| writeln!(text, "      {step:?}").unwrap());
            }
            for edge in function.successors(block) {
                writeln!(
                    text,
                    "      -> {:?}{:?} {:?}",
                    function.target(edge),
                    code.args(edge),
                    allocation.moves_on(edge)
                )
                .unwrap();
            }
        }
        for vreg in code.vregs.keys() {
            let data = &code.vregs[vreg];
            let end = if data.end == NEVER {
                -1
            } else {
                i64::from(data.end)
            };
            let (owner, stored) = (allocation.slots.owner(vreg), allocation.stored(vreg));
            writeln!(
                text,
                "{vreg:?}: {:?} {:?} {}..{end} with {owner:?} {stored:?}",
                data.class, data.home, data.start as i32
            )
            .unwrap();
        }
        text
    }
}

pub(crate) fn check<I: Isa>(places: Places<'_>, cfg: &Cfg, instructions: &[I]) {
    let checker = Checker {
        places,
        cfg,
        instructions,
    };
    if let Err(problem) = checker.run() {
        panic!(
            "register allocation went wrong {problem}\n{}\n{:?}",
            checker.listing(),
            places.function
        );
    }
}
