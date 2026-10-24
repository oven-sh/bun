use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingKind, BindingStability, Decl, FnOwner, FunctionFlags, Parent, PatParent,
    StoreKind, SymbolId,
};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, Branches, ExportSpecId, ExprId, ExprKind, Flags, FnId, FnKind, ImportEqualsId, NodeData,
    PatId, PatKind, StmtKind, UnOp,
};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;
use smallvec::{SmallVec, smallvec};

use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};
use crate::load::loader_aliases::{
    LoaderAlias, resolve_exported_loader_alias, resolve_loader_alias,
};
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};
use crate::load::sources::parsed_source;
use crate::statistics::{LimitId, LimitValues};

// `module` is what `name` stands for, and `name` is one of the values of `argument`, the first argument of a load.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct NamedModule {
    pub argument: ExprId,
    pub name: Atom,
    pub module: RuntimeModule,
}

pub(crate) fn modules_named_in(named: &[NamedModule], argument: ExprId) -> &[NamedModule] {
    let first = named.partition_point(|it| it.argument < argument);
    let count = named[first..].partition_point(|it| it.argument == argument);
    &named[first..first + count]
}

#[derive(Default)]
pub(crate) struct NamedLoads {
    pub modules: Vec<NamedModule>,
    pub passed_to_imports: Vec<(SymbolId, NamedModule)>,
    pub passed_for_parameters: Vec<RuntimeModule>,
    pub written_as_values: Vec<RuntimeModule>,
    pub loads_by_unknown_name: bool,
    // Where a loader is given a name that the build does not know, also one that no module of the library has. A loader that goes somewhere as a value has no place here.
    pub unknown_names_at: Vec<u32>,
    pub imports_given_unknown_names: Vec<SymbolId>,
}

pub(crate) struct Scan<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    builtins: &'a ResolvedBuiltins,
    runtime_modules: &'a RuntimeModules,
    limits: &'a LimitValues,
    named: Vec<NamedModule>,
    passed_to_imports: Vec<(SymbolId, NamedModule)>,
    passed_for_parameters: Vec<RuntimeModule>,
    loads_by_unknown_name: bool,
    unknown_names_at: Vec<u32>,
    imports_given_unknown_names: Vec<SymbolId>,
}

// What an expression holds of a text that the program writes: the text itself, or a list or a set with the text in it.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Held {
    Text,
    List,
}

// Where that goes from the expression.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Way {
    Anywhere,
    Nowhere,
    Variable(SymbolId, Held),
}

struct Holder {
    symbol: SymbolId,
    held: Held,
    leads_anywhere: bool,
    handed_to: SmallVec<[u32; 2]>,
}

fn holder_of(holders: &mut Vec<Holder>, symbol: SymbolId, held: Held) -> u32 {
    let is_same = |holder: &Holder| holder.symbol == symbol && holder.held == held;
    let found = holders.iter().position(is_same).unwrap_or_else(|| {
        holders.push(Holder {
            symbol,
            held,
            leads_anywhere: false,
            handed_to: SmallVec::new(),
        });
        holders.len() - 1
    });
    found as u32
}

fn sort_modules(modules: &mut Vec<RuntimeModule>) {
    modules.shared_sort_unstable_by_key(|module| module.registry_id());
    modules.dedup();
}

// The library modules that the arms of `require(flag ? "node:vm" : "node:v8")` name.
pub(crate) fn find_library_modules_named_in_choices(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    runtime_modules: &RuntimeModules,
    limits: &LimitValues,
) -> NamedLoads {
    let mut scan = Scan::new(request, builtins, runtime_modules, limits);
    scan.visit_import_sites();
    scan.visit_calls_of_other_loaders();
    sort_named_modules(&mut scan.named);
    let mut written_as_values = scan.find_modules_written_as_values();
    sort_modules(&mut written_as_values);
    sort_modules(&mut scan.passed_for_parameters);
    scan.imports_given_unknown_names.shared_sort_unstable();
    scan.imports_given_unknown_names.dedup();
    NamedLoads {
        modules: scan.named,
        passed_to_imports: scan.passed_to_imports,
        passed_for_parameters: scan.passed_for_parameters,
        written_as_values,
        loads_by_unknown_name: scan.loads_by_unknown_name,
        unknown_names_at: scan.unknown_names_at,
        imports_given_unknown_names: scan.imports_given_unknown_names,
    }
}

fn sort_named_modules(named: &mut Vec<NamedModule>) {
    named.shared_sort_unstable_by_key(|it| (it.argument, it.name.0));
    named.dedup();
}

const MAX_REEXPORTS: usize = 8;

fn imports_loader(files: &Files<'_>, mut file: FileId, mut symbol: SymbolId) -> bool {
    for _ in 0..MAX_REEXPORTS {
        let (hir, bound) = (files.hir(file), files.bound(file));
        let import = bound
            .symbol(symbol)
            .decls
            .iter()
            .find_map(|&declaration| match declaration {
                Decl::ImportSpec(specifier) => {
                    let specifier = hir[specifier];
                    (!specifier.type_only).then_some((specifier.import, specifier.imported))
                }
                Decl::ImportDefault(import) => Some((import, known::default)),
                _ => None,
            });
        let Some((import, export_name)) = import else {
            return false;
        };
        let site = files
            .analysis(file)
            .import_site_index(ImportSiteKind::Import(import));
        let answer = site.and_then(|site| files.compiled(file)?.code_answers.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return false;
        };
        if files.compiled(exporter).is_none() {
            return false;
        }
        let decisions = &files.analysis(exporter).decisions;
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        match resolve_exported_loader_alias(hir, bound, decisions, export_name) {
            Some(LoaderAlias::Local) => return true,
            Some(LoaderAlias::Import(next)) => (file, symbol) = (exporter, next),
            None => return false,
        }
    }
    false
}

