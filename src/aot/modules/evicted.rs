//! Which files of a program may run a second time.
//!
//! `delete require.cache[path]` makes the next `require()` or `import()` of the file load it again, and so does a store to the entry. Load says which files a test run
//! takes out (`test_run_loads`), and `test_run_evictions` who leaves with them. Where nobody can say which, one place counts for every module.
//! Without it a CommonJS file still runs again where its last run threw, because `require()` takes such a file out of the cache. That takes somebody who caught the throw.

use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::order::FileText;
use super::requests::{ScannedSite, Scans};
use super::test_run_evictions::{find_files_that_leave, is_among};
use super::{BindInput, ModuleRef};
use crate::builtins::RuntimeModule;
use crate::load::contents::load_names::find_library_modules_stored_in_cache;
use crate::load::sources::parsed_source;
use crate::load::{EntryPointKind, SourceKind};
use crate::test_run_report::say_files_that_may_run_again;
use bun_sema::bind::{Bound, CodeUnit, FnOwner, Parent};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, ExprId, ExprKind, FnId, PatId, PatKind, PropKey, StmtId, StmtKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::FileId;
use core::ops::Range;

#[derive(Default)]
pub(super) struct EvictedModules {
    is_every_module: bool,
    /// `LoadsOfRun::is_any_file_taken_out`. Without it `modules` lists the files that leave though `is_every_module` holds.
    is_any_module_taken_out: bool,
    /// `find_files_that_leave`
    modules: Vec<ModuleRef>,
    is_table_reached: bool,
    library_modules_stored_in_cache: Vec<RuntimeModule>,
}

impl EvictedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || is_among(&self.modules, module)
    }

    /// The module has run and leaves the table of loaded modules, so it may be loaded once more.
    pub(super) fn leaves(&self, module: ModuleRef) -> bool {
        self.is_any_module_taken_out || is_among(&self.modules, module)
    }

    /// Those that are listed, where that is not all of them. Each is a `ModuleRef::File`, ascending.
    pub(super) fn modules(&self) -> &[ModuleRef] {
        &self.modules
    }

    /// `require.cache["fs"] = { exports: fake }`: nobody knows what `require` answers for the module.
    pub(super) fn is_stored_in_cache(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::Runtime(module) if self.library_modules_stored_in_cache.contains(&module))
    }

    pub(super) fn library_modules_stored_in_cache(&self) -> &[RuntimeModule] {
        &self.library_modules_stored_in_cache
    }

    pub(super) fn is_every_module(&self) -> bool {
        self.is_every_module
    }

    /// A file gets at the entries of `require.cache`: it may store other `exports` in the entry that the run time made for a file.
    pub(super) fn is_table_reached(&self) -> bool {
        self.is_table_reached
    }
}

pub(super) fn find_evicted_modules(input: &BindInput<'_, '_>, scans: &Scans) -> EvictedModules {
    let compiled_files = input.files.compiled_files().iter();
    let files_of_program =
        compiled_files.filter(|&&file| input.sources.kind(file) == SourceKind::Program);
    let mut library_modules_stored_in_cache: Vec<RuntimeModule> = files_of_program
        .flat_map(|&file| find_library_modules_stored_in_cache(input.files, file))
        .collect();
    // `require.cache` lists the files of the program in a test run alone.
    if !input.runs_tests {
        return EvictedModules {
            library_modules_stored_in_cache,
            ..EvictedModules::default()
        };
    }
    // Under a key that no file spells whole. The list is the application's.
    if input.runner_starts_entry_points {
        let unspelled = &input.run.loads.library_modules_that_entries_may_answer;
        library_modules_stored_in_cache.extend_from_slice(unspelled);
    }
    let reaches_module_cache = |&file: &FileId| {
        input.sources.kind(file) == SourceKind::Program
            && parsed_source(input.files, file)
                .is_some_and(|source| source.builtins.reaches_module_cache())
    };
    let is_every_module = input.any_module_loads_again;
    let mut files = input.files.compiled_files().iter();
    EvictedModules {
        is_every_module,
        is_any_module_taken_out: is_every_module && input.run.loads.is_any_file_taken_out,
        modules: find_files_that_leave(input, scans),
        is_table_reached: is_every_module || files.any(reaches_module_cache),
        library_modules_stored_in_cache,
    }
}

