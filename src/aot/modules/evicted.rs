//! Which files of a test run may load a second time. `delete require.cache[path]` makes the next `require()` or `import()` of the file load it again, from
//! disk, and so does `require.cache[path] = undefined`. Code that asks for such a file asks the run time which instance answers, and knows nothing of what it gets, so the fewer the better.
//! So does an import statement of a test file, which may be linked behind the `delete` of an earlier one: `leave_imports_of_test_files_to_loader`.
//! A file that the run itself writes, moves or removes is among them, though it may load only once: `bun test` reads what lies on disk when something first loads it.

use super::imports::find_mocked_modules;
use super::module_set::ModuleSet;
use super::plan::ModuleRef;
use super::requests::{ScannedSite, Scans};
use super::{BindInput, ReplacedModules};
use crate::builtins::{KeyOfModuleCache, ResolvedBuiltins, RuntimeModule, table};
use crate::load::is_written_by_test_runner;
use crate::load::loader_aliases::resolve_loader_alias;
use crate::load::sources::{EntryPoint, EntryPointKind, SourceKind, parsed_source};
use crate::options::ReplacedModule;
use crate::statistics::logs_stages;
use bun_ast::Target;
use bun_core::strings::{contains, index_of_char, last_index_of_char};
use bun_paths::resolve_path::{dirname, join_abs_string_buf_checked, platform};
use bun_paths::{is_absolute, path_buffer_pool};
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, PatId, PatKind, PropKey, StmtId, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, is_made_require};
use bun_sema::program::{FileId, Files};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, to_native};
use std::collections::VecDeque;
use std::collections::hash_map::Entry;

#[derive(Default)]
pub(super) struct EvictedModules {
    modules: FxHashSet<ModuleRef>,
    is_every_module: bool,
    /// What the texts of `modules` name. A copy from disk links to the names of compiled modules.
    named_by_copies: FxHashSet<ModuleRef>,
    /// A file may read what the table lists, and an entry shows all that its file exports. Or a copy names a file that nobody knows.
    is_every_export_asked_for: bool,
    /// The text of a copy names a file that nobody knows.
    copies_name_any_file: bool,
    /// A file names the table, or lets go of something that leads there: it may get at the entry of a file, and store other `exports` in it.
    is_table_reached: bool,
    /// A file may read what an entry of the table exports.
    are_entries_read: bool,
    /// `writeFileSync(path, text)`: the files of the program at the paths that a file spells to a call which writes, moves or removes what is there.
    /// What loads from there is a text that nobody has read.
    changed_on_disk: FxHashSet<ModuleRef>,
}

impl EvictedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || self.modules.contains(&module)
    }

    pub(super) fn is_every_module(&self) -> bool {
        self.is_every_module
    }

    pub(super) fn is_table_reached(&self) -> bool {
        self.is_every_module || self.is_table_reached
    }

    pub(super) fn are_entries_read(&self) -> bool {
        self.is_every_module || self.are_entries_read
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.modules.iter().copied()
    }

    pub(super) fn changed_on_disk(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.changed_on_disk.iter().copied()
    }

    pub(super) fn is_every_export_asked_for(&self) -> bool {
        self.is_every_module || self.is_every_export_asked_for
    }

    /// Whether `asked_for_any_export` falls short of what a copy from disk may name.
    pub(super) fn copies_name_every_module(&self) -> bool {
        self.is_every_module || self.copies_name_any_file
    }

    /// The modules of which somebody out of sight may ask for any export, where that is not all of them.
    pub(super) fn asked_for_any_export(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.modules.iter().chain(&self.named_by_copies).copied()
    }
}

/// What a key of the table names, as far as the file says it.
pub(crate) enum FileOfKey {
    /// `require.resolve("./a")`: the place of the call in `FileAnalysis::import_sites`.
    Site(usize),
    Path(Atom),
    Unknown,
}

/// `const path = require.resolve("./a"); delete require.cache[path];`
pub(crate) fn find_file_of_key(
    hir: &bun_sema::hir::File<'_>,
    bound: &bun_sema::bind::Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    key: KeyOfModuleCache,
) -> FileOfKey {
    let key = match key {
        KeyOfModuleCache::Text(path) => return FileOfKey::Path(path),
        KeyOfModuleCache::Computed(key) => key,
    };
    let mut key = hir.skip_type_assertions(key);
    // `const a = b, b = a` leads round.
    let mut followed = Vec::new();
    loop {
        if let FoldedValue::Constant(Constant::String(path)) = analysis.decisions.constant(hir, key)
        {
            return FileOfKey::Path(path);
        }
        let is_this_call = |kind: ImportSiteKind| kind == ImportSiteKind::RequireResolve(key);
        if let Some(site) = (analysis.import_sites.iter()).position(|site| is_this_call(site.kind))
        {
            return FileOfKey::Site(site);
        }
        let Binding::Symbol(symbol) = bound.binding(key) else {
            return FileOfKey::Unknown;
        };
        if !bound.is_evaluated_ident(key)
            || !bound.is_stable_binding(symbol)
            || followed.contains(&symbol)
        {
            return FileOfKey::Unknown;
        }
        followed.push(symbol);
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            return FileOfKey::Unknown;
        };
        key = hir.skip_type_assertions(initializer);
    }
}

/// `try { require("./a.cjs"); } catch {}`, `expect(() => require("./a.cjs")).toThrow()`, `test("a", () => { require("./a.cjs"); })`: the program goes on behind a body that throws.
/// Whoever is handed a function may catch what it throws.
pub(crate) fn stands_where_a_throw_is_caught(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    mut call: ExprId,
) -> bool {
    let statement_around = |parent: Parent| -> Option<StmtId> {
        match parent {
            Parent::Stmt(statement) => statement.some(),
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
            Parent::Case(case) => bound.case_stmt[case.idx()].some(),
            _ => None,
        }
    };
    loop {
        let mut parent = bound.parent_of_expr(call);
        while let Parent::Expr(outer) = parent {
            parent = bound.parent_of_expr(outer);
        }
        while let Some(inner) = statement_around(parent) {
            parent = bound.parent_of_stmt(inner);
            let is_guarded = statement_around(parent).is_some_and(
                |outer| matches!(hir[outer].kind, StmtKind::Try { block, .. } if block == inner),
            );
            if is_guarded {
                return true;
            }
        }
        let Parent::FnBody(function) = parent else {
            return false;
        };
        let FnOwner::Expr(function) = bound.fns[function.idx()].owner else {
            return false;
        };
        let Parent::Expr(user) = bound.parent_of_expr(function) else {
            return false;
        };
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[user].kind else {
            return false;
        };
        if hir[site].callee != function {
            return true;
        }
        // `(() => require("./a.cjs"))()`: what it throws goes on to what stands around the call.
        call = user;
    }
}

/// When a call that loads a file runs, and whether somebody may catch what the file throws.
#[derive(Copy, Clone, PartialEq)]
enum LoadedWhen {
    /// While the files are loaded one below the other from an entry point, with no handler around: a throw ends the process.
    AtTheTop,
    /// Then too, where the file may pass the call by: in a branch, in a loop, behind `&&`.
    AtTheTopPerhaps,
    /// Then too, with a handler around it, or as a promise.
    AtTheTopAndCaught,
    /// When a function is called: a handler may stand around that call.
    Later,
}

