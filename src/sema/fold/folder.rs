use super::dead_code::mark_nodes_below;
use super::evaluate::{Evaluator, Value};
use super::feature_flags::find_feature_import;
use super::folder_commonjs::LoaderNames;
use super::inputs::{FoldInputs, PathState};
use super::run_order::RunOrder;
use super::{
    Constant, Decision, Decisions, FoldError, FoldResult, FoldedConstant, FoldedValue, NodeBits,
    literal_constant, slice_in,
};
use crate::atom::Interner;
use crate::bind::{Bound, Parent, SymbolId};
use crate::file_analysis::FileInputs;
use crate::hir::{ExprId, File};
use crate::hir_from_data::HostValue;
use crate::import_sites::ImportSpecifier;
use crate::session::Arena;
use crate::util::{FxHashMap, PositionSet, SharedSort};
use std::cell::{Cell, OnceCell};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Effects {
    Unknown,
    DeadZoneCheck,
    None,
}

#[derive(Copy, Clone)]
pub(super) struct Folded {
    pub(super) value: Value,
    pub(super) effects: Effects,
}

impl Folded {
    pub(super) const UNKNOWN: Folded = Folded::new(Value::Unknown, Effects::Unknown);

    pub(super) const fn new(value: Value, effects: Effects) -> Folded {
        Folded { value, effects }
    }

    pub(super) fn constant(constant: Constant) -> Folded {
        Folded::new(Value::from(constant), Effects::None)
    }
}

pub(crate) struct MarkedNodes {
    pub(crate) exprs: PositionSet,
    pub(super) stmts: PositionSet,
    pub(super) functions: PositionSet,
}

pub(super) struct Folder<'a, 's> {
    pub(super) hir: &'a File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) inputs: &'a FoldInputs<'s>,
    pub(super) file: &'a FileInputs<'s>,
    pub(super) atoms: &'a Interner<'s>,
    pub(super) evaluator: Evaluator<'a, 's>,
    pub(super) feature_symbol: SymbolId,
    pub(super) loader_names: OnceCell<LoaderNames>,
    pub(super) this_of_file: OnceCell<PositionSet>,
    pub(super) run_order: OnceCell<RunOrder>,
    pub(super) process_imports: OnceCell<Vec<SymbolId>>,
    pub(super) relies_on_running_before_calls: Cell<bool>,
    pub(super) values: Vec<Value>,
    pub(super) effects: Vec<Effects>,
    pub(super) path_states: FxHashMap<ExprId, PathState>,
    pub(super) data_literals: PositionSet,
    pub(super) decided: Vec<(ExprId, Decision<'s>)>,
    pub(super) specifiers: Vec<(ExprId, ImportSpecifier)>,
    pub(super) paths_from_own_directory: Vec<ExprId>,
    pub(super) paths_made_by_calls: Vec<ExprId>,
    pub(super) has_followed_path_call: Cell<bool>,
    pub(super) excluded_operands: Vec<ExprId>,
    pub(super) conditions: FxHashMap<ExprId, bool>,
    pub(super) short_circuited_links: PositionSet,
    pub(super) call_errors: Vec<(ExprId, FoldError)>,
    pub(super) strings_over_limit: Vec<ExprId>,
}

pub(super) fn run<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> FoldResult<'s> {
    let mut errors = Vec::new();
    let over_limit_count = Cell::new(0);
    let mut folder = Folder {
        hir,
        bound,
        inputs,
        file,
        atoms,
        evaluator: Evaluator::new(atoms, inputs.max_string_bytes, &over_limit_count),
        feature_symbol: find_feature_import(hir, bound, &mut errors),
        loader_names: OnceCell::new(),
        this_of_file: OnceCell::new(),
        run_order: OnceCell::new(),
        process_imports: OnceCell::new(),
        relies_on_running_before_calls: Cell::new(false),
        values: vec![Value::Unknown; hir.exprs.len()],
        effects: vec![Effects::Unknown; hir.exprs.len()],
        path_states: FxHashMap::default(),
        data_literals: PositionSet::new(hir.exprs.len()),
        decided: Vec::new(),
        specifiers: Vec::new(),
        paths_from_own_directory: Vec::new(),
        paths_made_by_calls: Vec::new(),
        has_followed_path_call: Cell::new(false),
        excluded_operands: Vec::new(),
        conditions: FxHashMap::default(),
        short_circuited_links: PositionSet::new(hir.exprs.len()),
        call_errors: Vec::new(),
        strings_over_limit: Vec::new(),
    };
    folder.fold_exprs();
    folder.finish(errors, arena)
}