/// Ascending. A file that is not listed keeps the error of a run that threw, so its body runs once whatever the program does.
pub(super) fn find_files_that_run_again(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    evicted: &EvictedModules,
) -> Vec<ModuleRef> {
    let kind_of = |file: FileId| modules.interop(ModuleRef::File(file)).kind;
    let files = modules.compiled_files.iter().copied();
    let may_load_again = |file: &FileId| {
        evicted.leaves(ModuleRef::File(*file))
            && match input.sources.kind(*file) {
                SourceKind::Program => {
                    matches!(kind_of(*file), ModuleKind::SourceText | ModuleKind::CommonJs)
                }
                SourceKind::Data => true,
                SourceKind::RuntimeModule(_)
                | SourceKind::RuntimeFunctions
                | SourceKind::TypesOnly => false,
            }
    };
    let is_commonjs = |file: FileId| kind_of(file) == ModuleKind::CommonJs;
    if evicted.is_any_module_taken_out || !files.clone().any(|file| is_commonjs(file)) {
        say_files_that_may_run_again(0);
        return files.filter(may_load_again).map(ModuleRef::File).collect();
    }
    let loads = collect_loads(input, scans, modules);
    // The runner of a test run starts the entry points that the build was given. At one that the load has found a Worker starts, or a name finds it.
    let mut is_found_by_load = vec![false; input.files.modules.len()];
    let written_and_found = input.files.entry_points().iter();
    for &file in written_and_found.skip(input.written_entry_point_count) {
        is_found_by_load[file.idx()] = true;
    }
    // A Worker may start at a test file as well, and the load lists no file as found that the build was given. `ProgramContents::names_worker_constructor`
    let names_worker_constructor = |file: FileId| {
        parsed_source(input.files, file)
            .is_none_or(|source| source.contents.names_worker_constructor)
    };
    let may_start_workers =
        input.runner_starts_entry_points && files.clone().any(names_worker_constructor);
    let (mut started, mut possible_loads) = (Vec::new(), Vec::new());
    for entry_point in input.sources.entry_points() {
        let is_started = match entry_point.kind {
            EntryPointKind::Main => true,
            EntryPointKind::Additional => {
                input.runner_starts_entry_points && !is_found_by_load[entry_point.file.idx()]
            }
            EntryPointKind::LoadedByTestRunner
            | EntryPointKind::HostLoadedModule
            | EntryPointKind::ImportedModule
            | EntryPointKind::Library => false,
        };
        // A host that starts an entry point once more has outlived what the first run threw.
        let is_started = is_started && !input.entry_points_run_again;
        // Any other entry point is there to be found by name, by a thread in which nothing has run. A Worker that starts at a test file is such a thread.
        // One that starts at the first file does what the startup does.
        if !is_started || (may_start_workers && !started.is_empty()) {
            possible_loads.push(PossibleLoad {
                earliest_time: 0,
                target: Some(entry_point.file),
                may_be_caught: input.entry_points_run_again,
            });
        }
        if is_started {
            started.push(entry_point.file);
        }
    }
    let start_times = walk_startup(&loads, &started, &is_commonjs, &mut possible_loads);
    let may_first_run_be_caught = find_files_whose_first_run_may_be_caught(
        &loads,
        &modules.compiled_files,
        &start_times,
        possible_loads,
    );
    // A file that leaves runs again anyway, and is not counted.
    let mut after_throw_alone = 0;
    let run_again: Vec<ModuleRef> = files
        .filter(|file| {
            let leaves = may_load_again(file);
            let runs_after_throw = is_commonjs(*file) && may_first_run_be_caught[file.idx()];
            after_throw_alone += usize::from(runs_after_throw && !leaves);
            leaves || runs_after_throw
        })
        .map(ModuleRef::File)
        .collect();
    say_files_that_may_run_again(after_throw_alone);
    run_again
}

