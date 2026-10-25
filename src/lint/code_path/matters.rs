//! Which parts of a file the code path walk can skip.
//!
//! Most expressions and all types are irrelevant to the analysis, and few rules that listen for
//! code paths also listen for many kinds of nodes. So the walk only descends into an expression or
//! a type if something in it matters: it forks, it has its own code path, or a rule listens for it.
//! One pass over the expression vector finds those nodes and marks each one along with its
//! ancestors, which takes time proportional to the number of marked nodes.

use crate::ast::{BinOp, Chain, Expr, File, Handle, Node, TypeTag};
use crate::rule::NodeTags;
use bun_sema::bind::Parent;
use bun_sema::hir::{self, ExprTag};

/// One bit per node of a HIR vector.
pub(super) struct Marks(Box<[u64]>);

impl Marks {
    pub(super) fn new(len: usize) -> Marks {
        Marks(vec![0; len.div_ceil(64)].into_boxed_slice())
    }

    pub(super) fn is_any(&self) -> bool {
        self.0.iter().any(|&word| word != 0)
    }

    pub(super) fn set(&mut self, at: usize, is_marked: bool) {
        if let Some(word) = self.0.get_mut(at / 64) {
            match is_marked {
                true => *word |= 1 << (at % 64),
                false => *word &= !(1 << (at % 64)),
            }
        }
    }

    #[inline]
    pub(super) fn has(&self, at: usize) -> bool {
        self.0
            .get(at / 64)
            .is_some_and(|word| word & (1 << (at % 64)) != 0)
    }

    /// Returns true if it wasn't marked before.
    #[inline]
    pub(super) fn add(&mut self, at: usize) -> bool {
        let Some(word) = self.0.get_mut(at / 64) else {
            return false;
        };
        let bit = 1 << (at % 64);
        let is_new = *word & bit == 0;
        *word |= bit;
        is_new
    }
}

pub(super) struct Matters {
    /// The expressions that matter or contain something that does.
    exprs: Marks,
    /// The types that contain something that matters.
    types: Marks,
    /// True if a rule listens for a kind of node that can appear inside a type.
    listens_in_types: bool,
}

impl Matters {
    /// `listened` is the set of node kinds that rules listen for.
    pub(super) fn new<'a>(file: &'a File<'a>, listened: NodeTags) -> Matters {
        use hir::ExprKind as K;
        let listens_for = |kind: NodeTags| listened.union(kind) == listened;
        let listens_in_types = TypeTag::ALL.iter().any(|&tag| listens_for(tag.into()))
            || [
                NodeTags::TYPE_PARAM,
                NodeTags::TUPLE_ELEM,
                NodeTags::MEMBER,
                NodeTags::FUNC,
                NodeTags::PARAM,
                NodeTags::PAT,
                NodeTags::PAT_PROP,
                NodeTags::PAT_ELEM,
            ]
            .into_iter()
            .any(listens_for);
        let listens_for_props = listens_for(NodeTags::PROP);
        let listens_for_templates = listens_for(ExprTag::Template.into());
        let (hir, bound) = (&file.hir, &file.bound);
        let is_logical = |op: BinOp| matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
        let kind_of = |e: hir::ExprId| hir.exprs.get(e.idx()).map(|raw| raw.kind);
        let has_type_args = |call: hir::CallId| {
            hir.calls
                .get(call.idx())
                .is_some_and(|call| !call.type_args.is_empty())
        };

        let mut matters = Matters {
            exprs: Marks::new(hir.exprs.len()),
            types: Marks::new(hir.types.len()),
            listens_in_types,
        };
        for (i, raw) in hir.exprs.iter().enumerate() {
            let is_relevant = listened.has_index(raw.kind.tag() as u32)
                || match raw.kind {
                    K::Fn(_) | K::Class(_) | K::Cond { .. } | K::Yield { .. } => true,
                    K::Binary { op, .. } => is_logical(op),
                    K::Assign { op: Some(op), .. } => is_logical(op),
                    // Destructuring, or a default value in it.
                    K::Assign {
                        op: None, target, ..
                    } => {
                        matches!(kind_of(target), Some(K::Array(_) | K::Object(_)))
                            || match bound.parent_of_expr(hir::ExprId(i as u32)) {
                                Parent::Expr(parent) => {
                                    matches!(kind_of(parent), Some(K::Array(_)))
                                }
                                Parent::Prop(_) => true,
                                _ => false,
                            }
                    }
                    K::Dot { chain, .. } | K::Index { chain, .. } => chain != Chain::No,
                    K::Call(call) => {
                        hir.calls
                            .get(call.idx())
                            .is_some_and(|call| call.chain != Chain::No)
                            || listens_in_types && has_type_args(call)
                    }
                    K::New(call) | K::TaggedTemplate(call) => {
                        listens_in_types && has_type_args(call)
                    }
                    K::As { .. } | K::Satisfies { .. } | K::Instantiation { .. } => {
                        listens_in_types
                    }
                    K::Object(_) => listens_for_props,
                    K::Jsx(_) => listens_for_props || listens_in_types,
                    // A template without substitutions.
                    K::String(_) => listens_for_templates,
                    _ => false,
                };
            if is_relevant {
                matters.mark(Node::Expr(Expr::from_raw(file, i as u32)));
            }
        }
        matters
    }

    /// Marks `node` and the expressions and types that contain it, up to the enclosing statement,
    /// declaration or class.
    fn mark(&mut self, node: Node) {
        let mut node = node;
        loop {
            let is_new = match node {
                Node::Expr(e) => self.exprs.add(e.id().idx()),
                Node::Type(ty) => self.types.add(ty.id().idx()),
                Node::Prop(_)
                | Node::Func(_)
                | Node::Param(_)
                | Node::Pat(_)
                | Node::PatProp(_)
                | Node::PatElem(_)
                | Node::Member(_)
                | Node::TypeParam(_)
                | Node::TupleElem(_) => true,
                _ => false,
            };
            if !is_new {
                return;
            }
            node = node.parent();
        }
    }

    /// True if nothing in `node` matters, except that it may throw.
    #[inline]
    pub(super) fn can_skip(&self, node: Node) -> bool {
        match node {
            Node::Expr(e) => !self.exprs.has(e.id().idx()),
            Node::Type(ty) => !self.listens_in_types && !self.types.has(ty.id().idx()),
            _ => false,
        }
    }
}