// Whether a function that the file imports and gives a name that the build does not know is a loader.
pub(crate) fn gives_unknown_name_to_imported_loader(application: &Files<'_>, file: FileId) -> bool {
    parsed_source(application, file).is_some_and(|source| {
        let mut callees = source.imports_given_unknown_names.iter();
        callees.any(|&callee| imports_loader(application, file, callee))
    })
}

// Whether some loader may be given a name that the build does not know.
pub(crate) fn loads_by_unknown_name(application: &Files<'_>) -> bool {
    let loads_by_unknown_name = |&file: &FileId| {
        parsed_source(application, file).is_none_or(|source| source.loads_by_unknown_name)
            || gives_unknown_name_to_imported_loader(application, file)
    };
    application
        .compiled_files()
        .iter()
        .any(loads_by_unknown_name)
}

// Whether some loader may be given the path of a file that the build has not seen.
pub(crate) fn loads_by_unknown_path(application: &Files<'_>) -> bool {
    let names_unknown_path = |&file: &FileId| {
        parsed_source(application, file).is_some_and(|source| !source.unknown_names_at.is_empty())
    };
    loads_by_unknown_name(application)
        || application.compiled_files().iter().any(names_unknown_path)
}

// A loader that is given a parameter is given what the calls pass for it. One that is given a name the build does not know may be given any text that the program writes as a value, in whichever file. In the order of the registry.
pub(crate) fn find_library_modules_that_unknown_names_may_stand_for(
    application: &Files<'_>,
) -> Vec<RuntimeModule> {
    let files = application.compiled_files();
    let sources = || {
        files
            .iter()
            .filter_map(|&file| parsed_source(application, file))
    };
    let passed = sources().flat_map(|it| &it.library_modules_passed_for_parameters);
    let mut modules: Vec<RuntimeModule> = passed.copied().collect();
    if loads_by_unknown_name(application) {
        let written = sources().flat_map(|it| &it.library_modules_written_as_values);
        modules.extend(written.copied());
    }
    sort_modules(&mut modules);
    modules
}

// esbuild exports `__require` from a shared chunk, so whether `__require("node:fs")` loads a module is only known once the exporting file is loaded.
pub(crate) fn resolve_loads_through_imported_loaders(application: &Files<'_>) {
    for &file in application.compiled_files() {
        let Some(source) = parsed_source(application, file) else {
            continue;
        };
        let mut loaders: Vec<(SymbolId, bool)> = Vec::new();
        let mut named = Vec::new();
        for &(callee, module) in &source.library_names_passed_to_imports {
            let is_loader = match loaders.iter().find(|known| known.0 == callee) {
                Some(known) => known.1,
                None => {
                    let is_loader = imports_loader(application, file, callee);
                    loaders.push((callee, is_loader));
                    is_loader
                }
            };
            if is_loader {
                named.push(module);
            }
        }
        if !named.is_empty() {
            named.extend_from_slice(&source.modules_named_in_choices);
            sort_named_modules(&mut named);
            source.set_named_modules(named);
        }
    }
}

impl<'a, 's> Scan<'a, 's> {
    pub(crate) fn new(
        request: &'a FinishedFile<'a, 's>,
        builtins: &'a ResolvedBuiltins,
        runtime_modules: &'a RuntimeModules,
        limits: &'a LimitValues,
    ) -> Scan<'a, 's> {
        Scan {
            request,
            builtins,
            runtime_modules,
            limits,
            named: Vec::new(),
            passed_to_imports: Vec::new(),
            passed_for_parameters: Vec::new(),
            loads_by_unknown_name: builtins.loads_unknown_modules(),
            unknown_names_at: Vec::new(),
            imports_given_unknown_names: Vec::new(),
        }
    }

    fn visit_import_sites(&mut self) {
        for site in self.request.analysis.import_sites {
            let loads = matches!(
                site.kind,
                ImportSiteKind::ImportCall(_)
                    | ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
            );
            // `require("./locales/" + name)` finds no module of the library, whatever the name is.
            let may_name_library_module = match site.specifier {
                ImportSpecifier::Constant(_) => false,
                ImportSpecifier::Pattern { prefix, suffix } => {
                    let atoms = self.request.atoms;
                    let (prefix, suffix) = (atoms.bytes(prefix), atoms.bytes(suffix));
                    !self.runtime_modules.find_modules(prefix, suffix).is_empty()
                }
                ImportSpecifier::Unknown => true,
            };
            if !loads || site.specifier_node.is_none() {
                continue;
            }
            if may_name_library_module {
                self.add_names_given_to_loader(site.specifier_node);
            } else if !matches!(site.specifier, ImportSpecifier::Constant(_)) {
                let position = self.request.hir[site.specifier_node].pos;
                self.unknown_names_at.push(position);
            }
        }
    }

    fn add_names_given_to_loader(&mut self, name: ExprId) {
        if self.add_names_in(name, true) {
            self.loads_by_unknown_name = true;
            self.unknown_names_at.push(self.request.hir[name].pos);
        }
    }

