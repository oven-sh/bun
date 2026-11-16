mod children;
mod data_literals;
mod dead_code;
mod define_trie;
mod evaluate;
mod feature_flags;
mod folder;
mod folder_calls;
mod folder_commonjs;
mod folder_enums;
mod folder_fields;
mod folder_imports;
mod folder_members;
mod folder_names;
mod folder_operators;
mod inputs;
mod known_constructors;
mod known_sets;
mod known_to_bun_run;
mod never_run;
mod removed_by_bun_run;
mod run_order;
mod string_affixes;

pub use children::{TreeNode, push_children};
pub use data_literals::data_value_of;
pub(crate) use dead_code::mark_nodes_below;
pub(crate) use evaluate::is_exact_power;
use evaluate::{Evaluator, Value};
pub use inputs::{
    Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions, PathInPlace,
    RuntimeValueKind, StoredByMocks,
};
pub use known_sets::KnownSets;
pub(crate) use known_sets::outermost_cast;
pub use never_run::NeverRun;
pub(crate) use string_affixes::{
    MembersBehindNames, Passes, PathBelowFolder, PathEnd, find_export_of_module,
    find_export_of_module_with, find_members_below_module, trim_lead_surrogate_at_end,
    trim_to_last_segment, trim_trail_surrogate_at_start,
};
pub use string_affixes::{ends_in_name_with_extension, find_export_of_path_module};

use crate::atom::{Atom, Interner, known};
use crate::bind::Bound;
use crate::file_analysis::FileInputs;
use crate::hir::{
    BinOp, Branches, Chain, ExprId, ExprKind, File, FnId, ImportedName, MemberKey, NodeData,
    StmtId, UnOp,
};
use crate::hir_from_data::DataValue;
use crate::import_sites::ImportSpecifier;
use crate::module_format::CommonJsEvidence;
use crate::session::Arena;
use crate::util::PositionSet;
use std::cell::Cell;

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Constant {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(Atom),
    BigInt(Atom),
}

