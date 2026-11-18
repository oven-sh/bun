//! The program while it is being written, and its layout.

use crate::Error;
use crate::compile::memory::{fill, push, reserve};
use crate::program::{Join, LoopId, Op, Program, Room, Scope, ScopeId, ScopeKind, Slot, Target};

/// Operations name labels where they will have targets.
pub(super) type Label = Target;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Section {
    Main,
    /// What runs after a failure.
    Cold,
}

#[derive(Clone, Copy)]
struct Bound {
    section: Section,
    index: u32,
    room: Room,
    scope: ScopeId,
}

pub(super) struct Output {
    /// With the main section for its operations.
    pub(super) program: Program,
    cold: Vec<Op>,
    labels: Vec<Option<Bound>>,
    /// For each scope: the nearest from it up that is more than a reservation.
    entered: Vec<ScopeId>,
    /// For each operation.
    new_index: Vec<u32>,
    /// For each label.
    is_used: Vec<bool>,
    to_visit: Vec<u32>,
}

pub(super) const ROOT: ScopeId = ScopeId(0);

/// Stands for a scope that comes into being after the body of the loop has been written.
pub(super) fn between_turns_of(id: LoopId) -> ScopeId {
    ScopeId(!id.0)
}

impl Output {
    pub(super) const fn new() -> Output {
        Output {
            program: Program::new(),
            cold: Vec::new(),
            labels: Vec::new(),
            entered: Vec::new(),
            new_index: Vec::new(),
            is_used: Vec::new(),
            to_visit: Vec::new(),
        }
    }

    pub(super) fn start(&mut self, expected_ops: usize) -> Result<(), Error> {
        self.program.clear();
        self.cold.clear();
        self.labels.clear();
        self.entered.clear();
        reserve(&mut self.program.ops, expected_ops)?;
        reserve(&mut self.cold, expected_ops / 2)?;
        reserve(&mut self.labels, expected_ops)?;
        let root = Scope {
            parent: ROOT,
            height: 0,
            kind: ScopeKind::Root,
        };
        push(&mut self.program.scopes, root)?;
        push(&mut self.entered, ROOT)
    }

    #[inline]
    pub(super) fn op(&mut self, section: Section, op: Op) -> Result<(), Error> {
        match section {
            Section::Main => push(&mut self.program.ops, op),
            Section::Cold => push(&mut self.cold, op),
        }
    }

    pub(super) fn main_length(&self) -> u32 {
        self.program.ops.len() as u32
    }

    /// The scope comes into being after the operation at `index` has been written.
    pub(super) fn name_scope_of_choice(&mut self, index: u32, choice: Slot) {
        if let Op::Choose { slot, .. } = &mut self.program.ops[index as usize] {
            *slot = choice;
        }
    }

    pub(super) fn label(&mut self) -> Result<Label, Error> {
        push(&mut self.labels, None)?;
        Ok(Target(self.labels.len() as u32 - 1))
    }

    pub(super) fn bind(&mut self, label: Label, section: Section, room: Room, scope: ScopeId) {
        let index = match section {
            Section::Main => self.program.ops.len(),
            Section::Cold => self.cold.len(),
        };
        self.labels[label.index()] = Some(Bound {
            section,
            index: index as u32,
            room,
            scope,
        });
    }

    pub(super) fn height(&self, scope: ScopeId) -> u32 {
        self.program.scopes[scope.index()].height
    }

    /// The slot is that of the first cell.
    pub(super) fn add_scope(
        &mut self,
        parent: ScopeId,
        height: u32,
        kind: ScopeKind,
    ) -> Result<Slot, Error> {
        let missing = (height as usize).saturating_sub(self.program.cell_weights.len());
        reserve(&mut self.program.cell_weights, missing)?;
        self.program
            .cell_weights
            .resize(self.program.cell_weights.len() + missing, 0);
        let scope = Scope {
            parent,
            height,
            kind,
        };
        let id = ScopeId(self.program.scopes.len() as u32);
        let entered = match kind {
            ScopeKind::Reserved => self.entered[parent.index()],
            _ => id,
        };
        push(&mut self.program.scopes, scope)?;
        push(&mut self.entered, entered)?;
        Ok(Slot {
            cell: self.height(parent),
            scope: id,
        })
    }

    /// The nearest scope from here up that an operation enters.
    pub(super) fn without_reservations(&self, scope: ScopeId) -> ScopeId {
        self.entered[scope.index()]
    }

