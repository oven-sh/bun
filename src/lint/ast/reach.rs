//! Which elements of the vectors of the HIR are nodes of the tree.
//!
//! A listener that is called with all the nodes of a sort goes through a vector, not through the
//! tree. Not everything in a vector is a node that [`Node::for_each_child`](super::Node) reaches:
//! - what the parser has left behind where it backtracked,
//! - what is synthesized from JSDoc comments for the type checker,
//! - what the HIR has and the source has not: placeholders, wrappers, the object of
//!   `with { type: "json" }`, the `B` of `namespace A.B`.

use super::{
    Case, Class, EnumMember, ExportSpec, ExprTag, File, Func, Handle, ImportSpec, Member, Param,
    PatTag, Prop, StmtTag, TypeParam, TypeTag, VarDecl,
};
use bun_sema::bind::{FnOwner, MemberOwner, Parent, PatParent};
use bun_sema::hir;

/// In place of the kind of what is not a node: see [`File::expr_tags_in_tree`].
pub const NOT_IN_TREE: u8 = u8::MAX;

/// Declares `File::$all`, which is `File::$one` for a whole vector of the HIR.
macro_rules! tags_in_tree {
    ($($all:ident $one:ident $field:ident;)*) => {
        impl File<'_> {$(
            /// Replaces `out` by the kind, as a number, of each element of the vector of the HIR,
            /// [`NOT_IN_TREE`] for what is not a node.
            #[doc(hidden)]
            pub fn $all(&self, out: &mut Vec<u8>) {
                let tags = (0..self.hir.$field.len()).map(|i| i as u32);
                out.clear();
                // Nothing is synthesized in most files, and then nothing asks whether it is.
                match self.has_synthetic_nodes() {
                    true => out.extend(tags.map(|i| self.$one::<true>(i).map_or(NOT_IN_TREE, |tag| tag as u8))),
                    false => out.extend(tags.map(|i| self.$one::<false>(i).map_or(NOT_IN_TREE, |tag| tag as u8))),
                }
            }
        )*}
    };
}

tags_in_tree! {
    expr_tags_in_tree expr_tag_in_tree exprs;
    stmt_tags_in_tree stmt_tag_in_tree stmts;
    type_tags_in_tree type_tag_in_tree types;
    pat_tags_in_tree pat_tag_in_tree pats;
}