const NEVER: u32 = u32::MAX;

/// When a site that loads a file runs, and whether somebody may catch what the file throws.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum LoadTiming {
    /// Every run of the body reaches it, with no handler around it: a throw ends the process.
    Unconditional,
    /// The body may skip it: it is in a branch or a loop, or comes after `&&` or a `return`. Or it is an import statement whose file runs at one of two times.
    Conditional,
    /// In the body, inside a `try` or as a promise that somebody may hold.
    Guarded,
    /// When a function is called, or when a deferred namespace is first touched. A handler may surround that.
    Deferred,
}

#[derive(Copy, Clone)]
struct Load {
    /// `None`: any file.
    target: Option<FileId>,
    timing: LoadTiming,
    /// An import statement, which loads ahead of the body of its file.
    is_hoisted: bool,
    position: u32,
}

#[derive(Copy, Clone, Default)]
struct FileLoads {
    first: u32,
    end: u32,
    /// The position of the first statement of the body that does more than load a file and keep the result. Until then the file has called none of its functions and
    /// has handed none to anybody. Computed for a file with a deferred load alone.
    first_effect_position: u32,
}

struct Loads {
    all: Vec<Load>,
    /// The part of `all` that belongs to each file, in the order in which the file reaches the loads.
    by_file: Vec<FileLoads>,
    /// The body of an ES module that waits for such a file runs after the bodies of files that are imported later.
    some_body_awaits: bool,
}

impl Loads {
    fn of(&self, file: FileId) -> &[Load] {
        let range = self.by_file[file.idx()];
        &self.all[range.first as usize..range.end as usize]
    }
}