    /// Puts the sections together without what cannot be reached, and turns the labels into targets, also `others`.
    pub(super) fn lay_out(&mut self, others: &mut [Label]) -> Result<(), Error> {
        let main_length = self.main_length();
        reserve(&mut self.program.ops, self.cold.len())?;
        self.program.ops.extend_from_slice(&self.cold);
        for bound in self.labels.iter_mut().flatten() {
            if bound.section == Section::Cold {
                bound.index += main_length;
            }
        }

        self.reach()?;
        let mut kept = 0;
        for index in 0..self.program.ops.len() {
            let is_reached = self.new_index[index] != UNREACHED && !self.jumps_to_next(index);
            self.new_index[index] = kept;
            if is_reached && kept as usize != index {
                self.program.ops[kept as usize] = self.program.ops[index];
            }
            kept += u32::from(is_reached);
        }
        self.program.ops.truncate(kept as usize);

        let (labels, new_index) = (&self.labels[..], &self.new_index[..]);
        let resolve = |label: &mut Label| {
            let index = labels[label.index()].and_then(|it| new_index.get(it.index as usize));
            *label = Target(index.copied().unwrap_or(UNREACHED));
        };
        self.program.for_each_target(resolve);
        others.iter_mut().for_each(resolve);
        self.list_joins()
    }

    fn list_joins(&mut self) -> Result<(), Error> {
        let Program { joins, loops, .. } = &mut self.program;
        reserve(joins, self.labels.len())?;
        let labels = self.labels.iter().zip(&self.is_used);
        joins.extend(labels.filter_map(|(bound, &is_used)| {
            bound.filter(|_| is_used).map(|bound| Join {
                at: Target(self.new_index[bound.index as usize]),
                room: bound.room,
                scope: match loops.get(!bound.scope.0 as usize) {
                    Some(it) => it.between_turns,
                    None => bound.scope,
                },
            })
        }));
        joins.sort_unstable_by_key(|join| join.at);
        joins.dedup_by(|join, kept| {
            let is_same = join.at == kept.at;
            if is_same {
                kept.room = kept.room.min(join.room);
                kept.scope = kept.scope.min(join.scope);
            }
            is_same
        });
        Ok(())
    }

    /// From `index` on `new_index` says what is reached.
    fn jumps_to_next(&self, index: usize) -> bool {
        let Op::Jump { to } = self.program.ops[index] else {
            return false;
        };
        let to = self.labels[to.index()].map_or(0, |bound| bound.index as usize);
        to > index && (self.new_index[index + 1..to].iter()).all(|&it| it == UNREACHED)
    }

    #[inline]
    fn op_at(&self, label: Label) -> Option<&Op> {
        Some(&self.program.ops[self.labels[label.index()].as_ref()?.index as usize])
    }

    /// Where a jump to the label ends up.
    fn past_jumps(&self, mut label: Label) -> Label {
        const FOLLOWED: usize = 4;
        for _ in 0..FOLLOWED {
            match self.op_at(label) {
                Some(&Op::Jump { to }) => label = to,
                _ => break,
            }
        }
        label
    }

    /// Marks the operations that can run and the labels that they go to.
    fn reach(&mut self) -> Result<(), Error> {
        fill(&mut self.new_index, self.program.ops.len(), UNREACHED)?;
        fill(&mut self.is_used, self.labels.len(), false)?;
        self.to_visit.clear();
        reserve(&mut self.to_visit, self.labels.len() + 1)?;
        self.to_visit.push(0);
        macro_rules! use_label {
            ($label:expr) => {
                if !core::mem::replace(&mut self.is_used[$label.index()], true) {
                    let bound = self.labels[$label.index()].expect("a label that is used is bound");
                    self.to_visit.push(bound.index);
                }
            };
        }
        let of_loops = self.program.loops.iter().map(|it| it.back_into_turn);
        let of_looks = self.program.sites.looks.iter().filter_map(|it| it.found);
        let chosen = self.program.choice_targets.iter().copied();
        for label in of_loops.chain(of_looks).chain(chosen) {
            use_label!(label);
        }
        while let Some(start) = self.to_visit.pop() {
            for index in start as usize.. {
                if core::mem::replace(&mut self.new_index[index], 0) != UNREACHED {
                    break;
                }
                if let Op::Jump { to } = self.program.ops[index]
                    && let Some(&again @ Op::Again { .. }) = self.op_at(self.past_jumps(to))
                {
                    self.program.ops[index] = again;
                }
                match &mut self.program.ops[index] {
                    Op::Choose { .. } => {}
                    Op::Switch { table, .. } => {
                        for case in self.program.switches[table.index()].cases() {
                            use_label!(case.target);
                        }
                    }
                    op => {
                        if let Some(&mut named) = op.target_mut() {
                            let label = self.past_jumps(named);
                            use_label!(label);
                            if label != named
                                && let Some(target) = self.program.ops[index].target_mut()
                            {
                                *target = label;
                            }
                        }
                    }
                }
                if !self.program.ops[index].falls_through() {
                    break;
                }
            }
        }
        Ok(())
    }
}

const UNREACHED: u32 = u32::MAX;