impl Constant {
    pub fn to_data_value<'s>(self) -> DataValue<'s> {
        match self {
            Constant::Undefined => DataValue::Undefined,
            Constant::Null => DataValue::Null,
            Constant::Boolean(value) => DataValue::Boolean(value),
            Constant::Number(value) => DataValue::Number(value),
            Constant::String(value) => DataValue::String(value),
            Constant::BigInt(value) => DataValue::BigInt(value),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum FoldedValue {
    Unknown,
    Constant(Constant),
    ConstantOutsideDeadZone(Constant),
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum FoldedData<'s> {
    Unknown,
    Known(DataValue<'s>),
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct LengthOfNamedText {
    pub name: ExprId,
    pub length: Constant,
    pub name_runs_for_its_check: bool,
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Decision<'s> {
    Unknown,
    Constant(Constant),
    GlobalPath(&'s [Atom]),
    Data(&'s DataValue<'s>),
    DeferredData,
}

impl<'s> Decision<'s> {
    pub fn of_data(data: &'s DataValue<'s>) -> Decision<'s> {
        match *data {
            DataValue::Undefined => Decision::Constant(Constant::Undefined),
            DataValue::Null => Decision::Constant(Constant::Null),
            DataValue::Boolean(value) => Decision::Constant(Constant::Boolean(value)),
            DataValue::Number(value) => Decision::Constant(Constant::Number(value)),
            DataValue::String(value) => Decision::Constant(Constant::String(value)),
            DataValue::BigInt(value) => Decision::Constant(Constant::BigInt(value)),
            DataValue::Array(_) | DataValue::Object(_) => Decision::Data(data),
            DataValue::Temporal { .. } => Decision::Unknown,
        }
    }
}

#[derive(Copy, Clone, Default, Debug)]
struct NodeBits<'s>(&'s [u64]);

impl<'s> NodeBits<'s> {
    fn freeze(set: &PositionSet, arena: &'s Arena) -> NodeBits<'s> {
        let Some(last) = set.iter().last() else {
            return NodeBits::default();
        };
        let words = arena.alloc_slice_fill_copy(last / 64 + 1, 0u64);
        for position in set.iter() {
            words[position / 64] |= 1 << (position % 64);
        }
        NodeBits(words)
    }

    fn of_ascending(
        positions: impl Iterator<Item = usize> + Clone,
        arena: &'s Arena,
    ) -> NodeBits<'s> {
        let Some(last) = positions.clone().last() else {
            return NodeBits::default();
        };
        let words = arena.alloc_slice_fill_copy(last / 64 + 1, 0u64);
        for position in positions {
            words[position / 64] |= 1 << (position % 64);
        }
        NodeBits(words)
    }

    #[inline]
    fn has(self, index: usize) -> bool {
        let word = self.0.get(index / 64);
        word.is_some_and(|word| word >> (index % 64) & 1 != 0)
    }

    fn iter(self) -> impl Iterator<Item = usize> + use<'s> {
        let words = self.0.iter().enumerate();
        words.flat_map(|(index, &word)| {
            let mut rest = word;
            std::iter::from_fn(move || {
                let position = (rest != 0).then(|| index * 64 + rest.trailing_zeros() as usize);
                rest &= rest.wrapping_sub(1);
                position
            })
        })
    }
}

#[derive(Copy, Clone, PartialEq, Debug)]
struct FoldedConstant {
    expr: ExprId,
    constant: Constant,
    checks_dead_zone: bool,
    is_known_to_bun_run: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MadeByCall {
    WholePath,
    Part,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct Decisions<'s> {
    decided: &'s [(ExprId, Decision<'s>)],
    is_decided: NodeBits<'s>,
    constants: &'s [FoldedConstant],
    is_constant: NodeBits<'s>,
    strings_and_numbers_of_bun_run_alone: NodeBits<'s>,
    strings_and_numbers_under_minify_syntax: NodeBits<'s>,
    folded_with: FoldInputs<'s>,
    specifiers: &'s [(ExprId, ImportSpecifier)],
    paths_from_own_directory: &'s [ExprId],
    paths_made_by_calls: &'s [ExprId],
    paths_written_from_own_directory: &'s [(ExprId, Atom)],
    names_made_by_calls: &'s [(ExprId, MadeByCall)],
    data_literals: NodeBits<'s>,
    dead_exprs: NodeBits<'s>,
    dead_stmts: NodeBits<'s>,
    dead_functions: NodeBits<'s>,
    dead_exprs_in_bun_run: NodeBits<'s>,
    dead_stmts_in_bun_run: NodeBits<'s>,
    dead_exprs_under_minify_syntax: NodeBits<'s>,
    dead_stmts_under_minify_syntax: NodeBits<'s>,
    short_circuited_links: NodeBits<'s>,
    constant_reads: &'s [(ExprId, Constant)],
    constants_of_lets: &'s [(ExprId, Constant)],
    truthy_without_effects: NodeBits<'s>,
    member_reads: NodeBits<'s>,
    folded_under_minify_syntax: NodeBits<'s>,
    goes_on_to_the_right: &'s [ExprId],
    stands_alone_in_bun_run: NodeBits<'s>,
}

impl<'s> Decisions<'s> {
    pub fn is_constant_under_minify_syntax(&self, hir: &File<'_>, expr: ExprId) -> bool {
        self.is_constant_in_bun_run(hir, expr) || self.folded_under_minify_syntax.has(expr.idx())
    }

    /// The value of a variable whose only store is its initializer, a constant, where the
    /// expression reads it after that store.
    pub fn constant_read(&self, expr: ExprId) -> Option<Constant> {
        let reads = self.constant_reads;
        let found = reads.binary_search_by_key(&expr, |read| read.0);
        found.ok().map(|index| reads[index].1)
    }

    /// The value of a `let` whose only store is its initializer, a constant: a read finds it or throws in the dead zone.
    pub fn constant_of_let(&self, expr: ExprId) -> Option<Constant> {
        let reads = self.constants_of_lets;
        let found = reads.binary_search_by_key(&expr, |read| read.0);
        found.ok().map(|index| reads[index].1)
    }

    #[inline]
    pub fn decision(&self, expr: ExprId) -> Decision<'s> {
        if !self.is_decided.has(expr.idx()) {
            return Decision::Unknown;
        }
        match self.decided.binary_search_by_key(&expr, |entry| entry.0) {
            Ok(index) => self.decided[index].1,
            Err(_) => Decision::Unknown,
        }
    }

    #[inline]
    fn find_folded_constant(&self, expr: ExprId) -> Option<&'s FoldedConstant> {
        if !self.is_constant.has(expr.idx()) {
            return None;
        }
        self.find_listed_constant(expr)
    }

