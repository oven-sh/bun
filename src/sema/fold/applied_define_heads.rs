use super::{Decision, Decisions, NamedPath};
use crate::bind::Binding;
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

    /// The site where the value is the name alone. `None`: the value has members behind the name, and the code there acts on a member of what the name holds.
    pub(crate) fn name_site(&self) -> Option<ExprId> {
        (self.path.names.len() == 1).then_some(self.site)
    }
}

impl<'s> Decisions<'s> {
    /// The mentions of a binding that no identifier spells, in code that `is_dead_expr` leaves. Whoever concludes from every mention of a binding asks here.
    pub fn applied_define_heads(&self) -> impl Iterator<Item = AppliedDefineHead<'s>> {
        let applied = self.applied_heads.iter();
        let live = applied.filter(move |entry| !self.is_dead_expr(entry.0));
        live.map(|&(site, path)| AppliedDefineHead { site, path })
    }

    /// Whether a define reads a name that the binder recorded in place of `expr`. Whoever takes an identifier for the name that it spells asks first.
    pub fn is_named_path(&self, expr: ExprId) -> bool {
        !self.applied_heads.is_empty() && matches!(self.decision(expr), Decision::NamedPath(_))
    }
}
