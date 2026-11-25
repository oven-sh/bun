use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer, Bound, Decl, Parent, PatParent, SymbolId};
use bun_sema::check::aot::function_of_this;
use bun_sema::hir::{
    self, BinOp, EnumId, ExprId, ExprKind, FnId, FnKind, MemberKey, PatId, PatKind,
};
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
    handed_on: FxHashSet<Sym>,
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

    fn hand_on_exports(&mut self, module: ModuleRef, seen: &mut FxHashSet<FileId>) {
        let (ModuleRef::File(file) | ModuleRef::Facade(file)) = module else {
            return;
        };
        if !seen.insert(file) {
            return;
        }
        let Some(row) = self.members.find_row(file) else {
            return;
        };
        for export in &row.exports {
            match export.binding {
                ExportBinding::Variable(variable) => {
                    if let Some((defined, _)) = self.members.follow_imports(variable) {
                        self.handed_on.insert(defined);
                    }
                }
                ExportBinding::Namespace { module, .. }
                | ExportBinding::Indirect { module, .. } => {
                    self.hand_on_exports(module, seen);
                }
                ExportBinding::Synthetic(_) => {}
            }
        }
    }

    fn hand_on_namespaces(&mut self, row: &FileRow, seen: &mut FxHashSet<FileId>) {
        for &module in &row.namespace_values {
            self.hand_on_exports(module, seen);
        }
        for (site, answer) in &row.sites {
            if links_names_alone(*site) {
                continue;
            }
            match answer {
                StoredSiteAnswer::Module(module) => self.hand_on_exports(*module, seen),
                StoredSiteAnswer::Candidates(range) => {
                    for spelled in &row.spellings[range.start as usize..range.end as usize] {
                        self.hand_on_exports(spelled.module, seen);
                    }
                }
                StoredSiteAnswer::AllModules
                | StoredSiteAnswer::Failed(_)
                | StoredSiteAnswer::Erased => {}
            }
        }
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
            self.handed_on.insert(enumeration);
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
                | BuiltinId::Proxy
                | BuiltinId::ProxyRevocable
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

    fn note_element(&mut self, file: FileId, list: ExprId, enumeration: Sym) {
        let files = self.members.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let (_, Parent::Expr(call)) = find_parent(hir, bound, list) else {
            return;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return;
        };
        let callee = hir.skip_type_assertions(hir[site].callee);
        let builtin = parsed_source(files, file)
            .and_then(|source| source.builtins.builtin_of_expression(callee));
        if builtin == Some(BuiltinId::ReflectConstruct) {
            self.stored_into.insert(enumeration);
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
                ExprKind::Array(_) => return self.note_element(file, parent, enumeration),
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

#[derive(Default)]
struct AtomSet(Vec<u64>);

impl AtomSet {
    fn insert(&mut self, name: Atom) {
        let word = name.0 as usize / 64;
        if self.0.len() <= word {
            self.0.resize(word + 1, 0);
        }
        self.0[word] |= 1 << (name.0 % 64);
    }

    fn contains(&self, name: Atom) -> bool {
        let word = self.0.get(name.0 as usize / 64);
        word.is_some_and(|word| word >> (name.0 % 64) & 1 != 0)
    }
}

fn may_variable_hold_enum(hir: &hir::File<'_>, bound: &Bound<'_>, variable: SymbolId) -> bool {
    match bound.symbol(variable).decls.first() {
        Some(Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) | Decl::Module(_)) => false,
        Some(&Decl::Param(pattern)) => match bound.pat_parent[pattern.idx()] {
            PatParent::Param(parameter) => {
                !bound.is_called_only_where_written(hir, bound.param_fn[parameter.idx()])
            }
            _ => true,
        },
        Some(Decl::Var(_)) => match bound.binding_initializer(hir, variable) {
            BindingInitializer::Expression(value) => !matches!(
                hir[hir.skip_type_assertions(value)].kind,
                ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Fn(_)
                    | ExprKind::Class(_)
                    | ExprKind::New(_)
            ),
            _ => true,
        },
        _ => true,
    }
}

fn may_hold_enum(hir: &hir::File<'_>, bound: &Bound<'_>, object: ExprId) -> bool {
    let object = hir.skip_type_assertions(object);
    match hir[object].kind {
        ExprKind::Ident(_) => match bound.binding(object) {
            Binding::Symbol(variable) => may_variable_hold_enum(hir, bound, variable),
            Binding::CommonJs(_) => false,
            Binding::Arguments(_) | Binding::Free => true,
        },
        ExprKind::This => function_of_this(hir, object)
            .is_some_and(|function| matches!(hir[function].kind, FnKind::Decl | FnKind::Expr)),
        ExprKind::Super
        | ExprKind::Object(_)
        | ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::New(_) => false,
        _ => true,
    }
}

fn add_enums_stored_by_name(
    files: &Files<'_>,
    graph: &ModuleGraph,
    handed_on: &FxHashSet<Sym>,
    stored: &mut FxHashSet<Sym>,
) {
    let (mut enums, mut members) = (AtomSet::default(), AtomSet::default());
    for hir in graph.rows.iter().map(|row| files.hir(row.file)) {
        let declared = hir.enums.iter().map(|it| it.name);
        declared
            .filter(|it| it.is_some())
            .for_each(|it| enums.insert(it));
        let declared = hir.enum_members.iter().map(|it| it.name);
        declared
            .filter(|it| it.is_some())
            .for_each(|it| members.insert(it));
    }
    let (mut objects_stored, mut names_stored) = (AtomSet::default(), AtomSet::default());
    for row in &graph.rows {
        let (hir, bound) = (files.hir(row.file), files.bound(row.file));
        for (index, expression) in hir.exprs.iter().enumerate() {
            let access = ExprId(index as u32);
            let (object, key) = match expression.kind {
                ExprKind::Dot { obj, name, .. } => (obj, Some(name)),
                ExprKind::Index { obj, .. } => match hir.member_key(access) {
                    Some((_, MemberKey::Name(name))) => (obj, Some(name)),
                    _ => (obj, None),
                },
                _ => continue,
            };
            let (names, set, name) = match key {
                Some(name) => (&members, &mut names_stored, name),
                None => match hir[hir.skip_type_assertions(object)].kind {
                    ExprKind::Ident(name) | ExprKind::Dot { name, .. } => {
                        (&enums, &mut objects_stored, name)
                    }
                    _ => continue,
                },
            };
            if names.contains(name)
                && !is_read(hir, bound, access)
                && may_hold_enum(hir, bound, object)
            {
                set.insert(name);
            }
        }
    }
    for row in &graph.rows {
        let (hir, bound) = (files.hir(row.file), files.bound(row.file));
        for declaration in (0..hir.enums.len() as u32).map(EnumId) {
            let mut declared = hir[declaration].members.iter();
            if objects_stored.contains(hir[declaration].name)
                || declared.any(|member| names_stored.contains(hir[member].name))
            {
                let id = bound.declared_symbol(Decl::Enum(declaration));
                let enumeration = Sym { file: row.file, id };
                if handed_on.contains(&enumeration) {
                    stored.insert(enumeration);
                }
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
        handed_on: FxHashSet::default(),
        held: FxHashSet::default(),
        pending: Vec::new(),
    };
    let mut seen = FxHashSet::default();
    for row in &graph.rows {
        search.look_at_file(row);
        search.hand_on_namespaces(row, &mut seen);
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
    add_enums_stored_by_name(files, graph, &search.handed_on, &mut search.stored_into);
    search.stored_into
}