    #[inline(never)]
    fn find_listed_constant(&self, expr: ExprId) -> Option<&'s FoldedConstant> {
        let constants = self.constants;
        let found = constants.binary_search_by_key(&expr, |entry| entry.expr);
        found.ok().map(|index| &constants[index])
    }

    #[inline]
    pub fn constant(&self, hir: &File<'_>, expr: ExprId) -> FoldedValue {
        let Some(node) = hir.exprs.get(expr.idx()) else {
            return FoldedValue::Unknown;
        };
        if let Some(constant) = literal_constant(hir, node.kind) {
            return FoldedValue::Constant(constant);
        }
        match self.find_folded_constant(expr) {
            Some(entry) if entry.checks_dead_zone => {
                FoldedValue::ConstantOutsideDeadZone(entry.constant)
            }
            Some(entry) => FoldedValue::Constant(entry.constant),
            None => FoldedValue::Unknown,
        }
    }

    pub fn length_of_named_text(&self, hir: &File<'_>, read: ExprId) -> Option<LengthOfNamedText> {
        let ExprKind::Dot {
            chain: Chain::No, ..
        } = hir.exprs.get(read.idx())?.kind
        else {
            return None;
        };
        let (name, MemberKey::Name(known::length)) = hir.member_key(read)? else {
            return None;
        };
        if !matches!(hir[name].kind, ExprKind::Ident(_)) {
            return None;
        }
        let (FoldedValue::Constant(Constant::String(_))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(_))) = self.constant(hir, name)
        else {
            return None;
        };
        let (length, name_runs_for_its_check) = match self.constant(hir, read) {
            FoldedValue::Constant(length @ Constant::Number(_)) => (length, false),
            FoldedValue::ConstantOutsideDeadZone(length @ Constant::Number(_)) => (length, true),
            _ => return None,
        };
        Some(LengthOfNamedText {
            name,
            length,
            name_runs_for_its_check,
        })
    }

    pub fn folds_text_that(&self, is_sought: impl Fn(Atom) -> bool) -> bool {
        let mut constants = self.constants.iter();
        constants.any(|it| matches!(it.constant, Constant::String(text) if is_sought(text)))
    }

    #[inline]
    pub fn is_constant_in_bun_run(&self, hir: &File<'_>, expr: ExprId) -> bool {
        let Some(node) = hir.exprs.get(expr.idx()) else {
            return false;
        };
        if literal_constant(hir, node.kind).is_some() {
            return true;
        }
        let found = self.find_folded_constant(expr);
        found.is_some_and(|entry| entry.is_known_to_bun_run)
    }

    pub fn is_string_or_number_in_bun_run(&self, hir: &File<'_>, expr: ExprId) -> bool {
        match self.constant(hir, expr) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                matches!(constant, Constant::String(_) | Constant::Number(_))
                    && self.is_constant_in_bun_run(hir, expr)
            }
            FoldedValue::Unknown => self.strings_and_numbers_of_bun_run_alone.has(expr.idx()),
        }
    }

    pub fn is_string_or_number_under_minify_syntax(&self, hir: &File<'_>, expr: ExprId) -> bool {
        match self.constant(hir, expr) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                matches!(constant, Constant::String(_) | Constant::Number(_))
                    && self.is_constant_under_minify_syntax(hir, expr)
            }
            FoldedValue::Unknown => self.strings_and_numbers_under_minify_syntax.has(expr.idx()),
        }
    }

    pub fn specifier(&self, argument: ExprId) -> ImportSpecifier {
        match self
            .specifiers
            .binary_search_by_key(&argument, |entry| entry.0)
        {
            Ok(index) => self.specifiers[index].1,
            Err(_) => ImportSpecifier::Unknown,
        }
    }

    pub fn is_path_from_own_directory(&self, argument: ExprId) -> bool {
        self.paths_from_own_directory
            .binary_search(&argument)
            .is_ok()
    }

    pub fn paths_written_from_own_directory(&self) -> &'s [(ExprId, Atom)] {
        self.paths_written_from_own_directory
    }

    pub fn is_path_made_by_call(&self, argument: ExprId) -> bool {
        self.paths_made_by_calls.binary_search(&argument).is_ok()
    }

    pub fn find_what_call_made(&self, argument: ExprId) -> Option<MadeByCall> {
        let made = self.names_made_by_calls;
        let index = made.binary_search_by_key(&argument, |entry| entry.0).ok()?;
        Some(made[index].1)
    }

    #[inline]
    pub fn is_data_literal(&self, expr: ExprId) -> bool {
        self.data_literals.has(expr.idx())
    }

    #[inline]
    pub fn is_dead_expr(&self, expr: ExprId) -> bool {
        self.dead_exprs.has(expr.idx())
    }

    #[inline]
    pub fn is_dead_stmt(&self, stmt: StmtId) -> bool {
        self.dead_stmts.has(stmt.idx())
    }

    pub fn decided(&self) -> &'s [(ExprId, Decision<'s>)] {
        self.decided
    }

    /// The texts that expressions which are no literals fold to.
    pub fn folded_texts(&self) -> impl Iterator<Item = Atom> + use<'s> {
        self.constants
            .iter()
            .filter_map(|folded| match folded.constant {
                Constant::String(text) => Some(text),
                _ => None,
            })
    }

    pub fn dead_exprs(&self) -> impl Iterator<Item = ExprId> + use<'s> {
        self.dead_exprs.iter().map(|index| ExprId(index as u32))
    }

    /// In the order of their numbers.
    pub fn dead_exprs_and_short_circuited_links(&self) -> impl Iterator<Item = ExprId> + use<'s> {
        let (dead, links) = (self.dead_exprs.0, self.short_circuited_links.0);
        let word_at = |words: &[u64], index: usize| words.get(index).copied().unwrap_or(0);
        (0..dead.len().max(links.len())).flat_map(move |index| {
            let mut rest = word_at(dead, index) | word_at(links, index);
            std::iter::from_fn(move || {
                let position = (rest != 0).then(|| index * 64 + rest.trailing_zeros() as usize);
                rest &= rest.wrapping_sub(1);
                position.map(|position| ExprId(position as u32))
            })
        })
    }

    pub fn dead_stmts(&self) -> impl Iterator<Item = StmtId> + use<'s> {
        self.dead_stmts.iter().map(|index| StmtId(index as u32))
    }

    pub fn operators_that_go_on_to_the_right(&self) -> &'s [ExprId] {
        self.goes_on_to_the_right
    }

    pub fn find_operand_alone_in_bun_run(
        &self,
        hir: &File<'_>,
        operator: ExprId,
    ) -> Option<ExprId> {
        let operands = match hir[operator].kind {
            ExprKind::Binary { left, right, .. } => [left, right],
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                [yes, no]
            }
            _ => return None,
        };
        let mut operands = operands.into_iter();
        operands.find(|operand| self.stands_alone_in_bun_run.has(operand.idx()))
    }

    pub(crate) fn has_same_code_and_specifiers(&self, other: &Decisions<'_>) -> bool {
        self.dead_exprs.0 == other.dead_exprs.0
            && self.dead_stmts.0 == other.dead_stmts.0
            && self.dead_exprs_in_bun_run.0 == other.dead_exprs_in_bun_run.0
            && self.dead_stmts_in_bun_run.0 == other.dead_stmts_in_bun_run.0
            && self.dead_exprs_under_minify_syntax.0 == other.dead_exprs_under_minify_syntax.0
            && self.dead_stmts_under_minify_syntax.0 == other.dead_stmts_under_minify_syntax.0
            && self.stands_alone_in_bun_run.0 == other.stands_alone_in_bun_run.0
            && self.specifiers == other.specifiers
    }

    pub fn as_folded_by_bun_run(&self) -> Decisions<'s> {
        Decisions {
            dead_exprs: self.dead_exprs_in_bun_run,
            dead_stmts: self.dead_stmts_in_bun_run,
            ..*self
        }
    }

    pub fn as_folded_under_minify_syntax(&self) -> Decisions<'s> {
        Decisions {
            dead_exprs: self.dead_exprs_under_minify_syntax,
            dead_stmts: self.dead_stmts_under_minify_syntax,
            ..*self
        }
    }

    #[inline]
    pub fn is_dead_function(&self, function: FnId) -> bool {
        self.dead_functions.has(function.idx())
    }

    #[inline]
    pub fn is_short_circuited_link(&self, expr: ExprId) -> bool {
        self.short_circuited_links.has(expr.idx())
    }

    #[inline]
    pub fn is_truthy_without_effects(&self, expr: ExprId) -> bool {
        self.truthy_without_effects.has(expr.idx())
    }

    #[inline]
    pub fn reads_member(&self, expr: ExprId) -> bool {
        self.member_reads.has(expr.idx())
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FoldErrorKind {
    FeatureArgumentCount,
    FeatureArgumentNotString,
    FeatureFlagNotAscii,
    FeatureOutsideCondition,
    FeatureImportedTwice,
    UnknownBundleExport(Atom),
    ImportStatementInCommonJs(CommonJsEvidence),
    MacroInExportStar,
    MacroInExportFrom,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct FoldError {
    pub kind: FoldErrorKind,
    pub node: NodeData,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct FoldResult<'s> {
    pub decisions: Decisions<'s>,
    pub errors: &'s [FoldError],
    pub strings_over_limit: &'s [ExprId],
    pub asks_for_main_module: bool,
    pub imported_names: &'s [ImportedName],
}

pub(crate) fn fold_file<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> FoldResult<'s> {
    folder::run(hir, bound, inputs, file, atoms, arena)
}

pub fn apply_unary(atoms: &Interner<'_>, op: UnOp, operand: Constant) -> Option<Constant> {
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(atoms, usize::MAX, &over_limit_count);
    match evaluator.unary(op, Value::from(operand)) {
        Value::Known(result) => Some(evaluator.to_constant(result)),
        Value::Unknown => None,
    }
}

pub fn is_computed_by_transpiler(atoms: &Interner<'_>, op: BinOp, operands: [Constant; 2]) -> bool {
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(atoms, usize::MAX, &over_limit_count);
    match operands.map(Value::from) {
        [Value::Known(left), Value::Known(right)] => {
            evaluator.is_computed_by_bun_run(op, left, right)
        }
        _ => false,
    }
}

pub fn apply_binary(
    atoms: &Interner<'_>,
    op: BinOp,
    operands: [Constant; 2],
    max_string_bytes: usize,
) -> Option<Constant> {
    if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) {
        return None;
    }
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(atoms, max_string_bytes, &over_limit_count);
    let [left, right] = operands.map(Value::from);
    match evaluator.binary(op, left, right) {
        Value::Known(result) => Some(evaluator.to_constant(result)),
        Value::Unknown => None,
    }
}

pub fn apply_template(
    atoms: &Interner<'_>,
    texts: &[Atom],
    substitutions: &[Constant],
    max_string_bytes: usize,
) -> Option<Constant> {
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(atoms, max_string_bytes, &over_limit_count);
    let substitutions: Vec<Value> = substitutions.iter().copied().map(Value::from).collect();
    match evaluator.concatenate(texts, &substitutions) {
        Value::Known(result) => Some(evaluator.to_constant(result)),
        Value::Unknown => None,
    }
}

pub(crate) fn slice_in<'s, T: Copy>(list: &[T], arena: &'s Arena) -> &'s [T] {
    if list.is_empty() {
        return &[];
    }
    arena.alloc_slice_copy(list)
}

#[inline]
fn literal_constant(hir: &File<'_>, kind: ExprKind) -> Option<Constant> {
    Some(match kind {
        ExprKind::Null => Constant::Null,
        ExprKind::True => Constant::Boolean(true),
        ExprKind::False => Constant::Boolean(false),
        ExprKind::Number(index) => Constant::Number(hir.numbers[index as usize]),
        ExprKind::String(text) => Constant::String(text),
        ExprKind::BigInt(digits) => Constant::BigInt(digits),
        _ => return None,
    })
}
