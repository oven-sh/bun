#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_of_test_runs;

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
    is_any_module_taken_out: bool,
    modules: Vec<ModuleRef>,
    is_table_reached: bool,
    library_modules_stored_in_cache: Vec<RuntimeModule>,
}

impl EvictedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || is_among(&self.modules, module)
    }

    pub(super) fn leaves(&self, module: ModuleRef) -> bool {
        self.is_any_module_taken_out || is_among(&self.modules, module)
    }

    pub(super) fn modules(&self) -> &[ModuleRef] {
        &self.modules
    }

    pub(super) fn is_stored_in_cache(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::Runtime(module) if self.library_modules_stored_in_cache.contains(&module))
    }

    pub(super) fn library_modules_stored_in_cache(&self) -> &[RuntimeModule] {
        &self.library_modules_stored_in_cache
    }

    pub(super) fn is_every_module(&self) -> bool {
        self.is_every_module
    }

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
    if !input.runs_tests {
        return EvictedModules {
            library_modules_stored_in_cache,
            ..EvictedModules::default()
        };
    }
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
                    matches!(
                        kind_of(*file),
                        ModuleKind::SourceText | ModuleKind::CommonJs
                    )
                }
                SourceKind::Data => true,
                SourceKind::RuntimeModule(_)
                | SourceKind::RuntimeFunctions
                | SourceKind::TypesOnly => false,
            }
    };
    let is_commonjs = |file: FileId| kind_of(file) == ModuleKind::CommonJs;
    if evicted.is_any_module_taken_out || !files.clone().any(&is_commonjs) {
        say_files_that_may_run_again(0);
        return files.filter(may_load_again).map(ModuleRef::File).collect();
    }
    let loads = collect_loads(input, scans, modules);
    let mut is_found_by_load = vec![false; input.files.modules.len()];
    let written_and_found = input.files.entry_points().iter();
    for &file in written_and_found.skip(input.written_entry_point_count) {
        is_found_by_load[file.idx()] = true;
    }
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
        let is_started = is_started && !input.entry_points_run_again;
        if !is_started {
            possible_loads.push(PossibleLoad {
                earliest_time: 0,
                target: Some(entry_point.file),
                may_be_caught: input.entry_points_run_again,
            });
        }
        if is_started && !started.is_empty() {
            let loads = loads.of(entry_point.file).iter();
            possible_loads.extend(loads.map(|load| PossibleLoad {
                earliest_time: 0,
                target: load.target,
                may_be_caught: true,
            }));
        }
        if is_started {
            started.push(entry_point.file);
        }
    }
    let settled_times = walk_startup(&loads, &started, &is_commonjs, &mut possible_loads);
    let may_be_loaded_behind_throw = find_files_that_may_be_loaded_behind_throw(
        &loads,
        &modules.compiled_files,
        &settled_times,
        possible_loads,
    );
    let mut after_throw_alone = 0;
    let run_again: Vec<ModuleRef> = files
        .filter(|file| {
            let leaves = may_load_again(file);
            let runs_after_throw = is_commonjs(*file) && may_be_loaded_behind_throw[file.idx()];
            after_throw_alone += usize::from(runs_after_throw && !leaves);
            leaves || runs_after_throw
        })
        .map(ModuleRef::File)
        .collect();
    say_files_that_may_run_again(after_throw_alone);
    run_again
}

const NEVER: u32 = u32::MAX;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum LoadTiming {
    Unconditional,
    Conditional,
    Guarded,
    Deferred,
}

#[derive(Copy, Clone)]
struct Load {
    target: Option<FileId>,
    timing: LoadTiming,
    is_hoisted: bool,
    is_asked_by_job: bool,
    position: u32,
}

#[derive(Copy, Clone, Default)]
struct FileLoads {
    first: u32,
    end: u32,
    first_effect_position: u32,
}

