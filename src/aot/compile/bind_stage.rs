use super::guessed_workers::{
    describe_guessed_files, describe_silent_failure, find_guessed_names, refuse_guessed_file,
};
use super::lower_stage::may_fail_where_loaded;
use super::program_reach::{
    LeftOutCode, ProgramReachInput, ReachedModules, ReplacedLoaderHook,
    find_left_out_code_seeding_last, find_root_folders_spelled,
};
use super::summary::{collect_names_followed, collect_program_file_paths};
use super::{BoundBuild, BoundProject, Build, LoadedBuild};
use crate::builtins::{BuiltinValuePaths, RuntimeModule, builtin_type_paths, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView, Span, range_of_node};
use crate::ir::generated::ModuleRequestKind;
use crate::ir::{InParallel, filter_each};
use crate::known_helpers::KnownHelpers;
use crate::link::run_steps_beside;
use crate::load::contents::ProgramContents;
use crate::load::contents::worker_entries::source_path_of;
use crate::load::loaders::{gives_data, loader_by_path};
use crate::load::module_paths::compute_display_path;
use crate::load::plugin_modules::{first_error_of, warn_instead_of_errors};
use crate::load::source_provider::{RefusedText, SourceProvider};
use crate::load::sources::{JSON_PARSE_ERROR_FOR_BLANK_TEXT, Sources, parsed_source};
use crate::load::{PerProject, ProjectId};
use crate::module_keys::type_attribute_of;
use crate::modules::{
    self, BindInput, BoundModules, DeferredExports, ImportBinding, LinkedProject, ModuleGraph,
    ModuleKind, ModuleRef, ModuleRequest, Shape, SiteAnswer,
};
use crate::statistics::{Stage, StepClock};
use bun_ast::{Loader, Log};
use bun_options_types::aot_options::ExplainSet;
use bun_paths::is_absolute;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingInitializer, CommonJsVariable, Decl, FnOwner, FunctionFlags, Parent,
    ReferentCertainty, ResolvedReferent, StaticReferent, static_referent,
};
use bun_sema::check::aot::{BuiltinTypeSymbols, FunctionRef};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, Flags, MemberKey, NodeData, PatKind, StmtId, StmtKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, CodeView, ComputedTargets, FileId, Files, Sym};
use bun_sema::resolve::CodeImportKind;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, from_native, to_native};

fn finish_modules(graph: &mut ModuleGraph, reached: &ReachedModules, left_out_files: &[FileId]) {
    for &module in &reached.looked_at {
        match graph.shape(module) {
            Shape::EsModule => graph.set_namespace_is_seen(module),
            Shape::Names | Shape::Value => graph.look_at(module),
            Shape::AsToday => {}
        }
    }
    for &module in &reached.with_module_objects {
        graph.set_keeps_module_object(module);
    }
    for &module in &reached.naming_ways {
        graph.set_reaches_module_objects(module);
    }
    for &module in &reached.exposing_global_object {
        graph.set_exposes_global_object(module);
    }
    for &module in reached
        .found_by_name
        .iter()
        .chain(&reached.data_found_by_name)
    {
        graph.set_is_found_by_name(module);
    }
    graph.leave_out_inner_modules(&reached.left_out_inner_modules);
    let keeps =
        |referrer: ModuleRef, request: &ModuleRequest| reached.keeps_request(referrer, request);
    let needed = match reached.drops_imports() {
        true => graph.find_imports_of_lookups(left_out_files, &keeps),
        false => FxHashSet::default(),
    };
    let keeps = |referrer: ModuleRef, request: &ModuleRequest| {
        let is_needed = matches!(
            (referrer, request.target, request.kind),
            (ModuleRef::File(importer), ModuleRef::File(target), ModuleRequestKind::Import)
                if needed.contains(&(importer, target))
        );
        is_needed || keeps(referrer, request)
    };
    let unreachable_builtins = match reached.drops_imports() {
        true => graph.find_unreachable_builtins(left_out_files, &keeps),
        false => Vec::new(),
    };
    graph.limit_requests(keeps);
    graph.add_imports(&reached.readers_of_built_in_modules);
    graph.add_imports(&unreachable_builtins);
}

fn key_names_no_file_of_program(files: &Files<'_>, file: FileId, entry: ExprId) -> bool {
    let (hir, analysis) = (files.hir(file), files.analysis(file));
    let key_of_deletion = match hir[entry].kind {
        ExprKind::Call(call) => hir.ids(hir[call].args).nth(1),
        _ => None,
    };
    let key = match key_of_deletion {
        Some(key) => Some(hir.index_member_key(hir.skip_type_assertions(key))),
        None => hir.member_key(entry).map(|it| it.1),
    };
    let path = match key {
        Some(MemberKey::Name(text) | MemberKey::PrivateName(text)) => text,
        Some(MemberKey::Computed(key)) => {
            let key = hir.skip_type_assertions(key);
            if let Some(site) = analysis.import_site_of_call(key)
                && analysis.import_sites[site].kind == ImportSiteKind::RequireResolve(key)
            {
                let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
                return matches!(
                    answers.get(site),
                    Some(CodeAnswer::External { .. } | CodeAnswer::NotFound(_))
                );
            }
            match analysis.decisions.constant(hir, key) {
                FoldedValue::Constant(Constant::String(path))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(path)) => path,
                FoldedValue::Constant(_)
                | FoldedValue::ConstantOutsideDeadZone(_)
                | FoldedValue::Unknown => return false,
            }
        }
        None => return false,
    };
    let path = files.atoms.bytes(path);
    !is_absolute(path) || !files.by_path.contains(&from_native(path))
}

/// `clear(require.cache)`, `held.table = require.cache`: whoever gets the table may delete from it. `clear(require)`, `new Loader(Module)`: so may a function that gets
/// what holds the table, unless it is a built-in function, or one that the build finds and that does nothing with its parameter but call it: `factory(require, exports)`.
/// A `require` that is exported, returned or stored is followed where it is used.
fn hands_module_cache_to_code_out_of_sight(
    project: &LinkedProject<'_, '_>,
    file: FileId,
    handed: ExprId,
) -> bool {
    let (hir, bound) = (project.files.hir(file), project.files.bound(file));
    if parsed_source(project.files, file)
        .is_some_and(|source| source.builtins.passes_module_cache(handed))
    {
        return true;
    }
    let mut operand = handed;
    while let Parent::Expr(parent) = bound.parent_of_expr(operand)
        && hir.type_assertion_operand(parent) == Some(operand)
    {
        operand = parent;
    }
    let Parent::Expr(user) = bound.parent_of_expr(operand) else {
        return false;
    };
    let (ExprKind::Call(call) | ExprKind::New(call)) = hir[user].kind else {
        return false;
    };
    let Some(index) = hir.ids(hir[call].args).position(|it| it == operand) else {
        return false;
    };
    let mut in_front = hir.ids(hir[call].args).take(index);
    if in_front.any(|it| matches!(hir[it].kind, ExprKind::Spread(_))) {
        return true;
    }
    let callee = hir.skip_type_assertions(hir[call].callee);
    let called = match hir[callee].kind {
        ExprKind::Fn(function) => FunctionRef { file, function },
        _ => match static_referent(project, file, callee) {
            ResolvedReferent {
                referent: StaticReferent::Function(called),
                certainty: ReferentCertainty::Proven,
            } => called,
            ResolvedReferent {
                referent: StaticReferent::Builtin(_),
                certainty: ReferentCertainty::Proven,
            } => return false,
            _ => return true,
        },
    };
    let (hir, bound) = (
        project.files.hir(called.file),
        project.files.bound(called.file),
    );
    let flags = bound.function_flags(called.function);
    if flags.contains(FunctionFlags::USES_ARGUMENTS) || !bound.runtime.eval_scopes().is_empty() {
        return true;
    }
    let parameters = hir[called.function].params;
    let rest = parameters.iter().next_back();
    let rest = rest.filter(|&last| hir[last].flags.contains(Flags::REST));
    let Some(parameter) = parameters.iter().nth(index).or(rest) else {
        return false;
    };
    let parameter = &hir[parameter];
    let symbol = bound.declared_symbol(Decl::Param(parameter.pat));
    if !matches!(hir[parameter.pat].kind, PatKind::Ident(_))
        || parameter.default.is_some()
        || parameter.flags.contains(Flags::REST)
        || !bound.is_stable_binding(symbol)
    {
        return true;
    }
    let mut reads = (0..hir.exprs.len() as u32).map(ExprId).filter(|&it| {
        matches!(hir[it].kind, ExprKind::Ident(_)) && bound.binding(it) == Binding::Symbol(symbol)
    });
    !reads.all(|read| match bound.parent_of_expr(read) {
        Parent::Expr(parent) => {
            matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == read)
        }
        _ => false,
    })
}

fn lies_in_left_out_code(files: &Files<'_>, left_out: &LeftOutCode, span: Span) -> bool {
    let (file, hir) = (span.file, files.hir(span.file));
    let is_left_out = |function| left_out.functions.contains(&FunctionRef { file, function });
    let holds = |node| {
        let (start, end) = range_of_node(hir, node);
        (start..end).contains(&span.start)
    };
    left_out.files.binary_search(&file).is_ok()
        || (0..hir.exprs.len() as u32).map(ExprId).any(|it| {
            matches!(hir[it].kind, ExprKind::Fn(function) if is_left_out(function))
                && holds(NodeData::Expr(it))
        })
        || (0..hir.stmts.len() as u32).map(StmtId).any(|it| {
            matches!(hir[it].kind, StmtKind::Fn(function) if is_left_out(function))
                && holds(NodeData::Stmt(it))
        })
}