fn collect_loads(input: &BindInput<'_, '_>, scans: &Scans, modules: &ModuleSet) -> Loads {
    let files = input.files;
    let mut loads = Loads {
        all: Vec::new(),
        by_file: vec![FileLoads::default(); files.modules.len()],
        some_body_awaits: false,
    };
    let mut calls: Vec<ExprId> = Vec::new();
    for &file in &modules.compiled_files {
        let (analysis, scan) = (files.analysis(file), scans.of(file));
        loads.some_body_awaits |= analysis.has_live_top_level_await;
        if analysis.import_sites.is_empty() {
            continue;
        }
        let text = BodyText {
            hir: files.hir(file),
            bound: files.bound(file),
            decisions: &analysis.decisions,
            file_text: FileText::new(files, &modules.wrapped, file),
        };
        let hir = text.hir;
        let first = loads.all.len();
        let mut first_return = None;
        calls.clear();
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            if let Some(call) = site.kind.call() {
                if text.decisions.is_dead_expr(call) {
                    continue;
                }
                calls.push(call);
            }
            let (mut timing, is_hoisted, position) = match site.kind {
                ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call)
                | ImportSiteKind::RequireByTestRunner(call) => {
                    (text.find_timing_of_call(call), false, hir[call].pos)
                }
                ImportSiteKind::ImportCall(call) | ImportSiteKind::ImportByTestRunner(call) => {
                    let timing = text.find_timing_of_call(call);
                    match text.is_awaited_at_once(call) {
                        true => (timing, false, hir[call].pos),
                        false => (timing.max(LoadTiming::Guarded), false, hir[call].pos),
                    }
                }
                ImportSiteKind::ImportEquals(import) => {
                    let position = hir[hir[import].stmt].start;
                    (LoadTiming::Unconditional, false, position)
                }
                ImportSiteKind::Import(import) if hir[import].is_deferred => {
                    (LoadTiming::Deferred, true, 0)
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) => (LoadTiming::Unconditional, true, 0),
                ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) => continue,
            };
            let is_one_of_several =
                matches!(answer, ScannedSite::Candidates(range) if range.end - range.start > 1);
            if timing == LoadTiming::Unconditional
                && !is_hoisted
                && (is_one_of_several
                    || position
                        > *first_return.get_or_insert_with(|| text.find_first_return_of_body()))
            {
                timing = LoadTiming::Conditional;
            }
            let is_linked_with_importer = is_hoisted && scan.interop.kind != ModuleKind::CommonJs;
            let load_of = |target: Option<FileId>| Load {
                target,
                timing: match target {
                    // It runs in its turn among the ES modules, or while its importer is linked where `require` has read the graph.
                    Some(target)
                        if is_linked_with_importer && files.is_es_module_to_imports(target) =>
                    {
                        timing.max(LoadTiming::Conditional)
                    }
                    _ => timing,
                },
                is_hoisted,
                position,
            };
            match answer {
                &ScannedSite::Module(ModuleRef::File(target)) => {
                    loads.all.push(load_of(Some(target)));
                }
                ScannedSite::Candidates(range) => {
                    for module in scan.modules_spelled_in(range) {
                        if let ModuleRef::File(target) = module {
                            loads.all.push(load_of(Some(target)));
                        }
                    }
                }
                ScannedSite::AllModules => loads.all.push(load_of(None)),
                ScannedSite::Module(_) | ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
        let of_file = &mut loads.all[first..];
        of_file.sort_by_key(|load| (!load.is_hoisted, load.position));
        let has_deferred_load = (of_file.iter()).any(|load| load.timing == LoadTiming::Deferred);
        let first_effect_position = match has_deferred_load {
            true => {
                calls.sort_unstable();
                text.find_first_effect_of_body(&calls)
            }
            false => 0,
        };
        loads.by_file[file.idx()] = FileLoads {
            first: first as u32,
            end: loads.all.len() as u32,
            first_effect_position,
        };
    }
    loads
}

struct BodyText<'a, 's> {
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    file_text: FileText<'a, 's>,
}

impl BodyText<'_, '_> {
    fn find_timing_of_call(&self, call: ExprId) -> LoadTiming {
        let (hir, bound) = (self.hir, self.bound);
        let mut timing = LoadTiming::Unconditional;
        let mut expression = call;
        loop {
            let mut statement = loop {
                match bound.parent_of_expr(expression) {
                    Parent::Expr(parent) if parent.is_some() => {
                        if !self.file_text.always_evaluates(parent, expression) {
                            timing = timing.max(LoadTiming::Conditional);
                        }
                        expression = parent;
                    }
                    Parent::Prop(property) | Parent::PropKey(property) => {
                        expression = bound.prop_owner[property.idx()];
                    }
                    Parent::VarInit(declaration) => break bound.var_stmt[declaration.idx()],
                    Parent::Stmt(statement) if statement.is_some() => {
                        if !always_evaluates_operand(hir, statement, expression) {
                            timing = timing.max(LoadTiming::Conditional);
                        }
                        break statement;
                    }
                    Parent::FnBody(function) => match self.find_function_called_in_place(function) {
                        Some(written) => {
                            timing = timing.max(LoadTiming::Conditional);
                            expression = written;
                        }
                        None => return LoadTiming::Deferred,
                    },
                    Parent::File => return timing,
                    _ => return LoadTiming::Deferred,
                }
            };
            expression = loop {
                if statement.is_none() {
                    return LoadTiming::Deferred;
                }
                match bound.parent_of_stmt(statement) {
                    Parent::File => return timing,
                    Parent::Stmt(parent) if parent.is_some() => {
                        timing = timing.max(match hir[parent].kind {
                            StmtKind::Block(_) => LoadTiming::Unconditional,
                            StmtKind::Try { block, .. } if block == statement => {
                                LoadTiming::Guarded
                            }
                            StmtKind::Try { finalizer, .. } if finalizer == statement => {
                                LoadTiming::Unconditional
                            }
                            _ => LoadTiming::Conditional,
                        });
                        statement = parent;
                    }
                    Parent::FnBody(function) => match self.find_function_called_in_place(function) {
                        Some(written) => {
                            timing = timing.max(LoadTiming::Conditional);
                            break written;
                        }
                        None => return LoadTiming::Deferred,
                    },
                    _ => return LoadTiming::Deferred,
                }
            };
        }
    }