/// `a && operand`, `a ? operand : b`, `a?.(operand)`
fn may_pass_operand_by(hir: &bun_sema::hir::File<'_>, outer: ExprId, operand: ExprId) -> bool {
    const STOPS_EARLY: [BinOp; 3] = [BinOp::And, BinOp::Or, BinOp::Nullish];
    match hir[outer].kind {
        ExprKind::Binary { op, right, .. } => STOPS_EARLY.contains(&op) && right == operand,
        ExprKind::Assign { op, value, .. } => {
            op.is_some_and(|op| STOPS_EARLY.contains(&op)) && value == operand
        }
        ExprKind::Cond { test, .. } => test != operand,
        ExprKind::Index { obj, chain, .. } => !matches!(chain, Chain::No) && obj != operand,
        ExprKind::Call(site) | ExprKind::New(site) => {
            !matches!(hir[site].chain, Chain::No) && hir[site].callee != operand
        }
        _ => false,
    }
}

fn find_when_call_runs(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> LoadedWhen {
    let mut when = LoadedWhen::AtTheTop;
    let mut operand = call;
    let mut parent = bound.parent_of_expr(call);
    loop {
        let mut may_be_passed_by = false;
        let inner = match parent {
            Parent::Expr(outer) => {
                if when == LoadedWhen::AtTheTop && may_pass_operand_by(hir, outer, operand) {
                    when = LoadedWhen::AtTheTopPerhaps;
                }
                operand = outer;
                parent = bound.parent_of_expr(outer);
                continue;
            }
            Parent::Stmt(statement) => {
                may_be_passed_by = statement.some().is_some_and(
                    |it| matches!(hir[it].kind, StmtKind::For { update, .. } if update == operand),
                );
                statement.some()
            }
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
            Parent::Case(case) => {
                may_be_passed_by = true;
                bound.case_stmt[case.idx()].some()
            }
            Parent::File => return when,
            _ => return LoadedWhen::Later,
        };
        let Some(inner) = inner else {
            return LoadedWhen::Later;
        };
        parent = bound.parent_of_stmt(inner);
        if let Parent::Stmt(outer) = parent
            && let Some(outer) = outer.some()
        {
            match hir[outer].kind {
                StmtKind::Try { block, .. } if block == inner => {
                    when = LoadedWhen::AtTheTopAndCaught;
                }
                StmtKind::Try { finalizer, .. } if finalizer == inner => {}
                StmtKind::For { init, .. } if init == inner => {}
                StmtKind::Block(_) => {}
                _ => may_be_passed_by = true,
            }
        }
        if may_be_passed_by && when == LoadedWhen::AtTheTop {
            when = LoadedWhen::AtTheTopPerhaps;
        }
    }
}

/// `if (done) return;` at the top of a CommonJS file: where the first one stands. The file may pass by what stands behind it.
fn find_first_return_at_the_top(hir: &bun_sema::hir::File<'_>) -> u32 {
    let mut first = u32::MAX;
    let mut to_visit: Vec<StmtId> = hir.ids(hir.body).collect();
    while let Some(statement) = to_visit.pop() {
        match hir[statement].kind {
            StmtKind::Return(_) => first = first.min(hir[statement].start),
            StmtKind::If { yes, no, .. } => {
                to_visit.extend([yes, no].iter().filter_map(|it| it.some()))
            }
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => to_visit.extend(body.some()),
            StmtKind::Block(statements) => to_visit.extend(hir.ids(statements)),
            StmtKind::Switch { cases, .. } => {
                cases
                    .iter()
                    .for_each(|case| to_visit.extend(hir.ids(hir[case].body)));
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                to_visit.extend(
                    [block, handler, finalizer]
                        .iter()
                        .filter_map(|it| it.some()),
                );
            }
            _ => {}
        }
    }
    first
}

/// `await import("./a.ts")`: nobody but the `await` holds the promise, so what the file throws goes on from there as it does from an import statement.
fn is_awaited_at_once(hir: &bun_sema::hir::File<'_>, bound: &Bound<'_>, call: ExprId) -> bool {
    let mut inner = call;
    while let Parent::Expr(outer) = bound.parent_of_expr(inner) {
        match hir[outer].kind {
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

fn add_all_that_they_load(
    files: &mut FxHashSet<FileId>,
    loaded_by: &FxHashMap<FileId, Vec<FileId>>,
    is_left_out: impl Fn(FileId) -> bool,
) {
    let mut to_follow: Vec<FileId> = files.iter().copied().collect();
    while let Some(file) = to_follow.pop() {
        for &target in loaded_by.get(&file).map_or(&[][..], |it| &it[..]) {
            if !is_left_out(target) && files.insert(target) {
                to_follow.push(target);
            }
        }
    }
}

/// The first way from an entry point to one of `goals` that a search by levels finds, which passes none of `without`.
fn find_way_to(
    entry_points: &[FileId],
    loaded_by: &FxHashMap<FileId, Vec<FileId>>,
    goals: &FxHashSet<FileId>,
    without: Option<FileId>,
) -> Option<Vec<FileId>> {
    let mut came_from: FxHashMap<FileId, Option<FileId>> = FxHashMap::default();
    let mut found: VecDeque<FileId> = VecDeque::new();
    for &entry_point in entry_points {
        if Some(entry_point) != without && came_from.insert(entry_point, None).is_none() {
            found.push_back(entry_point);
        }
    }
    while let Some(file) = found.pop_front() {
        if goals.contains(&file) {
            let mut way = vec![file];
            while let Some(&Some(before)) = came_from.get(way.last().unwrap()) {
                way.push(before);
            }
            return Some(way);
        }
        for &target in loaded_by.get(&file).map_or(&[][..], |it| &it[..]) {
            if Some(target) != without && !came_from.contains_key(&target) {
                came_from.insert(target, Some(file));
                found.push_back(target);
            }
        }
    }
    None
}

/// A call that may load any file stands in a file that has begun to run, and so has every file that all ways from the entry points to such a call
/// lead through: the call is not the first to load one of those. A file that leads to all of them lies on any one way.
fn find_files_on_every_way_to(
    entry_points: &[FileId],
    loaded_by: &FxHashMap<FileId, Vec<FileId>>,
    goals: &FxHashSet<FileId>,
) -> FxHashSet<FileId> {
    let way = find_way_to(entry_points, loaded_by, goals, None).unwrap_or_default();
    let is_on_every_way =
        |&file: &FileId| find_way_to(entry_points, loaded_by, goals, Some(file)).is_none();
    way.into_iter().filter(is_on_every_way).collect()
}

/// `require("a")`, `require("a").b`, `require("a")("name")`
fn only_loads(hir: &bun_sema::hir::File<'_>, loading_calls: &[ExprId], value: ExprId) -> bool {
    let is_constant = |argument: ExprId| {
        use ExprKind::{False, Null, Number, String, True};
        matches!(
            hir[argument].kind,
            String(_) | Number(_) | True | False | Null
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
fn only_takes_apart(hir: &bun_sema::hir::File<'_>, pattern: PatId) -> bool {
    let mut to_visit = vec![pattern];
    while let Some(pattern) = to_visit.pop() {
        match hir[pattern].kind {
            PatKind::Missing | PatKind::Ident(_) => {}
            PatKind::Object(properties) => {
                for property in properties.iter().map(|it| &hir[it]) {
                    if property.default.is_some() || matches!(property.key, PropKey::Computed(_)) {
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

/// Where the first statement at the top stands that does more than load a file and keep what it gets. Until then the file has called none of its functions
/// and has handed none to anybody.
fn find_where_top_does_more_than_load(
    hir: &bun_sema::hir::File<'_>,
    loading_calls: &[ExprId],
) -> u32 {
    let does_more = |&statement: &StmtId| match hir[statement].kind {
        StmtKind::Empty
        | StmtKind::Directive { .. }
        | StmtKind::Fn(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. } => false,
        StmtKind::Expr(value) => !only_loads(hir, loading_calls, value),
        StmtKind::Var(declarations) => declarations.iter().map(|it| &hir[it]).any(|it| {
            !only_takes_apart(hir, it.pat)
                || (it.init.is_some() && !only_loads(hir, loading_calls, it.init))
        }),
        _ => true,
    };
    let first = hir.ids(hir.body).find(does_more);
    first.map_or(u32::MAX, |statement: StmtId| hir[statement].start)
}

#[derive(Copy, Clone)]
enum Loaded {
    File(FileId),
    AnyFile,
}

/// One place in a file that loads another.
#[derive(Copy, Clone)]
struct Load {
    what: Loaded,
    when: LoadedWhen,
    /// An import statement: it loads ahead of the body of its file.
    is_ahead_of_body: bool,
    position: u32,
}

#[derive(Default)]
struct LoadsOfFile {
    /// In the order in which the file reaches them.
    loads: Vec<Load>,
    /// `find_where_top_does_more_than_load`
    does_more_than_load_from: u32,
}

/// Something other than the sure way down from the entry point may load a file from `time` on.
#[derive(Copy, Clone)]
struct Ask {
    time: u32,
    what: Loaded,
    may_be_caught: bool,
}

/// The files whose first run begins at the top with no handler around it: they have run, or have ended the process, when anybody else asks for them.
/// The top is followed in the order in which it runs, through the loads that no file passes by, and each file gets the time at which it begins. A call in a
/// function may run as soon as the top of its file does more than load, a call at the top where it stands; what such a call loads may run from then on, with
/// all that it loads in turn. A file that has not begun by then may be loaded by that call first.
fn find_files_that_top_loads_first(
    started: &[FileId],
    found_by_name: &[FileId],
    all_files: &[FileId],
    loads_of: &FxHashMap<FileId, LoadsOfFile>,
    is_commonjs: impl Fn(FileId) -> bool,
) -> FxHashSet<FileId> {
    struct Running {
        file: FileId,
        next_load: usize,
        has_begun_body: bool,
        functions_run_from: Option<u32>,
    }
    let begin = |file: FileId| Running {
        file,
        next_load: 0,
        has_begun_body: false,
        functions_run_from: None,
    };
    let loads_in = |file: FileId| loads_of.get(&file).map_or(&[][..], |it| &it.loads[..]);
    let mut time = 0;
    let mut began_at: FxHashMap<FileId, u32> = FxHashMap::default();
    let mut depth_of_running: FxHashMap<FileId, usize> = FxHashMap::default();
    // The functions that an ES module declares can be called ahead of its body by what it loads, where that loads the module in turn.
    let mut least_depth_imported_while_running = usize::MAX;
    let mut asks: Vec<Ask> = Vec::new();
    // Another thread starts there, where nothing has run.
    asks.extend(found_by_name.iter().map(|&file| Ask {
        time: 0,
        what: Loaded::File(file),
        may_be_caught: false,
    }));
    for &entry_point in started {
        let Entry::Vacant(has_not_begun) = began_at.entry(entry_point) else {
            continue;
        };
        time += 1;
        has_not_begun.insert(time);
        depth_of_running.insert(entry_point, 0);
        let mut running = vec![begin(entry_point)];
        while let Some(top) = running.last_mut() {
            let file = top.file;
            let load = loads_in(file).get(top.next_load).copied();
            if !top.has_begun_body && !load.is_some_and(|load| load.is_ahead_of_body) {
                time += 1;
                top.has_begun_body = true;
            }
            let does_more_from = loads_of
                .get(&file)
                .map_or(0, |it| it.does_more_than_load_from);
            if top.has_begun_body && !load.is_some_and(|load| load.position < does_more_from) {
                top.functions_run_from.get_or_insert(time);
            }
            top.next_load += 1;
            let functions_run_from = top.functions_run_from.unwrap_or(time);
            let Some(load) = load else {
                let depth = running.len() - 1;
                let is_imported_ahead_of_body =
                    depth >= least_depth_imported_while_running && !is_commonjs(file);
                let functions_run_from = match is_imported_ahead_of_body {
                    true => began_at[&file],
                    false => functions_run_from,
                };
                if depth <= least_depth_imported_while_running {
                    least_depth_imported_while_running = usize::MAX;
                }
                let in_functions = loads_in(file)
                    .iter()
                    .filter(|it| it.when == LoadedWhen::Later);
                asks.extend(in_functions.map(|load| Ask {
                    time: functions_run_from,
                    what: load.what,
                    may_be_caught: true,
                }));
                depth_of_running.remove(&file);
                running.pop();
                continue;
            };
            match (load.when, load.what) {
                (LoadedWhen::Later, _) => {}
                (LoadedWhen::AtTheTop, Loaded::File(target)) => {
                    if let Some(&depth) = depth_of_running.get(&target) {
                        least_depth_imported_while_running =
                            least_depth_imported_while_running.min(depth);
                    } else if let Entry::Vacant(has_not_begun) = began_at.entry(target) {
                        time += 1;
                        has_not_begun.insert(time);
                        depth_of_running.insert(target, running.len());
                        running.push(begin(target));
                    }
                }
                (when, what) => asks.push(Ask {
                    time,
                    what,
                    may_be_caught: when == LoadedWhen::AtTheTopAndCaught,
                }),
            }
        }
    }

    asks.shared_sort_by_key(|ask| ask.time);
    // Whether somebody may catch what the file throws where it is loaded ahead of its time.
    let mut loaded_early: FxHashMap<FileId, bool> = FxHashMap::default();
    let mut is_any_file_loaded_early = [false; 2];
    let mut to_follow: Vec<(Loaded, bool)> = Vec::new();
    for ask in asks {
        to_follow.push((ask.what, ask.may_be_caught));
        while let Some((what, may_be_caught)) = to_follow.pop() {
            let target = match what {
                Loaded::File(target) => target,
                Loaded::AnyFile => {
                    let is_new = !is_any_file_loaded_early[1]
                        && !std::mem::replace(
                            &mut is_any_file_loaded_early[may_be_caught as usize],
                            true,
                        );
                    if is_new {
                        let files = all_files.iter().map(|&file| Loaded::File(file));
                        to_follow.extend(files.map(|file| (file, may_be_caught)));
                    }
                    continue;
                }
            };
            if began_at.get(&target).is_some_and(|&at| at <= ask.time) {
                continue;
            }
            match loaded_early.insert(target, may_be_caught) {
                Some(true) => _ = loaded_early.insert(target, true),
                Some(false) if !may_be_caught => {}
                _ => to_follow.extend(loads_in(target).iter().map(|load| {
                    let catches =
                        matches!(load.when, LoadedWhen::AtTheTopAndCaught | LoadedWhen::Later);
                    (load.what, may_be_caught || catches)
                })),
            }
        }
    }
    let is_first = |file: &FileId| loaded_early.get(file) != Some(&true);
    began_at.into_keys().filter(is_first).collect()
}

/// `require()` runs a CommonJS file again whose last run threw. That takes somebody who caught the throw. A file that the top is the first to load has run, or
/// has ended the process, when a function that is called loads it: `find_files_that_top_loads_first`.
pub(super) fn find_files_that_run_again(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    evicted: &EvictedModules,
) -> Vec<ModuleRef> {
    let mut loaded_by: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    let mut loads_of: FxHashMap<FileId, LoadsOfFile> = FxHashMap::default();
    let mut caught_at_the_top: FxHashSet<FileId> = FxHashSet::default();
    let mut loaded_later: FxHashSet<FileId> = FxHashSet::default();
    let mut catch_any_file_at_the_top: FxHashSet<FileId> = FxHashSet::default();
    let mut is_any_file_loaded_later = false;
    for &file in &modules.compiled_files {
        if parsed_source(input.files, file).is_none() {
            continue;
        }
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        // In a layer below the test files a file of the runner's stands for them. What they load they load in tests, and the runner catches what a test throws.
        let stands_for_tests = is_written_by_test_runner(input.files.module(file).file_name());
        let mut first_return_at_the_top = None;
        let LoadsOfFile {
            loads,
            does_more_than_load_from,
        } = loads_of.entry(file).or_default();
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let mut is_ahead_of_body = false;
            let mut position = site.kind.call().map_or(0, |call| hir[call].pos);
            let mut when = match site.kind {
                ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call)
                | ImportSiteKind::RequireByTestRunner(call) => {
                    find_when_call_runs(hir, bound, call)
                }
                ImportSiteKind::ImportCall(call) | ImportSiteKind::ImportByTestRunner(call) => {
                    match find_when_call_runs(hir, bound, call) {
                        LoadedWhen::Later => LoadedWhen::Later,
                        when @ (LoadedWhen::AtTheTop | LoadedWhen::AtTheTopPerhaps)
                            if !stands_for_tests && is_awaited_at_once(hir, bound, call) =>
                        {
                            when
                        }
                        _ => LoadedWhen::AtTheTopAndCaught,
                    }
                }
                ImportSiteKind::ImportEquals(import) => {
                    position = hir[hir[import].stmt].start;
                    LoadedWhen::AtTheTop
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) => {
                    is_ahead_of_body = true;
                    LoadedWhen::AtTheTop
                }
                ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) => continue,
            };
            let is_one_of_several =
                matches!(answer, ScannedSite::Candidates(range) if range.end - range.start > 1);
            if when == LoadedWhen::AtTheTop
                && !is_ahead_of_body
                && (is_one_of_several
                    || position
                        > *first_return_at_the_top
                            .get_or_insert_with(|| find_first_return_at_the_top(hir)))
            {
                when = LoadedWhen::AtTheTopPerhaps;
            }
            let mut add = |what: Loaded| {
                loads.push(Load {
                    what,
                    when,
                    is_ahead_of_body,
                    position,
                })
            };
            let mut note = |target: ModuleRef| {
                let ModuleRef::File(target) = target else {
                    return;
                };
                loaded_by.entry(file).or_default().push(target);
                add(Loaded::File(target));
                match when {
                    LoadedWhen::AtTheTop | LoadedWhen::AtTheTopPerhaps => {}
                    LoadedWhen::AtTheTopAndCaught => _ = caught_at_the_top.insert(target),
                    LoadedWhen::Later => _ = loaded_later.insert(target),
                }
            };
            match answer {
                &ScannedSite::Module(target) => note(target),
                ScannedSite::Candidates(range) => {
                    let spelled = &scan.spellings[range.start as usize..range.end as usize];
                    spelled.iter().for_each(|spelled| note(spelled.module));
                }
                ScannedSite::AllModules => {
                    add(Loaded::AnyFile);
                    match when {
                        LoadedWhen::AtTheTop | LoadedWhen::AtTheTopPerhaps => {}
                        LoadedWhen::AtTheTopAndCaught => _ = catch_any_file_at_the_top.insert(file),
                        LoadedWhen::Later => is_any_file_loaded_later = true,
                    }
                }
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
        loads.shared_sort_by_key(|load| (!load.is_ahead_of_body, load.position));
        if loads.iter().any(|load| load.when == LoadedWhen::Later) {
            let calls = analysis
                .import_sites
                .iter()
                .filter_map(|site| site.kind.call());
            let mut calls: Vec<ExprId> = calls.collect();
            calls.shared_sort_unstable();
            *does_more_than_load_from = find_where_top_does_more_than_load(hir, &calls);
        }
    }
    let entry_points: Vec<FileId> = input
        .sources
        .entry_points()
        .iter()
        .map(|it| it.file)
        .collect();
    // A further entry point of an executable is there to be found by name.
    let starts =
        |it: &&EntryPoint| it.kind == EntryPointKind::Main || input.runner_starts_entry_points;
    let (started, mut found_by_name): (Vec<&EntryPoint>, Vec<&EntryPoint>) =
        input.sources.entry_points().iter().partition(starts);
    // Over layers every file of a part is one, for the programs that no build sees.
    found_by_name.retain(|it| it.kind == EntryPointKind::Additional && !input.runs_tests);
    let files_of = |entry_points: Vec<&EntryPoint>| -> Vec<FileId> {
        entry_points.iter().map(|it| it.file).collect()
    };
    let at_the_top = find_files_that_top_loads_first(
        &files_of(started),
        &files_of(found_by_name),
        &modules.compiled_files,
        &loads_of,
        |file| modules.find_commonjs_file(ModuleRef::File(file)).is_some(),
    );
    if !catch_any_file_at_the_top.is_empty() {
        let has_begun =
            find_files_on_every_way_to(&entry_points, &loaded_by, &catch_any_file_at_the_top);
        let files = modules.compiled_files.iter().copied();
        caught_at_the_top.extend(files.filter(|file| !has_begun.contains(file)));
    }
    if is_any_file_loaded_later {
        loaded_later.extend(modules.compiled_files.iter().copied());
    }
    loaded_later.retain(|file| !at_the_top.contains(file));
    add_all_that_they_load(&mut caught_at_the_top, &loaded_by, |_| false);
    add_all_that_they_load(&mut loaded_later, &loaded_by, |file| {
        at_the_top.contains(&file)
    });
    caught_at_the_top.extend(loaded_later);
    let run_again: Vec<ModuleRef> = caught_at_the_top
        .into_iter()
        .map(ModuleRef::File)
        .filter(|&file| modules.find_commonjs_file(file).is_some() && !evicted.contains(file))
        .collect();
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT modules | CommonJS files that may run again {}",
            run_again.len(),
        );
    }
    run_again
}

/// `import("./a.js?again")` loads the file once more, from disk. What stands in front of the `?` in each specifier that has one.
/// `None`: the `?` follows a part that nobody knows.
pub(crate) fn find_files_named_with_query<'a>(
    atoms: &'a bun_sema::atom::Interner<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
) -> Vec<Option<&'a [u8]>> {
    let before_query = |text: Atom| {
        let text = atoms.bytes(text);
        index_of_char(text, b'?').map(|at| &text[..at as usize])
    };
    let mut named = Vec::new();
    for site in analysis.import_sites {
        for specifier in analysis.alternatives_of(&site.specifier) {
            match *specifier {
                ImportSpecifier::Constant(text) => named.extend(before_query(text).map(Some)),
                ImportSpecifier::Pattern { prefix, suffix } => match before_query(prefix) {
                    Some(file) => named.push(Some(file)),
                    None => named.extend(before_query(suffix).map(|_| None)),
                },
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {}
            }
        }
    }
    named
}

// The compiled file that `importer` means with a path. `./a.js` may stand for `./a.ts`.
fn find_file_beside(
    by_path: &ReplacedModules<'_>,
    importer: &[u8],
    written: &[u8],
) -> Option<ModuleRef> {
    const WRITTEN_FOR_OUTPUT: [(&[u8], [&[u8]; 2]); 4] = [
        (b".js", [b".ts", b".tsx"]),
        (b".jsx", [b".tsx", b".tsx"]),
        (b".mjs", [b".mts", b".mts"]),
        (b".cjs", [b".cts", b".cts"]),
    ];
    if !written.starts_with(b"./") && !written.starts_with(b"../") && !is_absolute(written) {
        return None;
    }
    let mut buffer = path_buffer_pool::get();
    let directory = dirname::<platform::Auto>(importer);
    let path =
        join_abs_string_buf_checked::<platform::Auto>(directory, &mut buffer[..], &[written])?;
    let find = |path: Vec<u8>| match by_path.find(&ReplacedModule::File(path)) {
        Some(module @ ModuleRef::File(_)) => Some(module),
        _ => None,
    };
    find(path.to_vec()).or_else(|| {
        let (stem, sources) = (WRITTEN_FOR_OUTPUT.iter())
            .find_map(|(end, sources)| Some((path.strip_suffix(*end)?, sources)))?;
        (sources.iter()).find_map(|source| find([stem, source].concat()))
    })
}

/// A path that a file spells to a call which writes, moves or removes what is there.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct PathChangedOnDisk<Text> {
    pub path: Text,
    /// As `./a.js` in an import does. Any other starts at the working directory.
    pub starts_at_own_directory: bool,
    /// `ChangedPath::reaches_below`
    pub reaches_below: bool,
}

/// A path that the file does not spell is none: a test writes where it likes, mostly into a folder of its own, and a build that took every such call for one on a
/// file of the program would know nothing of any file.
pub(crate) fn find_paths_changed_on_disk(
    atoms: &bun_sema::atom::Interner<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
) -> Vec<PathChangedOnDisk<Atom>> {
    let mut paths = Vec::new();
    for changed in analysis.paths_of_changed_files {
        let starts_at_own_directory = analysis.is_path_from_own_directory(changed.operand)
            || analysis.find_resolved_form(changed.operand).is_some();
        for alternative in analysis.alternatives_of(&changed.path) {
            // Nothing lies at the empty path: `createWriteStream("", { fd })`. Joined to a folder it would be the folder.
            if let ImportSpecifier::Constant(path) = *alternative
                && !atoms.bytes(path).is_empty()
            {
                paths.push(PathChangedOnDisk {
                    path,
                    starts_at_own_directory,
                    reaches_below: changed.reaches_below,
                });
            }
        }
    }
    paths
}

/// `find_paths_changed_on_disk` of a file, each as a whole path, with `ChangedPath::reaches_below`.
pub(crate) fn find_whole_paths_changed_on_disk(
    files: &Files<'_>,
    file: FileId,
    working_directory: &[u8],
) -> Vec<(Vec<u8>, bool)> {
    let name = files.module(file).file_name();
    let changed = find_paths_changed_on_disk(&files.atoms, files.analysis(file));
    let whole = changed.into_iter().map(|changed| {
        let folder = match changed.starts_at_own_directory {
            true => &name[..last_index_of_char(name, b'/').unwrap_or(0)],
            false => working_directory,
        };
        let path = from_argument(folder, files.atoms.bytes(changed.path));
        (path, changed.reaches_below)
    });
    whole.collect()
}

// The files at `paths`, and all that lie below `folders`, each of which ends in `/`.
fn find_files_at(
    by_path: &ReplacedModules<'_>,
    paths: &[Vec<u8>],
    folders: &[Vec<u8>],
) -> Vec<ModuleRef> {
    let at_paths = paths.iter().filter_map(|path| by_path.files.get(&path[..]));
    let mut files: Vec<ModuleRef> = at_paths.map(|&file| ModuleRef::File(file)).collect();
    if !folders.is_empty() {
        let below = by_path.files.iter().filter(|(name, _)| {
            let mut folders = folders.iter();
            folders.any(|folder| name.starts_with(folder))
        });
        files.extend(below.map(|(_, &file)| ModuleRef::File(file)));
    }
    files
}

// The stage log says why every file of a run may load again.
fn say_why_every_file(input: &BindInput<'_, '_>, file: FileId, does: &str) {
    if logs_stages() {
        // The runner has written that file: it stands for the files above this layer, and says nothing of the user's.
        let whose = match is_written_by_test_runner(input.files.module(file).file_name()) {
            true => {
                "THE RUNNER's OWN STAND-IN for the files above this layer, not a file of the project: "
            }
            false => "",
        };
        bun_core::print_errorln!(
            "AOT test run | every file may load again: {}{} {}",
            whose,
            bstr::BStr::new(input.files.module(file).file_name()),
            does,
        );
    }
}

// A module that has not run yet is bound to what its imports name when it runs. Behind an eviction that is an instance from disk, which only code from disk
// imports: the run time leaves such a module to the loader of the host too (`Modules::isLeftToHost`).
fn add_importers(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    evicted: &mut FxHashSet<ModuleRef>,
) {
    let mut importers: FxHashMap<ModuleRef, Vec<FileId>> = FxHashMap::default();
    for &file in &modules.compiled_files {
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let is_statement = matches!(
                site.kind,
                ImportSiteKind::JsxRuntime
                    | ImportSiteKind::JsxPackage
                    | ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
                    | ImportSiteKind::ImportEquals(_)
            );
            if let (true, &ScannedSite::Module(target)) = (is_statement, answer) {
                importers.entry(target).or_default().push(file);
            }
        }
    }
    let mut to_follow: Vec<ModuleRef> = evicted.iter().copied().collect();
    while let Some(module) = to_follow.pop() {
        for &importer in importers.get(&module).map_or(&[][..], |it| &it[..]) {
            let importer = ModuleRef::File(importer);
            for form in core::iter::once(importer).chain(modules.forms_of(importer)) {
                if evicted.insert(form) {
                    to_follow.push(form);
                }
            }
        }
    }
}

pub(super) fn find_evicted_modules(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> EvictedModules {
    let mut evicted = EvictedModules::default();
    if !input.runs_tests {
        return evicted;
    }
    evicted.is_every_module = input.evicts_any_module;
    if input.evicts_any_module && logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | every file may load again: the scan of the test files says so"
        );
    }
    let by_path = ReplacedModules::of_every_file(input, modules);
    let out_of_sight = input.evicted_modules.iter();
    (evicted.modules).extend(out_of_sight.filter_map(|module| by_path.find(module)));
    let is_thrower = |required: &ModuleRef| {
        modules
            .find_commonjs_file(*required)
            .is_some_and(|thrower| {
                !contains(input.files.module(thrower).file_name(), b"/node_modules/")
            })
    };
    let out_of_sight = input.files_that_tests_load.where_throws_are_caught.iter();
    let out_of_sight = out_of_sight.filter_map(|module| by_path.find(module));
    evicted.modules.extend(out_of_sight.filter(is_thrower));
    // `rmSync(folder, { recursive: true })` in a test file that this build does not see: `ReplacedByTests::evicted_modules` has the folder with `/` at its end.
    let out_of_sight = input.evicted_modules.iter();
    let mut folders_changed_on_disk: Vec<Vec<u8>> = out_of_sight
        .filter_map(ReplacedModule::file_path)
        .filter(|path| path.ends_with(b"/"))
        .cloned()
        .collect();
    let mut paths_changed_on_disk: Vec<Vec<u8>> = Vec::new();
    for &file in &modules.compiled_files {
        if !matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        ) {
            continue;
        }
        for written in find_files_named_with_query(&input.files.atoms, input.files.analysis(file)) {
            // A file that is reached only under a query is never compiled, so nobody has read its text: it may name any file of the program.
            // Where the host alone runs what the build has not seen, what nobody named is refused by name: the copy is as one that loads again.
            let Some(written) = written.filter(|_| input.host_runs_files_from_disk) else {
                say_why_every_file(input, file, "loads a file under a query");
                evicted.is_every_module = true;
                continue;
            };
            let importer = input.files.module(file).file_name();
            evicted
                .modules
                .extend(find_file_beside(&by_path, importer, written));
        }
        let Some(builtins) = parsed_source(input.files, file).map(|source| &source.builtins) else {
            continue;
        };
        if builtins.loses_sight_of_module_cache() {
            say_why_every_file(
                input,
                file,
                "hands require.cache on, names Bun.plugin or resetModules of the test runner, or stores a loader into Module._extensions",
            );
            evicted.is_every_module = true;
        }
        evicted.is_every_export_asked_for |= builtins.reaches_module_cache();
        evicted.is_table_reached |= builtins.reaches_module_cache();
        evicted.are_entries_read |= builtins.reads_entries_of_module_cache();
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        let changed = find_whole_paths_changed_on_disk(input.files, file, input.working_directory);
        for (path, reaches_below) in changed {
            if reaches_below {
                folders_changed_on_disk.push([&path[..], b"/"].concat());
            }
            paths_changed_on_disk.push(path);
        }
        // A CommonJS file whose body throws is out of the table, and the next `require()` runs it again.
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            if let (ImportSiteKind::Require(call), &ScannedSite::Module(required)) =
                (site.kind, answer)
                && is_thrower(&required)
                && stands_where_a_throw_is_caught(hir, bound, call)
            {
                evicted.modules.insert(required);
            }
        }
        for &key in builtins.keys_taken_out_of_module_cache() {
            match find_file_of_key(hir, bound, analysis, key) {
                FileOfKey::Path(path) => {
                    let path = ReplacedModule::File(input.files.atoms.bytes(path).to_vec());
                    evicted.modules.extend(by_path.find(&path));
                }
                FileOfKey::Site(site) => match scan.sites[site] {
                    ScannedSite::Module(module) => {
                        evicted.modules.insert(module);
                    }
                    ScannedSite::Candidates(ref range) => {
                        evicted.modules.extend(scan.modules_spelled_in(range));
                    }
                    ScannedSite::AllModules => {
                        say_why_every_file(
                            input,
                            file,
                            "takes require.cache[require.resolve(name)] out for a name that it does not spell",
                        );
                        evicted.is_every_module = true;
                    }
                    ScannedSite::Unresolved | ScannedSite::Erased => {}
                },
                FileOfKey::Unknown => {
                    say_why_every_file(
                        input,
                        file,
                        "takes a key out of require.cache that it does not spell",
                    );
                    evicted.is_every_module = true;
                }
            }
        }
    }
    paths_changed_on_disk.shared_sort_unstable();
    paths_changed_on_disk.dedup();
    folders_changed_on_disk.shared_sort_unstable();
    folders_changed_on_disk.dedup();
    let mut changed_on_disk =
        find_files_at(&by_path, &paths_changed_on_disk, &folders_changed_on_disk);
    evicted.modules.extend(&changed_on_disk);
    for module in changed_on_disk.iter().filter(|_| logs_stages()) {
        if let ModuleRef::File(file) = *module {
            bun_core::print_errorln!(
                "AOT test run | the run writes, moves or removes a file of its own, which is compared with the disk before it loads: {}",
                bstr::BStr::new(input.files.module(file).file_name()),
            );
        }
    }
    // A file of data names nothing.
    changed_on_disk.retain(|module| {
        matches!(*module, ModuleRef::File(file) if input.sources.kind(file) != SourceKind::Data)
    });
    let forms = changed_on_disk.iter().flat_map(|&it| modules.forms_of(it));
    evicted.changed_on_disk = forms.chain(changed_on_disk.iter().copied()).collect();
    // The new text names what it likes.
    evicted.is_every_export_asked_for |= !changed_on_disk.is_empty();
    evicted.copies_name_any_file |= !changed_on_disk.is_empty();
    if evicted.is_every_module {
        evicted.modules.clear();
        return evicted;
    }
    evicted
        .modules
        .retain(|module| matches!(module, ModuleRef::File(_)));
    let forms: Vec<ModuleRef> = (evicted.modules.iter())
        .flat_map(|&it| modules.forms_of(it))
        .collect();
    evicted.modules.extend(forms);
    add_importers(input, scans, modules, &mut evicted.modules);
    // The original beside its mock is a copy from disk too: `vi.importActual()`, `importOriginal()`, a mock without a factory.
    let mocked = find_mocked_modules(input, scans, modules);
    if mocked.is_every_module() {
        evicted.is_every_export_asked_for = true;
        evicted.copies_name_any_file = true;
    }
    for &module in evicted.modules.iter().chain(mocked.iter()) {
        let ModuleRef::File(file) = module else {
            continue;
        };
        let Some(scan) = scans.find(file) else {
            continue;
        };
        for answer in &scan.sites {
            match *answer {
                ScannedSite::Module(named) => {
                    evicted.named_by_copies.insert(named);
                }
                ScannedSite::Candidates(ref range) => {
                    let named = scan.modules_spelled_in(range);
                    evicted.named_by_copies.extend(named);
                }
                ScannedSite::AllModules => {
                    evicted.is_every_export_asked_for = true;
                    evicted.copies_name_any_file = true;
                }
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    // `load::manual_mocks`: the test runner asks for the file by its path, and takes whatever it exports.
    if mocked.is_every_module() || mocked.iter().next().is_some() {
        let files = modules.compiled_files.iter().copied();
        let in_folder =
            files.filter(|&file| contains(input.files.module(file).file_name(), b"/__mocks__/"));
        (evicted.named_by_copies).extend(in_folder.map(ModuleRef::File));
    }
    add_files_named_below_files_left_to_loader(input, modules, &mut evicted);
    // A copy links to a name through the files that hand it on, and the loader asks each of them for it: `export { isUpKey } from "./lib/key"`.
    let mut handing_on: Vec<ModuleRef> = evicted.named_by_copies.iter().copied().collect();
    while let Some(module) = handing_on.pop() {
        let ModuleRef::File(file) = module else {
            continue;
        };
        let Some(scan) = scans.find(file) else {
            continue;
        };
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            let hands_on = matches!(
                site.kind,
                ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
            );
            if let ScannedSite::Module(source) = *answer
                && hands_on
                && evicted.named_by_copies.insert(source)
            {
                handing_on.push(source);
            }
        }
    }
    let forms: Vec<ModuleRef> = (evicted.named_by_copies.iter())
        .flat_map(|&it| modules.forms_of(it))
        .collect();
    evicted.named_by_copies.extend(forms);
    if input.copies_name_no_file {
        evicted.named_by_copies.clear();
    }
    evicted
}

// The loader reads a file that is left to it from disk, as it reads a copy, and asks for what the text names. `export { absent } from "./lib.js"`:
// it is the link to lib.js that fails. A mock of lib.js may have the name, and then the file runs.
fn add_files_named_below_files_left_to_loader(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    evicted: &mut EvictedModules,
) {
    if input.loads_below_files_left_to_loader.is_empty() {
        return;
    }
    let held = modules.record_files.iter();
    let held: FxHashMap<&[u8], FileId> = held
        .map(|&file| (to_native(input.files.module(file).file_name()), file))
        .collect();
    for below in input.loads_below_files_left_to_loader {
        let mut is_followed = vec![false; below.files.len()];
        let mut to_follow: Vec<u32> = (0..below.left_count as u32).collect();
        while let Some(place) = to_follow.pop() {
            if core::mem::replace(&mut is_followed[place as usize], true) {
                continue;
            }
            let file = &below.files[place as usize];
            let is_left = (place as usize) < below.left_count;
            if let Some(&held) = held.get(&file.path[..]).filter(|_| !is_left) {
                evicted.named_by_copies.insert(ModuleRef::File(held));
                continue;
            }
            if file.loads_unknown_files {
                evicted.is_every_export_asked_for = true;
                evicted.copies_name_any_file = true;
            }
            to_follow.extend_from_slice(&file.loads);
        }
    }
}

/// `require.cache["fs"] = { exports: fake }`: from then on `require("fs")` answers with what the entry exports, and `require("node:fs")` with the module.
/// `overridableRequire` in CommonJS.ts looks in the table for a name in front of which the resolver puts `node:`. These are the modules for which a file spells such a key.
#[derive(Default)]
pub(super) struct LibraryModulesStoredInCache {
    modules: FxHashSet<RuntimeModule>,
    /// The others that a `require` of the program names without `node:`. It is compiled for the module, so the run time refuses an entry under such a name.
    held_under_name_without_prefix: FxHashSet<RuntimeModule>,
    /// `bun run` reads `require("fs")` as `require("node:fs")` in a CommonJS file that an import loads, and as it is written in one that `require` loads.
    /// The first load counts, and the statements of a program are followed before any of its code runs.
    commonjs_files_that_imports_load: FxHashSet<FileId>,
    commonjs_files_tracking_first_load: FxHashSet<FileId>,
}

/// The key under which `require(name)` looks, and the module that it answers with where nothing stands there.
/// A module of Bun's own (`bun:sqlite`, `ws`) is looked for under its one name. `require("bun")` is read as `Bun`.
fn find_key_and_module_looked_up_in_cache(name: &[u8]) -> Option<(&[u8], RuntimeModule)> {
    let alias = Alias::get(name, Target::Bun, Cfg::default())?;
    let path = alias.path.as_bytes();
    let key = if path.starts_with(b"node:") {
        name
    } else {
        path
    };
    let module = table::module_by_specifier(path)?;
    (!key.starts_with(b"node:") && module != RuntimeModule::Bun).then_some((key, module))
}

fn find_module_looked_up_in_cache(name: &[u8]) -> Option<RuntimeModule> {
    find_key_and_module_looked_up_in_cache(name).map(|(_, module)| module)
}

fn find_module_stored_under(key: &[u8]) -> Option<RuntimeModule> {
    let (looked_under, module) = find_key_and_module_looked_up_in_cache(key)?;
    (looked_under == key).then_some(module)
}

pub(crate) fn find_names_that_unspelled_keys_may_be(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    atoms: &Interner<'_>,
    builtins: &ResolvedBuiltins,
) -> Vec<&'static [u8]> {
    let mut keys: Vec<(&[u8], Option<&[u8]>)> = Vec::new();
    if builtins.hands_module_cache_on() {
        keys.push((b"", Some(b"")));
    }
    for &key in builtins.keys_stored_in_module_cache() {
        let text = match (find_file_of_key(hir, bound, analysis, key), key) {
            (FileOfKey::Path(_), _) | (FileOfKey::Unknown, KeyOfModuleCache::Text(_)) => continue,
            (FileOfKey::Site(site), _) => &analysis.import_sites[site].specifier,
            (FileOfKey::Unknown, KeyOfModuleCache::Computed(key)) => analysis
                .find_key_stored_in_cache(key)
                .unwrap_or(&ImportSpecifier::Unknown),
        };
        keys.extend((analysis.alternatives_of(text).iter()).map(
            |alternative| match *alternative {
                ImportSpecifier::Constant(text) => (atoms.bytes(text), None),
                ImportSpecifier::Pattern { prefix, suffix } => {
                    (atoms.bytes(prefix), Some(atoms.bytes(suffix)))
                }
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => (&b""[..], Some(&b""[..])),
            },
        ));
    }
    if keys.is_empty() {
        return Vec::new();
    }
    let may_be = |name: &[u8]| {
        keys.iter().any(|&(start, end)| match end {
            None => name == start,
            Some(end) => {
                name.len() >= start.len() + end.len()
                    && name.starts_with(start)
                    && name.ends_with(end)
            }
        })
    };
    let names = BUN_ALIASES.iter().copied().flatten().map(|entry| entry.0);
    names
        .filter(|name| may_be(name) && find_module_stored_under(name).is_some())
        .collect()
}

impl LibraryModulesStoredInCache {
    pub(super) fn may_stand_under(&self, name: &[u8]) -> bool {
        !self.modules.is_empty()
            && find_module_looked_up_in_cache(name)
                .is_some_and(|module| self.modules.contains(&module))
    }

    pub(super) fn is_held_under_name_without_prefix(&self, module: RuntimeModule) -> bool {
        self.held_under_name_without_prefix.contains(&module)
    }

    pub(super) fn is_commonjs_file_that_imports_load(&self, file: FileId) -> bool {
        self.commonjs_files_that_imports_load.contains(&file)
    }

    pub(super) fn tracks_first_load(&self, file: FileId) -> bool {
        self.commonjs_files_tracking_first_load.contains(&file)
    }

    pub(super) fn files_tracking_first_load(&self) -> impl Iterator<Item = FileId> + '_ {
        self.commonjs_files_tracking_first_load.iter().copied()
    }

    /// Nobody knows what `require` answers for the module.
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::Runtime(module) if self.modules.contains(&module))
    }
}

fn find_commonjs_files_that_imports_load(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> FxHashSet<FileId> {
    let [mut by_statement, mut by_call, mut required] = <[FxHashSet<FileId>; 3]>::default();
    let by_path = ReplacedModules::of_every_file(input, modules);
    let loaded = input.files_that_tests_load;
    for (paths, files) in [
        (&loaded.by_statements, &mut by_statement),
        (&loaded.by_calls, &mut by_call),
        (&loaded.by_require, &mut required),
    ] {
        let targets = paths.iter().filter_map(|path| by_path.find(path));
        files.extend(targets.filter_map(|target| modules.find_commonjs_file(target)));
    }
    for &file in &modules.compiled_files {
        // It names what the test files name, and does not say how they load it. The scan of the test files does.
        if input.stand_in_for_files_from_disk == Some(file) {
            continue;
        }
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let &ScannedSite::Module(target) = answer else {
                continue;
            };
            let Some(target) = modules.find_commonjs_file(target) else {
                continue;
            };
            match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) => by_statement.insert(target),
                ImportSiteKind::ImportCall(_) => by_call.insert(target),
                ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportEquals(_) => required.insert(target),
                _ => false,
            };
        }
    }
    by_statement.extend(by_call.difference(&required));
    by_statement
}