    fn is_constant_text(&self, expression: ExprId) -> bool {
        matches!(
            self.request
                .analysis
                .decisions
                .constant(self.request.hir, expression),
            FoldedValue::Constant(Constant::String(_))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(_))
        )
    }

    fn way_into_pattern(&self, pattern: PatId, held: Held) -> Way {
        let (hir, bound) = (self.request.hir, self.request.bound);
        match (hir[pattern].kind, bound.initialized_binding(pattern)) {
            (PatKind::Ident(_), Binding::Symbol(symbol))
                if bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none() =>
            {
                Way::Variable(symbol, held)
            }
            _ => Way::Anywhere,
        }
    }

    fn is_discarded(&self, mut expression: ExprId) -> bool {
        let (hir, bound) = (self.request.hir, self.request.bound);
        loop {
            let above = match bound.parent_of_expr(expression) {
                Parent::Expr(above) => above,
                Parent::Stmt(statement) => return matches!(hir[statement].kind, StmtKind::Expr(_)),
                _ => return false,
            };
            match hir[above].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } if left == expression => return true,
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => expression = above,
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                _ => return false,
            }
        }
    }

    fn way_into_target(&self, assignment: ExprId, target: ExprId, held: Held) -> Way {
        let (hir, bound) = (self.request.hir, self.request.bound);
        let target = hir.skip_type_assertions(target);
        match (hir[target].kind, bound.binding(target)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol))
                if bound.dynamic_lookup_scope(NodeData::Expr(target)).is_none()
                    && self.is_discarded(assignment) =>
            {
                Way::Variable(symbol, held)
            }
            _ => Way::Anywhere,
        }
    }

    // The members of a list or a set that say whether it holds a value, where, or how many it holds. They hand out none, and a program cannot replace them.
    fn way_of_member(&self, member: ExprId, name: Atom) -> Way {
        let (hir, bound) = (self.request.hir, self.request.bound);
        let is_called = match bound.parent_of_expr(member) {
            Parent::Expr(above) => {
                matches!(hir[above].kind, ExprKind::Call(call) if hir[call].callee == member)
            }
            _ => false,
        };
        match self.request.atoms.bytes(name) {
            b"length" | b"size" => Way::Nowhere,
            b"includes" | b"indexOf" | b"lastIndexOf" | b"has" if is_called => Way::Nowhere,
            _ => Way::Anywhere,
        }
    }

    // `new Set(list)` and `Object.freeze(list)` hold what the list holds.
    fn holds_its_only_argument(&self, expression: ExprId, argument: ExprId) -> bool {
        let hir = self.request.hir;
        let (call, holder) = match hir[expression].kind {
            ExprKind::New(call) => (call, BuiltinId::Set),
            ExprKind::Call(call) => (call, BuiltinId::ObjectFreeze),
            _ => return false,
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        hir.ids(hir[call].args).eq([argument])
            && self.builtins.builtin_of_expression(callee) == Some(holder)
    }

    // A text that is only compared, or is the key of a member, comes to no loader. Neither does one in a list that is only searched. Any other may: through a parameter, a list, a property.
    fn way_of(&self, mut expression: ExprId, mut held: Held) -> Way {
        let (hir, bound) = (self.request.hir, self.request.bound);
        loop {
            let above = match bound.parent_of_expr(expression) {
                Parent::Expr(above) => above,
                Parent::VarInit(declaration) => {
                    return self.way_into_pattern(hir[declaration].pat, held);
                }
                Parent::Stmt(statement) => {
                    let ends_here = match (hir[statement].kind, held) {
                        (StmtKind::Expr(_) | StmtKind::If { .. }, _) => true,
                        (
                            StmtKind::Return(_)
                            | StmtKind::Throw(_)
                            | StmtKind::ExportDefault(_)
                            | StmtKind::ExportAssign(_),
                            _,
                        ) => false,
                        (_, Held::Text) => true,
                        (_, Held::List) => false,
                    };
                    return if ends_here {
                        Way::Nowhere
                    } else {
                        Way::Anywhere
                    };
                }
                Parent::ParamDefault(_)
                | Parent::PatPropDefault(_)
                | Parent::PatElemDefault(_)
                | Parent::Prop(_)
                | Parent::MemberInit(_)
                | Parent::FnBody(_)
                | Parent::EnumInit(_) => return Way::Anywhere,
                _ if held == Held::Text => return Way::Nowhere,
                _ => return Way::Anywhere,
            };
            match (hir[above].kind, held) {
                (
                    ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::NonNull(_),
                    _,
                ) => expression = above,
                (
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    },
                    _,
                ) if value == expression => return self.way_into_target(above, target, held),
                (
                    ExprKind::Binary {
                        op: BinOp::Comma,
                        left,
                        ..
                    },
                    _,
                ) if left == expression => return Way::Nowhere,
                (
                    ExprKind::Binary {
                        op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                        ..
                    },
                    _,
                ) => expression = above,
                (ExprKind::Cond { test, .. }, _) if test == expression => return Way::Nowhere,
                (ExprKind::Cond { .. }, _) => expression = above,
                (ExprKind::Unary { .. }, _) => return Way::Nowhere,
                (ExprKind::Array(_), _) => (expression, held) = (above, Held::List),
                // A part of a longer constant text goes nowhere by itself.
                (
                    ExprKind::Binary { op: BinOp::Add, .. } | ExprKind::Template { .. },
                    Held::Text,
                ) if !self.is_constant_text(above) => return Way::Anywhere,
                (ExprKind::Binary { .. } | ExprKind::Template { .. }, Held::Text) => {
                    return Way::Nowhere;
                }
                (ExprKind::Index { index, .. }, Held::Text) if index == expression => {
                    return Way::Nowhere;
                }
                (
                    ExprKind::Binary {
                        op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::Instanceof,
                        ..
                    },
                    Held::List,
                ) => return Way::Nowhere,
                (ExprKind::Spread(_), Held::List) => match bound.parent_of_expr(above) {
                    Parent::Expr(list) if matches!(hir[list].kind, ExprKind::Array(_)) => {
                        expression = list;
                    }
                    _ => return Way::Anywhere,
                },
                (ExprKind::Dot { name, .. }, Held::List) => return self.way_of_member(above, name),
                (ExprKind::New(_) | ExprKind::Call(_), Held::List)
                    if self.holds_its_only_argument(above, expression) =>
                {
                    expression = above;
                }
                _ => return Way::Anywhere,
            }
        }
    }

    fn is_exported(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.request.hir, self.request.bound);
        let binding = Binding::Symbol(symbol);
        let mut declarations = bound.symbol(symbol).decls.iter();
        let mut specifiers = (0..hir.export_specs.len() as u32).map(ExportSpecId);
        let mut entity_names = (0..hir.import_equals.len() as u32).map(ImportEqualsId);
        declarations.any(|&it| bound.modifier_flags(hir, it).contains(Flags::EXPORT))
            || specifiers.any(|it| bound.exported_binding(it) == binding)
            || entity_names.any(|it| bound.entity_root_binding(it) == binding)
    }

    // Whether whoever reads the variable writes its name in this file.
    fn is_read_by_name_alone(&self, symbol: SymbolId) -> bool {
        let bound = self.request.bound;
        let redeclared = bound.runtime.redeclared_commonjs_variables();
        matches!(
            bound.binding_kind(symbol),
            BindingKind::Var | BindingKind::Let | BindingKind::Const
        ) && matches!(
            bound.binding_stability(symbol),
            BindingStability::Stable
                | BindingStability::Stored
                | BindingStability::NotInitializedOnce
        ) && !bound.is_visible_to_eval(symbol)
            && !redeclared.iter().any(|it| it.0 == symbol)
            && !self.is_exported(symbol)
    }

    fn way_of_mention(&self, mention: ExprId, holder: &Holder) -> Way {
        let bound = self.request.bound;
        if !bound.is_store_target(mention) {
            return self.way_of(mention, holder.held);
        }
        let mut stores = bound.stores_to(holder.symbol).iter();
        match stores
            .find(|store| store.target == mention)
            .map(|it| it.kind)
        {
            Some(
                StoreKind::Assign | StoreKind::Destructure | StoreKind::ForIn | StoreKind::ForOf,
            ) => Way::Nowhere,
            Some(StoreKind::CompoundAssign(_) | StoreKind::Update(_)) | None => Way::Anywhere,
        }
    }

    fn follow_variables(&self, holders: &mut Vec<Holder>) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let mut first_new = 0;
        for _ in 0..self.limits.get(LimitId::MaxVariablesFollowedToLoader) {
            let end = holders.len();
            if first_new == end {
                break;
            }
            for holder in &mut holders[first_new..end] {
                holder.leads_anywhere = !self.is_read_by_name_alone(holder.symbol);
            }
            let names = holders[first_new..end].iter();
            let mut names: Vec<Atom> = names.map(|it| bound.symbol(it.symbol).name).collect();
            names.shared_sort_unstable_by_key(|name| name.0);
            for mention in (0..hir.exprs.len() as u32).map(ExprId) {
                let ExprKind::Ident(name) = hir[mention].kind else {
                    continue;
                };
                if names.binary_search_by_key(&name.0, |it| it.0).is_err()
                    || !bound.is_evaluated_ident(mention)
                    || analysis.decisions.is_dead_expr(mention)
                {
                    continue;
                }
                let binding = bound.binding(mention);
                for index in first_new..end {
                    let holder = &holders[index];
                    if holder.leads_anywhere || binding != Binding::Symbol(holder.symbol) {
                        continue;
                    }
                    match self.way_of_mention(mention, holder) {
                        Way::Anywhere => holders[index].leads_anywhere = true,
                        Way::Nowhere => {}
                        Way::Variable(next, held) => {
                            let next = holder_of(holders, next, held);
                            holders[index].handed_to.push(next);
                        }
                    }
                }
            }
            first_new = end;
        }
        for holder in &mut holders[first_new..] {
            holder.leads_anywhere = true;
        }
        loop {
            let leads_on = |holder: &Holder| {
                let mut next = holder.handed_to.iter();
                !holder.leads_anywhere && next.any(|&it| holders[it as usize].leads_anywhere)
            };
            let Some(found) = holders.iter().position(leads_on) else {
                break;
            };
            holders[found].leads_anywhere = true;
        }
    }

    fn find_modules_written_as_values(&self) -> Vec<RuntimeModule> {
        let &FinishedFile { hir, analysis, .. } = self.request;
        // The name of an import by a constant name goes to that import, which keeps the module where it is reached.
        let sites = analysis.import_sites.iter();
        let mut names_of_imports: Vec<ExprId> = sites.map(|site| site.specifier_node).collect();
        names_of_imports.shared_sort_unstable();
        let mut written: Vec<RuntimeModule> = Vec::new();
        let mut held_by_variables: Vec<(u32, RuntimeModule)> = Vec::new();
        let mut holders: Vec<Holder> = Vec::new();
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let is_text = matches!(
                hir[expression].kind,
                ExprKind::String(_)
                    | ExprKind::Template { .. }
                    | ExprKind::Binary { op: BinOp::Add, .. }
            );
            if !is_text
                || analysis.decisions.is_dead_expr(expression)
                || names_of_imports.binary_search(&expression).is_ok()
            {
                continue;
            }
            let (FoldedValue::Constant(Constant::String(name))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(name))) =
                analysis.decisions.constant(hir, expression)
            else {
                continue;
            };
            let Some(module) = self.find_module(name) else {
                continue;
            };
            if written.contains(&module) {
                continue;
            }
            match self.way_of(expression, Held::Text) {
                Way::Anywhere => written.push(module),
                Way::Nowhere => {}
                Way::Variable(symbol, held) => {
                    let holder = holder_of(&mut holders, symbol, held);
                    held_by_variables.push((holder, module));
                }
            }
        }
        held_by_variables.retain(|it| !written.contains(&it.1));
        if !held_by_variables.is_empty() {
            self.follow_variables(&mut holders);
        }
        let reach = |it: &(u32, RuntimeModule)| holders[it.0 as usize].leads_anywhere;
        written.extend(
            held_by_variables
                .iter()
                .filter(|it| reach(it))
                .map(|it| it.1),
        );
        written
    }

    // A call of process.getBuiltinModule with a name that is no constant is no import site.
    fn visit_calls_of_other_loaders(&mut self) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[expression].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !analysis.decisions.is_dead_expr(expression);
            if !is_evaluated || analysis.import_site_of_call(expression).is_some() {
                continue;
            }
            let Some(argument) = hir.ids(hir[call].args).next() else {
                continue;
            };
            let loader = self.builtins.builtin_of_expression(callee);
            if loader == Some(BuiltinId::ProcessGetBuiltinModule) {
                self.add_names_given_to_loader(argument);
                continue;
            }
            match resolve_loader_alias(hir, bound, &analysis.decisions, callee) {
                Some(LoaderAlias::Local) => self.add_names_given_to_loader(argument),
                // Whether what is imported is a loader is known once the exporting file is loaded.
                Some(LoaderAlias::Import(symbol)) => {
                    let first_new = self.named.len();
                    if self.add_names_in(argument, false) {
                        self.imports_given_unknown_names.push(symbol);
                    }
                    let named = self.named.drain(first_new..);
                    self.passed_to_imports
                        .extend(named.map(|module| (symbol, module)));
                }
                None => {}
            }
        }
    }

    // The one name under which a function is reached.
    fn find_only_name_of(&self, function: FnId) -> Option<SymbolId> {
        let (hir, bound) = (self.request.hir, self.request.bound);
        let name = match (hir[function].kind, bound.fns[function.idx()].owner) {
            (FnKind::Decl, _) => bound.declared_symbol(Decl::Fn(function)),
            (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(expression))
                if !bound.finds_itself(hir, function) =>
            {
                let Parent::VarInit(declaration) = bound.parent_of_expr(expression) else {
                    return None;
                };
                match self.way_into_pattern(hir[declaration].pat, Held::Text) {
                    Way::Variable(name, _) => name,
                    Way::Anywhere | Way::Nowhere => return None,
                }
            }
            _ => return None,
        };
        let mut hoisted = bound.runtime.annex_b_functions().iter();
        // `arguments.callee` and evaluated text hand the function on without its name.
        let other_ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
        let is_only_name = name.is_some()
            && !bound.function_flags(function).intersects(other_ways)
            && bound.is_stable_binding(name)
            && !bound.is_visible_to_eval(name)
            && !hoisted.any(|it| it.function == function)
            && !self.is_exported(name);
        is_only_name.then_some(name)
    }

    // `function load(name) { return require(name); }`, where every mention of `load` calls it: what the calls pass for `name`.
    pub(crate) fn find_values_of_parameter(
        &self,
        mention: ExprId,
    ) -> Option<SmallVec<[ExprId; 4]>> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let Binding::Symbol(parameter) = bound.binding(mention) else {
            return None;
        };
        let &[Decl::Param(pattern)] = bound.symbol(parameter).decls else {
            return None;
        };
        let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let function = bound.param_fn[id.idx()];
        let index = hir[function].params.iter().position(|it| it == id)?;
        let is_settled = matches!(
            bound.binding_stability(parameter),
            BindingStability::Stable | BindingStability::NotInitializedOnce
        ) && bound.stores_to(parameter).is_empty()
            && !bound.is_visible_to_eval(parameter)
            && bound
                .dynamic_lookup_scope(NodeData::Expr(mention))
                .is_none()
            && !hir[id].flags.contains(Flags::REST);
        let name = self.find_only_name_of(function).filter(|_| is_settled)?;
        let text = bound.symbol(name).name;
        let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
        if hir[id].default.is_some() {
            values.push(hir[id].default);
        }
        for callee in (0..hir.exprs.len() as u32).map(ExprId) {
            let is_mention = matches!(hir[callee].kind, ExprKind::Ident(it) if it == text)
                && bound.is_evaluated_ident(callee)
                && !analysis.decisions.is_dead_expr(callee)
                && bound.binding(callee) == Binding::Symbol(name);
            if !is_mention {
                continue;
            }
            let Parent::Expr(above) = bound.parent_of_expr(callee) else {
                return None;
            };
            let ExprKind::Call(call) = hir[above].kind else {
                return None;
            };
            let mut passed = hir.ids(hir[call].args).take(index + 1);
            let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
            if hir[call].callee != callee || passed.clone().any(is_spread) {
                return None;
            }
            values.extend(passed.nth(index));
        }
        Some(values)
    }

    // Whether the argument may also be a name that the build does not know.
    fn add_names_in(&mut self, argument: ExprId, follows_parameters: bool) -> bool {
        let (hir, decisions) = (self.request.hir, &self.request.analysis.decisions);
        let mut has_unknown_name = false;
        let mut parameters_left = if follows_parameters {
            self.limits.get(LimitId::MaxParametersFollowedToLoader)
        } else {
            0
        };
        let mut pending: SmallVec<[(ExprId, bool); 4]> = smallvec![(argument, false)];
        while let Some((expression, is_passed)) = pending.pop() {
            let expression = hir.skip_type_assertions(expression);
            if decisions.is_dead_expr(expression) {
                continue;
            }
            match decisions.constant(hir, expression) {
                FoldedValue::Constant(Constant::String(name))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => {
                    if is_passed {
                        let module = self.find_module(name);
                        self.passed_for_parameters.extend(module);
                    } else {
                        self.add_name(argument, name);
                    }
                }
                FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => {}
                FoldedValue::Unknown => match hir[expression].kind {
                    ExprKind::Cond { branches, .. } => {
                        let Branches { yes, no } = hir.branches(branches);
                        pending.extend([(yes, is_passed), (no, is_passed)]);
                    }
                    ExprKind::Ident(_) if parameters_left > 0 => {
                        parameters_left -= 1;
                        match self.find_values_of_parameter(expression) {
                            Some(values) => pending.extend(values.iter().map(|&it| (it, true))),
                            None => has_unknown_name = true,
                        }
                    }
                    _ => has_unknown_name = true,
                },
            }
        }
        has_unknown_name
    }

    fn find_module(&self, name: Atom) -> Option<RuntimeModule> {
        let text = self.request.atoms.bytes(name);
        match self.runtime_modules.resolve_module(text, b"") {
            Some(RuntimeResolution::Module(module)) => RuntimeModule::from_registry_id(module.0),
            Some(RuntimeResolution::HostValue) | None => None,
        }
    }

    fn add_name(&mut self, argument: ExprId, name: Atom) {
        let module = self.find_module(name);
        self.named.extend(module.map(|module| NamedModule {
            argument,
            name,
            module,
        }));
    }
}

