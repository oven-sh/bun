use bun_sema::bind::{Binding, BindingInitializer, Decl, Parent, SymbolId};
use bun_sema::hir::{BinOp, EnumId, ExprId, ExprKind, FnId, MemberKey, PatId, PatKind};
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet};

use super::{
    FileRow, KnownMemberValues, KnownObjects, StoredSiteAnswer, find_parent, is_enum, is_read,
    links_names_alone,
};
use crate::builtins::BuiltinId;
use crate::load::sources::parsed_source;
use crate::modules::{ExportBinding, ImportBinding, ModuleGraph, ModuleRef};

struct Search<'a, 's> {
    members: KnownObjects<'a, 's>,
    stored_into: FxHashSet<Sym>,
    held: FxHashSet<(Sym, Sym)>,
    pending: Vec<(Sym, Sym)>,
}

impl Search<'_, '_> {
    fn is_enum_variable(&self, variable: Sym) -> bool {
        let found = self.members.follow_imports(variable);
        found
            .is_some_and(|(defined, _)| is_enum(self.members.files.bound(defined.file), defined.id))
    }

    fn binds_enum(&self, binding: ImportBinding) -> bool {
        match binding {
            ImportBinding::Variable(variable) => self.is_enum_variable(variable),
            _ => false,
        }
    }

    fn list_names_of_enums(&self, row: &FileRow) -> FxHashSet<SymbolId> {
        let files = self.members.files;
        let (hir, bound) = (files.hir(row.file), files.bound(row.file));
        let own = (0..hir.enums.len() as u32).map(|at| Decl::Enum(EnumId(at)));
        let own = own.map(|declaration| bound.declared_symbol(declaration));
        let imported = row.imports.iter().filter(|it| self.binds_enum(it.1));
        own.chain(imported.map(|it| it.0)).collect()
    }

    fn exports_enum(&self, module: ModuleRef) -> bool {
        let row = match module {
            ModuleRef::File(file) => self.members.find_row(file),
            _ => None,
        };
        row.is_some_and(|row| {
            row.exports.iter().any(|export| match export.binding {
                ExportBinding::Variable(variable) => self.is_enum_variable(variable),
                _ => false,
            })
        })
    }

    fn loads_enums(&self, row: &FileRow) -> bool {
        let mut loads = row.sites.iter().filter(|it| !links_names_alone(it.0));
        loads.any(|(_, answer)| match answer {
            StoredSiteAnswer::Module(module) => self.exports_enum(*module),
            _ => false,
        })
    }

    fn look_at_file(&mut self, row: &FileRow) {
        for &(access, binding) in &row.members {
            if self.binds_enum(binding) {
                self.look_at_name(row.file, access);
            }
        }
        let names = self.list_names_of_enums(row);
        let loads_enums = self.loads_enums(row);
        if names.is_empty() && !loads_enums {
            return;
        }
        let files = self.members.files;
        let (hir, bound) = (files.hir(row.file), files.bound(row.file));
        for name in (0..hir.exprs.len() as u32).map(ExprId) {
            let may_name_enum = match hir[name].kind {
                ExprKind::Ident(_) => match bound.binding(name) {
                    Binding::Symbol(symbol) => names.contains(&symbol),
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
                },
                ExprKind::Dot { .. } | ExprKind::Index { .. } => loads_enums,
                _ => false,
            };
            if may_name_enum {
                self.look_at_name(row.file, name);
            }
        }
    }

    fn look_at_name(&mut self, file: FileId, name: ExprId) {
        if !self.is_object_of_read(file, name)
            && let Some(enumeration) = self.members.find_enum(file, name)
        {
            self.note_use(file, name, enumeration);
        }
    }

    fn is_object_of_read(&self, file: FileId, object: ExprId) -> bool {
        let files = self.members.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let (outermost, parent) = find_parent(hir, bound, object);
        match parent {
            Parent::Expr(access) => {
                hir.member_key(access).is_some_and(|it| it.0 == outermost)
                    && is_read(hir, bound, access)
            }
            _ => false,
        }
    }

    fn hold(&mut self, holder: Sym, enumeration: Sym) {
        if self.held.insert((holder, enumeration)) {
            self.pending.push((holder, enumeration));
        }
    }

    fn hold_in_pattern(&mut self, file: FileId, pattern: PatId, enumeration: Sym) {
        let files = self.members.files;
        let name = files.hir(file)[pattern].kind;
        if let (PatKind::Ident(_), Binding::Symbol(id)) =
            (name, files.bound(file).initialized_binding(pattern))
        {
            self.hold(Sym { file, id }, enumeration);
        }
    }