    /// `(() => require("./a.cjs"))()`: what the function throws goes on to whatever surrounds the call.
    fn find_function_called_in_place(&self, function: FnId) -> Option<ExprId> {
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(written) if self.file_text.is_called_where_written(function) => {
                Some(written)
            }
            _ => None,
        }
    }

    /// `await import("./a.ts")`: nobody but the `await` holds the promise, so what the file throws goes on from there as it does from an import statement.
    fn is_awaited_at_once(&self, call: ExprId) -> bool {
        let mut inner = call;
        while let Parent::Expr(outer) = self.bound.parent_of_expr(inner) {
            match self.hir[outer].kind {
                ExprKind::Await(_) => return true,
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => inner = outer,
                _ => return false,
            }
        }
        false
    }

    /// `if (done) return;` in the body of a CommonJS file. The file may skip what comes after it.
    fn find_first_return_of_body(&self) -> u32 {
        let (hir, bound) = (self.hir, self.bound);
        let mut first = u32::MAX;
        for statement in (0..hir.stmts.len() as u32).map(StmtId) {
            if !matches!(hir[statement].kind, StmtKind::Return(_))
                || self.decisions.is_dead_stmt(statement)
            {
                continue;
            }
            let scope = bound.scope_of_stmt(statement);
            if scope.is_some() && bound.code_unit(scope) == CodeUnit::File {
                first = first.min(hir[statement].start);
            }
        }
        first
    }

    /// `FileLoads::first_effect_position`. `loading_calls` ascend.
    fn find_first_effect_of_body(&self, loading_calls: &[ExprId]) -> u32 {
        let hir = self.hir;
        let has_effect = |&statement: &StmtId| match hir[statement].kind {
            _ if self.decisions.is_dead_stmt(statement) => false,
            StmtKind::Empty
            | StmtKind::Directive { .. }
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. } => false,
            StmtKind::Expr(value) => !self.only_loads(loading_calls, value),
            StmtKind::Var(declarations) => declarations.iter().map(|it| &hir[it]).any(|it| {
                !self.only_destructures(it.pat)
                    || (it.init.is_some() && !self.only_loads(loading_calls, it.init))
            }),
            _ => true,
        };
        let first = hir.ids(hir.body).find(has_effect);
        first.map_or(u32::MAX, |statement: StmtId| hir[statement].start)
    }

    /// `require("a")`, `require("a").b`, `require("a")("name")`
    fn only_loads(&self, loading_calls: &[ExprId], value: ExprId) -> bool {
        let hir = self.hir;
        let is_constant = |argument: ExprId| {
            matches!(
                hir[argument].kind,
                ExprKind::String(_)
                    | ExprKind::Number(_)
                    | ExprKind::True
                    | ExprKind::False
                    | ExprKind::Null
            )
        };
        let mut value = value;
        loop {
            match hir[value].kind {
                ExprKind::Dot { obj, .. } => value = obj,
                ExprKind::Call(site) if hir.ids(hir[site].args).all(is_constant) => {
                    if loading_calls.binary_search(&value).is_ok() {
                        return true;
                    }
                    value = hir[site].callee;
                }
                _ => return false,
            }
        }
    }

    /// `{ a, b: [c] }`: it evaluates nothing that the file has written.
    fn only_destructures(&self, pattern: PatId) -> bool {
        let hir = self.hir;
        let mut to_visit = vec![pattern];
        while let Some(pattern) = to_visit.pop() {
            match hir[pattern].kind {
                PatKind::Missing | PatKind::Ident(_) => {}
                PatKind::Object(properties) => {
                    for property in properties.iter().map(|it| &hir[it]) {
                        if property.default.is_some()
                            || matches!(property.key, PropKey::Computed(_))
                        {
                            return false;
                        }
                        to_visit.push(property.value);
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter().map(|it| &hir[it]) {
                        if element.default.is_some() {
                            return false;
                        }
                        to_visit.push(element.pat);
                    }
                }
            }
        }
        true
    }
}