#[cfg(test)]
mod tests {
    use bun_builtin_sources::Archive;

    use crate::builtins::RuntimeModule;
    use crate::compile::testing::{default_settings, with_bind_input};
    use crate::load::runtime_modules::RuntimeModules;
    use crate::load::runtime_roots::collect_runtime_roots;

    fn root_modules(files: &[(&str, &str)]) -> Vec<RuntimeModule> {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        with_bind_input(files, &default_settings(), |input| {
            let roots = collect_runtime_roots(input.files, &runtime_modules, input.platform);
            let is_root = |module: &RuntimeModule| {
                let path = runtime_modules.module_path(*module);
                path.is_some_and(|path| roots.paths.iter().any(|root| root == path))
            };
            RuntimeModule::ALL.into_iter().filter(is_root).collect()
        })
    }

    #[track_caller]
    fn assert_files_keep(
        files: &[(&str, &str)],
        kept: &[RuntimeModule],
        dropped: &[RuntimeModule],
    ) {
        let modules = root_modules(files);
        for module in kept {
            assert!(modules.contains(module), "{module:?} is missing: {files:?}");
        }
        for module in dropped {
            assert!(!modules.contains(module), "{module:?} is kept: {files:?}");
        }
    }

    #[track_caller]
    fn assert_keeps(source: &str, kept: &[RuntimeModule], dropped: &[RuntimeModule]) {
        assert_files_keep(&[("main.ts", source)], kept, dropped);
    }

