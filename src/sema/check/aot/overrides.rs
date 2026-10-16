use super::OnceLock;
use crate::atom::Atom;
use crate::bind::Decl;
use crate::check::Checker;
use crate::hir::{Chain, ExprId, ExprKind};
use crate::program::{FileId, Sym};
use crate::types::{Origin, TypeData, TypeId};
use crate::util::FxHashSet;

#[derive(Default)]
pub(super) struct Shared {
    bindings: OnceLock<FxHashSet<Sym>>,
    modules: OnceLock<FxHashSet<FileId>>,
    members_of_globals: OnceLock<Vec<(Atom, Atom)>>,
}

impl Checker<'_, '_> {
    pub fn set_bindings_that_may_be_overridden(&self, bindings: FxHashSet<Sym>) {
        self.p.aot.overrides.bindings.get_or_init(|| bindings);
    }

    pub fn set_modules_that_may_be_overridden(&self, modules: FxHashSet<FileId>) {
        self.p.aot.overrides.modules.get_or_init(|| modules);
    }

    pub fn module_may_be_overridden(&self, file: FileId) -> bool {
        self.p.aot.overrides.modules.get().is_some_and(|modules| modules.contains(&file))
    }

    pub fn set_members_of_globals_that_may_be_overridden(&self, members: Vec<(Atom, Atom)>) {
        self.p.aot.overrides.members_of_globals.get_or_init(|| members);
    }

    pub fn members_of_globals_that_may_be_overridden(&self) -> &[(Atom, Atom)] {
        self.p.aot.overrides.members_of_globals.get().map_or(&[][..], |members| &members[..])
    }

    pub fn member_of_global_that_may_be_overridden(&self, file: FileId, e: ExprId) -> Option<(Atom, Atom)> {
        let members = self.members_of_globals_that_may_be_overridden();
        if members.is_empty() {
            return None;
        }
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[e].kind else { return None };
        if !members.iter().any(|member| member.1 == name) {
            return None;
        }
        let (mut at, mut path) = (obj, Vec::new());
        while let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[at].kind {
            path.push(self.atoms().bytes(name));
            at = obj;
        }
        let ExprKind::Ident(global) = hir[at].kind else { return None };
        if self.bound(file).expr_symbol[at.idx()].is_some() {
            return None;
        }
        path.push(self.atoms().bytes(global));
        path.reverse();
        let path = path.join(&b'.');
        members.iter().copied().find(|&(holder, member)| member == name && self.atoms().bytes(holder) == &path[..])
    }

    pub fn global_that_may_be_overridden(&self, name: &[u8]) -> Option<(Atom, Atom)> {
        let members = self.members_of_globals_that_may_be_overridden();
        members.iter().copied().find(|&(holder, member)| self.atoms().bytes(holder) == b"globalThis" && self.atoms().bytes(member) == name)
    }

    pub fn holders_of_member_that_may_be_overridden(&self, name: Atom) -> Vec<Atom> {
        let members = self.members_of_globals_that_may_be_overridden();
        members.iter().filter(|member| member.1 == name).map(|member| member.0).collect()
    }

    pub fn calls_what_a_spy_may_stand_for(&self, file: FileId, callee: ExprId) -> bool {
        let members = self.members_of_globals_that_may_be_overridden();
        !members.is_empty() && matches!(self.hir(file)[callee].kind, ExprKind::Dot { name, .. } if members.iter().any(|member| member.1 == name))
    }

    pub fn modules_spied_on(&mut self, file: FileId, target: ExprId) -> Option<Vec<FileId>> {
        let hir = self.hir(file);
        let mut target = target;
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[target].kind {
            target = expr;
        }
        let ty = self.type_of_expr(file, target);
        let ty = self.non_nullable(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        if parts.iter().any(|&part| self.says_nothing(part) || part == TypeId::OBJECT || self.is_instantiable(part) || self.is_empty_object_type(part)) {
            return None;
        }
        Some(
            parts
                .into_iter()
                .filter_map(|part| match *self.data(part) {
                    TypeData::Anon { origin: Origin::Module(module) | Origin::Namespace { module, .. }, .. } if matches!(self.files().value_declaration(module), Some((_, Decl::File))) => Some(module.file),
                    _ => None,
                })
                .collect(),
        )
    }

    pub fn is_told_what_may_be_overridden(&self) -> bool {
        self.p.aot.overrides.bindings.get().is_some()
    }

    pub fn may_be_overridden(&self, sym: Sym) -> bool {
        let Some(bindings) = self.p.aot.overrides.bindings.get().filter(|bindings| !bindings.is_empty()) else { return false };
        bindings.contains(&sym) || bindings.contains(&self.files().export_symbol_of_value_symbol_if_exported(sym))
    }

    pub fn may_be_overridden_at(&mut self, sym: Sym, file: FileId, e: ExprId) -> bool {
        if !self.may_be_overridden(sym) {
            return false;
        }
        if e.is_none() || file != sym.file {
            return true;
        }
        match self.declaration_of_variable(sym) {
            Some((of, Decl::Class(class))) => !(of == file && self.is_written_in_class(file, e, class)),
            Some((_, Decl::Var(_))) => !(self.constant_held_by(sym).is_some() && self.is_its_value_in_its_own_file(sym)),
            _ => true,
        }
    }
}