fn always_evaluates_operand(hir: &hir::File<'_>, statement: StmtId, operand: ExprId) -> bool {
    match hir[statement].kind {
        StmtKind::Expr(_)
        | StmtKind::Return(_)
        | StmtKind::Throw(_)
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_) => true,
        StmtKind::If { test, .. } => test == operand,
        StmtKind::Switch { expr, .. } => expr == operand,
        _ => false,
    }
}

/// A load that is no step of the startup. It may run at `earliest_time` or at any time after it.
#[derive(Copy, Clone)]
struct PossibleLoad {
    earliest_time: u32,
    /// `None`: any file.
    target: Option<FileId>,
    may_be_caught: bool,
}

struct StartingFile {
    file: FileId,
    /// The part of `StartupWalk::files_run_at_link` that has yet to start. It starts ahead of the loads of the file.
    files_run_at_link: Range<u32>,
    next_load: usize,
    has_started_body: bool,
    /// The earliest time at which something may call a function of the file.
    functions_callable_from: u32,
}

struct StartupWalk<'a> {
    loads: &'a Loads,
    is_commonjs: &'a dyn Fn(FileId) -> bool,
    possible_loads: &'a mut Vec<PossibleLoad>,
    time: u32,
    start_times: Vec<u32>,
    depth_of_starting_file: Vec<u32>,
    stack: Vec<StartingFile>,
    files_run_at_link: Vec<FileId>,
    /// How many of them the files of `stack` have yet to start.
    files_yet_to_run_at_link: u32,
    /// The ES modules of the graph that `collect_files_run_at_link` searches.
    importers: Vec<FileId>,
    /// By file: the number of the last graph whose search met it.
    last_graph_of_file: Vec<u32>,
    graph_count: u32,
}

/// Follows the unconditional loads down from the entry points that the host starts, in the order in which they run, and answers by file the time at which it starts.
/// A file with such a time has run, or has ended the process, when a load with a later time asks for it. Every other load is added to `possible_loads`.
fn walk_startup(
    loads: &Loads,
    started: &[FileId],
    is_commonjs: &dyn Fn(FileId) -> bool,
    possible_loads: &mut Vec<PossibleLoad>,
) -> Vec<u32> {
    let file_count = loads.by_file.len();
    let mut walk = StartupWalk {
        loads,
        is_commonjs,
        possible_loads,
        time: 0,
        start_times: vec![NEVER; file_count],
        depth_of_starting_file: vec![NEVER; file_count],
        stack: Vec::new(),
        files_run_at_link: Vec::new(),
        files_yet_to_run_at_link: 0,
        importers: Vec::new(),
        last_graph_of_file: vec![0; file_count],
        graph_count: 0,
    };
    for &entry_point in started {
        walk.start_entry_point(entry_point);
    }
    walk.start_times
}