    const ESBUILD_REQUIRE: &str = r#"((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
})"#;

    #[test]
    fn esbuild_require_shim_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeZlib};
        let source = format!(
            "var __require = {ESBUILD_REQUIRE};\n__require('zlib'); __require('node:dgram');"
        );
        assert_files_keep(
            &[("main.mjs", &source)],
            &[NodeZlib, NodeDgram],
            &[NodeRepl],
        );
        let minified = "var t=(a=>typeof require<\"u\"?require:typeof Proxy<\"u\"?new Proxy(a,{get:(b,c)=>(typeof require<\"u\"?require:b)[c]}):a)(function(a){if(typeof require<\"u\")return require.apply(this,arguments);throw Error('no '+a)});t('zlib');";
        assert_files_keep(&[("main.mjs", minified)], &[NodeZlib], &[NodeDgram]);
    }

    #[test]
    fn iife_that_returns_a_loader_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = "import { createRequire } from 'node:module';
const a = (() => require)();
const b = (function () { return import.meta.require; })();
const c = (() => createRequire('/elsewhere/'))();
const d = a;
a('zlib'); b('dgram'); c('vm'); d('v8');";
        assert_files_keep(
            &[("main.mjs", source)],
            &[NodeZlib, NodeDgram, NodeVm, NodeV8],
            &[NodeRepl],
        );
    }

    #[test]
    fn callee_that_may_be_a_loader_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeHttp2, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}let reassigned = (() => require)(); reassigned = String;