impl File<'_> {
    /// The kind of the expression at `i` of the HIR. `None` if it is not a node.
    pub(crate) fn expr_in_tree(&self, i: usize) -> Option<ExprTag> {
        self.expr_tag_in_tree::<true>(i as u32)
    }

    /// The kind of the statement at `i` of the HIR. `None` if it is not a node.
    pub(crate) fn stmt_in_tree(&self, i: usize) -> Option<StmtTag> {
        self.stmt_tag_in_tree::<true>(i as u32)
    }

    /// The kind of the type at `i` of the HIR. `None` if it is not a node.
    pub(crate) fn type_in_tree(&self, i: usize) -> Option<TypeTag> {
        self.type_tag_in_tree::<true>(i as u32)
    }

    /// The kind of the pattern at `i` of the HIR. `None` if it is not a node.
    pub(crate) fn pat_in_tree(&self, i: usize) -> Option<PatTag> {
        self.pat_tag_in_tree::<true>(i as u32)
    }

    /// `MAY_BE_SYNTHETIC`, here and below: the file may have nodes that are synthesized from JSDoc
    /// comments.
    #[inline(always)]
    fn is_written<const MAY_BE_SYNTHETIC: bool>(&self, pos: u32) -> bool {
        !MAY_BE_SYNTHETIC || !self.is_in_jsdoc(pos)
    }

    #[inline(always)]
    fn expr_tag_in_tree<const MAY_BE_SYNTHETIC: bool>(&self, i: u32) -> Option<ExprTag> {
        let id = hir::ExprId(i);
        let raw = self.hir.exprs.get(id.idx())?;
        let attributes = self.hir.import_attributes;
        let is_node = !matches!(self.bound.expr_parent.get(id.idx()), None | Some(Parent::None))
            && !matches!(raw.kind, hir::ExprKind::Missing)
            && self.is_written::<MAY_BE_SYNTHETIC>(raw.pos)
            && (!MAY_BE_SYNTHETIC || self.jsdoc_cast_operand(id).is_none())
            && (attributes.is_empty()
                || !matches!(raw.kind, hir::ExprKind::Object(_))
                || !attributes.iter().any(|it| it.1 == id));
        is_node.then(|| self.expr_tag(id, raw))
    }

    #[inline(always)]
    fn stmt_tag_in_tree<const MAY_BE_SYNTHETIC: bool>(&self, i: u32) -> Option<StmtTag> {
        let id = hir::StmtId(i);
        let raw = self.hir.stmts.get(id.idx())?;
        let is_node = !matches!(self.bound.stmt_parent.get(id.idx()), None | Some(Parent::None))
            && self.is_written::<MAY_BE_SYNTHETIC>(raw.start)
            && self.wrapped_in(id).is_none()
            && !self.is_nested_namespace(id);
        is_node.then(|| StmtTag::of(&raw.kind))
    }

    #[inline(always)]
    fn type_tag_in_tree<const MAY_BE_SYNTHETIC: bool>(&self, i: u32) -> Option<TypeTag> {
        let id = hir::TypeNodeId(i);
        let raw = self.hir.types.get(id.idx())?;
        let is_node = self.bound.type_scope.get(id.idx()).is_some_and(|scope| scope.is_some())
            && self.is_written::<MAY_BE_SYNTHETIC>(raw.pos)
            && !self.is_in_type_that_is_an_error(id);
        is_node.then(|| TypeTag::of(&raw.kind))
    }

    #[inline(always)]
    fn pat_tag_in_tree<const MAY_BE_SYNTHETIC: bool>(&self, i: u32) -> Option<PatTag> {
        let id = hir::PatId(i);
        let raw = self.hir.pats.get(id.idx())?;
        let is_bound = !matches!(self.bound.pat_parent.get(id.idx()), None | Some(PatParent::None));
        let is_node = !matches!(raw.kind, hir::PatKind::Missing)
            && self.is_written::<MAY_BE_SYNTHETIC>(raw.pos)
            && (is_bound || self.is_this_name(id, raw));
        is_node.then(|| PatTag::of(&raw.kind))
    }

    /// Whether `pat` is the `this` of a `this` parameter of a function that is a node.
    fn is_this_name(&self, pat: hir::PatId, raw: &hir::Pat) -> bool {
        self.hir.text.get(raw.pos as usize..raw.end as usize) == Some(b"this")
            && (self.parents().of_this(pat))
                .is_some_and(|param| self.bound.param_fn.get(param.idx()).is_some_and(|f| f.is_some()))
    }

    /// Whether the statement `id` is the `B` of `namespace A.B`: it starts with its name.
    #[inline]
    pub(crate) fn is_nested_namespace(&self, id: hir::StmtId) -> bool {
        match self.hir.stmts.get(id.idx()) {
            Some(&hir::Stmt { kind: hir::StmtKind::Module(m), start, .. }) => {
                let is_name = |it: &hir::Module| it.name_pos == start && matches!(it.name, hir::ModuleName::Ident(_));
                self.hir.modules.get(m.idx()).is_some_and(is_name)
                    && matches!(self.bound.stmt_parent.get(id.idx()), Some(Parent::Module(_)))
            }
            _ => false,
        }
    }

    /// Whether `prop` is a `key: "value"` of `with { .. }`, which is not a property of an object.
    #[inline]
    pub(crate) fn is_import_attribute(&self, prop: hir::PropId) -> bool {
        let attributes = self.hir.import_attributes;
        !attributes.is_empty()
            && (self.bound.prop_owner.get(prop.idx()))
                .is_some_and(|owner| attributes.iter().any(|it| it.1 == *owner))
    }
}

macro_rules! in_tree {
    ($($handle:ident |$it:ident, $file:ident, $i:ident| $is_reached:expr;)*) => {$(
        impl $handle<'_> {
            /// Whether it is a node of the tree, as opposed to an element of a vector of the HIR
            /// that is not reached from the file or that is synthesized from a JSDoc comment.
            pub(crate) fn is_in_tree(self) -> bool {
                let ($it, $file, $i) = (self, self.file, self.id.idx());
                $is_reached && !$it.is_synthetic()
            }
        }
    )*};
}

in_tree! {
    Func |_it, file, i| file.bound.fns.get(i).is_some_and(|f| f.owner != FnOwner::None);
    Class |_it, file, i| file.bound.class_scope.get(i).is_some_and(|scope| scope.is_some());
    Member |_it, file, i| !matches!(file.bound.member_owner.get(i), None | Some(MemberOwner::None));
    Prop |it, file, i| file.bound.prop_owner.get(i).is_some_and(|owner| owner.is_some())
        && !file.is_import_attribute(it.id);
    Param |_it, file, i| file.bound.param_fn.get(i).is_some_and(|f| f.is_some());
    TypeParam |_it, file, i| file.bound.type_param_scope.get(i).is_some_and(|scope| scope.is_some());
    VarDecl |_it, file, i| file.bound.var_stmt.get(i).is_some_and(|s| s.is_some());
    Case |_it, file, i| file.bound.case_stmt.get(i).is_some_and(|s| s.is_some());
    EnumMember |_it, file, i| i < file.hir.enum_members.len();
    ImportSpec |_it, file, i| i < file.hir.import_specs.len();
    ExportSpec |_it, file, i| i < file.hir.export_specs.len();
}
