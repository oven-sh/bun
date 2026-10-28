mod children;
mod data_literals;
mod dead_code;
mod define_trie;
mod evaluate;
mod feature_flags;
mod folder;
mod folder_calls;
mod folder_commonjs;
mod folder_imports;
mod folder_names;
mod folder_operators;
mod inputs;
mod known_to_bun_run;
mod removed_by_bun_run;
mod run_order;
mod string_affixes;

pub use children::{TreeNode, push_children};
pub use data_literals::data_value_of;
pub(crate) use dead_code::mark_nodes_below;
pub(crate) use evaluate::is_exact_power;
use evaluate::{Evaluator, Value};
pub use inputs::{
    Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions, RuntimeValueKind,
};
pub use removed_by_bun_run::is_removed_where_never_run;
pub(crate) use string_affixes::{
    PathBelowFolder, find_path_joining_function, trim_lead_surrogate_at_end,
    trim_trail_surrogate_at_start,
};

use crate::atom::{Atom, Interner};
use crate::bind::Bound;
use crate::file_analysis::FileInputs;
use crate::hir::{BinOp, ExprId, ExprKind, File, FnId, ImportedName, NodeData, StmtId, UnOp};
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

    #[inline]
    fn has(self, index: usize) -> bool {
        let word = self.0.get(index / 64);
        word.is_some_and(|word| word >> (index % 64) & 1 != 0)
    }
}

#[derive(Copy, Clone, PartialEq, Debug)]
struct FoldedConstant {
    expr: ExprId,
    constant: Constant,
    checks_dead_zone: bool,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct Decisions<'s> {
    decided: &'s [(ExprId, Decision<'s>)],
    constants: &'s [FoldedConstant],
    specifiers: &'s [(ExprId, ImportSpecifier)],
    paths_from_own_directory: &'s [ExprId],
    paths_made_by_calls: &'s [ExprId],
    data_literals: NodeBits<'s>,
    dead_exprs: NodeBits<'s>,
    dead_stmts: NodeBits<'s>,
    dead_functions: NodeBits<'s>,
    dead_exprs_in_bun_run: NodeBits<'s>,
    dead_stmts_in_bun_run: NodeBits<'s>,
    short_circuited_links: NodeBits<'s>,
    truthy_without_effects: NodeBits<'s>,
    member_reads: NodeBits<'s>,
}

impl<'s> Decisions<'s> {
    #[inline]
    pub fn decision(&self, expr: ExprId) -> Decision<'s> {
        match self.decided.binary_search_by_key(&expr, |entry| entry.0) {
            Ok(index) => self.decided[index].1,
            Err(_) => Decision::Unknown,
        }
    }

    pub fn constant(&self, hir: &File<'_>, expr: ExprId) -> FoldedValue {
        let Some(node) = hir.exprs.get(expr.idx()) else {
            return FoldedValue::Unknown;
        };
        if let Some(constant) = literal_constant(hir, node.kind) {
            return FoldedValue::Constant(constant);
        }
        let found = self
            .constants
            .binary_search_by_key(&expr, |entry| entry.expr);
        match found.map(|index| self.constants[index]) {
            Ok(entry) if entry.checks_dead_zone => {
                FoldedValue::ConstantOutsideDeadZone(entry.constant)
            }
            Ok(entry) => FoldedValue::Constant(entry.constant),
            Err(_) => FoldedValue::Unknown,
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

    pub fn is_path_made_by_call(&self, argument: ExprId) -> bool {
        self.paths_made_by_calls.binary_search(&argument).is_ok()
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

    /// Whether both remove the same code and know the same specifiers. Whoever looks for the import sites of a file, for its format and
    /// for what it asks of other files reads nothing else of them.
    pub(crate) fn has_same_code_and_specifiers(&self, other: &Decisions<'_>) -> bool {
        self.dead_exprs.0 == other.dead_exprs.0
            && self.dead_stmts.0 == other.dead_stmts.0
            && self.dead_exprs_in_bun_run.0 == other.dead_exprs_in_bun_run.0
            && self.dead_stmts_in_bun_run.0 == other.dead_stmts_in_bun_run.0
            && self.specifiers == other.specifiers
    }

    /// `bun run` folds less than a build does. In the result, only the code that `bun run` removes too is dead.
    pub fn as_folded_by_bun_run(&self) -> Decisions<'s> {
        Decisions {
            dead_exprs: self.dead_exprs_in_bun_run,
            dead_stmts: self.dead_stmts_in_bun_run,
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

    /// It may read members of built-in objects: `reads_member`.
    #[inline]
    pub fn is_truthy_without_effects(&self, expr: ExprId) -> bool {
        self.truthy_without_effects.has(expr.idx())
    }

    /// The build knows the value or what a test of it answers, and evaluating it reads members of built-in objects.
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
    pub relies_on_running_before_calls: bool,
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

/// What the operator makes of a constant. `None`: the build leaves it to the run time.
pub fn apply_unary(atoms: &Interner<'_>, op: UnOp, operand: Constant) -> Option<Constant> {
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(atoms, usize::MAX, &over_limit_count);
    match evaluator.unary(op, Value::from(operand)) {
        Value::Known(result) => Some(evaluator.to_constant(result)),
        Value::Unknown => None,
    }
}

/// What an operator that evaluates both of its operands makes of two constants. `None`: the build leaves it to the run time.
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

/// The text of a template whose substitutions are constants. `None`: the build leaves it to the run time.
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