const chosen = flag ? require : String;
const parameter = ((load: unknown) => load)(require) as (name: string) => unknown;
const asynchronous = (async () => require)() as unknown as (name: string) => unknown;
const longer = (() => {{ if (flag) return String; return require; }})();
reassigned('zlib'); chosen('dgram'); parameter('vm'); asynchronous('v8'); longer('repl');"
        );
        assert_keeps(
            &source,
            &[NodeZlib, NodeDgram, NodeVm, NodeV8, NodeRepl],
            &[NodeHttp2],
        );
    }

    #[test]
    fn name_that_comes_to_a_load_as_a_value_is_kept() {
        use RuntimeModule::{
            NodeDgram, NodeHttp2, NodeOs, NodeReadline, NodeRepl, NodeV8, NodeVm, NodeZlib,
        };
        let source = "function load(name: string) { try { return require(name); } catch { return null; } }
const table = { first: 'node:vm' };
enum Names { Second = 'node:v8' }
class Holder { name = 'os'; }
const choose = (): string => 'readline';
load('node:dgram'); for (const name of ['zlib']) load(name);
load(table.first); load(Names.Second); load(new Holder().name); load(choose()); load('node:' + 're' + 'pl');";
        assert_keeps(
            source,
            &[
                NodeDgram,
                NodeZlib,
                NodeVm,
                NodeV8,
                NodeOs,
                NodeReadline,
                NodeRepl,
            ],
            &[NodeHttp2],
        );
    }

    #[test]
    fn name_written_in_another_file_than_the_load_is_kept() {
        use RuntimeModule::{NodeDgram, NodeRepl};
        let files = [
            (
                "main.mjs",
                "import { ask } from './ask.mjs';\nask('node:dgram');",
            ),
            (
                "ask.mjs",
                "export function ask(name) { return process.getBuiltinModule(name); }",
            ),
        ];
        assert_files_keep(&files, &[NodeDgram], &[NodeRepl]);
    }

    #[test]
    fn holder_of_a_loader_in_unknown_hands_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source =
            "function ask(holder: typeof process) { return holder.getBuiltinModule('node:dgram'); }