fn lies_in_dead_code(files: &Files<'_>, span: Span) -> bool {
    let (hir, decisions) = (files.hir(span.file), &files.analysis(span.file).decisions);
    let holds = |node| {
        let (start, end) = range_of_node(hir, node);
        (start..end).contains(&span.start)
    };
    decisions.dead_stmts().any(|it| holds(NodeData::Stmt(it)))
        || decisions.dead_exprs().any(|it| holds(NodeData::Expr(it)))
}

fn warn_where_modules_are_reset(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
) {
    let files = view.files();
    for &file in files.compiled_files() {
        let Some(source) = parsed_source(files, file) else {
            continue;
        };
        if !source.builtins.loses_sight_of_module_cache()
            || left_out.files.binary_search(&file).is_ok()
        {
            continue;
        }
        let hir = files.hir(file);
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let named = source.builtins.builtin_of_expression(expression);
            if named.is_some_and(table::resets_modules) {
                let span = Span::of_node(hir, file, NodeData::Expr(expression));
                let code = Code::ModulesLoadAgainUncompiled;
                diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[]));
            }
        }
    }
}

fn name_data_files_found_by_patterns(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    loaders: &[(Vec<u8>, Loader)],
    provider: &dyn SourceProvider,
    lists_files: bool,
    in_parallel: InParallel<'_>,
) -> bool {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    let is_data = |file: FileId| {
        let by_name = loader_by_path(loaders, files.file_name(file), CodeImportKind::Import);
        gives_data(by_name) && gives_data(sources.loader(file))
    };
    let may_load_data = |file: FileId| {
        let names_modules = |answer: &CodeAnswer<'_>| {
            matches!(
                answer,
                CodeAnswer::Computed(ComputedTargets::Modules { .. })
            )
        };
        is_kept(file)
            && (files.answers(file)).is_some_and(|(answers, _)| answers.iter().any(names_modules))
    };
    let mut has_found_data = false;
    for file in filter_each(files.compiled_files(), in_parallel, &may_load_data) {
        let Some((answers, _)) = files.answers(file) else {
            continue;
        };
        let sites = files.analysis(file).import_sites.iter().zip(answers);
        for (site, answer) in sites.filter(|(site, _)| site.kind.loads_module()) {
            let CodeAnswer::Computed(ComputedTargets::Modules { files: found, .. }) = *answer
            else {
                continue;
            };
            let data = found
                .iter()
                .filter(|&&found| is_kept(found) && is_data(found));
            let mut names: Vec<&[u8]> = data
                .clone()
                .map(|&found| sources.module_paths(found).display_path)
                .collect();
            if names.is_empty() {
                continue;
            }
            has_found_data = true;
            for &found in data {
                provider.keep_bytes_of_data_file(to_native(files.module(found).file_name()));
            }
            if !lists_files {
                continue;
            }
            names.shared_sort_unstable();
            let node = NodeData::Expr(site.specifier_node);
            let span = Span::of_node(files.hir(file), file, node);
            let code = Code::DataFilesFoundByPattern;
            let note = Diagnostic::new(code, Some(span), &[&names.join(&b", "[..])]);
            diagnostics.add(Some(view), note);
        }
    }
    has_found_data
}

/// Returns true if `e` is in a function, declarator or statement that the executable leaves out, or nested in one. A parent that the walk doesn't know ends it with false.
fn is_in_left_out_code(files: &Files<'_>, left_out: &LeftOutCode, file: FileId, e: ExprId) -> bool {
    let bound = files.bound(file);
    let mut node = bound.parent_of_expr(e);
    loop {
        node = match node {
            Parent::Expr(above) => bound.parent_of_expr(above),
            Parent::Stmt(statement) => {
                if left_out.declarations.is_statement_left_out(file, statement) {
                    return true;
                }
                bound.parent_of_stmt(statement)
            }
            Parent::VarInit(declarator) => {
                if left_out
                    .declarations
                    .is_declarator_left_out(file, declarator)
                {
                    return true;
                }
                Parent::Stmt(bound.var_stmt[declarator.idx()])
            }
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::FnBody(function) => {
                if left_out.functions.contains(&FunctionRef { file, function }) {
                    return true;
                }
                match bound.fns[function.idx()].owner {
                    FnOwner::Expr(written) => bound.parent_of_expr(written),
                    FnOwner::Stmt(statement) => bound.parent_of_stmt(statement),
                    _ => return false,
                }
            }
            _ => return false,
        };
    }
}

/// `__dirname` and `__filename` are paths of the build machine in an ES module too, and those lead to every embedded file.
fn names_build_machine_paths(files: &Files<'_>, file: FileId) -> bool {
    use CommonJsVariable::{Dirname, Filename};
    let mut names = files.bound(file).ident_bindings().iter();
    names.any(|it| matches!(it.1, Binding::CommonJs(Filename | Dirname)))
}

fn is_builtin_function(
    files: &Files<'_>,
    graph: &ModuleGraph,
    file: FileId,
    callee: ExprId,
) -> bool {
    let binding = match files.bound(file).binding(callee) {
        Binding::Symbol(id) => Some(graph.import_binding(file, id)),
        _ => graph.member_binding(file, callee),
    };
    matches!(
        binding,
        Some(
            ImportBinding::Builtin(_)
                | ImportBinding::CapturedBuiltin { .. }
                | ImportBinding::BuiltinMember { .. }
        )
    )
}

/// Where `file` hands its own folder to code that may search from it. Only a built-in function is known not to: a variable may hold any function, and a function of the file may hand on what it is given.
fn find_forwarded_folder(
    files: &Files<'_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    file: FileId,
) -> Option<ExprId> {
    let analysis = files.analysis(file);
    let is_run = |operand: ExprId| !is_in_left_out_code(files, left_out, file, operand);
    let is_builtin = |callee: ExprId| is_builtin_function(files, graph, file, callee);
    let mut handed = analysis.own_folder_arguments.iter();
    let mut urls = analysis.own_url_arguments.iter().map(|it| it.argument);
    let may_search = |&&(argument, callee): &&(ExprId, Option<ExprId>)| {
        is_run(argument) && !callee.is_some_and(is_builtin)
    };
    let folder = handed.find(may_search).map(|it| it.0);
    folder.or_else(|| urls.find(|&it| is_run(it)))
}

/// The folder of the package that `path` lies in.
fn find_package_folder(path: &[u8]) -> Option<&[u8]> {
    const FOLDER: &[u8] = b"/node_modules/";
    let start = bun_core::strings::last_index_of(path, FOLDER)? + FOLDER.len();
    let slash_after = |from: usize| {
        let slash = bun_core::strings::index_of_char_usize(&path[from..], b'/');
        slash.map(|it| from + it)
    };
    let first = slash_after(start)?;
    let end = match path[start] {
        b'@' => slash_after(first + 1)?,
        _ => first,
    };
    Some(&path[..end])
}

/// The texts in `file` that can be the name of a file, where `is_meant` by their place.
fn list_file_names<'f>(
    files: &'f Files<'_>,
    file: FileId,
    is_meant: impl Fn(u32) -> bool + 'f,
) -> impl Iterator<Item = &'f [u8]> {
    let hir = files.hir(file);
    let expressions = (0..hir.exprs.len() as u32).map(ExprId);
    let texts = expressions.filter_map(move |e| match hir[e].kind {
        ExprKind::String(text) if is_meant(hir[e].pos) => Some(files.atoms.bytes(text)),
        _ => None,
    });
    let names = texts.map(bun_paths::basename);
    names.filter(|it| bun_core::strings::contains_char(it, b'.'))
}

#[derive(Default)]
struct NamedFiles {
    found: Vec<(FileId, ExprId, Vec<u8>)>,
}

impl NamedFiles {
    fn add(&mut self, file: FileId, operand: ExprId, path: Vec<u8>) {
        self.found.push((file, operand, path));
    }

    fn describe(
        mut self,
        diagnostics: &mut Diagnostics,
        view: ProgramView<'_, '_>,
        project_root: &[u8],
        provider: &dyn SourceProvider,
        mut noted: FxHashSet<Vec<u8>>,
    ) {
        self.found.sort_unstable();
        for of_operand in self.found.chunk_by(|a, b| (a.0, a.1) == (b.0, b.1)) {
            let (file, operand, _) = of_operand[0];
            let embedded = of_operand.iter().map(|it| &it.2);
            let names: Vec<Box<[u8]>> = embedded
                .filter(|&it| provider.is_embedded_implicitly(it, true) && noted.insert(it.clone()))
                .map(|it| compute_display_path(project_root, it))
                .collect();
            if names.is_empty() {
                continue;
            }
            let span = Span::of_node(view.files().hir(file), file, NodeData::Expr(operand));
            let code = Code::NamedFilesEmbedded;
            let note = Diagnostic::new(code, Some(span), &[&names.join(&b", "[..])]);
            diagnostics.add(Some(view), note);
        }
    }
}

