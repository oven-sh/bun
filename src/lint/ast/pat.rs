//! Binding patterns: the things that `var`, `let`, `const`, a parameter or a `catch` clause
//! declare.
//!
//! The target of a destructuring *assignment* isn't a pattern. It's an array or object literal,
//! which is how it's parsed.

use super::stmt::tags;
use super::{Expr, Key, List, Name, Node, handle};
use crate::span::Span;
use bun_sema::bind::PatParent;
use bun_sema::hir;
use smallvec::{SmallVec, smallvec};

handle! {
    /// A binding pattern.
    Pat, PatId, pats, Pat
}

#[derive(Copy, Clone, Debug)]
pub enum PatKind<'a> {
    /// A hole in an array pattern.
    Missing,
    Ident(Name<'a>),
    Object(List<'a, PatProp<'a>>),
    Array(List<'a, PatElem<'a>>),
}

tags! {
    /// The kind of a pattern without its payload.
    PatTag of PatKind {
        Missing unit,
        Ident tuple,
        Object tuple,
        Array tuple,
    }
}

impl<'a> Pat<'a> {
    #[inline]
    pub fn kind(self) -> PatKind<'a> {
        match self.try_raw().map(|raw| raw.kind) {
            None | Some(hir::PatKind::Missing) => PatKind::Missing,
            Some(hir::PatKind::Ident(name)) => PatKind::Ident(self.file.name(name)),
            Some(hir::PatKind::Object(props)) => PatKind::Object(List::run(self.file, props)),
            Some(hir::PatKind::Array(elems)) => PatKind::Array(List::run(self.file, elems)),
        }
    }

    #[inline]
    pub fn tag(self) -> PatTag {
        (self.try_raw()).map_or(PatTag::Missing, |raw| PatTag::of(&raw.kind))
    }

    /// Excludes a type annotation or default value, which belong to the node that contains the
    /// pattern.
    #[inline]
    pub fn span(self) -> Span {
        match self.try_raw() {
            Some(&hir::Pat {
                kind: hir::PatKind::Ident(_),
                pos,
                end,
            }) => Span::new(pos, self.file.end_of_identifier(pos, end)),
            Some(raw) => Span::new(raw.pos, raw.end),
            None => Span::default(),
        }
    }

    #[inline]
    pub fn as_ident(self) -> Option<Name<'a>> {
        match self.kind() {
            PatKind::Ident(name) => Some(name),
            _ => None,
        }
    }

    /// The pattern that contains `inner` as a property value or an element.
    #[inline]
    fn enclosing_pattern(file: &'a super::File<'a>, inner: hir::PatId) -> Node<'a> {
        match file.bound.pat_parent.get(inner.idx()) {
            Some(&(PatParent::Prop(owner, _) | PatParent::Elem(owner, _))) => {
                Node::Pat(Pat::new(file, owner))
            }
            _ => Node::File(file),
        }
    }

    /// A `VarDecl`, a `Param`, a `PatProp` or a `PatElem`.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        let file = self.file;
        match file.bound.pat_parent.get(self.id.idx()) {
            Some(&PatParent::Var(d)) => Node::VarDecl(super::VarDecl::new(file, d)),
            Some(&PatParent::Param(p)) => Node::Param(super::Param::new(file, p)),
            Some(&PatParent::Prop(_, prop)) => Node::PatProp(PatProp::new(file, prop)),
            Some(&PatParent::Elem(_, elem)) => Node::PatElem(PatElem::new(file, elem)),
            Some(PatParent::None) | None => Node::Pat(self).parent_of_other_node(),
        }
    }

    /// Calls `visit` with every identifier that the pattern binds, in source order.
    pub fn for_each_binding(self, visit: &mut dyn FnMut(Pat<'a>)) {
        if self.tag() == PatTag::Ident {
            return visit(self);
        }
        // An explicit stack, popped from the end. A pattern can be too deep for recursion.
        let mut pending: SmallVec<[Pat<'a>; 8]> = smallvec![self];
        while let Some(pat) = pending.pop() {
            match pat.kind() {
                PatKind::Missing => {}
                PatKind::Ident(_) => visit(pat),
                PatKind::Object(props) => pending.extend(props.iter().rev().map(PatProp::value)),
                PatKind::Array(elems) => {
                    pending.extend(elems.iter().rev().filter_map(PatElem::pat))
                }
            }
        }
    }
}

handle! {
    /// `key: value = default`, `value = default`, `...value` in an object pattern.
    PatProp, PatPropId, pat_props, PatProp
}

impl<'a> PatProp<'a> {
    #[inline]
    fn raw(self) -> &'a hir::PatProp {
        &self.file.hir.pat_props[self.id.idx()]
    }

    /// `None` for `...rest`. For the shorthand `{ a }` it's the `a`.
    pub fn key(self) -> Option<Key<'a>> {
        let raw = self.raw();
        if raw.is_rest {
            return None;
        }
        Key::new(self.file, raw.key, raw.name_kind, raw.key_pos)
    }

    /// Same as [`Key::is_computed`] on its key.
    #[inline]
    pub fn has_computed_key(self) -> bool {
        let raw = self.raw();
        !raw.is_rest && super::decl::is_computed(raw.key, raw.name_kind)
    }

    /// The `e` of a [`KeyKind::Computed`](super::KeyKind::Computed) key.
    #[inline]
    pub fn computed_key(self) -> Option<Expr<'a>> {
        match self.raw() {
            &hir::PatProp {
                key: hir::PropKey::Computed(e),
                is_rest: false,
                ..
            } => Some(Expr::new(self.file, e)),
            _ => None,
        }
    }

    /// `{ a }`, `{ a = 1 }`: the name is both the key and the binding.
    pub fn is_shorthand(self) -> bool {
        let raw = self.raw();
        !raw.is_rest && raw.key_pos == self.value().span().start
    }

    #[inline]
    pub fn value(self) -> Pat<'a> {
        Pat::new(self.file, self.raw().value)
    }

    #[inline]
    pub fn default(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().default)
    }

    #[inline]
    pub fn is_rest(self) -> bool {
        self.raw().is_rest
    }

    #[inline]
    pub fn span(self) -> Span {
        // The HIR's end is too early for a name written with an escape.
        Span::new(self.raw().pos, self.raw().end.max(self.value().span().end))
    }

    /// The object pattern.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Pat::enclosing_pattern(self.file, self.value().id())
    }
}

handle! {
    /// `pat = default`, `...pat`, or a hole, in an array pattern.
    PatElem, PatElemId, pat_elems, PatElem
}

impl<'a> PatElem<'a> {
    #[inline]
    fn raw(self) -> &'a hir::PatElem {
        &self.file.hir.pat_elems[self.id.idx()]
    }

    /// `None` for a hole.
    #[inline]
    pub fn pat(self) -> Option<Pat<'a>> {
        Pat::some(self.file, self.raw().pat).filter(|pat| pat.tag() != PatTag::Missing)
    }

    #[inline]
    pub fn default(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().default)
    }

    #[inline]
    pub fn is_rest(self) -> bool {
        self.raw().is_rest
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().end)
    }

    /// The array pattern.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Pat::enclosing_pattern(
            self.file,
            self.file
                .hir
                .pat_elems
                .get(self.id.idx())
                .map_or(hir::PatId::NONE, |it| it.pat),
        )
    }
}