ask(process);
const held = { process };
held.process.getBuiltinModule('node:zlib');
function askModule(holder: NodeJS.Module, name: string) { return holder.require(name); }
askModule(module, 'vm');
process.getBuiltinModule.call(process, 'node:v8');";
        assert_files_keep(
            &[("main.cts", source)],
            &[NodeDgram, NodeZlib, NodeVm, NodeV8],
            &[NodeRepl],
        );
    }

    #[test]
    fn name_written_where_every_load_has_a_known_name_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeOs, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}import 'node:os';
function log(text: string) {{ console.log(text); }}
log('node:dgram'); export const names = ['zlib'];
require(flag ? 'node:os' : 'os'); process.getBuiltinModule('node:os'); process.env.NAME = 'vm';"
        );
        assert_keeps(&source, &[NodeOs], &[NodeDgram, NodeZlib, NodeVm]);
    }

    #[test]
    fn text_that_goes_nowhere_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeOs, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}declare const table: Record<string, unknown>;
require(name);
'node:os';
if (name === 'node:dgram' || 'zlib' == name) table['vm'];
switch (name) {{ case 'v8': break; }}
export const has = 'repl' in table, kind = typeof 'os';
if (false) console.log('node:os');"
        );
        assert_keeps(
            &source,
            &[],
            &[NodeDgram, NodeZlib, NodeVm, NodeV8, NodeRepl, NodeOs],
        );
    }

    #[test]
    fn list_that_is_only_searched_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeOs, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}require(name);
const list = ['node:dgram', 'zlib'] as const;
const set = new Set(['vm', ...list]);
let later: readonly string[]; later = Object.freeze(['v8']);
const again = set;
export const found = list.includes(name as never) || list.indexOf(name as never) > 0 || set.has(name)
    || again.size > list.length || later.lastIndexOf(name) > 0 || ['repl'].includes(name) || (flag ? ['os'] : list).includes(name as never);"
        );
        assert_keeps(
            &source,
            &[],
            &[NodeDgram, NodeZlib, NodeVm, NodeV8, NodeRepl, NodeOs],
        );
    }

    #[test]
    fn list_that_hands_out_an_element_is_kept() {
        use RuntimeModule::{
            NodeDgram, NodeHttp2, NodeOs, NodeReadline, NodeRepl, NodeTty, NodeV8, NodeVm, NodeZlib,
        };
        let source = "function load(name: string) { return require(name); }
const read = ['node:dgram']; if (read.includes('x')) load(read[0]);
const looped = ['zlib']; for (const name of looped) load(name);
const passed = ['vm']; console.log(passed, passed.length);
export const exported = ['v8'];
const spread = ['repl']; load(...spread);
const copied = ['os']; const copy = copied; copy.forEach(load);
const set = new Set(['readline']); for (const name of set) load(name);
const named = ['http2']; export { named as other };
const replaced = ['tty']; replaced.includes = load as never; replaced.includes('x');";
        assert_keeps(
            source,
            &[
                NodeDgram,
                NodeZlib,
                NodeVm,
                NodeV8,
                NodeRepl,
                NodeOs,
                NodeReadline,
                NodeHttp2,
                NodeTty,
            ],
            &[],
        );
    }

    #[test]
    fn list_that_evaluated_text_may_read_is_kept() {
        let source = "const list = ['node:dgram'];
function load(text) { return list.includes(text) && eval(text); }
load('require(list[0])');";
        assert_files_keep(&[("main.cjs", source)], &[RuntimeModule::NodeDgram], &[]);
    }

    #[test]
    fn text_in_a_variable_goes_where_the_variable_is_read() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}require(name);