fn find_commonjs_files_tracking_first_load(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    stored: &LibraryModulesStoredInCache,
) -> FxHashSet<FileId> {
    let mut files = FxHashSet::default();
    if stored.modules.is_empty() {
        return files;
    }
    let may_find_entry = |written: Atom| {
        let written = input.files.atoms.bytes(written);
        let name = Alias::bun_prefixed_builtin(written).unwrap_or(written);
        stored.may_stand_under(name)
            && Alias::get(name, Target::Bun, Cfg::default()).is_some_and(|alias| alias.node_builtin)
    };
    for &file in &modules.compiled_files {
        let is_of_program = matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        );
        if !is_of_program || modules.find_commonjs_file(ModuleRef::File(file)).is_none() {
            continue;
        }
        let analysis = input.files.analysis(file);
        let is_require = |kind: ImportSiteKind| {
            matches!(
                kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
            )
        };
        let sites = analysis.import_sites.iter();
        let is_written = sites.filter(|site| is_require(site.kind)).any(|site| {
            (analysis.alternatives_of(&site.specifier).iter()).any(|alternative| {
                matches!(*alternative, ImportSpecifier::Constant(written) if may_find_entry(written))
            })
        });
        let named =
            parsed_source(input.files, file).map_or(&[][..], |source| source.named_modules());
        if is_written || named.iter().any(|named| may_find_entry(named.name)) {
            files.insert(file);
        }
    }
    files
}