impl<'s> Folder<'_, 's> {
    fn fold_exprs(&mut self) {
        let file = self.file;
        let mut host_values = file.host_values.iter().peekable();
        for index in 0..self.hir.exprs.len() {
            let e = ExprId(index as u32);
            while host_values.next_if(|entry| entry.0 < e).is_some() {}
            let host_value = host_values.next_if(|entry| entry.0 == e);
            if self.bound.parent_of_expr(e) == Parent::None {
                continue;
            }
            let over_limit_before = self.evaluator.over_limit_count();
            let folded = match host_value {
                Some(&(_, value)) => self.decide_host_value(e, value),
                None => self.fold_expr(e),
            };
            if self.evaluator.over_limit_count() != over_limit_before {
                self.strings_over_limit.push(e);
            }
            if let Value::Known(_) = folded.value {
                self.values[index] = folded.value;
                self.effects[index] = folded.effects;
            }
        }
    }

    fn decide_host_value(&mut self, e: ExprId, value: HostValue<'s>) -> Folded {
        match value {
            HostValue::Data(data) => self.decide(e, Decision::of_data(data)),
            HostValue::Deferred => self.decide(e, Decision::DeferredData),
        }
    }

    pub(super) fn decide(&mut self, e: ExprId, decision: Decision<'s>) -> Folded {
        debug_assert!(self.decided.last().is_none_or(|last| last.0 < e));
        self.decided.push((e, decision));
        match decision {
            Decision::Constant(constant) => Folded::constant(constant),
            Decision::Data(_) => {
                self.data_literals.insert(e.idx());
                Folded::UNKNOWN
            }
            Decision::Unknown | Decision::GlobalPath(_) | Decision::DeferredData => Folded::UNKNOWN,
        }
    }

    pub(super) fn folded(&self, e: ExprId) -> Folded {
        match (self.values.get(e.idx()), self.effects.get(e.idx())) {
            (Some(&value), Some(&effects)) => Folded::new(value, effects),
            (None, _) | (_, None) => Folded::UNKNOWN,
        }
    }

    pub(super) fn condition(&self, e: ExprId) -> Option<bool> {
        match self.folded(e).value {
            Value::Known(value) => Some(self.evaluator.to_boolean(value)),
            Value::Unknown => self.conditions.get(&e).copied(),
        }
    }

    pub(super) fn copy_condition(&mut self, e: ExprId, source: ExprId) {
        if let Some(&is_truthy) = self.conditions.get(&source) {
            self.conditions.insert(e, is_truthy);
        }
    }

    pub(super) fn folded_value(&self, e: ExprId) -> FoldedValue {
        let folded = self.folded(e);
        match (folded.value, folded.effects) {
            (Value::Known(value), Effects::None) => {
                FoldedValue::Constant(self.evaluator.to_constant(value))
            }
            (Value::Known(value), Effects::DeadZoneCheck) => {
                FoldedValue::ConstantOutsideDeadZone(self.evaluator.to_constant(value))
            }
            (Value::Known(_), Effects::Unknown) | (Value::Unknown, _) => FoldedValue::Unknown,
        }
    }

    pub(super) fn parent_expr(&self, e: ExprId) -> Option<ExprId> {
        if let Parent::Expr(parent) = self.bound.parent_of_expr(e) {
            parent.some()
        } else {
            None
        }
    }

    fn collect_constants(&self, dead: &MarkedNodes) -> Vec<FoldedConstant> {
        let mut constants = Vec::new();
        for (index, node) in self.hir.exprs.iter().enumerate() {
            let is_literal = literal_constant(self.hir, node.kind).is_some();
            if is_literal || dead.exprs.contains(index) {
                continue;
            }
            let expr = ExprId(index as u32);
            let (constant, checks_dead_zone) = match self.folded_value(expr) {
                FoldedValue::Unknown => continue,
                FoldedValue::Constant(constant) => (constant, false),
                FoldedValue::ConstantOutsideDeadZone(constant) => (constant, true),
            };
            constants.push(FoldedConstant {
                expr,
                constant,
                checks_dead_zone,
            });
        }
        constants
    }

    fn collect_truthy_without_effects(&self) -> PositionSet {
        let mut found = PositionSet::new(self.hir.exprs.len());
        for &e in self.conditions.keys() {
            if self.is_truthy_without_effects(e) {
                found.insert(e.idx());
            }
        }
        found
    }

    fn finish(mut self, mut errors: Vec<FoldError>, arena: &'s Arena) -> FoldResult<'s> {
        self.specifiers.shared_sort_unstable_by_key(|entry| entry.0);
        self.paths_from_own_directory.shared_sort_unstable();
        self.paths_made_by_calls.shared_sort_unstable();
        let dead = mark_nodes_below(self.hir, self.find_dead_roots());
        let decisions = Decisions {
            decided: slice_in(&self.decided, arena),
            constants: slice_in(&self.collect_constants(&dead), arena),
            specifiers: slice_in(&self.specifiers, arena),
            paths_from_own_directory: slice_in(&self.paths_from_own_directory, arena),
            paths_made_by_calls: slice_in(&self.paths_made_by_calls, arena),
            data_literals: NodeBits::freeze(&self.data_literals, arena),
            dead_exprs: NodeBits::freeze(&dead.exprs, arena),
            dead_stmts: NodeBits::freeze(&dead.stmts, arena),
            dead_functions: NodeBits::freeze(&dead.functions, arena),
            short_circuited_links: NodeBits::freeze(&self.short_circuited_links, arena),
            truthy_without_effects: NodeBits::freeze(&self.collect_truthy_without_effects(), arena),
        };
        let call_errors = self.call_errors.iter();
        let live_call_errors = call_errors.filter(|entry| !decisions.is_dead_expr(entry.0));
        errors.extend(live_call_errors.map(|entry| entry.1));
        FoldResult {
            decisions,
            errors: slice_in(&errors, arena),
            strings_over_limit: slice_in(&self.strings_over_limit, arena),
            relies_on_running_before_calls: self.relies_on_running_before_calls.get(),
        }
    }
}