struct Loads {
    all: Vec<Load>,
    by_file: Vec<FileLoads>,
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
            moved_statements: find_moved_statements(files.hir(file)),
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
            let mut is_asked_by_job = false;
            let (mut timing, is_hoisted, position) = match site.kind {
                ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call)
                | ImportSiteKind::RequireByTestRunner(call) => (
                    text.find_timing_of_call(call),
                    false,
                    text.place_of(hir[call].pos),
                ),
                ImportSiteKind::ImportCall(call) | ImportSiteKind::ImportByTestRunner(call) => {
                    let timing = text.find_timing_of_call(call);
                    is_asked_by_job = !text.is_awaited_at_once(call);
                    let timing = match is_asked_by_job {
                        false => timing,
                        true => timing.max(LoadTiming::Guarded),
                    };
                    (timing, false, text.place_of(hir[call].pos))
                }
                ImportSiteKind::ImportEquals(import) => {
                    let position = text.place_of(hir[hir[import].stmt].start);
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
                    Some(target)
                        if is_linked_with_importer && files.is_es_module_to_imports(target) =>
                    {
                        timing.max(LoadTiming::Conditional)
                    }
                    _ => timing,
                },
                is_hoisted,
                is_asked_by_job,
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
    moved_statements: Vec<(u32, u32)>,
}

fn find_moved_statements(hir: &hir::File<'_>) -> Vec<(u32, u32)> {
    let starts = hir.ids(hir.body).map(|statement| hir[statement].start);
    if starts.is_sorted() {
        return Vec::new();
    }
    let mut place = 0;
    let mut moved: Vec<(u32, u32)> = hir
        .ids(hir.body)
        .map(|statement| {
            let (start, end) = (hir[statement].start, hir[statement].loc.end);
            let moved = (start, place);
            place += end.saturating_sub(start) + 1;
            moved
        })
        .collect();
    moved.sort_by_key(|&(start, _)| start);
    moved
}

impl BodyText<'_, '_> {
    fn place_of(&self, position: u32) -> u32 {
        let behind = self
            .moved_statements
            .partition_point(|&(start, _)| start <= position);
        match behind
            .checked_sub(1)
            .map(|index| self.moved_statements[index])
        {
            Some((start, place)) => place + (position - start),
            None => position,
        }
    }

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
                    Parent::FnBody(function) => {
                        match self.find_function_called_in_place(function) {
                            Some(written) => {
                                timing = timing.max(LoadTiming::Conditional);
                                expression = written;
                            }
                            None => return LoadTiming::Deferred,
                        }
                    }
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
                            StmtKind::Try {
                                handler, finalizer, ..
                            } if handler == statement && finalizer.is_some() => LoadTiming::Guarded,
                            _ => LoadTiming::Conditional,
                        });
                        statement = parent;
                    }
                    Parent::FnBody(function) => {
                        match self.find_function_called_in_place(function) {
                            Some(written) => {
                                timing = timing.max(LoadTiming::Conditional);
                                break written;
                            }
                            None => return LoadTiming::Deferred,
                        }
                    }
                    _ => return LoadTiming::Deferred,
                }
            };
        }
    }

    fn find_function_called_in_place(&self, function: FnId) -> Option<ExprId> {
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(written) if self.file_text.is_called_where_written(function) => {
                Some(written)
            }
            _ => None,
        }
    }

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
                first = first.min(self.place_of(hir[statement].start));
            }
        }
        first
    }

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
        first.map_or(u32::MAX, |statement: StmtId| {
            self.place_of(hir[statement].start)
        })
    }

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

#[derive(Copy, Clone)]
struct PossibleLoad {
    earliest_time: u32,
    target: Option<FileId>,
    may_be_caught: bool,
}

struct StartingFile {
    file: FileId,
    files_run_at_link: Range<u32>,
    next_load: usize,
    has_started_body: bool,
    functions_callable_from: u32,
}

struct StartupWalk<'a> {
    loads: &'a Loads,
    is_commonjs: &'a dyn Fn(FileId) -> bool,
    possible_loads: &'a mut Vec<PossibleLoad>,
    time: u32,
    start_times: Vec<u32>,
    settled_times: Vec<u32>,
    depth_of_starting_file: Vec<u32>,
    stack: Vec<StartingFile>,
    files_run_at_link: Vec<FileId>,
    files_yet_to_run_at_link: u32,
    importers: Vec<FileId>,
    last_graph_of_file: Vec<u32>,
    graph_count: u32,
}

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
        settled_times: vec![NEVER; file_count],
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
    walk.settled_times
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum StartedBy {
    LoaderAsRootOfGraph,
    Loader,
    Require,
}