// `createRequire(import.meta.url)("fs")`, and a name that holds `require`. `process.getBuiltinModule(flag ? "vm" : "v8")` looks in no table.
fn is_argument_of_require(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    argument: ExprId,
) -> bool {
    let mut operand = argument;
    while let Parent::Expr(parent) = bound.parent_of_expr(operand)
        && hir.type_assertion_operand(parent) == Some(operand)
    {
        operand = parent;
    }
    let Parent::Expr(user) = bound.parent_of_expr(operand) else {
        return false;
    };
    let ExprKind::Call(call) = hir[user].kind else {
        return false;
    };
    let callee = hir[call].callee;
    hir.ids(hir[call].args).next() == Some(operand)
        && (is_made_require(hir, bound, callee)
            || resolve_loader_alias(hir, bound, &analysis.decisions, callee).is_some())
}

fn find_modules_held_under_name_without_prefix(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    stored: &LibraryModulesStoredInCache,
) -> FxHashSet<RuntimeModule> {
    let mut held = FxHashSet::default();
    let mut hold = |written: Atom, is_answer: &dyn Fn(RuntimeModule) -> bool| {
        let written = input.files.atoms.bytes(written);
        let name = Alias::bun_prefixed_builtin(written).unwrap_or(written);
        if let Some(module) = find_module_looked_up_in_cache(name)
            && is_answer(module)
            && !stored.modules.contains(&module)
        {
            held.insert(module);
        }
    };
    for &file in &modules.compiled_files {
        let is_of_program = matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        );
        if !is_of_program || stored.is_commonjs_file_that_imports_load(file) {
            continue;
        }
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            if !matches!(
                site.kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
            ) {
                continue;
            }
            // A program above others leaves Bun's own modules to the host.
            let is_answer = |module: RuntimeModule| match *answer {
                ScannedSite::Module(answer) => answer == ModuleRef::Runtime(module),
                ScannedSite::Candidates(ref range) => {
                    let mut named = scan.modules_spelled_in(range);
                    named.any(|named| named == ModuleRef::Runtime(module))
                }
                ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => false,
            };
            for alternative in analysis.alternatives_of(&site.specifier) {
                if let ImportSpecifier::Constant(written) = *alternative {
                    hold(written, &is_answer);
                }
            }
        }
        let named =
            parsed_source(input.files, file).map_or(&[][..], |source| source.named_modules());
        for named in named {
            if is_argument_of_require(hir, bound, analysis, named.argument) {
                hold(named.name, &|module| module == named.module);
            }
        }
    }
    held
}

