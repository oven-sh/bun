use super::Constant;
use crate::atom::Atom;
use crate::hir_from_data::DataValue;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum DefineRoot {
    Global(Atom),
    ImportMeta,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RuntimeValueKind {
    Function,
    Object,
    Symbol,
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum DefineValue<'s> {
    Constant(Constant),
    GlobalPath(&'s [Atom]),
    Data(&'s DataValue<'s>),
    RuntimeValue(RuntimeValueKind),
    RuntimeConstant(Constant),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct DefinePath<'s> {
    pub root: DefineRoot,
    pub members: &'s [Atom],
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct Define<'s> {
    pub path: DefinePath<'s>,
    pub value: DefineValue<'s>,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct FoldOptions<'s> {
    pub defines: &'s [Define<'s>],
    pub dropped_calls: &'s [DefinePath<'s>],
    pub features: &'s [Atom],
    pub preserves_unused_imports: bool,
    pub max_string_bytes: usize,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct TrieNode<'s> {
    pub(super) edges: &'s [(Atom, u32)],
    pub(super) value: Option<DefineValue<'s>>,
    pub(super) ends_dropped_path: bool,
}

#[derive(Copy, Clone, Debug)]
pub struct FoldInputs<'s> {
    pub(super) nodes: &'s [TrieNode<'s>],
    pub(super) roots: &'s [(DefineRoot, u32)],
    pub(super) root_filter: u64,
    pub(super) features: &'s [Atom],
    pub(super) preserves_unused_imports: bool,
    pub(super) max_string_bytes: usize,
    pub(super) is_called_before_it_runs: bool,
}

const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<FoldInputs<'static>>();
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct PathState {
    pub(super) node: Option<u32>,
    pub(super) has_optional_link: bool,
    pub(super) is_dropped: bool,
    pub(super) has_dynamic_root: bool,
}
