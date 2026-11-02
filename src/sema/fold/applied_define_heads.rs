use super::{Decision, Decisions, NamedPath};
use crate::bind::{Binding, Bound, ImplicitReference, ImplicitReferenceKind};
use crate::hir::ExprId;

/// Where the fold applied, in code that runs, a define whose first name the binder recorded. No identifier spells the name there.
#[derive(Copy, Clone, Debug)]
pub struct AppliedDefineHead<'s> {
    /// The expression that the value of the define replaces: the identifier that the define names, or the access that ends its path.
    pub(crate) site: ExprId,
    pub(crate) path: &'s NamedPath<'s>,
}

impl AppliedDefineHead<'_> {
    /// What the first name is bound to at the site, before the module goal.
    pub fn binding(&self) -> Binding {
        self.path.head.binding
    }

    /// The site where the value is the name alone. `None`: the value has members behind the name, and the code acts on a member of what it holds.
    pub(crate) fn name_site(&self) -> Option<ExprId> {
        (self.path.names.len() == 1).then_some(self.site)
    }
}

impl<'s> Decisions<'s> {
    /// Whether the fold applied a define head in the file, in dead code too. Whoever asks the questions below of many expressions asks here first.
    #[inline]
    pub fn has_define_heads(&self) -> bool {
        !self.applied_heads.is_empty()
    }

    /// The mentions of a binding that no identifier spells, in code that `is_dead_expr` leaves. Whoever concludes from all its mentions asks here.
    pub fn applied_define_heads(&self) -> impl Iterator<Item = AppliedDefineHead<'s>> {
        let applied = self.applied_heads.iter();
        let live = applied.filter(move |entry| !self.is_dead_expr(entry.0));
        live.map(|&(site, path)| AppliedDefineHead { site, path })
    }

    /// Those of `binding`, each as its `AppliedDefineHead::name_site`. Whoever scans the identifiers that name a binding asks here for the rest.
    pub fn mentions_by_defines(&self, binding: Binding) -> impl Iterator<Item = Option<ExprId>> {
        let heads = self.applied_define_heads();
        let heads = heads.filter(move |head| head.binding() == binding);
        heads.map(|head| head.name_site())
    }

    /// Whether code reads what `reference` names. The first name of a define is read only where the fold applied the define, outside dead code.
    pub fn is_read(&self, reference: &ImplicitReference) -> bool {
        match reference.kind {
            ImplicitReferenceKind::DefineHead => self.reads_define_head(reference),
            ImplicitReferenceKind::JsxFactory
            | ImplicitReferenceKind::JsxFragment
            | ImplicitReferenceKind::DecoratorMetadata(_) => true,
        }
    }

    /// Whether a define reads a name that the binder recorded in place of `expr`. Whoever takes an identifier for the name that it spells asks first.
    pub fn is_named_path(&self, expr: ExprId) -> bool {
        !self.applied_heads.is_empty() && matches!(self.decision(expr), Decision::NamedPath(_))
    }

    /// What `expr` names: `AppliedDefineHead::binding` where a define puts a name alone in its place, and else `Bound::binding`.
    pub fn binding_named_at(&self, bound: &Bound<'_>, expr: ExprId) -> Binding {
        if !self.applied_heads.is_empty()
            && let Decision::NamedPath(&NamedPath { head, names: &[_] }) = self.decision(expr)
        {
            return head.binding;
        }
        bound.binding(expr)
    }
}