impl StartupWalk<'_> {
    fn start(&mut self, file: FileId, depth: u32, started_by: StartedBy) {
        self.time += 1;
        self.start_times[file.idx()] = self.time;
        if started_by != StartedBy::Require {
            self.settled_times[file.idx()] = self.time;
        }
        self.depth_of_starting_file[file.idx()] = depth;
        let files_run_at_link = match started_by {
            StartedBy::LoaderAsRootOfGraph => self.collect_files_run_at_link(file),
            StartedBy::Loader | StartedBy::Require => 0..0,
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

    fn collect_files_run_at_link(&mut self, root: FileId) -> Range<u32> {
        let loads = self.loads;
        let first = self.files_run_at_link.len() as u32;
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
        let (mut cycle_depth, mut cycle_time) = (NEVER, NEVER);
        let started_by = match (self.is_commonjs)(entry_point) {
            true => StartedBy::Loader,
            false => StartedBy::LoaderAsRootOfGraph,
        };
        self.start(entry_point, 0, started_by);
        while let Some(top) = self.stack.last_mut() {
            let file = top.file;
            let depth = self.depth_of_starting_file[file.idx()];
            if let Some(index) = top.files_run_at_link.next() {
                self.files_yet_to_run_at_link -= 1;
                let imported = self.files_run_at_link[index as usize];
                if self.start_times[imported.idx()] == NEVER {
                    self.start(imported, depth + 1, StartedBy::Loader);
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
                self.possible_loads
                    .extend(deferred.map(|load| PossibleLoad {
                        earliest_time: match load.is_hoisted {
                            true => 0,
                            false => earliest_time,
                        },
                        target: load.target,
                        may_be_caught: true,
                    }));
                self.depth_of_starting_file[file.idx()] = NEVER;
                self.time += 1;
                if self.settled_times[file.idx()] == NEVER {
                    self.settled_times[file.idx()] = self.time;
                }
                self.stack.pop();
                continue;
            };
            if load.timing == LoadTiming::Deferred {
                continue;
            }
            let is_in_order = load.timing == LoadTiming::Unconditional
                && (load.is_hoisted
                    || depth == 0
                    || !loads.some_body_awaits
                    || is_importer_commonjs);
            match load.target {
                Some(target) if self.depth_of_starting_file[target.idx()] != NEVER => {
                    cycle_depth = cycle_depth.min(self.depth_of_starting_file[target.idx()]);
                    cycle_time = cycle_time.min(self.time);
                    if load.is_asked_by_job {
                        self.possible_loads.push(PossibleLoad {
                            earliest_time: self.time,
                            target: Some(target),
                            may_be_caught: true,
                        });
                    }
                }
                Some(target) if is_in_order => {
                    if self.start_times[target.idx()] == NEVER {
                        let is_linked_with_importer = load.is_hoisted && !is_importer_commonjs;
                        let is_commonjs = (self.is_commonjs)(target);
                        let started_by = match (is_linked_with_importer, is_commonjs) {
                            (true, _) => StartedBy::Loader,
                            (false, false) => StartedBy::LoaderAsRootOfGraph,
                            (false, true) => StartedBy::Require,
                        };
                        self.start(target, depth + 1, started_by);
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

fn find_files_that_may_be_loaded_behind_throw(
    loads: &Loads,
    all_files: &[FileId],
    settled_times: &[u32],
    mut possible_loads: Vec<PossibleLoad>,
) -> Vec<bool> {
    possible_loads.sort_by_key(|load| load.earliest_time);
    let mut is_followed = vec![[false; 2]; settled_times.len()];
    let mut is_any_file_followed = [false; 2];
    let mut to_follow: Vec<(Option<FileId>, bool)> = Vec::new();
    for possible in possible_loads {
        to_follow.push((possible.target, possible.may_be_caught));
        while let Some((target, may_be_caught)) = to_follow.pop() {
            let seen = match target {
                Some(target) if settled_times[target.idx()] <= possible.earliest_time => continue,
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