impl StartupWalk<'_> {
    /// `is_root_of_graph`: the file is an ES module, and something other than an import statement of an ES module loads it.
    fn start(&mut self, file: FileId, depth: u32, is_root_of_graph: bool) {
        self.time += 1;
        self.start_times[file.idx()] = self.time;
        self.depth_of_starting_file[file.idx()] = depth;
        let files_run_at_link = match is_root_of_graph {
            true => self.collect_files_run_at_link(file),
            false => 0..0,
        };
        self.files_yet_to_run_at_link += files_run_at_link.len() as u32;
        self.stack.push(StartingFile {
            file,
            files_run_at_link,
            next_load: 0,
            has_started_body: false,
            functions_callable_from: NEVER,
        });
    }

    /// The CommonJS files that import statements reach from `root` through ES modules and that have not started. They run while the graph is loaded, ahead of the body of
    /// every ES module in it, and what a module imports comes after everything that was asked for before.
    fn collect_files_run_at_link(&mut self, root: FileId) -> Range<u32> {
        let loads = self.loads;
        let first = self.files_run_at_link.len() as u32;
        // All that an ES module which has finished leads to has started, unless it leads back to a graph that is still being loaded.
        let is_outer_graph_being_loaded = self.files_yet_to_run_at_link != 0;
        self.graph_count += 1;
        let graph = self.graph_count;
        self.last_graph_of_file[root.idx()] = graph;
        self.importers.clear();
        self.importers.push(root);
        let mut next = 0;
        while let Some(&importer) = self.importers.get(next) {
            next += 1;
            let hoisted = loads.of(importer).iter().take_while(|load| load.is_hoisted);
            for load in hoisted {
                let Some(target) = load.target else {
                    continue;
                };
                match load.timing {
                    LoadTiming::Unconditional => {}
                    LoadTiming::Conditional => {
                        self.possible_loads.push(PossibleLoad {
                            earliest_time: self.time,
                            target: Some(target),
                            may_be_caught: false,
                        });
                        continue;
                    }
                    LoadTiming::Guarded | LoadTiming::Deferred => continue,
                }
                if core::mem::replace(&mut self.last_graph_of_file[target.idx()], graph) == graph {
                    continue;
                }
                let has_started = self.start_times[target.idx()] != NEVER;
                let is_starting = self.depth_of_starting_file[target.idx()] != NEVER;
                if (self.is_commonjs)(target) {
                    if !has_started {
                        self.files_run_at_link.push(target);
                    }
                } else if !has_started || is_starting || is_outer_graph_being_loaded {
                    self.importers.push(target);
                }
            }
        }
        first..self.files_run_at_link.len() as u32
    }

    fn start_entry_point(&mut self, entry_point: FileId) {
        if self.start_times[entry_point.idx()] != NEVER {
            return;
        }
        let loads = self.loads;
        // A file has loaded one that is still starting. The functions that an ES module declares exist ahead of its body, so from that time on the loaded module can be
        // called, and through it every ES module that starts below it.
        let (mut cycle_depth, mut cycle_time) = (NEVER, NEVER);
        let is_root_of_graph = !(self.is_commonjs)(entry_point);
        self.start(entry_point, 0, is_root_of_graph);
        while let Some(top) = self.stack.last_mut() {
            let file = top.file;
            let depth = self.depth_of_starting_file[file.idx()];
            if let Some(index) = top.files_run_at_link.next() {
                self.files_yet_to_run_at_link -= 1;
                let imported = self.files_run_at_link[index as usize];
                if self.start_times[imported.idx()] == NEVER {
                    self.start(imported, depth + 1, false);
                }
                continue;
            }
            let load = loads.of(file).get(top.next_load).copied();
            top.next_load += 1;
            if !top.has_started_body && !load.is_some_and(|load| load.is_hoisted) {
                self.time += 1;
                top.has_started_body = true;
            }
            let first_effect_position = loads.by_file[file.idx()].first_effect_position;
            if top.has_started_body
                && top.functions_callable_from == NEVER
                && !load.is_some_and(|load| load.position < first_effect_position)
            {
                top.functions_callable_from = self.time;
            }
            let is_importer_commonjs = (self.is_commonjs)(file);
            let Some(load) = load else {
                let is_callable_ahead_of_body = depth >= cycle_depth && !is_importer_commonjs;
                let earliest_time = match is_callable_ahead_of_body {
                    true => self.start_times[file.idx()].min(cycle_time),
                    false => top.functions_callable_from,
                };
                if depth <= cycle_depth {
                    (cycle_depth, cycle_time) = (NEVER, NEVER);
                }
                let deferred = loads.of(file).iter();
                let deferred = deferred.filter(|load| load.timing == LoadTiming::Deferred);
                self.possible_loads.extend(deferred.map(|load| PossibleLoad {
                    // What `import defer` names is linked with its importer, and the CommonJS files below it run then.
                    earliest_time: match load.is_hoisted {
                        true => 0,
                        false => earliest_time,
                    },
                    target: load.target,
                    may_be_caught: true,
                }));
                self.depth_of_starting_file[file.idx()] = NEVER;
                self.stack.pop();
                continue;
            };
            if load.timing == LoadTiming::Deferred {
                continue;
            }
            // Nothing else of the startup runs while an entry point waits.
            let is_in_order = load.timing == LoadTiming::Unconditional
                && (load.is_hoisted
                    || depth == 0
                    || !loads.some_body_awaits
                    || is_importer_commonjs);
            match load.target {
                Some(target) if self.depth_of_starting_file[target.idx()] != NEVER => {
                    cycle_depth = cycle_depth.min(self.depth_of_starting_file[target.idx()]);
                    cycle_time = cycle_time.min(self.time);
                }
                Some(target) if is_in_order => {
                    if self.start_times[target.idx()] == NEVER {
                        let is_linked_with_importer = load.is_hoisted && !is_importer_commonjs;
                        let is_root_of_graph =
                            !is_linked_with_importer && !(self.is_commonjs)(target);
                        self.start(target, depth + 1, is_root_of_graph);
                    }
                }
                target => self.possible_loads.push(PossibleLoad {
                    earliest_time: self.time,
                    target,
                    may_be_caught: load.timing == LoadTiming::Guarded,
                }),
            }
        }
    }
}