/// A package hands its own folder to code that reads there at paths that aren't known, as in `find(__dirname)` with `for (const name of ["package.json5", "package.json"])`. The files of the folder that this code names come along.
fn embed_files_asked_by_name(
    view: ProgramView<'_, '_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
    entry: Option<&[u8]>,
    files_that_name_paths: &[FileId],
    named: &mut NamedFiles,
) {
    let (files, sources) = (view.files(), view.sources);
    let Some(entry) = entry else {
        return;
    };
    let mut names_by_package: FxHashMap<&[u8], Vec<(FileId, FxHashSet<&[u8]>)>> =
        FxHashMap::default();
    let mut files_that_hand_on = Vec::new();
    for &file in files_that_name_paths {
        let Some(package) = find_package_folder(files.module(file).file_name()) else {
            continue;
        };
        if let Some(argument) = find_forwarded_folder(files, graph, left_out, file) {
            files_that_hand_on.push((file, package, argument));
        }
        let mut unknown = files.analysis(file).unknown_path_reads.iter();
        if unknown.any(|&it| !is_in_left_out_code(files, left_out, file, it)) {
            let names = list_file_names(files, file, |_| true).collect();
            (names_by_package.entry(package).or_default()).push((file, names));
        }
    }
    for (file, package, argument) in files_that_hand_on {
        let sites = files.analysis(file).import_sites.iter();
        let loaded = sites.filter_map(|site| match graph.find_site_answer(file, site.kind)? {
            SiteAnswer::Module(ModuleRef::File(loaded) | ModuleRef::Facade(loaded)) => {
                find_package_folder(files.module(loaded).file_name())
            }
            _ => None,
        });
        // What the file itself reads is known of its own text.
        let mut asked: Vec<&FxHashSet<&[u8]>> = Vec::new();
        for package in loaded.chain([package]) {
            let named = names_by_package.get(package).into_iter().flatten();
            asked.extend(named.filter(|it| it.0 != file).map(|it| &it.1));
        }
        // `find(__dirname, "a.json")`, and the names in a variable.
        let (hir, bound) = (files.hir(file), files.bound(file));
        let mut beside = Vec::new();
        if let Parent::Expr(call) = bound.parent_of_expr(argument) {
            beside.push(hir[call].pos..hir[call].end);
            for e in (0..hir.exprs.len() as u32).map(ExprId) {
                if beside[0].contains(&hir[e].pos)
                    && matches!(hir[e].kind, ExprKind::Ident(_))
                    && let Binding::Symbol(variable) = bound.binding(e)
                    && let BindingInitializer::Expression(value) =
                        bound.binding_initializer(hir, variable)
                {
                    beside.push(hir[value].pos..hir[value].end);
                }
            }
        }
        let is_beside = |place: u32| beside.iter().any(|it| it.contains(&place));
        let named_beside: FxHashSet<&[u8]> = list_file_names(files, file, is_beside).collect();
        asked.push(&named_beside);
        let module = to_native(files.module(file).file_name());
        let mut folder = dirname::<Posix>(files.module(file).file_name());
        while folder.len() >= package.len() && asked.iter().any(|it| !it.is_empty()) {
            for listed in provider.list_files_to_embed(to_native(folder), false) {
                let name = bun_paths::basename(&listed);
                if asked.iter().any(|it| it.contains(name))
                    && embed_unless_code(files, sources, provider, (entry, module), &listed, false)
                {
                    named.add(file, argument, listed);
                }
            }
            folder = dirname::<Posix>(folder);
        }
    }
}

/// The path operand of a file read, with a path that it can name.
struct FileRead {
    operand: ExprId,
    path: Vec<u8>,
    /// The call only asks about the file.
    is_query: bool,
    is_listing: bool,
    is_ruled_out: bool,
}

/// The folders of their own that the files of the program make the working directory.
fn find_folders_entered(
    files: &Files<'_>,
    left_out: &LeftOutCode,
    in_parallel: InParallel<'_>,
) -> Vec<Vec<u8>> {
    let enters_folder = |file: FileId| !files.analysis(file).folders_entered.is_empty();
    let mut entered = Vec::new();
    for file in filter_each(files.compiled_files(), in_parallel, &enters_folder) {
        let folder = dirname::<Posix>(files.module(file).file_name());
        for &(operand, path) in files.analysis(file).folders_entered {
            if !is_in_left_out_code(files, left_out, file, operand) {
                entered.push(from_argument(folder, files.atoms.bytes(path)));
            }
        }
    }
    entered.sort_unstable();
    entered.dedup();
    entered
}

fn list_file_reads(
    files: &Files<'_>,
    graph: &ModuleGraph,
    folders_entered: &[Vec<u8>],
    file: FileId,
) -> Vec<FileRead> {
    let analysis = files.analysis(file);
    let folder = dirname::<Posix>(files.module(file).file_name());
    let is_listing = |operand: ExprId| analysis.path_listings.binary_search(&operand).is_ok();
    let is_query = |operand: ExprId| analysis.path_queries.binary_search(&operand).is_ok();
    let read_by_functions_called = analysis.own_url_arguments.iter().flat_map(move |handed| {
        let function = match graph.import_binding(file, handed.function) {
            ImportBinding::Variable(function) => function,
            _ => Sym {
                file,
                id: handed.function,
            },
        };
        let read = files.compiled(function.file).into_iter();
        read.flat_map(|it| it.analysis.caller_relative_reads)
            .filter(move |it| {
                (it.function, it.place, it.property) == (function.id, handed.place, handed.property)
            })
            .map(|it| (handed.argument, it.path, it.is_query))
    });
    let read = analysis.module_relative_reads.iter();
    let read = read.map(move |&(operand, path)| (operand, path, is_query(operand)));
    let is_read_by_function_called = move |callee: ExprId| {
        let function = match files.bound(file).binding(callee) {
            Binding::Symbol(id) => match graph.import_binding(file, id) {
                ImportBinding::Variable(function) => function,
                _ => Sym { file, id },
            },
            _ => match graph.member_binding(file, callee) {
                Some(ImportBinding::Variable(function)) => function,
                _ => return false,
            },
        };
        let called = files.compiled(function.file);
        called.is_some_and(|it| {
            (it.analysis.reading_functions)
                .binary_search(&function.id)
                .is_ok()
        })
    };
    let given = analysis.named_paths.iter();
    let given = given.filter(move |it| it.callee.is_some_and(is_read_by_function_called));
    let given = given.map(|it| (it.operand, it.path, false));
    let read = read.chain(given).chain(read_by_functions_called);
    let create = |folder: &[u8], (operand, path, is_query): (ExprId, Atom, bool)| FileRead {
        operand,
        path: from_argument(folder, files.atoms.bytes(path)),
        is_query,
        is_listing: is_listing(operand),
        is_ruled_out: false,
    };
    let mut reads: Vec<FileRead> = read.map(|it| create(folder, it)).collect();
    reads.extend(analysis.reads_ruled_out.iter().map(|it| FileRead {
        is_ruled_out: true,
        ..create(folder, (it.0, it.1, is_query(it.0)))
    }));
    for folder in folders_entered {
        let below = analysis.reads_below_working_folder.iter();
        reads.extend(below.map(|it| create(folder, (it.0, it.1, is_query(it.0)))));
    }
    reads
}

/// Returns true if `operand` stands in the operand of another read of the same path, as `p` does in `readFileSync(realpathSync(p))`.
fn is_within_other_read(
    files: &Files<'_>,
    file: FileId,
    reads: &[FileRead],
    read: &FileRead,
) -> bool {
    let bound = files.bound(file);
    let mut inner = read.operand;
    while let Parent::Expr(outer) = bound.parent_of_expr(inner) {
        let is_around =
            |it: &FileRead| it.operand == outer && it.path == read.path && !it.is_ruled_out;
        if reads.iter().any(is_around) {
            return true;
        }
        inner = outer;
    }
    false
}

/// A folder that holds code is listed with its compiled files.
fn is_excluded_folder(
    files: &Files<'_>,
    sources: &Sources,
    provider: &dyn SourceProvider,
    folder: &[u8],
    pattern: Option<&PathPattern<'_>>,
) -> bool {
    let is_there = |path: &Vec<u8>| {
        let is_code = |found: FileId| !sources.is_data(found);
        files.by_path.get(&from_native(path)).is_some_and(is_code)
            || provider.is_embedded_implicitly(path, false)
    };
    let Some(mut left_out) = provider.list_excluded_folder(to_native(folder)) else {
        return false;
    };
    if let Some(pattern) = pattern {
        left_out.retain(|path| pattern.matches(path));
        if left_out.is_empty() {
            return false;
        }
    }
    !left_out.iter().any(is_there)
}

/// A path of which only the start and the end are known.
struct PathPattern<'a> {
    folder: Vec<u8>,
    /// It starts with `folder` and a separator.
    start: Vec<u8>,
    end: &'a [u8],
    /// The start names a folder besides the ones that the module lies in.
    names_folder: bool,
}