const first = 'node:dgram';
let second; second = flag ? 'zlib' : 'vm';
export const same = name === first || second === name;
const third = 'v8'; console.log(third);
let fourth; console.log(fourth = 'repl');"
        );
        assert_keeps(&source, &[NodeV8, NodeRepl], &[NodeDgram, NodeZlib, NodeVm]);
    }

    #[test]
    fn default_export_that_is_a_name_is_kept() {
        let files = [
            (
                "main.mjs",
                "import name from './name.mjs';\nprocess.getBuiltinModule(name);",
            ),
            ("name.mjs", "export default 'node:dgram';"),
        ];
        assert_files_keep(&files, &[RuntimeModule::NodeDgram], &[]);
    }

    #[test]
    fn unknown_argument_of_an_imported_function_that_is_no_loader_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeZlib};
        let files = [
            (
                "main.mjs",
                "import { log } from './log.mjs';
log(process.argv[2]); log('zlib'); console.log({ kind: 'node:dgram' });",
            ),
            (
                "log.mjs",
                "export function log(text) { console.log(text); }",
            ),
        ];
        assert_files_keep(&files, &[], &[NodeZlib, NodeDgram]);
    }

    #[test]
    fn unknown_argument_of_an_imported_loader_keeps_written_names() {
        use RuntimeModule::{NodeDgram, NodeRepl};
        let files = [
            (
                "main.mjs",
                "import { load } from './load.mjs';
load(process.argv[2]); console.log({ kind: 'node:dgram' });",
            ),
            (
                "load.mjs",
                "import { createRequire } from 'node:module';
export const load = createRequire(import.meta.url);",
            ),
        ];
        assert_files_keep(&files, &[NodeDgram], &[NodeRepl]);
    }

    #[test]
    fn parameter_of_a_function_that_is_only_called_takes_what_the_calls_pass() {
        use RuntimeModule::{NodeDgram, NodeOs, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}function load(name: string) {{ try {{ return require(name); }} catch {{ return null; }} }}
const later = (first: number, name = 'node:v8') => import(name);
function outer(name: string) {{ return load(name); }}
load('node:dgram'); load(flag ? 'zlib' : 'vm'); later(1); outer('os');
console.log('repl');"
        );
        assert_keeps(
            &source,
            &[NodeDgram, NodeZlib, NodeVm, NodeV8, NodeOs],
            &[NodeRepl],
        );
    }

    #[test]
    fn parameter_of_a_function_in_unknown_hands_takes_any_written_name() {
        use RuntimeModule::NodeRepl;
        for hands in [
            "console.log(load);",
            "export { load };",
            "load(...[name]);",
            "load(name);",
            "load.call(null, name);",
            "new load(name);",
        ] {
            let source = format!(
                "{FLAG}function load(name: string) {{ return require(name); }}
{hands} console.log('repl');"
            );
            assert_keeps(&source, &[NodeRepl], &[]);
        }
        let handed_on =
            "function load(name) { console.log(arguments.callee); return require(name); }
load('x'); console.log('repl');";
        assert_files_keep(&[("main.cjs", handed_on)], &[NodeRepl], &[]);
        for parameter in ["...name", "{ name }", "name, other = (name = 'x')"] {
            let source = format!(
                "function load({parameter}) {{ return require(name); }}
load('x'); console.log('repl');"
            );
            assert_files_keep(&[("main.cjs", &source)], &[NodeRepl], &[]);
        }
    }

    #[test]
    fn name_that_starts_like_no_library_module_keeps_nothing() {
        let source = format!(
            "{FLAG}require('./' + name); import(`../${{name}}.js`); console.log('node:dgram');"
        );
        assert_keeps(&source, &[], &[RuntimeModule::NodeDgram]);
    }

    #[test]
    fn loader_imported_from_another_file_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let chunk = format!(
            "import {{ createRequire }} from 'node:module';
var __require = {ESBUILD_REQUIRE};
export var made = createRequire(import.meta.url);
export {{ __require as a }};"
        );
        let files = [
            (
                "main.mjs",
                "import { a as load, made } from './chunk.mjs';
import { again } from './barrel.mjs';
load('zlib'); made('node:dgram'); again(globalThis.flag ? 'vm' : 'v8');",
            ),
            ("chunk.mjs", &chunk),
            (
                "barrel.mjs",
                "import { a } from './chunk.mjs';\nexport { a as again };",
            ),
        ];
        assert_files_keep(&files, &[NodeZlib, NodeDgram, NodeVm, NodeV8], &[NodeRepl]);
    }

    #[test]
    fn imported_function_that_is_no_loader_keeps_nothing() {
        use RuntimeModule::{NodeRepl, NodeZlib};
        let files = [
            (
                "main.mjs",
                "import { log } from './log.mjs';
import other from './log.mjs';
log('zlib'); other('repl');",
            ),
            (
                "log.mjs",
                "export function log(text) { console.log(text); }
export default log;",
            ),
        ];
        assert_files_keep(&files, &[], &[NodeZlib, NodeRepl]);
    }

    #[test]
    fn imported_binding_that_may_hold_a_loader_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl};
        let files = [
            (
                "main.mjs",
                "import { swapped } from './log.mjs';\nswapped('dgram');",
            ),
            (
                "log.mjs",
                "export let swapped = require;
export function swap() { swapped = console.log; }",
            ),
        ];
        assert_files_keep(&files, &[NodeDgram], &[NodeRepl]);
    }

    const FLAG: &str = "declare const flag: boolean; declare const name: string;\n";

    #[test]
    fn each_arm_of_a_choice_is_kept() {
        use RuntimeModule::{NodeDgram, NodeHttp2, NodeRepl, NodeV8, NodeVm, NodeZlib};
        for load in [
            "require",
            "import",
            "import.meta.require",
            "process.getBuiltinModule",
        ] {
            let source =
                format!("{FLAG}export const loaded = {load}(flag ? 'node:vm' : 'node:v8');");
            assert_keeps(&source, &[NodeVm, NodeV8], &[NodeDgram]);
        }
        let nested = format!(
            "{FLAG}require(flag ? 'node:dgram' : name ? 'zlib' : ('node:http2' as string));"
        );
        assert_keeps(&nested, &[NodeDgram, NodeZlib, NodeHttp2], &[NodeRepl]);
    }

    #[test]
    fn choice_given_to_made_require_is_kept() {
        let source = format!(
            "{FLAG}import {{ createRequire }} from 'node:module';
const load = createRequire(import.meta.url);
load(flag ? 'node:vm' : 'node:v8');"
        );
        assert_keeps(
            &source,
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
            &[RuntimeModule::NodeDgram],
        );
    }

    #[test]
    fn library_module_named_to_require_made_for_another_file_is_kept() {
        let source = "import { createRequire } from 'module';
var require = createRequire('/');
export const tty = require('tty');
export const os = createRequire('/elsewhere/')('node:os');";
        assert_keeps(
            source,
            &[RuntimeModule::NodeTty, RuntimeModule::NodeOs],
            &[RuntimeModule::NodeDgram],
        );
    }

    #[test]
    fn constant_arm_beside_unknown_arm_is_kept() {
        let source = format!("{FLAG}require(flag ? 'node:vm' : name);");
        assert_keeps(&source, &[RuntimeModule::NodeVm], &[RuntimeModule::NodeV8]);
    }

    #[test]
    fn name_with_constant_start_keeps_nothing() {
        let source =
            format!("{FLAG}require('node:v' + name); require(`node:${{name}}`); require(name);");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }

    #[test]
    fn choice_that_only_names_a_module_keeps_nothing() {
        let source = format!("{FLAG}require.resolve(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }

    #[test]
    fn choice_in_dead_code_keeps_nothing() {
        let source = format!("{FLAG}if (false) require(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }
}
