use super::EarlyRedeclaration;
use super::declaration_kinds::{creates_binding, declaration_symbol, for_each_name};
use crate::atom::{Atom, known};
use crate::bind::{BoundBuilder, Decl, SymbolId};
use crate::hir::*;
use crate::util::FxHashMap;
use std::collections::hash_map::Entry;

type ExportedNames = FxHashMap<Atom, (Decl, SymbolId)>;

pub(super) fn find_duplicate_names(
    hir: &File<'_>,
    bound: &BoundBuilder,
) -> Vec<EarlyRedeclaration> {
    let mut names = DuplicateNames {
        hir,
        bound,
        redeclarations: Vec::new(),
    };
    names.check_private_names();
    names.check_exported_names();
    names.redeclarations
}

fn is_accessor_pair(first: &Member, second: &Member) -> bool {
    matches!(
        (first.kind, second.kind),
        (MemberKind::Getter, MemberKind::Setter) | (MemberKind::Setter, MemberKind::Getter)
    ) && first.flags.contains(Flags::STATIC) == second.flags.contains(Flags::STATIC)
}

fn is_signature(hir: &File<'_>, member: &Member) -> bool {
    member.func.is_some() && matches!(hir[member.func].body, FnBody::None)
}

struct DuplicateNames<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a BoundBuilder,
    redeclarations: Vec<EarlyRedeclaration>,
}

impl DuplicateNames<'_, '_> {
    fn check_private_names(&mut self) {
        let hir = self.hir;
        if hir.rare_syntax & rare::NOTABLE_CLASS_MEMBER == 0 {
            return;
        }
        let mut seen: FxHashMap<Atom, (MemberId, u32)> = FxHashMap::default();
        for (index, class) in hir.classes.iter().enumerate() {
            if self.bound.class_scope[index].is_none() || class.flags.contains(Flags::AMBIENT) {
                continue;
            }
            seen.clear();
            for member in class.members.iter() {
                let PropKey::Private(name) = hir[member].key else {
                    continue;
                };
                if is_signature(hir, &hir[member]) {
                    continue;
                }
                match seen.entry(name) {
                    Entry::Vacant(entry) => {
                        entry.insert((member, 1));
                    }
                    Entry::Occupied(mut entry) => {
                        let (first, count) = *entry.get();
                        entry.insert((first, count + 1));
                        if count > 1 || !is_accessor_pair(&hir[first], &hir[member]) {
                            let (earlier, later) = (Decl::Member(first), Decl::Member(member));
                            self.redeclarations
                                .push(EarlyRedeclaration { earlier, later });
                        }
                    }
                }
            }
        }
    }

    fn check_exported_names(&mut self) {
        let hir = self.hir;
        if !hir.has_module_syntax {
            return;
        }
        let mut names = ExportedNames::default();
        for statement in hir.ids(hir.body) {
            self.check_exported_statement(statement, &mut names);
        }
    }

    fn check_exported_statement(&mut self, statement: StmtId, names: &mut ExportedNames) {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::ExportNamed(export) => {
                for specifier in hir[export].items.iter() {
                    let decl = Decl::ExportSpec(specifier);
                    if creates_binding(hir, self.bound, decl) {
                        self.check_exported_name(names, hir[specifier].exported, decl);
                    }
                }
            }
            StmtKind::ExportStar { alias, .. } => {
                let decl = Decl::ExportStarAs(statement);
                if alias.is_some() && creates_binding(hir, self.bound, decl) {
                    self.check_exported_name(names, alias, decl);
                }
            }
            StmtKind::ExportDefault(_) => {
                self.check_exported_name(names, known::default, Decl::ExportExpr(statement));
            }
            StmtKind::Var(list) => {
                for declaration in list.iter() {
                    if hir[declaration].flags.contains(Flags::EXPORT) {
                        self.check_exported_pattern(names, hir[declaration].pat);
                    }
                }
            }
            StmtKind::Fn(f) => self.check_exported_declaration(names, Decl::Fn(f), hir[f].name),
            StmtKind::Class(c) => {
                self.check_exported_declaration(names, Decl::Class(c), hir[c].name);
            }
            StmtKind::Enum(e) => self.check_exported_declaration(names, Decl::Enum(e), hir[e].name),
            StmtKind::Module(m) => {
                if let ModuleName::Ident(name) = hir[m].name {
                    self.check_exported_declaration(names, Decl::Module(m), name);
                }
            }
            StmtKind::ImportEquals(i) => {
                self.check_exported_declaration(names, Decl::ImportEquals(i), hir[i].name);
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Return(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Block(_)
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::Import(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. }
            | StmtKind::Directive { .. } => {}
        }
    }

    fn check_exported_pattern(&mut self, names: &mut ExportedNames, pattern: PatId) {
        for_each_name(self.hir, pattern, |pat, name| {
            let decl = Decl::Var(pat);
            if creates_binding(self.hir, self.bound, decl) {
                self.check_exported_name(names, name, decl);
            }
        });
    }

    fn check_exported_declaration(&mut self, names: &mut ExportedNames, decl: Decl, name: Atom) {
        let flags = self.bound.modifier_flags(self.hir, decl);
        if flags.intersects(Flags::EXPORT | Flags::DEFAULT)
            && creates_binding(self.hir, self.bound, decl)
        {
            let is_default = flags.contains(Flags::DEFAULT);
            self.check_exported_name(names, if is_default { known::default } else { name }, decl);
        }
    }

    fn check_exported_name(&mut self, names: &mut ExportedNames, name: Atom, later: Decl) {
        if name.is_none() {
            return;
        }
        let symbol = declaration_symbol(self.bound, later);
        match names.entry(name) {
            Entry::Vacant(entry) => {
                entry.insert((later, symbol));
            }
            Entry::Occupied(entry) => {
                let (earlier, earlier_symbol) = *entry.get();
                if symbol.is_none() || symbol != earlier_symbol {
                    self.redeclarations
                        .push(EarlyRedeclaration { earlier, later });
                }
            }
        }
    }
}
