//! Which parts of a file the walk for the code paths can leave out.
//!
//! Most expressions and all types are nothing to the analysis, and few rules that listen for code
//! paths listen for many kinds of nodes. So the walk does not go into an expression or a type
//! unless something in it matters: it forks, it has a code path of its own, or a rule listens for
//! it. What matters is found in one pass over the vector of the expressions, and marked together
//! with what contains it, which takes time in proportion to what is marked.

use crate::ast::{BinOp, Chain, Expr, File, Handle, Node, TypeTag};
use crate::rule::NodeTags;
use bun_sema::bind::Parent;
use bun_sema::hir::{self, ExprTag};

/// A bit for each node of a vector of the HIR.
struct Marks(Box<[u64]>);

impl Marks {
    fn new(len: usize) -> Marks {
        Marks(vec![0; len.div_ceil(64)].into_boxed_slice())
    }

    #[inline]
    fn has(&self, at: usize) -> bool {
        self.0
            .get(at / 64)
            .is_some_and(|word| word & (1 << (at % 64)) != 0)
    }

    /// Returns whether it was not marked yet.
    #[inline]
    fn add(&mut self, at: usize) -> bool {
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
    /// Whether a rule listens for a kind of node that types consist of.
    listens_in_types: bool,
}

impl Matters {
    /// `listened`: the kinds of nodes that a rule listens for.
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
            let is_it = listened.has_index(raw.kind.tag() as u32)
                || match raw.kind {
                    K::Fn(_) | K::Class(_) | K::Cond { .. } | K::Yield { .. } => true,
                    K::Binary { op, .. } => is_logical(op),
                    K::Assign { op: Some(op), .. } => is_logical(op),
                    // Destructuring, or a default value in it.
                    K::Assign {
                        op: None, target, ..
                    } => {
                        matches!(kind_of(target), Some(K::Array(_) | K::Object(_)))
                            || match bound.expr_parent.get(i) {
                                Some(&Parent::Expr(parent)) => {
                                    matches!(kind_of(parent), Some(K::Array(_)))
                                }
                                Some(Parent::Prop(_)) => true,
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
            if is_it {
                matters.mark(Node::Expr(Expr::from_raw(file, i as u32)));
            }
        }
        matters
    }

    /// Marks `node` and the expressions and types that contain it, up to the statement, the
    /// declaration or the class that they are part of.
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

    /// Whether nothing in `node` matters, unless it is that it may throw.
    #[inline]
    pub(super) fn is_nothing_in(&self, node: Node) -> bool {
        match node {
            Node::Expr(e) => !self.exprs.has(e.id().idx()),
            Node::Type(ty) => !self.listens_in_types && !self.types.has(ty.id().idx()),
            _ => false,
        }
    }
}
