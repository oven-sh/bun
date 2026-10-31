use super::Constant;
use crate::atom::{Atom, known};
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
    /// The paths of `defines` that `bun build` defines by itself in a build for a server: it replaces them only where the last step is `.name` and no step is behind `?.`.
    pub plain_path_defines: &'s [DefinePath<'s>],
    pub dropped_calls: &'s [DefinePath<'s>],
    pub features: &'s [Atom],
    pub preserves_unused_imports: bool,
    pub minifies_syntax: bool,
    pub max_string_bytes: usize,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct TrieNode<'s> {
    pub(super) edges: &'s [(Atom, u32)],
    pub(super) value: Option<DefineValue<'s>>,
    pub(super) is_plain_path_only: bool,
    pub(super) ends_dropped_path: bool,
}

#[derive(Copy, Clone, Debug)]
pub struct FoldInputs<'s> {
    pub(super) nodes: &'s [TrieNode<'s>],
    pub(super) roots: &'s [(DefineRoot, u32)],
    pub(super) root_filter: u64,
    pub(super) has_dropped_paths: bool,
    pub(super) features: &'s [Atom],
    pub(super) preserves_unused_imports: bool,
    pub(super) minifies_syntax: bool,
    pub(super) max_string_bytes: usize,
    pub(super) is_called_before_it_runs: bool,
}

const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<FoldInputs<'static>>();
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct LinkForm {
    pub(super) is_in_optional_chain: bool,
    /// `[key]`. With --minify-syntax `bun build` has `["name"]` as `.name` first.
    pub(super) is_index: bool,
}

impl LinkForm {
    pub(super) const DOT: LinkForm = LinkForm {
        is_in_optional_chain: false,
        is_index: false,
    };
}

/// How much of what stands behind a dropped path `bun build` still drops a call of.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum DropReach {
    None,
    /// `.call` or `.apply` of a path that ends with `[key]`: a call of it, and of nothing below.
    BehindIndex,
    /// The path ends with `[key]`: a call of it, of its `.call` and of its `.apply`.
    AtIndex,
    /// Only dots stand behind the dropped path: a call of it and of every path below.
    Whole,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct PathState {
    pub(super) node: Option<u32>,
    /// The root is a binding of the file: no define and no dropped path names it.
    pub(super) is_bound_root: bool,
    pub(super) has_optional_link: bool,
    pub(super) ends_with_index: bool,
    pub(super) drop: DropReach,
    pub(super) has_dynamic_root: bool,
}

impl DropReach {
    pub(super) fn of_path_end(is_index: bool) -> DropReach {
        match is_index {
            false => DropReach::Whole,
            true => DropReach::AtIndex,
        }
    }

    // `bun build` hands the drop on from a callee to its object through every `.name`, and through `[key]` only from the callee or from its `.call` or `.apply`.
    pub(super) fn behind_link(self, name: Atom, is_index: bool) -> DropReach {
        match (self, is_index) {
            (DropReach::Whole, false) => DropReach::Whole,
            (DropReach::Whole, true) => DropReach::AtIndex,
            (DropReach::AtIndex, false) if name == known::call || name == known::apply => {
                DropReach::BehindIndex
            }
            (DropReach::None | DropReach::BehindIndex | DropReach::AtIndex, _) => DropReach::None,
        }
    }
}
