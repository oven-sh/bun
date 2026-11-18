//! Checks of types that the check of a shape is going to cover, and checks that are put off until after a branch.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{
    Binary, Block, Builder, Edge, Function, Op, Origin, State, Type, Value as Ssa,
};
use bun_engine_vm::SpeculatedType as T;

use super::Specializer;
use crate::graph::{ExitKind, Kind, ShapeSet, TypeCheck, heaps};

const REACH: usize = 24;

enum Ahead {
    Check(Ssa, ShapeSet),
    /// Each way tells the type, and all others go back to before the check.
    Switch,
}

/// What a value has to be on each edge of the branch that ends the block.
pub(super) struct PutOff {
    subject: Ssa,
    wanted: [T; 2],
    origin: Origin,
    state: State,
}

pub(super) struct Insertion {
    subject: Ssa,
    /// The data of the two nodes.
    described: u32,
    check: u32,
    origin: Origin,
    state: State,
}

impl Insertion {
    fn insert(&self, function: &mut Function, block: Block) {
        let first = function.first(block);
        let mut ir = Builder::before(function, first);
        ir.origin = self.origin;
        let (refine, check) = (Kind::Refine.id(), Kind::CheckType.id());
        let (subject, nowhere) = (&[self.subject], State::NONE);
        let refined = ir.node(refine, Type::I64, subject, self.described, nowhere);
        ir.node(check, Type::I64, &[refined], self.check, self.state);
    }
}

impl Specializer<'_> {
    fn ahead(&self, root: Ssa, wanted: T) -> Option<Ahead> {
        let (graph, function) = (&*self.graph, &self.graph.function);
        let next = |&value: &Ssa| function.next(value).expand();
        let mut is_relied_on = false;
        for value in core::iter::successors(next(&self.at), next).take(REACH) {
            let is_of_root = || {
                function
                    .operands(value)
                    .iter()
                    .any(|&it| graph.root(it) == root)
            };
            match graph.node(value) {
                Some((Kind::CheckShape, data)) if is_of_root() => {
                    let shapes = ShapeSet(data);
                    let covers = wanted.contains(graph.shapes.type_of(shapes));
                    return covers.then_some(Ahead::Check(value, shapes));
                }
                Some((Kind::LoadShapeId, _)) if is_of_root() => {
                    let covers = !is_relied_on && self.is_told_apart(value, wanted);
                    return covers.then_some(Ahead::Switch);
                }
                _ if function.may_alias(function.effects(value).writes, heaps::SHAPE) => break,
                Some((Kind::CheckType, _)) => {}
                _ => is_relied_on |= is_of_root(),
            }
        }
        None
    }

    fn is_told_apart(&self, id: Ssa, wanted: T) -> bool {
        let (graph, function) = (&*self.graph, &self.graph.function);
        let block = function.block_of(id);
        let covers = |edge| {
            let first = function.first(function.target(edge));
            match graph.node(first) {
                Some((Kind::RefineShape, data)) => {
                    wanted.contains(graph.shapes.type_of(ShapeSet(data)))
                }
                Some((Kind::ForceExit, _)) => function.state_of(first) == self.state,
                _ => false,
            }
        };
        matches!(*function.op(function.next(id)), Op::Switch(key, _) if key == id)
            && function.successors(block).all(covers)
    }

    /// In place of a check for some types of cells.
    pub(super) fn check_shape_instead(&mut self, value: Ssa, check: TypeCheck) -> Option<Ssa> {
        if !T::CELL.contains(check.wanted)
            || check.wanted == T::CELL
            || self.is(value, check.wanted)
        {
            return None;
        }
        let ahead = self.ahead(self.graph.root(value), check.wanted)?;
        let cell = self.check_type(value, T::CELL, check.failure);
        let Ahead::Check(later, shapes) = ahead else {
            self.has_unproven = true;
            let data = self.graph.intern_type(check.wanted);
            return Some(self.node(Kind::Unproven, &[cell], data));
        };
        let checked = self.node(Kind::CheckShape, &[cell], shapes.0);
        (self.graph.function).set_origin(checked, self.graph.function.origin(later));
        let known = self.knowledge.shapes_of(self.graph, value);
        let narrowed = self.graph.shapes.intersection(known, shapes);
        (self.knowledge).learn_shapes(self.graph, value, narrowed, checked);
        Some(checked)
    }

    /// Has the instruction use what ties the operands to the ways that tell their type.
    pub(super) fn tie_to_proofs(&mut self) {
        for position in 0..self.graph.function.operands(self.at).len() {
            let operand = self.graph.function.operands(self.at)[position];
            let Some((Kind::Unproven, data)) = self.graph.node(operand) else {
                continue;
            };
            let root = self.graph.root(operand);
            if self.knowledge.get(root).is_none() {
                let wanted = self.graph.interned_type(data);
                (self.knowledge).learn_type(self.graph, root, wanted, Ssa::NONE);
            }
            self.graph.function.operands_mut(self.at)[position] = self.alias(root);
        }
    }

    /// Whether the branch that follows takes its first edge if the result of the instruction is true.
    fn decides_branch(&self) -> Option<bool> {
        let function = &self.graph.function;
        let next = function.next(self.at);
        match *function.op(next) {
            Op::Branch(condition) => (condition == self.at).then_some(true),
            Op::Binary(Binary::Xor, [inner, _]) if inner == self.at => {
                (*function.op(function.next(next)) == Op::Branch(next)).then_some(false)
            }
            _ => None,
        }
    }

    /// Whether a value is a cell, for an instruction that gives `if_cell` then. It is certain to be one of `cells` or
    /// `others` by the time that anything depends on the answer.
    pub(super) fn is_cell_and_check_later(
        &mut self,
        value: Ssa,
        if_cell: bool,
        [cells, others]: [T; 2],
    ) -> Option<Ssa> {
        let known = self.type_of(value);
        if T::CELL.contains(known) || !T::CELL.intersects(known) {
            return None;
        }
        let cells_go_first = self.decides_branch()? == if_cell;
        self.put_off = Some(PutOff {
            subject: self.graph.root(value),
            wanted: if cells_go_first {
                [cells, others]
            } else {
                [others, cells]
            },
            origin: self.origin,
            state: self.state,
        });
        let is_cell = self.is_type(value, T::CELL);
        Some(if if_cell {
            is_cell
        } else {
            self.ir().xor(is_cell, 1)
        })
    }

    /// With the knowledge for the edge at that position.
    pub(super) fn check_along(&mut self, cfg: &Cfg, put_off: &PutOff, edge: Edge, position: usize) {
        let (subject, wanted) = (put_off.subject, put_off.wanted[position]);
        let known = self.type_of(subject);
        if wanted.contains(known) {
            return;
        }
        let failure = ExitKind::BadType;
        let insertion = Insertion {
            subject,
            described: self.graph.intern_type(known),
            check: self.graph.type_check(TypeCheck {
                wanted,
                known,
                failure,
            }),
            origin: put_off.origin,
            state: put_off.state,
        };
        let target = self.graph.function.target(edge);
        if cfg.predecessors(target).len() == 1 {
            insertion.insert(&mut self.graph.function, target);
        } else {
            (self.knowledge).learn_type(self.graph, subject, wanted, Ssa::NONE);
            self.checks_on_edges.push((edge, insertion));
        }
    }

    pub(super) fn split_edges(&mut self) {
        for (edge, insertion) in self.checks_on_edges.drain(..) {
            let middle = self.graph.function.split_edge(edge);
            insertion.insert(&mut self.graph.function, middle);
            self.changed_control_flow = true;
        }
    }
}