impl<'a> PathPattern<'a> {
    fn new(module_folder: &[u8], prefix: &[u8], end: &'a [u8]) -> Option<PathPattern<'a>> {
        let cut = bun_core::strings::last_index_of_char(prefix, b'/')?;
        let (written, name) = (&prefix[..cut], &prefix[cut + 1..]);
        let is_name = |it: &[u8]| !matches!(it, b"" | b"." | b"..");
        let names_folder = bun_core::strings::split(written, b"/").any(is_name);
        let folder = from_argument(module_folder, written);
        Some(PathPattern {
            start: [&folder[..], b"/", name].concat(),
            folder,
            end,
            names_folder,
        })
    }

    fn matches_every_file(&self) -> bool {
        self.end.is_empty() && self.start.len() == self.folder.len() + 1
    }

    fn matches(&self, path: &[u8]) -> bool {
        let path = from_native(path);
        path.len() >= self.start.len() + self.end.len()
            && path.starts_with(&self.start)
            && path.ends_with(self.end)
    }
}

fn lists_own_folder(files: &Files<'_>, file: FileId, reads: &[FileRead]) -> bool {
    let folder = dirname::<Posix>(files.module(file).file_name());
    let entered = files.analysis(file).folders_entered;
    let is_entered = |operand: ExprId| entered.iter().any(|it| it.0 == operand);
    (reads.iter()).any(|it| it.is_listing && it.path == folder && !is_entered(it.operand))
}

/// What the module at `module` finds in its own folder under `pattern` over its sources, and not in the executable. Code is there compiled.
fn list_excluded_own_files(
    files: &Files<'_>,
    sources: &Sources,
    provider: &dyn SourceProvider,
    module: &[u8],
    pattern: &PathPattern<'_>,
) -> Vec<Vec<u8>> {
    let is_code = |path: &Vec<u8>| {
        (files.by_path.get(&from_native(path))).is_some_and(|it| !sources.is_data(it))
    };
    let listed = provider.list_excluded_folder(to_native(&pattern.folder));
    let mut found = listed.unwrap_or_default();
    found.retain(|path| pattern.matches(path));
    if !pattern.matches_every_file() && found.iter().any(is_code) {
        return Vec::new();
    }
    found.retain(|path| {
        let is_hidden = bun_paths::basename(path).starts_with(b".");
        !is_hidden && !is_code(path) && provider.is_embeddable_only_by_asset(module, path)
    });
    found.iter().map(|path| from_native(path)).collect()
}

/// The run time finds compiled WebAssembly by its bytes, whatever read them.
fn find_adjacent_web_assembly(
    files: &Files<'_>,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
) -> Vec<(FileId, Vec<u8>)> {
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut found = Vec::new();
    for &file in files.compiled_files().iter().filter(|&&file| is_kept(file)) {
        let analysis = files.analysis(file);
        let folder = dirname::<Posix>(files.module(file).file_name());
        let read = analysis.module_relative_reads.iter();
        let read = read.chain(analysis.reads_ruled_out);
        let handed_on = analysis.named_paths.iter().map(|it| (it.operand, it.path));
        let named = read.copied().chain(handed_on);
        let named = named.filter(|it| files.atoms.bytes(it.1).ends_with(b".wasm"));
        for (operand, name) in named.chain(analysis.web_assembly_names.iter().copied()) {
            let path = from_argument(folder, files.atoms.bytes(name));
            if files.by_path.get(&path).is_some()
                || is_in_left_out_code(files, left_out, file, operand)
                || !seen.insert(path.clone())
            {
                continue;
            }
            found.extend((provider.read_web_assembly(to_native(&path))).map(|bytes| (file, bytes)));
        }
    }
    found
}

/// False where no path of a file is written that the code of the file with `analysis` may read.
fn names_paths(analysis: &FileAnalysis<'_>) -> bool {
    !analysis.unknown_path_reads.is_empty()
        || !analysis.own_folder_arguments.is_empty()
        || !analysis.own_url_arguments.is_empty()
        || !analysis.module_relative_reads.is_empty()
        || !analysis.module_relative_patterns.is_empty()
        || !analysis.reads_ruled_out.is_empty()
        || !analysis.patterns_ruled_out.is_empty()
        || !analysis.reads_below_working_folder.is_empty()
        || !analysis.named_paths.is_empty()
}

fn warn_about_unembedded_reads(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    project_root: &[u8],
    provider: &dyn SourceProvider,
    lists_files: bool,
    in_parallel: InParallel<'_>,
) {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    let path_of = |file: FileId| to_native(files.module(file).file_name());
    let entry = files.entry_points().first().map(|&file| path_of(file));
    let names_paths = |file: FileId| is_kept(file) && names_paths(files.analysis(file));
    let files_that_name_paths = filter_each(files.compiled_files(), in_parallel, &names_paths);
    let mut searched = Vec::new();
    for &file in &files_that_name_paths {
        let mut unknown = files.analysis(file).unknown_path_reads.iter().copied();
        let is_run = |&operand: &ExprId| !is_in_left_out_code(files, left_out, file, operand);
        let find_handed_on = || find_forwarded_folder(files, graph, left_out, file);
        let unknown = unknown.find(is_run);
        if unknown.is_some() {
            provider.note_reads_of_unknown_paths();
        }
        if let Some(operand) = unknown.or_else(find_handed_on) {
            let added = provider.embed_package_json_files(path_of(file));
            searched.extend(added.into_iter().map(|path| (file, operand, path)));
        }
    }
    let mut named_files = NamedFiles::default();
    embed_files_asked_by_name(
        view,
        graph,
        left_out,
        provider,
        entry,
        &files_that_name_paths,
        &mut named_files,
    );
    let folders_entered = find_folders_entered(files, left_out, in_parallel);
    let list_reads = |file: FileId| list_file_reads(files, graph, &folders_entered, file);
    // By the folder of the module.
    let mut folders_embedded: FxHashSet<(Vec<u8>, Vec<u8>)> = FxHashSet::default();
    let mut patterns_embedded: FxHashSet<((Vec<u8>, Vec<u8>), Vec<u8>, bool)> =
        FxHashSet::default();
    // A file that is only asked about is embedded without its bytes. One that another call reads has them, wherever that call stands.
    for &file in &files_that_name_paths {
        let folder = dirname::<Posix>(files.module(file).file_name());
        for read in list_reads(file) {
            let path = read.path;
            let is_query = read.is_query && !provider.is_searched_for(to_native(&path));
            let is_code = (files.by_path.get(&path)).is_some_and(|found| !sources.is_data(found));
            if let (false, Some(entry)) = (is_code, entry)
                && !is_in_left_out_code(files, left_out, file, read.operand)
            {
                let module = path_of(file);
                provider.embed_file_implicitly(entry, module, to_native(&path), is_query);
                if read.is_listing && folders_embedded.insert((folder.to_vec(), path.clone())) {
                    for listed in provider.list_files_to_embed(to_native(&path), true) {
                        let from = (entry, module);
                        if embed_unless_code(files, sources, provider, from, &listed, false) {
                            named_files.add(file, read.operand, listed);
                        }
                    }
                }
            }
        }
        let analysis = files.analysis(file);
        for named in analysis.named_paths {
            let path = from_argument(folder, files.atoms.bytes(named.path));
            if files.by_path.get(&path).is_none()
                && !is_in_left_out_code(files, left_out, file, named.operand)
                && provider.embed_named_file(path_of(file), to_native(&path))
            {
                named_files.add(file, named.operand, to_native(&path).to_vec());
            }
        }
        let patterns = analysis.module_relative_patterns.iter();
        for &(operand, prefix, suffix) in patterns.chain(analysis.patterns_ruled_out) {
            let (prefix, suffix) = (files.atoms.bytes(prefix), files.atoms.bytes(suffix));
            let Some((pattern, entry)) = PathPattern::new(folder, prefix, suffix).zip(entry) else {
                continue;
            };
            let is_any_own_file = !pattern.names_folder && pattern.matches_every_file();
            if is_any_own_file || is_in_left_out_code(files, left_out, file, operand) {
                continue;
            }
            let is_query = analysis.path_queries.binary_search(&operand).is_ok();
            let start = (folder.to_vec(), pattern.start.clone());
            if !patterns_embedded.insert((start, suffix.to_vec(), is_query)) {
                continue;
            }
            let from = (entry, path_of(file));
            let below = pattern.names_folder;
            for found in provider.list_files_to_embed(to_native(&pattern.folder), below) {
                if pattern.matches(&found)
                    && embed_unless_code(files, sources, provider, from, &found, is_query)
                {
                    named_files.add(file, operand, found);
                }
            }
        }
    }
    let kept = files.compiled_files().iter().filter(|&&file| is_kept(file));
    let module_paths: Vec<&[u8]> = kept.map(|&file| path_of(file)).collect();
    let nearer = provider.fill_package_json_gaps(&module_paths);
    // What is noted is still embedded: a `package.json` goes out again where a nearer one can't be embedded.
    let is_noted = |path: &[u8]| lists_files && provider.is_embedded_implicitly(path, false);
    for (file, operand, path) in searched.iter().filter(|it| is_noted(&it.2)) {
        let span = Span::of_node(files.hir(*file), *file, NodeData::Expr(*operand));
        let name = compute_display_path(project_root, path);
        let code = Code::PackageJsonEmbeddedImplicitly;
        diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[&name]));
    }
    for (path, found) in nearer.iter().filter(|it| is_noted(&it.0)) {
        let name = compute_display_path(project_root, path);
        let found = compute_display_path(project_root, found);
        let code = Code::NearerPackageJsonEmbedded;
        diagnostics.add(Some(view), Diagnostic::new(code, None, &[&name, &found]));
    }
    let manifests = searched.into_iter().map(|it| it.2);
    let manifests = manifests.chain(nearer.into_iter().map(|it| it.0));
    let mut noted: FxHashSet<Vec<u8>> = manifests.collect();
    let (mut created, mut listers) = (None, None);
    for &file in &files_that_name_paths {
        let folder = dirname::<Posix>(files.module(file).file_name());
        let mut names_build_paths = None;
        let reads = list_reads(file);
        for read in &reads {
            let (operand, path) = (read.operand, &read.path);
            let is_query = read.is_query && !provider.is_searched_for(to_native(path));
            let is_code = (files.by_path.get(path)).is_some_and(|found| !sources.is_data(found));
            if !is_code && provider.is_embedded_implicitly(to_native(path), is_query) {
                if !lists_files || is_in_left_out_code(files, left_out, file, operand) {
                    continue;
                }
                if is_query {
                    named_files.add(file, operand, to_native(path).to_vec());
                    continue;
                }
                let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
                let name = compute_display_path(project_root, to_native(path));
                let code = Code::FileEmbeddedImplicitly;
                diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[&name]));
                noted.insert(to_native(path).to_vec());
                continue;
            }
            if read.is_ruled_out {
                continue;
            }
            let module = path_of(file);
            let is_not_embedded = !is_code
                && (provider.is_embeddable_only_by_asset(module, to_native(path))
                    || read.is_listing && is_excluded_folder(files, sources, provider, path, None));
            let may_not_be_embedded = !is_code
                && !is_not_embedded
                && provider.is_embedding_undecided(module, to_native(path));
            if !is_not_embedded && !may_not_be_embedded {
                let module = to_native(files.module(file).file_name());
                let is_unreachable_asset = !is_code
                    && graph.kind(file) == ModuleKind::SourceText
                    && provider.is_asset_unreachable(module, to_native(path))
                    && !*names_build_paths
                        .get_or_insert_with(|| names_build_machine_paths(files, file))
                    && !is_in_left_out_code(files, left_out, file, operand);
                if is_unreachable_asset {
                    let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
                    let name = compute_display_path(project_root, to_native(path));
                    let code = Code::EmbeddedFileUnreachable;
                    diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[&name]));
                }
                continue;
            }
            if is_in_left_out_code(files, left_out, file, operand) {
                continue;
            }
            if is_within_other_read(files, file, &reads, read) {
                continue;
            }
            let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
            let name = compute_display_path(project_root, to_native(path));
            let link = provider.find_symlink_in_asset(to_native(path));
            let link = link.map(|link| compute_display_path(project_root, &link));
            let warning = match &link {
                Some(link) => {
                    Diagnostic::new(Code::FileBehindAssetSymlink, Some(span), &[&name, link])
                }
                None => Diagnostic::new(Code::UnembeddedFileRead, Some(span), &[&name]),
            };
            match is_not_embedded {
                true => diagnostics.add(Some(view), warning),
                false => {
                    if let Some(warning) = Diagnostics::render(view, warning) {
                        provider.warn_if_not_embedded(to_native(path), warning);
                    }
                }
            }
        }
        let analysis = files.analysis(file);
        let mut named = find_excluded_named_paths(view, left_out, file, &reads, provider);
        named.extend(find_searches_missing_manifests(
            files, graph, left_out, file, provider,
        ));
        let listers = listers.get_or_insert_with(|| find_listers(files, left_out, provider));
        named.extend(find_folders_listed_in_part(
            view, graph, left_out, file, listers, provider,
        ));
        for (operand, path, code) in named {
            let created = created.get_or_insert_with(|| collect_paths_created(files));
            let holds_module = is_at_or_below(files.module(file).file_name(), &path);
            let is_created =
                (created.iter()).any(|it| is_at_or_below(it, &path) || is_at_or_below(&path, it));
            if is_created && !holds_module {
                continue;
            }
            let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
            let name = compute_display_path(project_root, to_native(&path));
            let name = match &name[..] {
                b"" => b".",
                name => name,
            };
            let warning = Diagnostic::new(code, Some(span), &[name]);
            diagnostics.add(Some(view), warning);
        }
        for &(operand, prefix, suffix) in analysis.module_relative_patterns {
            let (prefix, suffix) = (files.atoms.bytes(prefix), files.atoms.bytes(suffix));
            let is_query = || analysis.path_queries.binary_search(&operand).is_ok();
            let Some(pattern) = PathPattern::new(folder, prefix, suffix) else {
                continue;
            };
            if is_query() || is_in_left_out_code(files, left_out, file, operand) {
                continue;
            }
            let paths = if pattern.names_folder {
                let is_left_out =
                    is_excluded_folder(files, sources, provider, &pattern.folder, Some(&pattern));
                Vec::from_iter(is_left_out.then(|| pattern.folder.clone()))
            } else if !pattern.matches_every_file() || lists_own_folder(files, file, &reads) {
                list_excluded_own_files(files, sources, provider, path_of(file), &pattern)
            } else {
                Vec::new()
            };
            for path in paths {
                let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
                let name = compute_display_path(project_root, to_native(&path));
                let warning = Diagnostic::new(Code::UnembeddedFileRead, Some(span), &[&name]);
                diagnostics.add(Some(view), warning);
            }
        }
    }
    if lists_files {
        named_files.describe(diagnostics, view, project_root, provider, noted);
    }
}

