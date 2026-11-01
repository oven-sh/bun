use bun_ast::import_record::is_test_module;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Decl, SymbolId};
use bun_sema::hir::{
    BinOp, Chain, ExportSpecId, ExprFlags, ExprId, ExprKind, FAR_IN_BRACKETS, File, FileBuilder,
    Flags, Import, ImportEqualsId, ImportId, PatKind, PropKind, ResolutionMode, Span,
    SpecifierKind, SpecifierUse, StmtId, StmtKind, TypeNodeId, UnOp, VarDecl, VarKind, rare,
};
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::TransformRequest;
use bun_sema::util::FxHashMap;

const NAMESPACE_PREFIX: &str = "%import:";

fn text_of<'a>(atoms: &'a Interner<'_>, text: Atom) -> &'a [u8] {
    match text.is_none() {
        true => b"",
        false => atoms.bytes(text),
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MockApi {
    Vi,
    Jest,
}

impl MockApi {
    fn from_export_name(name: &[u8]) -> Option<MockApi> {
        match name {
            b"vi" | b"vitest" => Some(MockApi::Vi),
            b"jest" => Some(MockApi::Jest),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    BeforeHoisted,
    Hoisted,
    LoweredImport,
    InPlace,
}

#[derive(Copy, Clone)]
struct Use {
    expression: ExprId,
    import: ImportId,
    member: Atom,
}

pub(crate) struct Plan {
    places: Vec<(StmtId, Place)>,
    uses: Vec<Use>,
    /// The factory and the fragment of classic JSX, and a class that decorator metadata names: no expression spells the name, so there is none to rewrite.
    /// The binder finds the loaded module by `Import::loaded_as`.
    named_implicitly: Vec<ImportId>,
    /// `import * as ns`, `export { ns }`: the clause names the variable of the load.
    exported_namespaces: Vec<(ExportSpecId, ImportId)>,
    paths_written_as_imports: Vec<(ExprId, ExprId)>,
}

struct Planner<'a, 'r, 's> {
    hir: &'a File<'s>,
    request: &'a TransformRequest<'r, 's>,
    atoms: &'a Interner<'s>,
    has_globals_of_vitest: bool,
    imported_apis: Vec<(SymbolId, MockApi)>,
}

impl<'a, 'r, 's> Planner<'a, 'r, 's> {
    fn new(
        request: &'a TransformRequest<'r, 's>,
        atoms: &'a Interner<'s>,
        has_globals_of_vitest: bool,
    ) -> Self {
        let hir: &File<'s> = &*request.hir;
        let imports = hir.ids(hir.body).filter_map(|it| match hir[it].kind {
            StmtKind::Import(import) => Some(import),
            _ => None,
        });
        let of_runner = imports
            .filter(|&it| !hir[it].type_only && is_test_module(text_of(atoms, hir[it].spec)));
        let imported_apis = of_runner
            .flat_map(|it| hir[it].named.iter())
            .filter_map(|it| {
                let api = MockApi::from_export_name(text_of(atoms, hir[it].imported))?;
                let symbol = request.bound.declared_symbol(Decl::ImportSpec(it));
                Some((symbol, api))
            });
        Planner {
            hir,
            request,
            atoms,
            has_globals_of_vitest,
            imported_apis: imported_apis.collect(),
        }
    }

    fn find_api(&self, object: ExprId) -> Option<MockApi> {
        let ExprKind::Ident(name) = self.hir[object].kind else {
            return None;
        };
        match self.request.bound.binding(object) {
            Binding::Free => match MockApi::from_export_name(text_of(self.atoms, name))? {
                MockApi::Jest if self.has_globals_of_vitest => None,
                api => Some(api),
            },
            Binding::Symbol(symbol) => {
                let mut imported = self.imported_apis.iter();
                imported.find(|it| it.0 == symbol).map(|it| it.1)
            }
            Binding::Arguments(_) | Binding::CommonJs(_) => None,
        }
    }

    fn without_type_syntax(&self, expression: ExprId) -> ExprId {
        self.hir.skip_type_assertions(expression)
    }

    fn find_mock_call(&self, expression: ExprId) -> Option<(MockApi, &'a [u8])> {
        let expression = self.without_type_syntax(expression);
        let mut callee = match self.hir[expression].kind {
            ExprKind::Await(value) => self.without_type_syntax(value),
            _ => expression,
        };
        let mut last_name = None;
        loop {
            let ExprKind::Call(call) = self.hir[callee].kind else {
                return None;
            };
            let call = self.hir[call];
            let ExprKind::Dot {
                obj,
                name,
                chain,
                name_before_end,
            } = self.hir[self.without_type_syntax(call.callee)].kind
            else {
                return None;
            };
            if call.chain != Chain::No || chain != Chain::No || name_before_end == FAR_IN_BRACKETS {
                return None;
            }
            let name = text_of(self.atoms, name);
            let is_chain = last_name.is_some();
            if is_chain && !matches!(name, b"mock" | b"unmock") {
                return None;
            }
            let last_name = *last_name.get_or_insert(name);
            let obj = self.without_type_syntax(obj);
            match self.hir[obj].kind {
                ExprKind::Ident(_) => {
                    let api = self.find_api(obj)?;
                    return (!is_chain || api == MockApi::Jest).then_some((api, last_name));
                }
                ExprKind::Call(_) => callee = obj,
                _ => return None,
            }
        }
    }

    fn is_hoisted(&self, statement: StmtId) -> bool {
        match self.hir[statement].kind {
            StmtKind::Expr(value) => matches!(
                self.find_mock_call(value),
                Some((_, b"mock" | b"unmock") | (MockApi::Vi, b"hoisted"))
            ),
            StmtKind::Var(declarations) => {
                let mut declarations = declarations.iter().map(|it| self.hir[it]);
                declarations.any(|it| {
                    !matches!(it.kind, VarKind::Using | VarKind::AwaitUsing)
                        && it.init != ExprId::NONE
                        && matches!(
                            self.find_mock_call(it.init),
                            Some((MockApi::Vi, b"hoisted"))
                        )
                })
            }
            _ => false,
        }
    }

    fn is_primitive_literal(&self, expression: ExprId) -> bool {
        let expression = self.without_type_syntax(expression);
        match self.hir[expression].kind {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null => true,
            ExprKind::Template { exprs } => self.hir.ids(exprs).next().is_none(),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => matches!(
                self.hir[self.without_type_syntax(operand)].kind,
                ExprKind::Number(_) | ExprKind::BigInt(_)
            ),
            ExprKind::Ident(name) => {
                text_of(self.atoms, name) == b"undefined"
                    && self.request.bound.binding(expression) == Binding::Free
            }
            _ => false,
        }
    }

    fn declares_primitive_literals_alone(&self, statement: StmtId) -> bool {
        let StmtKind::Var(declarations) = self.hir[statement].kind else {
            return false;
        };
        let mut declarations = declarations.iter().map(|it| self.hir[it]);
        declarations.all(|it| {
            matches!(it.kind, VarKind::Const | VarKind::Let)
                && matches!(self.hir[it.pat].kind, PatKind::Ident(_))
                && it.init != ExprId::NONE
                && self.is_primitive_literal(it.init)
        })
    }

    fn runs_imports_in_turn(&self, body: &[StmtId]) -> bool {
        let imports = body.iter().filter(|&&it| match self.hir[it].kind {
            StmtKind::Import(import) => {
                let import = self.hir[import];
                !import.type_only && !is_test_module(text_of(self.atoms, import.spec))
            }
            _ => false,
        });
        self.has_globals_of_vitest && imports.count() >= 2
    }

    fn find_names_in_export_clauses(&self, body: &[StmtId]) -> Vec<Atom> {
        let clauses = body.iter().filter_map(|&it| match self.hir[it].kind {
            StmtKind::ExportNamed(export) => Some(self.hir[export]),
            _ => None,
        });
        let clauses = clauses.filter(|it| !it.has_module_specifier && !it.type_only);
        let items = clauses
            .flat_map(|it| it.items.iter())
            .map(|it| self.hir[it]);
        items
            .filter(|it| !it.type_only)
            .map(|it| it.local)
            .collect()
    }

    fn find_exported_namespaces(
        &self,
        body: &[StmtId],
        lowered: &[ImportId],
    ) -> Vec<(ExportSpecId, ImportId)> {
        let clauses = body.iter().filter_map(|&it| match self.hir[it].kind {
            StmtKind::ExportNamed(export) => Some(self.hir[export]),
            _ => None,
        });
        let clauses = clauses.filter(|it| !it.has_module_specifier && !it.type_only);
        let items = clauses.flat_map(|it| it.items.iter());
        let items = items.filter(|&it| !self.hir[it].type_only);
        let exported = items.filter_map(|item| {
            let mut imports = lowered.iter().copied();
            let import = imports.find(|&it| self.hir[it].namespace == self.hir[item].local)?;
            Some((item, import))
        });
        exported.collect()
    }

    fn names_of(&self, import: ImportId) -> Vec<(Decl, Atom, Atom)> {
        let node = self.hir[import];
        let mut names = Vec::new();
        if node.default != Atom::NONE {
            let member = self.atoms.intern(b"default");
            names.push((Decl::ImportDefault(import), node.default, member));
        }
        if node.namespace != Atom::NONE {
            names.push((Decl::ImportNamespace(import), node.namespace, Atom::NONE));
        }
        let named = node.named.iter().map(|it| (it, self.hir[it]));
        let named = named.filter(|(_, it)| !it.type_only);
        names.extend(named.map(|(id, it)| (Decl::ImportSpec(id), it.local, it.imported)));
        names
    }

    fn place_import(&self, import: ImportId, exported: &[Atom]) -> Place {
        let node = self.hir[import];
        if node.type_only || node.spec.is_none() {
            return Place::InPlace;
        }
        let path = text_of(self.atoms, node.spec);
        if is_test_module(path) || path == b"bun" {
            return Place::BeforeHoisted;
        }
        // Only an attribute that chooses how the file is loaded keeps the statement.
        let chooses_loader = |attributes: ExprId| {
            let keys = [known::r#type, known::embed];
            keys.iter()
                .any(|&key| self.hir.import_attribute(attributes, key).is_some())
        };
        if node.is_deferred || node.attributes.some().is_some_and(chooses_loader) {
            return Place::InPlace;
        }
        // `export { a }` needs `a` to be a binding. The variable of a load is one, and holds what a namespace names.
        let names = self.names_of(import);
        let mut members = names.iter().filter(|it| it.2 != Atom::NONE);
        if members.any(|it| exported.contains(&it.1)) {
            return Place::InPlace;
        }
        Place::LoweredImport
    }

    fn is_named_implicitly(&self, import: ImportId) -> bool {
        let bound = self.request.bound;
        let names = self.names_of(import);
        let mut symbols = names.iter().map(|it| bound.declared_symbol(it.0));
        // `import a = ns.a`: an entity name is no expression either.
        let aliases = (0..self.hir.import_equals.len() as u32).map(ImportEqualsId);
        let roots: Vec<Binding> = aliases.map(|it| bound.entity_root_binding(it)).collect();
        symbols.any(|symbol| {
            bound.runtime.is_named_implicitly(symbol) || roots.contains(&Binding::Symbol(symbol))
        })
    }

    fn find_uses(&self, lowered: &[ImportId]) -> Vec<Use> {
        let mut members: FxHashMap<SymbolId, (ImportId, Atom)> = FxHashMap::default();
        for &import in lowered {
            for (declaration, _, member) in self.names_of(import) {
                let symbol = self.request.bound.declared_symbol(declaration);
                members.insert(symbol, (import, member));
            }
        }
        let bound = self.request.bound;
        let expressions = (0..).map(ExprId).zip(self.hir.exprs.iter());
        let uses = expressions.filter_map(|(expression, node)| {
            let ExprKind::Ident(_) = node.kind else {
                return None;
            };
            if !bound.is_evaluated_ident(expression) {
                return None;
            }
            let Binding::Symbol(symbol) = bound.binding(expression) else {
                return None;
            };
            let &(import, member) = members.get(&symbol)?;
            Some(Use {
                expression,
                import,
                member,
            })
        });
        uses.collect()
    }

    fn find_paths_written_as_imports(&self) -> Vec<(ExprId, ExprId)> {
        let calls = self.hir.exprs.iter().filter_map(|it| match it.kind {
            ExprKind::Call(call) => Some(self.hir[call]),
            _ => None,
        });
        let paths = calls.filter_map(|call| {
            let ExprKind::Dot {
                obj,
                name,
                name_before_end,
                ..
            } = self.hir[self.without_type_syntax(call.callee)].kind
            else {
                return None;
            };
            if name_before_end == FAR_IN_BRACKETS {
                return None;
            }
            let first = self.without_type_syntax(self.hir.ids(call.args).next()?);
            let written = match self.hir[first].kind {
                ExprKind::Await(value) => self.without_type_syntax(value),
                _ => first,
            };
            let ExprKind::ImportCall { args } = self.hir[written].kind else {
                return None;
            };
            let path = self.hir.ids(args).next()?;
            let takes_path = matches!(
                text_of(self.atoms, name),
                b"mock" | b"unmock" | b"doMock" | b"doUnmock"
            );
            let obj = self.without_type_syntax(obj);
            (takes_path && self.find_api(obj).is_some()).then_some((written, path))
        });
        paths.collect()
    }
}

pub(crate) fn plan<'s>(
    request: &TransformRequest<'_, 's>,
    atoms: &Interner<'s>,
    has_globals_of_vitest: bool,
    is_entry_point: bool,
) -> Option<Plan> {
    let planner = Planner::new(request, atoms, has_globals_of_vitest);
    let hir = planner.hir;
    let paths_written_as_imports = planner.find_paths_written_as_imports();
    let body: Vec<StmtId> = hir.ids(hir.body).collect();
    let moves = body.iter().any(|&it| planner.is_hoisted(it))
        || (is_entry_point && planner.runs_imports_in_turn(&body));
    if !moves {
        return (!paths_written_as_imports.is_empty()).then_some(Plan {
            places: Vec::new(),
            uses: Vec::new(),
            named_implicitly: Vec::new(),
            exported_namespaces: Vec::new(),
            paths_written_as_imports,
        });
    }
    let exported = planner.find_names_in_export_clauses(&body);
    let lowers_imports = request.analysis.module_format == ModuleFormat::Esm;
    let mut places: Vec<(StmtId, Place)> = body
        .iter()
        .map(|&statement| {
            let place = match hir[statement].kind {
                StmtKind::Directive { .. } => Place::BeforeHoisted,
                StmtKind::Import(_) if !lowers_imports => Place::InPlace,
                StmtKind::Import(import) => planner.place_import(import, &exported),
                _ if planner.is_hoisted(statement)
                    || planner.declares_primitive_literals_alone(statement) =>
                {
                    Place::Hoisted
                }
                _ => Place::InPlace,
            };
            (statement, place)
        })
        .collect();
    let import_of = |statement: StmtId| match hir[statement].kind {
        StmtKind::Import(import) => Some(import),
        _ => None,
    };
    let lowered = places.iter().filter(|it| it.1 == Place::LoweredImport);
    let lowered: Vec<ImportId> = lowered.filter_map(|it| import_of(it.0)).collect();
    let mut uses = planner.find_uses(&lowered);
    let named_implicitly = lowered.iter().copied();
    let named_implicitly: Vec<ImportId> = named_implicitly
        .filter(|&it| planner.is_named_implicitly(it))
        .collect();
    let exported_namespaces = planner.find_exported_namespaces(&body, &lowered);
    if !hir.is_js {
        let is_removed = |import: ImportId| {
            let node = hir[import];
            let has_names = node.default != Atom::NONE
                || node.namespace != Atom::NONE
                || !node.named.is_empty();
            has_names
                && !uses.iter().any(|it| it.import == import)
                && !named_implicitly.contains(&import)
                && !exported_namespaces.iter().any(|it| it.1 == import)
        };
        for (statement, place) in &mut places {
            if *place == Place::LoweredImport && import_of(*statement).is_some_and(is_removed) {
                *place = Place::InPlace;
            }
        }
    }
    let is_lowered = |import: ImportId| {
        let mut lowered = places.iter().filter(|it| it.1 == Place::LoweredImport);
        lowered.any(|it| import_of(it.0) == Some(import))
    };
    uses.retain(|it| is_lowered(it.import));
    Some(Plan {
        places,
        uses,
        named_implicitly,
        exported_namespaces,
        paths_written_as_imports,
    })
}

fn find_callees(file: &FileBuilder) -> Vec<ExprId> {
    let calls = file.exprs.iter().filter_map(|it| match it.kind {
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => Some(file[call].callee),
        _ => None,
    });
    let mut callees: Vec<ExprId> = calls
        .map(|mut callee| {
            while let ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::Instantiation { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) = file[callee].kind
            {
                callee = expr;
            }
            callee
        })
        .collect();
    callees.sort_unstable();
    callees
}

fn write_use(
    file: &mut FileBuilder,
    expression: ExprId,
    namespace: Atom,
    member: Atom,
    is_callee: bool,
) {
    let (pos, end) = (file[expression].pos, file[expression].end);
    if member == Atom::NONE {
        file[expression].kind = ExprKind::Ident(namespace);
        return;
    }
    let object = file.expr(ExprKind::Ident(namespace), pos, end);
    let read = file.dot((object, Chain::No), (member, pos), end);
    if !is_callee {
        file[expression].kind = read;
        return;
    }
    let read = file.expr(read, pos, end);
    let zero = file.number(0.0);
    let zero = file.expr(ExprKind::Number(zero), pos, pos);
    file[expression].kind = ExprKind::Binary {
        op: BinOp::Comma,
        left: zero,
        right: read,
    };
    if !file
        .expr_flags(expression)
        .contains(ExprFlags::PARENTHESIZED)
    {
        file.parens.push((expression, pos, end));
        file.add_flags(expression, ExprFlags::PARENTHESIZED);
    }
}

fn write_load(file: &mut FileBuilder, statement: StmtId, import: ImportId, local: Atom) -> StmtId {
    let (start, loc) = (file[statement].start, file[statement].loc);
    let path = file[import].spec;
    // The parser lists every specifier for the type checker, by the kind of its use.
    file.specifier_uses.push(SpecifierUse {
        spec: path,
        pos: start,
        kind: SpecifierKind::ImportCall,
        mode: ResolutionMode::None,
    });
    let path = file.expr(ExprKind::String(path), start, loc.end);
    let args = file.list(&[path]);
    let load = file.expr(ExprKind::ImportCall { args }, start, loc.end);
    let loaded = file.expr(ExprKind::Await(load), start, loc.end);
    let kind = if local == Atom::NONE {
        StmtKind::Expr(loaded)
    } else {
        let pat = file.pat(PatKind::Ident(local), start, start);
        StmtKind::Var(file.add_var_decls(&[VarDecl {
            pat,
            ty: TypeNodeId::NONE,
            init: loaded,
            kind: VarKind::Const,
            flags: Flags::empty(),
            loc,
        }]))
    };
    let written = file.stmt(kind, start);
    file[written].loc = loc;
    written
}

fn keep_for_types_alone(
    file: &mut FileBuilder,
    statement: StmtId,
    import: ImportId,
) -> Vec<StmtId> {
    file[import].type_only = true;
    let node = file[import];
    let stands_beside_others = node.has_named_imports || node.namespace != Atom::NONE;
    if file.is_js || (node.default == Atom::NONE && !stands_beside_others) {
        return Vec::new();
    }
    for name in node.named.iter() {
        file[name].type_only = false;
    }
    if node.default == Atom::NONE || !stands_beside_others {
        return vec![statement];
    }
    file[import].default = Atom::NONE;
    let default = file.add_import(Import {
        namespace: Atom::NONE,
        named: Span::EMPTY,
        has_named_imports: false,
        stmt: StmtId::NONE,
        ..node
    });
    let start = file[statement].start;
    vec![statement, file.stmt(StmtKind::Import(default), start)]
}

impl Plan {
    pub(crate) fn apply(&self, file: &mut FileBuilder, atoms: &Interner<'_>) {
        for &(written, path) in &self.paths_written_as_imports {
            let path = file[path];
            file[written] = path;
        }
        let lowered = self.places.iter().filter(|it| it.1 == Place::LoweredImport);
        let lowered = lowered.filter_map(|it| match file[it.0].kind {
            StmtKind::Import(import) => Some((it.0, import)),
            _ => None,
        });
        let lowered: Vec<(StmtId, ImportId)> = lowered.collect();
        let locals = lowered.iter().enumerate().map(|(position, it)| {
            let local = atoms.intern(format!("{NAMESPACE_PREFIX}{position}").as_bytes());
            (it.1, local)
        });
        let mut locals: Vec<(ImportId, Atom)> = locals.collect();
        locals.sort_unstable_by_key(|it| it.0);
        let local_of = |import: ImportId| {
            let position = locals.binary_search_by_key(&import, |it| it.0);
            locals[position.expect("a use names an import that is lowered")].1
        };
        let callees = find_callees(file);
        for it in &self.uses {
            let is_callee = callees.binary_search(&it.expression).is_ok();
            write_use(
                file,
                it.expression,
                local_of(it.import),
                it.member,
                is_callee,
            );
        }
        file.parens.sort_by_key(|it| it.0);
        let find_use = |expression: ExprId| {
            let position = self
                .uses
                .binary_search_by_key(&expression, |it| it.expression);
            position.ok().map(|position| &self.uses[position])
        };
        for property in &mut file.props {
            if property.kind == PropKind::Shorthand && find_use(property.value).is_some() {
                property.kind = PropKind::Init;
            }
        }
        let closing_tags = file.jsx.iter().filter_map(|it| {
            let is_written = it.close_tag == ExprId::NONE || find_use(it.close_tag).is_some();
            let opening = find_use(it.tag).filter(|_| !is_written)?;
            Some((it.close_tag, opening.import, opening.member))
        });
        let closing_tags: Vec<(ExprId, ImportId, Atom)> = closing_tags.collect();
        for (tag, import, member) in closing_tags {
            if matches!(file[tag].kind, ExprKind::Ident(_)) {
                write_use(file, tag, local_of(import), member, false);
            }
        }
        if self.places.is_empty() {
            return;
        }
        for &(item, import) in &self.exported_namespaces {
            file[item].local = local_of(import);
        }
        let mut loads = Vec::new();
        for &(statement, import) in &lowered {
            let is_named_implicitly = self.named_implicitly.contains(&import);
            let is_used = is_named_implicitly
                || self.exported_namespaces.iter().any(|it| it.1 == import)
                || self.uses.iter().any(|it| it.import == import);
            let local = if is_used {
                local_of(import)
            } else {
                Atom::NONE
            };
            loads.push(write_load(file, statement, import, local));
            if is_named_implicitly {
                file[import].loaded_as = local;
            }
            loads.extend(keep_for_types_alone(file, statement, import));
        }
        let at = |place: Place| {
            let statements = self.places.iter().filter(move |it| it.1 == place);
            statements.map(|it| it.0).collect::<Vec<StmtId>>()
        };
        let statements = [
            at(Place::BeforeHoisted),
            at(Place::Hoisted),
            loads,
            at(Place::InPlace),
        ]
        .concat();
        file.body = file.list(&statements);
        if !lowered.is_empty() {
            file.rare_syntax |= rare::TOP_LEVEL_AWAIT;
            file.has_module_syntax = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::hir::{BinOp, ExprId, ExprKind, File, PatKind, StmtKind, is_parenthesized};

    use crate::compile::testing::{default_settings, with_loaded_test_run};
    use crate::load::ProjectId;

    const MODULES: [(&str, &str); 2] = [
        (
            "mod.ts",
            "export const value = 1; export function call() {}",
        ),
        (
            "side.ts",
            "export const captured = 1; export type Unused = 1;",
        ),
    ];

    fn with_tree<R>(
        name: &str,
        text: &str,
        then: impl FnOnce(&File<'_>, &dyn Fn(&[u8]) -> bool, &dyn Fn(ExprId) -> Option<String>) -> R,
    ) -> R {
        let files = [&[(name, text)][..], &MODULES].concat();
        with_loaded_test_run(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let is_written = |name: &[u8]| {
                let mut expressions = hir.exprs.iter();
                expressions.any(|it| matches!(it.kind, ExprKind::Ident(written) if files.atoms.bytes(written) == name))
            };
            let text_of = |expression: ExprId| match hir[expression].kind {
                ExprKind::String(text)
                | ExprKind::Ident(text)
                | ExprKind::Dot { name: text, .. } => {
                    Some(BStr::new(files.atoms.bytes(text)).to_string())
                }
                _ => None,
            };
            then(hir, &is_written, &text_of)
        })
    }

    fn describe(name: &str, text: &str) -> String {
        with_tree(name, text, |hir, _, text_of| {
            let path_loaded = |expression: ExprId| {
                if expression == ExprId::NONE {
                    return None;
                }
                let ExprKind::Await(load) = hir[expression].kind else {
                    return None;
                };
                let ExprKind::ImportCall { args } = hir[load].kind else {
                    return None;
                };
                text_of(hir.ids(args).next()?)
            };
            let name_called = |expression: ExprId| match hir[expression].kind {
                ExprKind::Call(call) => text_of(hir[call].callee).map(|name| format!("{name}()")),
                _ => None,
            };
            let statements = hir
                .ids(hir.body)
                .map(|statement| match hir[statement].kind {
                    StmtKind::Import(import) => {
                        let kind = if hir[import].type_only {
                            "import type"
                        } else {
                            "import"
                        };
                        format!("{kind} {}", hir[import].named.iter().count())
                    }
                    StmtKind::Var(declarations) => {
                        let first = declarations.iter().next().expect("it declares something");
                        let first = hir[first];
                        let is_name = matches!(hir[first.pat].kind, PatKind::Ident(_));
                        match path_loaded(first.init) {
                            Some(path) => format!("const = await import {path}"),
                            None if is_name => "declaration".to_string(),
                            None => "pattern".to_string(),
                        }
                    }
                    StmtKind::Expr(value) => path_loaded(value)
                        .map(|path| format!("await import {path}"))
                        .or_else(|| name_called(value))
                        .unwrap_or_else(|| "expression".to_string()),
                    _ => "statement".to_string(),
                });
            statements.collect::<Vec<String>>().join(" | ")
        })
    }

    #[test]
    fn mocks_go_above_imports_which_become_loads() {
        let rows = [
            (
                "a.test.ts",
                r#"import { vi } from "bun:test"; import { captured } from "./side"; vi.mock("./mod", () => ({})); console.log(captured);"#,
                "import 1 | mock() | const = await import ./side | import type 1 | log()",
            ),
            (
                "a.test.js",
                r#"import { vi } from "bun:test"; import { captured } from "./side"; vi.mock("./mod", () => ({})); console.log(captured);"#,
                "import 1 | mock() | const = await import ./side | log()",
            ),
            (
                "a.test.js",
                r#"import { captured } from "./side"; jest.mock("./mod", () => ({})); console.log(captured);"#,
                "import 1 | mock() | const = await import ./side | log()",
            ),
            (
                "a.test.js",
                r#"import { jest } from "bun:test"; import "./side"; jest.unmock("./mod").mock("./mod", () => ({}));"#,
                "import 1 | mock() | await import ./side",
            ),
            (
                "a.test.ts",
                r#"import { vi } from "bun:test"; import "./side"; const made = vi.hoisted<number>(() => 1) as number; console.log(made);"#,
                "import 1 | declaration | await import ./side | log()",
            ),
            (
                "a.test.js",
                r#"import { vi } from "bun:test"; import "./side"; const a = "a", b = -1; const c = String("c"); vi.mock("./mod", () => ({ a, b, c }));"#,
                "import 1 | declaration | mock() | await import ./side | declaration",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe(name, text), expected, "{text}");
        }
    }

    #[test]
    fn what_plain_leaves_in_place_stays() {
        let rows = [
            (
                "a.test.js",
                r#"import { captured } from "./side"; console.log(captured);"#,
                "import 1 | log()",
            ),
            (
                "a.test.js",
                r#"import { mock } from "bun:test"; import { captured } from "./side"; mock.module("./mod", () => ({})); console.log(captured);"#,
                "import 1 | import 1 | module() | log()",
            ),
            (
                "a.test.js",
                r#"import { vi } from "bun:test"; import { captured } from "./side"; vi["mock"]("./mod", () => ({})); console.log(captured);"#,
                "import 1 | import 1 | mock() | log()",
            ),
            (
                "a.test.js",
                r#"import { vi } from "bun:test"; import { captured } from "./side"; vi.doMock("./mod", () => ({})); console.log(captured);"#,
                "import 1 | import 1 | doMock() | log()",
            ),
            (
                "a.test.js",
                r#"import { vi } from "bun:test"; import { captured } from "./side"; vi.mock("./mod", () => ({})); export { captured };"#,
                "import 1 | mock() | import 1 | statement",
            ),
            (
                "a.test.ts",
                r#"import { vi } from "bun:test"; import { Unused } from "./side"; vi.mock("./mod", () => ({})); let a: Unused;"#,
                "import 1 | mock() | import 1 | declaration",
            ),
            (
                "a.test.js",
                r#"const vi = { mock() {} }; import { captured } from "./side"; vi.mock("./mod"); console.log(captured);"#,
                "declaration | import 1 | mock() | log()",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe(name, text), expected, "{text}");
        }
    }

    #[test]
    fn uses_read_the_loaded_module() {
        let text = r#"import { vi } from "bun:test"; import { call } from "./mod"; vi.mock("./side", () => ({})); call(); console.log(call, { call });"#;
        with_tree("a.test.js", text, |hir, is_written, _| {
            assert!(!is_written(b"call"));
            let expressions = (0..).map(ExprId).zip(hir.exprs.iter());
            let without_receiver = expressions.filter(|it| {
                matches!(
                    it.1.kind,
                    ExprKind::Binary {
                        op: BinOp::Comma,
                        ..
                    }
                )
            });
            let without_receiver: Vec<ExprId> = without_receiver.map(|it| it.0).collect();
            assert_eq!(without_receiver.len(), 1);
            assert!(is_parenthesized(hir, without_receiver[0]));
        });
    }

    #[test]
    fn a_path_written_as_an_import_loads_nothing() {
        let text = r#"import { test, vi } from "bun:test"; test("a", () => { vi.doMock(import("./mod"), () => ({})); });"#;
        with_tree("a.test.js", text, |hir, _, _| {
            let mut expressions = hir.exprs.iter();
            assert!(!expressions.any(|it| matches!(it.kind, ExprKind::ImportCall { .. })));
        });
    }
}