/// By file: a load that somebody may catch, or a load below such a load, may be the first to run the file. What it throws then ends nothing, and the next load runs it again.
fn find_files_whose_first_run_may_be_caught(
    loads: &Loads,
    all_files: &[FileId],
    start_times: &[u32],
    mut possible_loads: Vec<PossibleLoad>,
) -> Vec<bool> {
    // What a file leads to at one time it leads to at every earlier time, so the first visit of a file finds all that a later one would.
    possible_loads.sort_by_key(|load| load.earliest_time);
    // Whether the loads of the file were followed, first where nobody catches and then where somebody may.
    let mut is_followed = vec![[false; 2]; start_times.len()];
    let mut is_any_file_followed = [false; 2];
    let mut to_follow: Vec<(Option<FileId>, bool)> = Vec::new();
    for possible in possible_loads {
        to_follow.push((possible.target, possible.may_be_caught));
        while let Some((target, may_be_caught)) = to_follow.pop() {
            let seen = match target {
                Some(target) if start_times[target.idx()] <= possible.earliest_time => continue,
                Some(target) => &mut is_followed[target.idx()],
                None => &mut is_any_file_followed,
            };
            if seen[1] || core::mem::replace(&mut seen[may_be_caught as usize], true) {
                continue;
            }
            match target {
                Some(target) => to_follow.extend(loads.of(target).iter().map(|load| {
                    let catches = matches!(load.timing, LoadTiming::Guarded | LoadTiming::Deferred);
                    (load.target, may_be_caught || catches)
                })),
                None => {
                    to_follow.extend(all_files.iter().map(|&file| (Some(file), may_be_caught)));
                }
            }
        }
    }
    is_followed.iter().map(|seen| seen[1]).collect()
}