fn collect_paths_created(files: &Files<'_>) -> Vec<Vec<u8>> {
    let mut created = Vec::new();
    for &file in files.compiled_files() {
        let folder = dirname::<Posix>(files.module(file).file_name());
        let paths = files.analysis(file).paths_created.iter();
        created.extend(paths.map(|&it| from_argument(folder, files.atoms.bytes(it))));
    }
    created
}

fn is_at_or_below(descendant: &[u8], ancestor: &[u8]) -> bool {
    (descendant.strip_prefix(ancestor))
        .is_some_and(|below| below.is_empty() || below[0] == b'/' || ancestor.ends_with(b"/"))
}

/// The folders of the installed packages that list a folder whose path is not known: `fs.readdirSync(folder)`.
fn find_listers(
    files: &Files<'_>,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
) -> FxHashSet<Vec<u8>> {
    let lists = |&&file: &&FileId| {
        let analysis = files.analysis(file);
        (analysis.unknown_path_reads.iter()).any(|operand| {
            analysis.path_listings.binary_search(operand).is_ok()
                && !is_in_left_out_code(files, left_out, file, *operand)
        })
    };
    let is_kept = |&&file: &&FileId| left_out.files.binary_search(&file).is_err();
    let lister = files.compiled_files().iter().filter(is_kept).filter(lists);
    lister
        .filter_map(|&file| provider.find_package_folder(to_native(files.module(file).file_name())))
        .collect()
}

/// Folders of a package that it hands on where it, or a package that it loads, is one of `listers`, and of which the executable holds some files alone.
fn find_folders_listed_in_part(
    view: ProgramView<'_, '_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    file: FileId,
    listers: &FxHashSet<Vec<u8>>,
    provider: &dyn SourceProvider,
) -> Vec<(ExprId, Vec<u8>, Code)> {
    let (files, sources) = (view.files(), view.sources);
    let package_of =
        |file: FileId| provider.find_package_folder(to_native(files.module(file).file_name()));
    let lists = |file: FileId| package_of(file).is_some_and(|it| listers.contains(&it));
    let analysis = files.analysis(file);
    let loads_lister = || {
        let mut loaded = graph.requests(file).iter();
        loaded.any(|it| matches!(it.target, ModuleRef::File(target) if lists(target)))
    };
    let hands_on = !analysis.own_folder_arguments.is_empty() || !analysis.named_paths.is_empty();
    if !hands_on || package_of(file).is_none() || !(lists(file) || loads_lister()) {
        return Vec::new();
    }
    let folder = dirname::<Posix>(files.module(file).file_name());
    // `path.join(__dirname, "lib")` hands on the folder that it names.
    let is_named = |operand: ExprId| analysis.named_paths.iter().any(|it| it.operand == operand);
    let own = (analysis.own_folder_arguments.iter()).filter(|it| !is_named(it.0));
    let own = own.map(|&(operand, callee)| (operand, callee, folder.to_vec()));
    let named = analysis
        .named_paths
        .iter()
        .filter(|it| !it.is_needed_on_disk);
    let named = named.map(|it| {
        let path = from_argument(folder, files.atoms.bytes(it.path));
        (it.operand, it.callee, path)
    });
    let is_there = |path: &Vec<u8>| {
        let is_code = |found: FileId| !sources.is_data(found);
        files.by_path.get(&from_native(path)).is_some_and(is_code)
            || provider.is_embedded_implicitly(path, false)
    };
    let is_in_part = |path: &[u8]| {
        let listed = provider
            .list_excluded_folder(to_native(path))
            .unwrap_or_default();
        listed.iter().any(is_there) && !listed.iter().all(is_there)
    };
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut found = Vec::new();
    for (operand, callee, path) in own.chain(named) {
        let is_builtin = |callee: ExprId| is_builtin_function(files, graph, file, callee);
        if callee.is_some_and(|it| !is_builtin(it))
            && !is_in_left_out_code(files, left_out, file, operand)
            && is_in_part(&path)
            && seen.insert(path.clone())
        {
            found.push((operand, path, Code::FolderListedInPart));
        }
    }
    found
}

/// `operand` is the value in `name = operand`, as in the next step of a loop that climbs by itself: `folder = path.dirname(folder)`.
fn is_assigned_to_variable(files: &Files<'_>, file: FileId, operand: ExprId) -> bool {
    let hir = files.hir(file);
    let Parent::Expr(above) = files.bound(file).parent_of_expr(operand) else {
        return false;
    };
    matches!(hir[above].kind, ExprKind::Assign { op: None, target, value }
        if value == operand && matches!(hir[target].kind, ExprKind::Ident(_)))
}