pub(super) fn find_library_modules_stored_in_cache(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> LibraryModulesStoredInCache {
    let mut stored = LibraryModulesStoredInCache::default();
    // The scan of the test files writes each module of the library under its one name.
    for module in input.evicted_modules {
        let ReplacedModule::File(name) = module else {
            continue;
        };
        stored.modules.extend(match name.starts_with(b"node:") {
            true => table::module_by_specifier(name),
            false => find_module_stored_under(name),
        });
    }
    for &file in &modules.compiled_files {
        if !matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        ) {
            continue;
        }
        let Some(builtins) = parsed_source(input.files, file).map(|source| &source.builtins) else {
            continue;
        };
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let analysis = input.files.analysis(file);
        let bytes_of = |name: Atom| input.files.atoms.bytes(name);
        for &key in builtins.keys_stored_in_module_cache() {
            let name = match find_file_of_key(hir, bound, analysis, key) {
                FileOfKey::Path(name) => name,
                // `require.resolve` answers the name of a Node.js module as it is asked.
                FileOfKey::Site(site) => match analysis.import_sites[site].specifier {
                    ImportSpecifier::Constant(name) => name,
                    _ => continue,
                },
                FileOfKey::Unknown => continue,
            };
            (stored.modules).extend(find_module_stored_under(bytes_of(name)));
        }
        if !input.runs_tests {
            continue;
        }
        let names = find_names_that_unspelled_keys_may_be(
            hir,
            bound,
            analysis,
            &input.files.atoms,
            builtins,
        );
        if !names.is_empty() && logs_stages() {
            bun_core::print_errorln!(
                "AOT test run | an entry in require.cache may answer require() of {} modules of the library: {} stores under a key that it does not spell, or hands the table on",
                names.len(),
                bstr::BStr::new(input.files.module(file).file_name()),
            );
        }
        let modules = names.into_iter().filter_map(find_module_stored_under);
        stored.modules.extend(modules);
    }
    stored.commonjs_files_that_imports_load =
        find_commonjs_files_that_imports_load(input, scans, modules);
    stored.commonjs_files_tracking_first_load =
        find_commonjs_files_tracking_first_load(input, modules, &stored);
    stored.held_under_name_without_prefix =
        find_modules_held_under_name_without_prefix(input, scans, modules, &stored);
    stored
}
