mod children;
mod data_literals;
mod dead_code;
mod define_trie;
mod evaluate;
mod feature_flags;
mod folder;
mod folder_calls;
mod folder_commonjs;
mod folder_names;
mod folder_operators;
mod inputs;
mod run_order;
mod string_affixes;

pub use children::{TreeNode, push_children};
pub use data_literals::data_value_of;
pub(crate) use dead_code::mark_nodes_below;
pub(crate) use evaluate::is_exact_power;
pub use inputs::{
    Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions, RuntimeValueKind,
};

use crate::atom::{Atom, Interner};
use crate::bind::Bound;
use crate::file_analysis::FileInputs;
use crate::hir::{ExprId, ExprKind, File, FnId, NodeData, StmtId};
use crate::hir_from_data::DataValue;
use crate::import_sites::ImportSpecifier;
use crate::module_format::CommonJsEvidence;
use crate::session::Arena;
use crate::util::PositionSet;

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
    short_circuited_links: NodeBits<'s>,
    truthy_without_effects: NodeBits<'s>,
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