/// Folders that a file of a package hands to code which may search from them and would find another `package.json` in the executable: `find(path.join(__dirname, ".."))`.
fn find_searches_missing_manifests(
    files: &Files<'_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    file: FileId,
    provider: &dyn SourceProvider,
) -> Vec<(ExprId, Vec<u8>, Code)> {
    let module = files.module(file).file_name();
    let folder = dirname::<Posix>(module);
    let mut seen: FxHashSet<Atom> = FxHashSet::default();
    let mut found = Vec::new();
    for named in files.analysis(file).named_paths {
        // A method of some value and a global function are taken for the language's own: `list.push(..)`, `new Error(..)`.
        let is_name_of_file = |callee: ExprId| {
            matches!(files.bound(file).binding(callee), Binding::Symbol(_))
                && !is_builtin_function(files, graph, file, callee)
        };
        let may_search = named.is_passed_to_package || named.callee.is_none_or(is_name_of_file);
        let is_next_step =
            named.callee.is_none() && is_assigned_to_variable(files, file, named.operand);
        if named.is_needed_on_disk || !may_search || is_next_step {
            continue;
        }
        let path = from_argument(folder, files.atoms.bytes(named.path));
        if provider.search_misses_manifest(to_native(module), to_native(&path))
            && !is_in_left_out_code(files, left_out, file, named.operand)
            && seen.insert(named.path)
        {
            found.push((named.operand, path, Code::SearchMissesPackageJson));
        }
    }
    found
}

/// Paths that a file of the project passes to code which may read them: `express.static(path.join(import.meta.dirname, "public"))`.
fn find_excluded_named_paths(
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    file: FileId,
    reads: &[FileRead],
    provider: &dyn SourceProvider,
) -> Vec<(ExprId, Vec<u8>, Code)> {
    let (files, sources) = (view.files(), view.sources);
    let module = files.module(file).file_name();
    let is_of_project = provider.is_own_module_of_project(to_native(module));
    let folder = dirname::<Posix>(module);
    let mut found = Vec::new();
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    for named in files.analysis(file).named_paths {
        let code = match (named.is_needed_on_disk, named.is_passed_to_package) {
            (true, _) => Code::PathNeededOnDisk,
            (false, true) if is_of_project => Code::NamedPathNotEmbedded,
            _ => continue,
        };
        let path = from_argument(folder, files.atoms.bytes(named.path));
        let is_code = (files.by_path.get(&path)).is_some_and(|found| !sources.is_data(found));
        let is_around_module = is_at_or_below(module, &path) && !named.becomes_working_folder;
        if is_around_module || is_code || !seen.insert(path.clone()) {
            continue;
        }
        let is_left_out = match code {
            Code::PathNeededOnDisk => provider.is_on_disk(to_native(module), to_native(&path)),
            _ => {
                let holds_files = || {
                    let listed = provider.list_excluded_folder(to_native(&path));
                    listed.is_some_and(|it| !it.is_empty())
                        && is_excluded_folder(files, sources, provider, &path, None)
                };
                !reads.iter().any(|it| it.path == path && !it.is_ruled_out)
                    && (provider.is_embeddable_only_by_asset(to_native(module), to_native(&path))
                        || holds_files())
            }
        };
        if is_left_out && !is_in_left_out_code(files, left_out, file, named.operand) {
            found.push((named.operand, path, code));
        }
    }
    found
}

/// `from` is the entry and the module that reads `path`.
fn embed_unless_code(
    files: &Files<'_>,
    sources: &Sources,
    provider: &dyn SourceProvider,
    from: (&[u8], &[u8]),
    path: &[u8],
    is_query: bool,
) -> bool {
    let found = files.by_path.get(&from_native(path));
    found.is_none_or(|found| sources.is_data(found))
        && provider.embed_file_implicitly(from.0, from.1, path, is_query)
}

/// In the executable `node:fs` lists every compiled file.
fn keep_paths_of_code_that_file_system_sees(
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
) {
    let (files, sources) = (view.files(), view.sources);
    for &file in files.compiled_files() {
        let is_seen = !sources.is_data(file) && left_out.files.binary_search(&file).is_err();
        if is_seen {
            provider
                .keep_path_of_code_that_file_system_sees(to_native(files.module(file).file_name()));
        }
    }
}

fn keep_where_parsers_refused_data(
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
) {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    for &file in files.compiled_files().iter().filter(|&&file| is_kept(file)) {
        let source = parsed_source(files, file);
        let Some((loader, place)) = source.and_then(|it| it.refused_at.as_ref()) else {
            continue;
        };
        let said_by_bun_run = source
            .and_then(|it| it.parse_failure.as_deref())
            .filter(|&it| it == JSON_PARSE_ERROR_FOR_BLANK_TEXT);
        let paths = sources.module_paths(file);
        let message = [
            &b"\""[..],
            paths.display_path,
            b"\" could not be parsed as ",
            type_attribute_of(*loader).as_bytes(),
        ];
        provider.keep_where_text_is_refused(&RefusedText {
            path: paths.public_path,
            is_syntax_error: *loader == Loader::Json,
            message: said_by_bun_run.unwrap_or(&message.concat()),
            line: place.line,
            column: place.column,
            offset: place.offset,
            length: place.length,
        });
    }
}

struct BoundGraph {
    graph: ModuleGraph,
    left_out: LeftOutCode,
    known_helpers: KnownHelpers,
}

impl BoundGraph {
    fn with_builtin_types(self, builtin_types: BuiltinTypeSymbols) -> BoundProject {
        BoundProject {
            graph: self.graph,
            left_out: self.left_out,
            known_helpers: self.known_helpers,
            builtin_types,
            page_manifests: Vec::new(),
        }
    }
}