    fn find_function(&self, file: FileId, callee: ExprId) -> Option<(FileId, FnId)> {
        let files = self.members.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let named = match (hir[callee].kind, bound.binding(callee)) {
            (ExprKind::Fn(function), _) => return Some((file, function)),
            (ExprKind::Ident(_), Binding::Symbol(id)) => Sym { file, id },
            (ExprKind::Dot { .. } | ExprKind::Index { .. }, _) => {
                match self.members.graph.member_binding(file, callee) {
                    Some(ImportBinding::Variable(variable)) => variable,
                    _ => return None,
                }
            }
            _ => return None,
        };
        let (Sym { file, id }, _) = self.members.follow_imports(named)?;
        let hir = files.hir(file);
        match files.bound(file).binding_initializer(hir, id) {
            BindingInitializer::Function(function) => Some((file, function)),
            BindingInitializer::Expression(value) => {
                match hir[hir.skip_type_assertions(value)].kind {
                    ExprKind::Fn(function) => Some((file, function)),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn note_argument(&mut self, file: FileId, call: ExprId, argument: ExprId, enumeration: Sym) {
        let files = self.members.files;
        let hir = files.hir(file);
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
            return;
        };
        let Some(index) = hir.ids(hir[site].args).position(|it| it == argument) else {
            return;
        };
        let callee = hir.skip_type_assertions(hir[site].callee);
        let builtin = parsed_source(files, file)
            .and_then(|source| source.builtins.builtin_of_expression(callee));
        match builtin {
            Some(
                BuiltinId::ObjectAssign
                | BuiltinId::ObjectDefineProperties
                | BuiltinId::ObjectDefineProperty
                | BuiltinId::ReflectDefineProperty
                | BuiltinId::ReflectDeleteProperty
                | BuiltinId::ReflectSet,
            ) if index == 0 => {
                self.stored_into.insert(enumeration);
            }
            Some(_) => {}
            None => {
                let Some((file, function)) = self.find_function(file, callee) else {
                    return;
                };
                let hir = files.hir(file);
                if let Some(parameter) = hir[function].params.iter().nth(index) {
                    self.hold_in_pattern(file, hir[parameter].pat, enumeration);
                }
            }
        }
    }

    fn note_use(&mut self, file: FileId, named: ExprId, enumeration: Sym) {
        let files = self.members.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let mut object = named;
        loop {
            let (outermost, parent) = find_parent(hir, bound, object);
            let parent = match parent {
                Parent::Expr(parent) => parent,
                Parent::VarInit(declaration) => {
                    return self.hold_in_pattern(file, hir[declaration].pat, enumeration);
                }
                Parent::ParamDefault(parameter) => {
                    return self.hold_in_pattern(file, hir[parameter].pat, enumeration);
                }
                _ => return,
            };
            match hir[parent].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == outermost => {
                    let may_be_member = || match hir.member_key(parent) {
                        Some((_, MemberKey::Name(name))) => {
                            self.members.find_member(enumeration, name).is_some()
                        }
                        _ => true,
                    };
                    if !self.is_object_of_read(file, object) && may_be_member() {
                        self.stored_into.insert(enumeration);
                    }
                    return;
                }
                ExprKind::Call(_) | ExprKind::New(_) => {
                    return self.note_argument(file, parent, outermost, enumeration);
                }
                ExprKind::Assign { target, value, .. } if value == outermost => {
                    let target = hir.skip_type_assertions(target);
                    if let (ExprKind::Ident(_), Binding::Symbol(id)) =
                        (hir[target].kind, bound.binding(target))
                    {
                        self.hold(Sym { file, id }, enumeration);
                    }
                    object = parent;
                }
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                }
                | ExprKind::Cond { .. }
                | ExprKind::Await(_) => object = parent,
                _ => return,
            }
        }
    }
}

fn list_references(files: &Files<'_>, file: FileId) -> Vec<(SymbolId, ExprId)> {
    let (hir, bound) = (files.hir(file), files.bound(file));
    let names = (0..hir.exprs.len() as u32).map(ExprId).filter(|&name| {
        matches!(hir[name].kind, ExprKind::Ident(_)) && bound.is_evaluated_ident(name)
    });
    let mut references: Vec<(SymbolId, ExprId)> = names
        .filter_map(|name| match bound.binding(name) {
            Binding::Symbol(symbol) => Some((symbol, name)),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        })
        .collect();
    references.sort_unstable_by_key(|it| (it.0.0, it.1.0));
    references
}

pub(super) fn find_enums_stored_into(files: &Files<'_>, graph: &ModuleGraph) -> FxHashSet<Sym> {
    let known = KnownMemberValues::default();
    let mut search = Search {
        members: KnownObjects::new(files, graph, &known),
        stored_into: FxHashSet::default(),
        held: FxHashSet::default(),
        pending: Vec::new(),
    };
    for row in &graph.rows {
        search.look_at_file(row);
    }
    let mut references: FxHashMap<FileId, Vec<(SymbolId, ExprId)>> = FxHashMap::default();
    while let Some((holder, enumeration)) = search.pending.pop() {
        let list = || list_references(files, holder.file);
        let named = references.entry(holder.file).or_insert_with(list);
        let first = named.partition_point(|it| it.0.0 < holder.id.0);
        for &(_, name) in named[first..].iter().take_while(|it| it.0 == holder.id) {
            search.note_use(holder.file, name, enumeration);
        }
    }
    search.stored_into
}