impl Build<'_> {
    fn runner_starts_entry_points(&self) -> bool {
        self.options.load.runs_tests
    }

    pub(crate) fn bind_modules(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
    ) -> Result<BoundBuild, Stage> {
        self.clock.start(Stage::BindModules);
        let platform = self.platform;
        let mut steps = StepClock::new(Stage::BindModules);
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        steps.end("deferred exports");
        let projects = loaded.projects.as_ref();
        let files = projects.map(|_, project| project.loaded.files());
        let find_builtin_types = move || {
            let types = builtin_type_paths();
            files.map(|_, files| {
                let values = Box::new(move || BuiltinValuePaths::list_of(platform));
                BuiltinTypeSymbols::compute(files, &types, values)
            })
        };
        let (builtin_types, (application, runtime)) = run_steps_beside(
            &self.beside_runner(),
            &mut steps,
            ["types of built-ins", "both projects"],
            find_builtin_types,
            || {
                let application =
                    self.bind_project(loaded, ProjectId::Application, &deferred_exports, &[]);
                let mocked = application.graph.mocked_library_modules();
                let runtime =
                    self.bind_project(loaded, ProjectId::Runtime, &deferred_exports, mocked);
                (application, runtime)
            },
        );
        self.say_why_forms_under_written_types_are_refused(loaded, &application.graph);
        let page_manifests = self.bundle_pages(loaded, &application.graph);
        if application.graph.errors().is_empty() {
            let provider = self.provider;
            let _ = loaded
                .messages
                .with_log(|log| provider.check_embedded_files(log));
            self.diagnostics.add_load_messages(loaded.messages);
        }
        steps.end("pages, embedded files");
        Ok(BoundBuild {
            projects: PerProject {
                application: BoundProject {
                    page_manifests,
                    ..application.with_builtin_types(builtin_types.application)
                },
                runtime: runtime.with_builtin_types(builtin_types.runtime),
            },
        })
    }

    fn say_why_forms_under_written_types_are_refused(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        graph: &ModuleGraph,
    ) {
        let files = loaded.project(ProjectId::Application).view().files();
        let said_of = |file: FileId| {
            parsed_source(files, file).and_then(|it| it.said_where_type_is_written.as_ref())
        };
        let compiled = files.compiled_files().iter().copied();
        let refused: Vec<FileId> = compiled.filter(|&file| said_of(file).is_some()).collect();
        if refused.is_empty() {
            return;
        }
        let named_by_load_sites = graph.find_files_named_by_load_sites();
        for said in (refused.into_iter())
            .filter(|file| named_by_load_sites.binary_search(file).is_ok())
            .filter_map(said_of)
        {
            said.hand_on_to(loaded.messages);
        }
        self.diagnostics.add_load_messages(loaded.messages);
    }

    fn describe_guesses(
        &mut self,
        view: ProgramView<'_, '_>,
        graph: &ModuleGraph,
        left_out: &LeftOutCode,
        contents: &ProgramContents,
    ) {
        let project_root = &self.options.load.project_root;
        let is_kept = |file: &FileId| left_out.files.binary_search(file).is_err();
        let mut names = find_guessed_names(
            view.files(),
            self.options.entry_points.len(),
            &contents.found_entry_points,
            &self.files_of_guesses,
        );
        names.retain(|file, _| is_kept(file));
        let lists_places = self.options.aot.explain.contains(ExplainSet::TEXT);
        for note in describe_guessed_files(view, project_root, &names, lists_places) {
            self.diagnostics.add(Some(view), note);
        }
        for &file in self.files_of_guesses.iter().filter(|file| is_kept(file)) {
            let failures = graph.failures().iter().filter(|it| it.importer == file);
            let mut reasons = failures.filter_map(|it| describe_silent_failure(view, it));
            if let Some(reason) = reasons.next() {
                let warning = refuse_guessed_file(view, project_root, file, &reason);
                self.diagnostics.add(Some(view), warning);
            }
        }
    }

    /// The files of guesses that the program doesn't name in a type either.
    fn find_files_without_type_references(
        &self,
        files: &Files<'_>,
        contents: &ProgramContents,
    ) -> Vec<FileId> {
        if self.files_of_guesses.is_empty() {
            return Vec::new();
        }
        let found = contents.found_entry_points.iter();
        let is_guess = found.map(|it| it.is_guess);
        let written = self.options.entry_points.iter().map(|_| false);
        let entry_points = files.entry_points().iter().zip(written.chain(is_guess));
        let sure = entry_points.filter(|it| !it.1).map(|it| *it.0).collect();
        let is_named = files.reached_from(sure);
        let mut guessed = self.files_of_guesses.clone();
        guessed.retain(|file| !is_named[file.idx()]);
        guessed
    }

    fn bundle_pages(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        graph: &ModuleGraph,
    ) -> Vec<(FileId, Vec<u8>)> {
        let has_no_bundle = self.options.load.runs_tests || self.options.aot.runs_in_place;
        if has_no_bundle || !graph.errors().is_empty() {
            return Vec::new();
        }
        let view = loaded.project(ProjectId::Application).view();
        let (files, sources) = (view.files(), view.sources);
        let is_page = |file: &FileId| {
            sources.is_data(*file)
                && sources.loader(*file) == Loader::Html
                && !graph.is_left_out(ModuleRef::File(*file))
        };
        let compiled = files.compiled_files().iter().copied();
        let mut pages: Vec<FileId> = compiled.filter(is_page).collect();
        if pages.is_empty() {
            return Vec::new();
        }
        let named_by_load_sites = graph.find_files_named_by_load_sites();
        pages.retain(|page| {
            let mut entry_points = sources.entry_points().iter();
            named_by_load_sites.binary_search(page).is_ok()
                || entry_points.any(|entry_point| entry_point.file == *page)
        });
        pages.sort_unstable();
        let path_of = |&page: &FileId| {
            let source = parsed_source(files, page);
            match source.and_then(|source| source.plugin_module.as_ref()) {
                Some(module) => &*module.path,
                None => sources.diagnostic_path(page),
            }
        };
        let provider = self.provider;
        let bundle = |pages: &[FileId], log: &mut Log| {
            let paths: Vec<&[u8]> = pages.iter().map(path_of).collect();
            provider.bundle_pages(&paths, log)
        };
        let mut said = Log::init();
        let mut manifests = bundle(&pages, &mut said);
        let is_guessed = |page: &FileId| self.files_of_guesses.binary_search(page).is_ok();
        if manifests.is_err() && pages.iter().any(is_guessed) {
            let (guessed, sure) = pages.into_iter().partition(is_guessed);
            let guessed: Vec<FileId> = guessed;
            pages = sure;
            let mut said_of_sure = Log::init();
            manifests = bundle(&pages, &mut said_of_sure);
            if manifests.is_ok() {
                let sentence = first_error_of(&said);
                warn_instead_of_errors(&mut said);
                loaded.messages.say(&mut said);
                let refused = &mut self.refused_guessed_files;
                refused.extend(guessed.into_iter().map(|page| (page, sentence.clone())));
                refused.sort_unstable();
            }
            said = said_of_sure;
        }
        loaded.messages.say(&mut said);
        self.diagnostics.add_load_messages(loaded.messages);
        let Ok(manifests) = manifests else {
            return Vec::new();
        };
        assert_eq!(manifests.len(), pages.len(), "one manifest for each page");
        pages.into_iter().zip(manifests).collect()
    }

    fn bind_project(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        project: ProjectId,
        deferred_exports: &DeferredExports,
        mocked_library_modules: &[RuntimeModule],
    ) -> BoundGraph {
        let in_parallel = self.parallel_runner();
        let beside = self.beside_runner();
        let view = loaded.project(project).view();
        let contents = loaded.contents;
        let external_packages: &[Vec<u8>] = match project {
            ProjectId::Application => &self.options.load.externals.packages,
            ProjectId::Runtime => &[],
        };
        let written_entry_point_count = match project {
            ProjectId::Application => self.options.entry_points.len(),
            ProjectId::Runtime => view.files().entry_points().len(),
        };
        let mut steps = StepClock::new(Stage::BindModules);
        let project_name = match project {
            ProjectId::Application => "application",
            ProjectId::Runtime => "library",
        };
        let mut known_helpers = KnownHelpers::compute_below_added_names(
            view.files(),
            &contents.names_added_to_builtins,
            &in_parallel,
        );
        known_helpers.keep_private_states_in_collections(&contents.replaced_builtins);
        steps.end_with(|| format!("{project_name}: known helpers"));
        let run_of_library = crate::test_runs::RunContents::default();
        let plugin_answers_for_names_left_to_host = project == ProjectId::Application
            && !self.options.load.runs_tests
            && !self.options.load.externals.is_empty()
            && crate::load::contents::load_names::names_plugin(view.files());
        let files_are_named_out_of_sight =
            self.options.code_from_disk_names_files() || plugin_answers_for_names_left_to_host;
        let BoundModules { mut graph } = modules::bind_modules(&BindInput {
            files: view.files(),
            sources: view.sources,
            builtin_names: loaded.builtin_names,
            deferred_exports,
            known_helpers: &known_helpers,
            platform: self.platform,
            external_packages,
            replaced_builtins: &contents.replaced_builtins,
            names_added_to_builtins: &contents.names_added_to_builtins,
            runs_in_place: self.options.aot.runs_in_place,
            ignores_declared_side_effects: self.options.code.ignores_declared_side_effects,
            mocks_any_module: project == ProjectId::Application && contents.mocks_any_module,
            mocked_library_modules,
            hands_on_any_module: contents.loads_by_unknown_name
                || contents.loads_by_unknown_path
                || (project == ProjectId::Application
                    && (contents.run.loader_functions_answer_requires
                        || self.options.aot.admits_inspector)),
            any_module_loads_again: self.options.load.runs_tests && contents.any_module_loads_again,
            runs_tests: self.options.load.runs_tests,
            runner_starts_entry_points: project == ProjectId::Application
                && self.runner_starts_entry_points(),
            written_entry_point_count,
            entry_points_run_again: project == ProjectId::Application
                && self.options.aot.entry_points_run_again,
            typescript_drops_absent_exports: project == ProjectId::Application
                && self.options.aot.typescript_drops_absent_exports,
            runs_in_several_realms: project == ProjectId::Application
                && self.options.aot.runs_in_several_realms,
            files_are_named_out_of_sight: files_are_named_out_of_sight
                && !self.stays_in_compiled_files,
            helpers_of_tests_name_files: self.options.load.runs_tests
                && !self.stays_in_compiled_files,
            run: match project {
                ProjectId::Application => &contents.run,
                ProjectId::Runtime => &run_of_library,
            },
            in_parallel: &in_parallel,
            beside: &beside,
        });
        if project == ProjectId::Application
            && crate::load::contents::load_names::mentions_plugin(view.files())
        {
            self.started_workers.names_plugin = true;
            if self.options.load.runs_tests {
                graph.set_lists_names_of_statements();
            }
        }
        if project == ProjectId::Application && contents.stores_loader_functions {
            graph.set_asks_loader_functions();
        }
        if self.stays_in_compiled_files {
            graph.set_closed_world();
        }
        if crate::load::contents::load_names::does_some_file_answer_for_names(view.files()) {
            graph.set_answers_for_names_itself();
        }
        steps.end_with(|| format!("{project_name}: bind modules"));
        self.diagnostics.add_module_failures(view, &graph);
        let runs_tests = self.options.load.runs_tests;
        let files = view.files();
        let compiled = files.compiled_files().iter().copied();
        for file in compiled.filter(|&file| !files.analysis(file).errors.is_empty()) {
            let throws_its_error = graph.load_failure(file).is_some()
                || (graph.kind(file) == ModuleKind::CommonJs
                    && may_fail_where_loaded(project, runs_tests, &graph, file));
            if !throws_its_error {
                self.diagnostics.add_fold_errors(view, file);
            }
        }
        steps.end_with(|| format!("{project_name}: failures of modules, errors of folding"));
        let left_out = match project {
            ProjectId::Application if graph.errors().is_empty() => {
                let files_are_named_out_of_sight = !self.options.load.runs_tests
                    && !graph.importers_of_uncompiled_code().is_empty()
                    && (self.options.aot.runs_in_place || files_are_named_out_of_sight);
                let entry_points = view.files().entry_points().iter().copied();
                let mut files_started_by_runner: Vec<_> = entry_points
                    .take(written_entry_point_count)
                    .filter(|_| self.runner_starts_entry_points())
                    .collect();
                files_started_by_runner.sort_unstable();
                let workers = view.files().entry_points().iter().copied();
                let workers = workers
                    .skip(written_entry_point_count)
                    .zip(&contents.found_entry_points)
                    .filter(|(_, found)| found.because.is_for_worker())
                    .map(|(file, _)| file);
                let written = view.files().entry_points().iter().copied();
                let mut files_with_kept_imports: Vec<FileId> = written
                    .take(written_entry_point_count)
                    .chain(workers)
                    .collect();
                files_with_kept_imports.sort_unstable();
                let found = view.files().entry_points().get(written_entry_point_count..);
                let found = found
                    .unwrap_or_default()
                    .iter()
                    .zip(&contents.found_entry_points);
                let mut starts_of_workers: Vec<(FileId, ExprId, FileId)> = found
                    .flat_map(|(&entry_point, found)| {
                        let starts = found.starts.iter();
                        starts.map(move |&(file, at)| (file, ExprId(at), entry_point))
                    })
                    .collect();
                starts_of_workers
                    .sort_unstable_by_key(|&(file, at, entry_point)| (file, at.0, entry_point));
                // What the build compiles only because a Worker may start it is no root of the program's own.
                let host = loaded.project(project).host;
                let found_entry_points = view.files().entry_points().iter().copied();
                let seeded_last: Vec<FileId> = found_entry_points
                    .skip(written_entry_point_count)
                    .zip(&contents.found_entry_points)
                    .filter(|&(file, found)| {
                        let name = view.files().module(file).file_name();
                        let may_start = crate::load::contents::FoundBecause::MayStartWorker;
                        let waits_for_sure_starts = found.because == may_start
                            && !found.starts.is_empty()
                            && crate::load::is_in_node_modules(name);
                        host.is_evaluated_text(name) || waits_for_sure_starts
                    })
                    .map(|(file, _)| file)
                    .collect();
                let input = ProgramReachInput {
                    files: view.files(),
                    sources: view.sources,
                    graph: &graph,
                    known_helpers: &known_helpers,
                    removable: self.options.removable,
                    counts_executions: self.options.aot.counts_executions,
                    any_file_is_named_at_run_time: files_are_named_out_of_sight
                        || self.options.aot.admits_inspector
                        || (!self.stays_in_compiled_files && self.options.load.runs_tests),
                    files_are_named_out_of_sight,
                    admits_inspector: self.options.aot.admits_inspector,
                    isolates_code_from_disk: self.options.aot.isolates_code_from_disk,
                    mocks_any_module: contents.mocks_any_module || contents.stores_loader_functions,
                    files_started_by_runner: &files_started_by_runner,
                    files_with_kept_imports: &files_with_kept_imports,
                    starts_of_workers: &starts_of_workers,
                    beside: &beside,
                };
                let lists_program_files = !self.options.aot.runs_in_place;
                steps.end_with(|| format!("{project_name}: what is asked ahead of the reach"));
                let (program_files, (left_out, reached)) = run_steps_beside(
                    &beside,
                    &mut steps,
                    ["paths of the files of the program", "find left out code"],
                    || match lists_program_files {
                        true => collect_program_file_paths(view.files(), view.sources),
                        false => Vec::new(),
                    },
                    || find_left_out_code_seeding_last(&input, &seeded_last, &in_parallel),
                );
                let alone = &left_out.files_alive_through_last_seeds_alone;
                let guessed = self.find_files_without_type_references(view.files(), contents);
                (loaded.project(project).loaded).settle_origins(alone, &guessed);
                let held = program_files.into_iter();
                let held = held.filter(|(file, _)| left_out.files.binary_search(file).is_err());
                self.started_workers.program_files = held.map(|(_, paths)| paths).collect();
                if !self.options.aot.runs_in_place {
                    self.started_workers.names_followed = collect_names_followed(
                        view.files(),
                        view.sources,
                        &graph,
                        &left_out.files,
                        &in_parallel,
                    );
                }
                self.adjacent_web_assembly =
                    find_adjacent_web_assembly(view.files(), &left_out, self.provider);
                for &module in &reached.looked_at {
                    if let crate::modules::ModuleRef::File(file) = module {
                        assert!(
                            !graph.leaves_out_star_names(file),
                            "something looks at the object of {}, and nobody was seen to ask for all that `export *` brings it",
                            bstr::BStr::new(view.sources.module_paths(file).display_path),
                        );
                    }
                }
                finish_modules(&mut graph, &reached, &left_out.files);
                if reached.stores_loader_function {
                    graph.set_computed_names_ask_loader_functions();
                }
                steps.end_with(|| format!("{project_name}: finish modules"));
                if !self.options.load.runs_tests {
                    for &replaced in &reached.replaced_loader_hooks {
                        let ReplacedLoaderHook {
                            file,
                            assignment,
                            hook,
                        } = replaced;
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(assignment));
                        let code = Code::LoaderFunctionNotAsked;
                        let warning = Diagnostic::new(code, Some(span), &[hook.name()]);
                        self.diagnostics.add(Some(view), warning);
                    }
                }
                if !self.options.load.runs_tests && !self.options.aot.runs_in_place {
                    for &(file, entry) in &reached.deletions_from_module_cache {
                        if key_names_no_file_of_program(view.files(), file, entry) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(entry));
                        let code = Code::DeletionFromModuleCacheDoesNothing;
                        let warning = Diagnostic::new(code, Some(span), &[]);
                        self.diagnostics.add(Some(view), warning);
                    }
                    for &(file, entry) in &reached.stores_into_module_cache {
                        if key_names_no_file_of_program(view.files(), file, entry) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(entry));
                        let code = Code::EntryStoredInModuleCacheIsNotAsked;
                        let warning = Diagnostic::new(code, Some(span), &[]);
                        self.diagnostics.add(Some(view), warning);
                    }
                    let linked = LinkedProject {
                        files: view.files(),
                        graph: &graph,
                        builtin_names: loaded.builtin_names,
                        platform: self.platform,
                        library: None,
                        known_helpers: None,
                    };
                    for &(file, place) in &reached.places_that_hand_module_cache_on {
                        if !hands_module_cache_to_code_out_of_sight(&linked, file, place) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(place));
                        let code = Code::ModuleCacheIsHandedOn;
                        let warning = Diagnostic::new(code, Some(span), &[]);
                        self.diagnostics.add(Some(view), warning);
                    }
                }
                let may_spell_root_folders = !reached.found_by_name.is_empty()
                    || self.started_workers.levels_above_root > 0
                    || self.provider.embeds_assets();
                if may_spell_root_folders {
                    self.started_workers.root_folders_spelled = find_root_folders_spelled(
                        view.files(),
                        view.sources,
                        &from_native(&self.options.paths.root_directory),
                        &in_parallel,
                    );
                }
                steps.end_with(|| format!("{project_name}: root folders that paths spell"));
                warn_where_modules_are_reset(&mut self.diagnostics, view, &left_out);
                let without_file = std::mem::take(&mut self.missing_node_workers);
                let resolves = std::mem::take(&mut self.resolves_that_miss);
                for warning in without_file.into_iter().chain(resolves) {
                    let is_unreached = |span| lies_in_left_out_code(view.files(), &left_out, span);
                    if !warning.span.is_some_and(is_unreached) {
                        self.diagnostics.add(Some(view), warning);
                    }
                }
                self.diagnostics.forgive_unasked_comments(|span| {
                    lies_in_left_out_code(view.files(), &left_out, span)
                        || lies_in_dead_code(view.files(), span)
                });
                if !self.options.aot.runs_in_place {
                    let loaders = &self.options.load.loaders;
                    let has_found_data = name_data_files_found_by_patterns(
                        &mut self.diagnostics,
                        view,
                        &left_out,
                        loaders,
                        self.provider,
                        self.options.aot.explain.contains(ExplainSet::TEXT),
                        &in_parallel,
                    );
                    if has_found_data {
                        keep_paths_of_code_that_file_system_sees(view, &left_out, self.provider);
                    }
                    keep_where_parsers_refused_data(view, &left_out, self.provider);
                    if !self.options.load.runs_tests {
                        self.describe_guesses(view, &graph, &left_out, contents);
                        warn_about_unembedded_reads(
                            &mut self.diagnostics,
                            view,
                            &graph,
                            &left_out,
                            &self.options.load.project_root,
                            self.provider,
                            self.options.aot.explain.contains(ExplainSet::TEXT),
                            &in_parallel,
                        );
                    }
                }
                crate::test_run_loads::warn_where_every_file_may_load_again(
                    &mut self.diagnostics,
                    view,
                    &contents.run.loads,
                    &left_out.files,
                );
                steps.end_with(|| format!("{project_name}: warnings"));
                graph.leave_out_files(&left_out.files, &in_parallel);
                for &(_, _, entry_point) in &starts_of_workers {
                    if left_out.files.binary_search(&entry_point).is_ok() {
                        let path = source_path_of(view.files().module(entry_point).file_name());
                        let names = &mut self.started_workers.names;
                        names.retain(|name| name.source_path != path);
                    }
                }
                steps.end_with(|| format!("{project_name}: leave out files"));
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                steps.end_with(|| format!("{project_name}: limit exports"));
                left_out
            }
            ProjectId::Application | ProjectId::Runtime => LeftOutCode::default(),
        };
        graph.finish_plan(&in_parallel);
        steps.end_with(|| format!("{project_name}: finish the plan"));
        if let Some((root, owner)) = graph.find_check_of_copy_that_nothing_stores() {
            let path_of = |file: bun_sema::program::FileId| {
                bstr::BStr::new(view.sources.module_paths(file).display_path)
            };
            let owner = match owner {
                crate::modules::ModuleRef::File(file) | crate::modules::ModuleRef::Facade(file) => {
                    path_of(file)
                }
                _ => bstr::BStr::new("a module that is no file"),
            };
            panic!(
                "{} would look for a name of {owner} before anything has run that file",
                path_of(root),
            );
        }
        BoundGraph {
            graph,
            left_out,
            known_helpers,
        }
    }
}
