use crate::build::Problem;
use crate::declared::{Declared, DeclaredTable, Part};
use crate::format::line_table;
use crate::fragment::{Definition, Fragment, FuncKey, Function, FunctionOutline, Ids, LayoutKey, LocalToProgram, ReferenceCollector, ReferencedIds, ModulePart, NO_FILE, Notes, Outline, OutlineBatch, ProgramIds, RuntimeModule, Shape, Summary, Used, for_each_func_id, for_each_global_id, for_each_layout_id, outline_flags};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Def, Func, FuncKind, Layout, LayoutKind, Literal, NO_VARIABLE, Op, Operation, Prediction, Program, Strs, Term, CoerceReason, class_flags, field_flags, func_flags, method_flags};
use bun_sema::aot_rules::{Rule, Severity};
use bun_sema::atom::Atom;
use bun_sema::check::task::Finished;
use bun_sema::check::{SubtypeAnswer, Checker, CompilerDiagnostic, ConstantSymbol, FieldKey, Identity, Int32Verdict, KindsDeclared, MethodStore, FlowNotes, NumberFlow, Program as Checked, SubtypeQuery, ReplacedMethods, compute_ecma_line_starts, expected_int32};
use bun_sema::hir::{self, ClassId, Flags, StmtKind};
use bun_sema::program::{Builtin, FileId, LoadedBy};
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::types::TypeId;
use bun_sema::util::{InParallel, for_each_mut};
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::mem::MaybeUninit;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

mod exports;
mod by_name;
mod costs;
mod interpreted;
mod nullish;
mod reads;
mod reuse;
mod literal_structures;
mod throws;
mod typedness;

pub use typedness::Typedness;

#[derive(Default)]
pub struct Linked {
    pub program: Program,
    pub problems: Vec<Problem>,
    pub members: String,
    pub explained: Vec<String>,
    pub errors: Vec<Option<OutsideProgramReason>>,
    pub skipped_builtin_modules: Vec<(u32, Problem)>,
    pub skipped_builtin_functions: Vec<(u32, Problem)>,
    pub found: Vec<CompilerDiagnostic>,
    pub typedness: Typedness,
    pub times: Times,
    pub(crate) failure_check: Option<FailureCheck>,
}

pub(crate) struct FailureCheck {
    setup: throws::Setup,
    modules: Vec<FileId>,
}

impl Linked {
    pub fn find_always_failing_sites<T: Send>(&mut self, checked: &Checked<'_>, in_parallel: InParallel<'_>, beside: impl FnOnce(&Program) -> T + Send) -> T {
        let mut since = Instant::now();
        let Linked { program, found, failure_check, .. } = self;
        let program: &Program = program;
        let result = std::thread::scope(|scope| {
            let beside = spawn_outside_pool(scope, || beside(program));
            if let Some(FailureCheck { setup, modules }) = failure_check.take() {
                found.extend(always_failing_sites(checked, program, &setup, &modules, in_parallel));
            }
            beside.join().expect("the thread beside the failure check panicked")
        });
        self.times.add("what always fails", &mut since);
        result
    }
}

fn always_failing_sites(checked: &Checked<'_>, program: &Program, setup: &throws::Setup, modules: &[FileId], in_parallel: InParallel<'_>) -> Vec<CompilerDiagnostic> {
    let logs_type_errors = checked.checker().logs_type_errors();
    let mut directives = bun_sema::check::CommentDirectives::default();
    throws::find_always_failing_sites(program, setup, in_parallel).iter().filter_map(|site| {
        let span = |module: u32, pos: u32| {
            let file = modules[module as usize];
            let hir = checked.files.hir(file);
            (file, pos, bun_sema::check::spans::token_end(&hir.text, pos as usize, hir.kind == hir::FileKind::Tsx) as u32)
        };
        let (file, start, end) = span(site.module, site.pos);
        if directives.silence(file, checked.files.hir(file), start) {
            return None;
        }
        let (code, args) = site.message();
        let code = if code == 100013 && logs_type_errors && site.continues_when_logged() { 100019 } else { code };
        let (code, args) = match bun_sema::messages::message(code) {
            Some((bun_sema::messages::Category::Error, words)) if checked.files.hir(file).is_js && is_in_try_block_with_catch(checked, file, start) => {
                let mut said = Vec::new();
                bun_sema::messages::format(&mut said, words, &args);
                (100020, vec![said])
            }
            _ => (code, args),
        };
        let related = site.origin.iter().filter(|origin| origin.0 != u32::MAX && origin.1 != 0 && (origin.0, origin.1) != (site.module, site.pos)).map(|(module, pos, what)| {
            let (file, start, end) = span(*module, *pos);
            CompilerDiagnostic { file, start, end, code: 100018, args: vec![what.clone().into_bytes()], related: Vec::new() }
        });
        Some(CompilerDiagnostic { file, start, end, code, args, related: related.collect() })
    }).collect()
}

#[derive(Default, Copy, Clone)]
pub struct Explain {
    pub foreign: bool,
    pub includes_builtin_modules: bool,
    pub mutations: bool,
    pub fields: bool,
    pub integers: bool,
    pub plugins: bool,
    pub progress: Option<fn(std::fmt::Arguments<'_>)>,
    pub deferred: bool,
    pub rows: bool,
    pub joins: bool,
    pub given: bool,
    pub throws: bool,
    pub throws_json: bool,
    pub throws_all: bool,
    pub rules_json: bool,
    pub costs: bool,
    pub costs_json: bool,
}

impl Explain {
    pub const REPORTS: [&'static str; 7] = ["throws", "throws-all", "throws-json", "throws-all-json", "rules-json", "costs", "costs-json"];
    pub const WORDS: [&'static str; 15] = ["mutations", "costs", "costs-json", "deferred", "fields", "foreign", "given", "integers", "joins", "plugins", "rows", "throws", "throws-all", "throws-all-json", "throws-json"];

    pub fn set(&mut self, word: &[u8]) -> bool {
        let asked = match word {
            b"mutations" => &mut self.mutations,
            b"" | b"costs" => &mut self.costs,
            b"costs-json" => &mut self.costs_json,
            b"deferred" => &mut self.deferred,
            b"fields" => &mut self.fields,
            b"foreign" => &mut self.foreign,
            b"given" => &mut self.given,
            b"integers" => &mut self.integers,
            b"plugins" => &mut self.plugins,
            b"rows" => &mut self.rows,
            b"rules-json" => &mut self.rules_json,
            b"joins" => &mut self.joins,
            b"throws" => &mut self.throws,
            b"throws-json" => &mut self.throws_json,
            b"throws-all" | b"throws-all-json" => {
                self.throws_all = true;
                if word == b"throws-all" { &mut self.throws } else { &mut self.throws_json }
            }
            _ => return false,
        };
        *asked = true;
        true
    }
}

#[derive(Default)]
pub struct Times {
    pub steps: Vec<(&'static str, Duration)>,
    pub rounds: usize,
    pub layouts_described: usize,
}

impl Times {
    fn add(&mut self, step: &'static str, since: &mut Instant) {
        let spent = std::mem::replace(since, Instant::now()).elapsed();
        match self.steps.iter_mut().find(|known| known.0 == step) {
            Some(known) => known.1 += spent,
            None => self.steps.push((step, spent)),
        }
    }
}

pub type Describe<'a> = &'a (dyn Fn(&mut Checker<'_, '_>, &[TypeId], &dyn Fn(Identity) -> bool) -> Fragment + Sync);

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct FragmentIndex {
    fragment: u32,
    index: u32,
}

impl FragmentIndex {
    fn new(fragment: usize, index: usize) -> FragmentIndex {
        FragmentIndex { fragment: fragment as u32, index: index as u32 }
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord)]
enum ReferencedBy {
    #[default]
    Entry,
    Func(FragmentIndex),
    Layout(FragmentIndex),
}

fn text_of(strs: &Strs, name: StrId) -> String {
    if name.is_none() { String::new() } else { bstr::BStr::new(strs.get(name)).to_string() }
}

fn func_name(fragments: &[Fragment], at: FragmentIndex) -> String {
    let fragment = &fragments[at.fragment as usize];
    let function = &fragment.funcs[at.index as usize];
    let name = function.func.as_ref().map_or_else(String::new, |func| text_of(&fragment.strs, func.name));
    format!("the function `{name}` ({:?})", function.key)
}

fn layout_name(fragments: &[Fragment], at: FragmentIndex) -> String {
    let fragment = &fragments[at.fragment as usize];
    let shape = &fragment.layouts[at.index as usize];
    format!("the layout `{}` ({:x?})", text_of(&fragment.strs, shape.name), shape.key)
}

impl ReferencedBy {
    fn name(self, fragments: &[Fragment]) -> String {
        match self {
            ReferencedBy::Entry => "the entry point".to_owned(),
            ReferencedBy::Func(at) => func_name(fragments, at),
            ReferencedBy::Layout(at) => layout_name(fragments, at),
        }
    }

    fn problem(self, fragments: &[Fragment], nowhere: FileId, what: String) -> Problem {
        let (file, pos) = match self {
            ReferencedBy::Entry => (nowhere, 0),
            ReferencedBy::Func(at) => {
                let function = &fragments[at.fragment as usize].funcs[at.index as usize];
                (function.key.file(), function.func.as_ref().map_or(0, |func| func.pos))
            }
            ReferencedBy::Layout(at) => {
                let fragment = &fragments[at.fragment as usize];
                (fragment.layouts[at.index as usize].key.file().unwrap_or(if fragment.file == NO_FILE { nowhere } else { fragment.file }), 0)
            }
        };
        Problem { file, pos, what: what.into() }
    }
}

#[derive(Default)]
struct Index {
    funcs: Vec<AtomicU64>,
    layouts: Vec<AtomicU64>,
    globals: Vec<AtomicU64>,
    by_file: FxHashMap<FileId, u32>,
    outline: Outline,
}

const NOT_FOUND: u64 = u64::MAX;

fn prefer(known: &[AtomicU64], id: u32, at: FragmentIndex, has_last_word: bool) {
    known[id as usize].fetch_min(u64::from(!has_last_word) << 63 | u64::from(at.fragment) << 32 | u64::from(at.index), Ordering::Relaxed);
}

fn preferred(known: &[AtomicU64], id: u32) -> Option<FragmentIndex> {
    let found = known.get(id as usize)?.load(Ordering::Relaxed);
    (found != NOT_FOUND).then_some(FragmentIndex { fragment: (found >> 32) as u32 & (u32::MAX >> 1), index: found as u32 })
}

impl Index {
    fn grow(&mut self, ids: &ProgramIds) {
        self.funcs.resize_with(ids.funcs.bound(), || AtomicU64::new(NOT_FOUND));
        self.layouts.resize_with(ids.layouts.bound(), || AtomicU64::new(NOT_FOUND));
        self.globals.resize_with(ids.globals.bound(), || AtomicU64::new(NOT_FOUND));
        self.outline.grow(ids);
    }

    fn extend_outline(&mut self, fragments: &mut [Fragment], first: usize, in_parallel: InParallel<'_>) {
        const FUNCTIONS_PER_BATCH: usize = 2048;
        let mut batches: Vec<OutlineBatch<'_>> = Vec::with_capacity(fragments.len());
        for (fragment_index, fragment) in fragments.iter_mut().enumerate() {
            let Fragment { funcs, layouts, globals, program_ids, summary, file, .. } = fragment;
            let (program_ids, summary): (&LocalToProgram, &Summary) = (program_ids, summary);
            let (fragment_index, mut tables) = ((first + fragment_index) as u32, Some((&mut layouts[..], &globals[..])));
            let mut chunks = funcs.chunks_mut(FUNCTIONS_PER_BATCH);
            let mut first_function = 0;
            while let Some((functions, (shapes, variables))) = match (chunks.next(), tables.take()) {
                (None, None) => None,
                (functions, tables) => Some((functions.unwrap_or_default(), tables.unwrap_or_default())),
            } {
                let count = functions.len() as u32;
                batches.push(OutlineBatch::new(fragment_index, *file, program_ids, summary, [first_function, 0, 0], functions, shapes, variables));
                first_function += count;
            }
        }
        let Index { funcs, layouts, globals, outline, .. } = self;
        outline.add(&mut batches, &|kind, fragment, index, id| preferred([&funcs[..], &layouts[..], &globals[..]][kind], id) == Some(FragmentIndex { fragment, index }), in_parallel);
    }

    fn add(&self, number: usize, fragment: &Fragment) {
        let ids = &fragment.program_ids;
        for (i, function) in fragment.funcs.iter().enumerate().filter(|(_, function)| function.func.is_some()) {
            prefer(&self.funcs, ids.funcs[i], FragmentIndex::new(number, i), function.body.is_some());
        }
        for (i, shape) in fragment.layouts.iter().enumerate() {
            let Some(definition) = &shape.definition else { continue };
            let lists_accessors = definition.layout.kind == LayoutKind::Record && !definition.layout.methods.is_empty();
            prefer(&self.layouts, ids.layouts[i], FragmentIndex::new(number, i), lists_accessors || shape.key.file() == Some(fragment.file));
        }
        for (i, variable) in fragment.globals.iter().enumerate() {
            prefer(&self.globals, ids.globals[i], FragmentIndex::new(number, i), variable.key.file() == Some(fragment.file));
        }
    }

    fn func(&self, id: u32) -> Option<FragmentIndex> {
        preferred(&self.funcs, id)
    }

    fn layout(&self, id: u32) -> Option<FragmentIndex> {
        preferred(&self.layouts, id)
    }

    fn global(&self, id: u32) -> Option<FragmentIndex> {
        preferred(&self.globals, id)
    }

    fn func_by_key(&self, ids: &ProgramIds, key: FuncKey) -> Option<u32> {
        ids.funcs.find(&key).filter(|&id| self.func(id).is_some())
    }

    fn record(&self, ids: &ProgramIds, identity: Identity) -> Option<FragmentIndex> {
        self.layout(ids.layouts.find(&LayoutKey::Record(identity))?)
    }
}

#[derive(Copy, Clone)]
enum Work {
    Root(u32, bool),
    Func(u32),
    Layout(u32),
    Part(FragmentIndex, u32),
}

mod reached {
    pub(super) const IS_REACHED: u8 = 1;
    pub(super) const BODY: u8 = 1 << 1;
    pub(super) const VALUE: u8 = 1 << 2;
    pub(super) const MEMBER: u8 = 1 << 3;
    pub(super) const USED_BY_CODE: u8 = 1 << 4;
    pub(super) const IS_UNDEFINED: u8 = 1 << 5;
    pub(super) const DECLARED: u8 = 1 << 1;
    pub(super) const CONSTRUCTED: u8 = 1 << 2;
}

#[derive(Default)]
struct RuntimeModules {
    by_number: FxHashMap<i64, FileId>,
    by_name: FxHashMap<Vec<u8>, FileId>,
    evaluations: FxHashMap<FileId, u32>,
    behind_loader_entries: Vec<u32>,
    hidden_behind_loader_entries: Vec<(i64, Vec<u8>, FileId, u32)>,
    unserved_requests: Vec<u32>,
}

impl RuntimeModules {
    fn add(&mut self, number: i64, name: &[u8], file: FileId, evaluation: u32) {
        self.by_number.insert(number, file);
        self.evaluations.insert(file, evaluation);
        self.by_name.insert(name.to_vec(), file);
        if let Some(short) = name.strip_prefix(b"node:") {
            self.by_name.insert(short.to_vec(), file);
        }
    }
}

#[derive(Default)]
struct Unresolved {
    missing: Vec<(Identity, FragmentIndex, ReferencedBy)>,
    undefined_funcs: Vec<(u32, ReferencedBy)>,
    undefined_layouts: Vec<(FragmentIndex, ReferencedBy)>,
}

type Sharded<T> = Vec<Guarded<FxHashMap<u32, Vec<T>>>>;

#[derive(Default)]
struct Reachability {
    funcs: Vec<AtomicU8>,
    layouts: Vec<AtomicU8>,
    globals: Vec<AtomicBool>,
    parts_storing: Sharded<(FragmentIndex, u32)>,
    parts: Guarded<FxHashSet<(FragmentIndex, u32)>>,
    waiting: Sharded<u32>,
    seen_tys: Vec<AtomicBool>,
    work: Vec<Work>,
    prelude: Vec<(Vec<u8>, Vec<u32>)>,
    prelude_left: AtomicU64,
    prelude_names: Vec<OnceLock<Vec<(StrId, u8)>>>,
    runtime: Guarded<RuntimeModules>,
    loader_entry_points: FxHashSet<FragmentIndex>,
    has_unreached_loader_entries: AtomicBool,
    unresolved: Unresolved,
}

struct WorkQueue<T> {
    shared: Guarded<Vec<T>>,
    shared_len: AtomicUsize,
    active_workers: AtomicUsize,
    idle_workers: AtomicUsize,
}

impl<T> Default for WorkQueue<T> {
    fn default() -> WorkQueue<T> {
        WorkQueue { shared: Guarded::new(Vec::new()), shared_len: AtomicUsize::new(0), active_workers: AtomicUsize::new(0), idle_workers: AtomicUsize::new(0) }
    }
}

impl<T> WorkQueue<T> {
    const LARGEST_BATCH: usize = 64;

    fn share(&self, work: impl Iterator<Item = T>) {
        let mut shared = self.shared.lock();
        shared.extend(work);
        self.shared_len.store(shared.len(), Ordering::Release);
    }

    fn join(&self) {
        self.active_workers.fetch_add(1, Ordering::AcqRel);
    }

    fn has_idle_workers(&self) -> bool {
        self.idle_workers.load(Ordering::Relaxed) != 0 && self.shared_len.load(Ordering::Relaxed) == 0
    }

    fn wait_for_work(&self, work: &mut Vec<T>) -> bool {
        self.idle_workers.fetch_add(1, Ordering::Relaxed);
        self.active_workers.fetch_sub(1, Ordering::AcqRel);
        let has_work = loop {
            if self.shared_len.load(Ordering::Acquire) != 0 || self.active_workers.load(Ordering::Acquire) == 0 {
                let mut shared = self.shared.lock();
                if !shared.is_empty() {
                    self.active_workers.fetch_add(1, Ordering::AcqRel);
                    let retained = shared.len() - shared.len().div_ceil(2).min(Self::LARGEST_BATCH);
                    work.extend(shared.drain(retained..));
                    self.shared_len.store(shared.len(), Ordering::Release);
                    break true;
                }
                if self.active_workers.load(Ordering::Acquire) == 0 {
                    break false;
                }
            }
            std::thread::yield_now();
        };
        self.idle_workers.fetch_sub(1, Ordering::Relaxed);
        has_work
    }
}

impl Reachability {
    const SHARDS: usize = 64;

    fn grow(&mut self, fragments: &[Fragment], ids: &ProgramIds) {
        self.funcs.resize_with(ids.funcs.bound(), AtomicU8::default);
        self.layouts.resize_with(ids.layouts.bound(), AtomicU8::default);
        self.globals.resize_with(ids.globals.bound(), AtomicBool::default);
        self.seen_tys.resize_with(ids.tys_upper_bound(), AtomicBool::default);
        self.prelude_names.resize_with(fragments.len(), OnceLock::new);
        self.parts_storing.resize_with(Reachability::SHARDS, Guarded::default);
        self.waiting.resize_with(Reachability::SHARDS, Guarded::default);
    }

    fn has(&self, func: u32, flag: u8) -> bool {
        self.funcs[func as usize].load(Ordering::Relaxed) & flag != 0
    }

    fn add_flags(&self, func: u32, flags: u8) {
        let cell = &self.funcs[func as usize];
        if cell.load(Ordering::Relaxed) & flags != flags {
            cell.fetch_or(flags, Ordering::Relaxed);
        }
    }

    fn has_layout(&self, layout: u32, flag: u8) -> bool {
        self.layouts[layout as usize].load(Ordering::Relaxed) & flag != 0
    }

    fn has_body_by_key(&self, ids: &ProgramIds, key: FuncKey) -> bool {
        ids.funcs.find(&key).is_some_and(|id| self.has(id, reached::BODY))
    }

    fn add_root(&mut self, id: u32, by_code: bool) {
        self.work.push(Work::Root(id, by_code));
    }

    fn add_prelude_function(&mut self, builtin: &[u8], id: u32) {
        match self.prelude.iter_mut().find(|known| known.0 == builtin) {
            Some(known) => known.1.push(id),
            None => {
                *self.prelude_left.get_mut() |= 1 << self.prelude.len();
                self.prelude.push((builtin.to_vec(), vec![id]));
            }
        }
    }

    fn run(&mut self, fragments: &[Fragment], index: &Index, in_parallel: InParallel<'_>) {
        const WORKERS: usize = 64;
        let queue = WorkQueue::default();
        queue.share(std::mem::take(&mut self.work).into_iter());
        let runtime = self.runtime.get_mut();
        *self.has_unreached_loader_entries.get_mut() = !(runtime.behind_loader_entries.is_empty() && runtime.hidden_behind_loader_entries.is_empty());
        let reach: &Reachability = self;
        let mut unresolved: Vec<Unresolved> = (0..WORKERS).map(|_| Unresolved::default()).collect();
        for_each_mut(&mut unresolved, in_parallel, &|unresolved| {
            let mut worker = ReachWorker { reach, fragments, index, work: Vec::new(), user: ReferencedBy::Entry, unresolved: Unresolved::default() };
            worker.run(&queue);
            *unresolved = worker.unresolved;
        });
        for mut found in unresolved {
            self.unresolved.missing.append(&mut found.missing);
            self.unresolved.undefined_funcs.append(&mut found.undefined_funcs);
            self.unresolved.undefined_layouts.append(&mut found.undefined_layouts);
        }
        self.unresolved.missing.sort_unstable();
        self.unresolved.undefined_funcs.sort_unstable();
        self.unresolved.undefined_layouts.sort_unstable();
    }
}

struct ReachWorker<'a> {
    reach: &'a Reachability,
    fragments: &'a [Fragment],
    index: &'a Index,
    work: Vec<Work>,
    user: ReferencedBy,
    unresolved: Unresolved,
}

impl<'a> ReachWorker<'a> {
    fn run(&mut self, queue: &WorkQueue<Work>) {
        queue.join();
        loop {
            let Some(work) = self.work.pop() else {
                if queue.wait_for_work(&mut self.work) {
                    continue;
                }
                return;
            };
            self.visit(work);
            if self.work.len() > 1 && queue.has_idle_workers() {
                let shared = self.work.len() / 2;
                queue.share(self.work.drain(..shared));
            }
        }
    }

    fn start_body(&mut self, id: u32) {
        self.reach.funcs[id as usize].fetch_or(reached::BODY, Ordering::Relaxed);
        self.work.push(Work::Func(id));
    }

    fn reach_function(&mut self, id: u32, by_code: bool) {
        let (reach, index) = (self.reach, self.index);
        let wanted = reached::IS_REACHED | if by_code { reached::USED_BY_CODE } else { 0 };
        let cell = &reach.funcs[id as usize];
        if cell.load(Ordering::Relaxed) & (wanted | reached::IS_UNDEFINED) == wanted {
            return;
        }
        let Some(function) = index.outline.func(id) else {
            cell.fetch_or(wanted | reached::IS_UNDEFINED, Ordering::Relaxed);
            return self.unresolved.undefined_funcs.push((id, self.user));
        };
        let flags = cell.fetch_or(wanted, Ordering::Relaxed);
        let is_new = flags & reached::IS_REACHED == 0;
        let is_newly_used = by_code && flags & reached::USED_BY_CODE == 0;
        if !is_new && !is_newly_used {
            return;
        }
        if is_new {
            let user = std::mem::replace(&mut self.user, ReferencedBy::Func(FragmentIndex { fragment: function.fragment, index: function.index }));
            for position in function.list(Outline::HEADER_TYS) {
                self.reach_listed_type(function.fragment, position);
            }
            self.reach_layout(function.fragment, function.class, function.class_id);
            self.user = user;
        }
        if !function.has(outline_flags::HAS_BODY) {
            return;
        }
        if function.class.is_none() {
            if is_new {
                self.start_body(id);
            }
            return;
        }
        let class = function.class_id;
        let mut waiting = reach.waiting[class as usize % Reachability::SHARDS].lock();
        let before = reach.layouts[class as usize].load(Ordering::Relaxed);
        let is_newly_constructed = by_code && function.has(outline_flags::IS_CONSTRUCTOR) && reach.layouts[class as usize].fetch_or(reached::CONSTRUCTED, Ordering::Relaxed) & reached::CONSTRUCTED == 0;
        if before & reached::DECLARED == 0 || is_newly_constructed {
            if is_new {
                waiting.entry(class).or_default().push(id);
            }
            return self.release(class, &mut waiting);
        }
        let is_ready = before & reached::CONSTRUCTED != 0 || cell.load(Ordering::Relaxed) & reached::USED_BY_CODE != 0;
        if !is_ready {
            return waiting.entry(class).or_default().push(id);
        }
        if !is_new {
            let Some(waiting) = waiting.get_mut(&class) else { return };
            let Some(position) = waiting.iter().position(|&other| other == id) else { return };
            waiting.remove(position);
        }
        self.start_body(id);
    }

    fn release(&mut self, class: u32, waiting: &mut FxHashMap<u32, Vec<u32>>) {
        let flags = self.reach.layouts[class as usize].load(Ordering::Relaxed);
        if flags & reached::DECLARED == 0 {
            return;
        }
        let Some(waiting) = waiting.get_mut(&class) else { return };
        let is_constructed = flags & reached::CONSTRUCTED != 0;
        let reach = self.reach;
        let (ready, still): (Vec<u32>, Vec<u32>) = waiting.iter().partition(|&&id| is_constructed || reach.has(id, reached::USED_BY_CODE));
        *waiting = still;
        for id in ready {
            self.start_body(id);
        }
    }

    fn reach_local_function(&mut self, from: u32, func: FuncId, by_code: bool) -> u32 {
        let id = self.fragments[from as usize].program_ids.funcs[func.idx()];
        self.reach_function(id, by_code);
        id
    }

    fn reach_local_layout(&mut self, from: u32, layout: LayoutId) {
        if layout.is_some() {
            self.reach_layout(from, layout, self.fragments[from as usize].program_ids.layouts[layout.idx()]);
        }
    }

    fn reach_layout(&mut self, from: u32, layout: LayoutId, id: u32) {
        if layout.is_none() || self.reach.has_layout(id, reached::IS_REACHED) || self.reach.layouts[id as usize].fetch_or(reached::IS_REACHED, Ordering::Relaxed) & reached::IS_REACHED != 0 {
            return;
        }
        if self.index.outline.layout(id).is_some() {
            return self.work.push(Work::Layout(id));
        }
        match self.fragments[from as usize].layouts[layout.idx()].key {
            LayoutKey::Record(identity) => self.unresolved.missing.push((identity, FragmentIndex::new(from as usize, layout.idx()), self.user)),
            _ => self.unresolved.undefined_layouts.push((FragmentIndex::new(from as usize, layout.idx()), self.user)),
        }
    }

    #[inline]
    fn reach_listed_layout(&mut self, from: u32, position: usize) {
        let id = self.index.outline.program[position];
        if id != u32::MAX && !self.reach.has_layout(id, reached::IS_REACHED) {
            self.reach_layout(from, LayoutId(self.index.outline.local[position]), id);
        }
    }

    #[inline]
    fn reach_listed_type(&mut self, from: u32, position: usize) {
        let id = self.index.outline.program[position];
        if id != u32::MAX && !self.reach.seen_tys[id as usize].load(Ordering::Relaxed) {
            self.reach_type(from, TyId(self.index.outline.local[position]), id);
        }
    }

    fn reach_local_type(&mut self, from: u32, ty: TyId) {
        if ty.is_some() {
            self.reach_type(from, ty, self.fragments[from as usize].program_ids.tys[ty.idx()]);
        }
    }

    fn reach_type(&mut self, from: u32, ty: TyId, id: u32) {
        if ty.is_none() || self.reach.seen_tys[id as usize].load(Ordering::Relaxed) || self.reach.seen_tys[id as usize].swap(true, Ordering::Relaxed) {
            return;
        }
        let fragments = self.fragments;
        for part in &fragments[from as usize].tys.get(ty).parts {
            match part {
                Part::Class(layout) => self.reach_local_layout(from, *layout),
                Part::Global(_, arguments) => {
                    for &argument in arguments {
                        self.reach_local_type(from, argument);
                    }
                }
                Part::Array(element) => self.reach_local_type(from, *element),
            }
        }
    }

    fn start_part(&mut self, part: (FragmentIndex, u32)) {
        if self.reach.parts.lock().insert(part) {
            self.work.push(Work::Part(part.0, part.1));
        }
    }

    fn reach_variable(&mut self, id: u32) {
        if self.reach.globals[id as usize].load(Ordering::Relaxed) || self.reach.globals[id as usize].swap(true, Ordering::Relaxed) {
            return;
        }
        let storing = self.reach.parts_storing[id as usize % Reachability::SHARDS].lock().remove(&id).unwrap_or_default();
        for part in storing {
            self.start_part(part);
        }
        self.reach_variable_type(id);
    }

    fn reach_variable_type(&mut self, id: u32) {
        let variable = *self.index.outline.variable(id).expect(IS_INDEXED);
        if variable.declared_id != u32::MAX {
            self.reach_type(variable.fragment, variable.declared, variable.declared_id);
        }
    }

    fn reach_mentions(&mut self, from: u32, mentions: &ReferencedIds, only_stored: &[GlobalId]) {
        for ty in mentions.tys() {
            self.reach_local_type(from, ty);
        }
        for layout in mentions.layouts() {
            self.reach_local_layout(from, layout);
        }
        for global in mentions.globals() {
            let id = self.fragments[from as usize].program_ids.globals[global.idx()];
            if only_stored.binary_search(&global).is_ok() {
                self.reach_variable_type(id);
            } else {
                self.reach_variable(id);
            }
        }
        for func in mentions.called() {
            self.reach_local_function(from, func, true);
        }
        for func in mentions.values() {
            let id = self.reach_local_function(from, func, true);
            self.reach.add_flags(id, reached::VALUE);
        }
    }

    fn reach_function_mentions(&mut self, function: &FunctionOutline) {
        let index = self.index;
        let program = &index.outline.program;
        for position in function.list(Outline::TYS) {
            self.reach_listed_type(function.fragment, position);
        }
        for position in function.list(Outline::LAYOUTS) {
            self.reach_listed_layout(function.fragment, position);
        }
        for &global in &program[function.list(Outline::GLOBALS)] {
            self.reach_variable(global);
        }
        for &func in &program[function.list(Outline::CALLED)] {
            self.reach_function(func, true);
        }
        for &func in &program[function.list(Outline::VALUES)] {
            self.reach_function(func, true);
            self.reach.add_flags(func, reached::VALUE);
        }
    }

    fn reach_requested_runtime_modules(&mut self, function: &FunctionOutline) {
        if !function.has(outline_flags::HAS_HEADER) || !function.has(outline_flags::EVALUATES_MODULE | outline_flags::REQUESTS_RUNTIME_MODULES) {
            return;
        }
        let (reach, fragment) = (self.reach, &self.fragments[function.fragment as usize]);
        let mut runtime = reach.runtime.lock();
        let mut requested: Vec<FileId> = Vec::new();
        let mut is_served = true;
        let file = fragment.file;
        if function.has(outline_flags::EVALUATES_MODULE)
            && runtime.evaluations.contains_key(&file)
            && let Some((&number, _)) = runtime.by_number.iter().find(|module| *module.1 == file)
        {
            let besides = bun_builtin_syntax::Archive::embedded().manifest().also_required(number as u32);
            requested.extend(besides.iter().filter_map(|&id| runtime.by_number.get(&i64::from(id))));
            is_served &= requested.len() == besides.len();
        }
        let of_fragment = &fragment.summary.runtime_modules;
        for &(_, module) in of_fragment[of_fragment.partition_point(|found| found.0 < function.index)..].iter().take_while(|found| found.0 == function.index) {
            let found = match module {
                RuntimeModule::Number(number) => runtime.by_number.get(&number),
                RuntimeModule::Name(name) => runtime.by_name.get(fragment.strs.get(name)),
            };
            is_served &= found.is_some();
            requested.extend(found.copied());
        }
        if !is_served && !runtime.hidden_behind_loader_entries.is_empty() {
            runtime.unserved_requests.push(function.id);
        }
        let evaluations: Vec<u32> = requested.iter().map(|file| runtime.evaluations[file]).collect();
        drop(runtime);
        for evaluation in evaluations {
            self.reach_function(evaluation, true);
        }
    }

    fn reach_loader_entries(&mut self) {
        let reach = self.reach;
        let mut runtime = reach.runtime.lock();
        for (number, name, file, evaluation) in std::mem::take(&mut runtime.hidden_behind_loader_entries) {
            runtime.add(number, &name, file, evaluation);
        }
        reach.has_unreached_loader_entries.store(false, Ordering::Relaxed);
        let (evaluations, requests) = (std::mem::take(&mut runtime.behind_loader_entries), std::mem::take(&mut runtime.unserved_requests));
        drop(runtime);
        for evaluation in evaluations {
            self.reach_function(evaluation, true);
        }
        let index = self.index;
        for function in requests.into_iter().filter_map(|id| index.outline.func(id)) {
            self.reach_requested_runtime_modules(function);
        }
    }

    fn reach_prelude_functions(&mut self, at: FragmentIndex) {
        let (reach, fragment) = (self.reach, &self.fragments[at.fragment as usize]);
        let left = reach.prelude_left.load(Ordering::Relaxed);
        let names = reach.prelude_names[at.fragment as usize].get_or_init(|| reach.prelude.iter().enumerate().filter_map(|(bit, builtin)| Some((fragment.strs.find(&builtin.0)?, bit as u8))).collect());
        if !names.iter().any(|name| left & 1 << name.1 != 0) {
            return;
        }
        let Some(func) = &fragment.funcs[at.index as usize].func else { return };
        let mut named = 0u64;
        for value in &func.values {
            if let Def::Op(Op::CallMethod { name, .. } | Op::PropGet { name, .. } | Op::FreeGet { name, .. }) = &value.def
                && let Some(known) = names.iter().find(|known| known.0 == *name)
            {
                named |= 1 << known.1;
            }
        }
        if named & left == 0 {
            return;
        }
        let newly_named = reach.prelude_left.fetch_and(!named, Ordering::Relaxed) & named;
        for builtin in reach.prelude.iter().enumerate().filter(|builtin| newly_named & 1 << builtin.0 != 0) {
            for &id in &builtin.1.1 {
                self.reach_function(id, true);
            }
        }
    }

    fn visit(&mut self, work: Work) {
        let (reach, fragments, index) = (self.reach, self.fragments, self.index);
        match work {
            Work::Root(id, by_code) => {
                self.user = ReferencedBy::Entry;
                self.reach_function(id, by_code);
            }
            Work::Func(id) => {
                let Some(function) = index.outline.func(id) else { return };
                let at = FragmentIndex { fragment: function.fragment, index: function.index };
                self.user = ReferencedBy::Func(at);
                if !function.has(outline_flags::HAS_BODY) {
                    return;
                }
                if reach.has_unreached_loader_entries.load(Ordering::Relaxed) && reach.loader_entry_points.contains(&at) {
                    self.reach_loader_entries();
                }
                self.reach_requested_runtime_modules(function);
                self.reach_function_mentions(function);
                let parts: &[ModulePart] = if function.has(outline_flags::HAS_PARTS) { fragments[at.fragment as usize].funcs[at.index as usize].body.as_ref().map_or(&[][..], |body| &body.parts[..]) } else { &[] };
                for (number, part) in parts.iter().enumerate() {
                    let stored = part.stores.iter().map(|global| fragments[at.fragment as usize].program_ids.globals[global.idx()]);
                    let mut runs = stored.clone().any(|id| reach.globals[id as usize].load(Ordering::Relaxed));
                    if !runs {
                        for id in stored {
                            let mut storing = reach.parts_storing[id as usize % Reachability::SHARDS].lock();
                            runs = reach.globals[id as usize].load(Ordering::Relaxed);
                            if runs {
                                break;
                            }
                            storing.entry(id).or_default().push((at, number as u32));
                        }
                    }
                    if runs {
                        self.start_part((at, number as u32));
                    }
                }
                if function.has(outline_flags::HAS_HEADER) && reach.prelude_left.load(Ordering::Relaxed) != 0 {
                    self.reach_prelude_functions(at);
                }
                for position in function.list(Outline::CLASSES_AS_VALUES) {
                    self.reach_listed_layout(at.fragment, position);
                }
                for &class in &index.outline.program[function.list(Outline::DECLARES)] {
                    if !reach.has_layout(class, reached::DECLARED) {
                        let mut waiting = reach.waiting[class as usize % Reachability::SHARDS].lock();
                        if reach.layouts[class as usize].fetch_or(reached::DECLARED, Ordering::Relaxed) & reached::DECLARED == 0 {
                            self.release(class, &mut waiting);
                        }
                    }
                }
            }
            Work::Part(at, number) => {
                self.user = ReferencedBy::Func(at);
                let Some(body) = &fragments[at.fragment as usize].funcs[at.index as usize].body else { return };
                let part = &body.parts[number as usize];
                self.reach_mentions(at.fragment, &part.mentions, &part.write_only_globals);
            }
            Work::Layout(id) => {
                let Some(layout) = index.outline.layout(id) else { return };
                self.user = ReferencedBy::Layout(FragmentIndex { fragment: layout.fragment, index: layout.index });
                let program = &index.outline.program;
                for position in layout.list(Outline::TYS - 1) {
                    self.reach_listed_type(layout.fragment, position);
                }
                for position in layout.list(Outline::LAYOUTS - 1) {
                    self.reach_listed_layout(layout.fragment, position);
                }
                for &global in &program[layout.list(Outline::GLOBALS - 1)] {
                    self.reach_variable(global);
                }
                for &func in &program[layout.list(Outline::CALLED - 1)] {
                    self.reach_function(func, false);
                    reach.add_flags(func, reached::MEMBER);
                }
                for &func in &program[layout.list(Outline::VALUES - 1)] {
                    self.reach_function(func, true);
                    reach.add_flags(func, reached::VALUE);
                }
                self.reach_layout(layout.fragment, layout.constructs, layout.constructs_id);
            }
        }
    }
}

#[derive(Default)]
struct UntypedObjectEvidence {
    fragments: usize,
    recorded: Notes,
    is_absorbed: Vec<bool>,
    classes: usize,
    served: Vec<LayoutKey>,
}

fn classes_served_by_untyped_clones(checked: &Checked<'_>, fragments: &[Fragment], index: &Index, reach: &Reachability, types: &FxHashMap<Identity, TypeId>, known: &mut UntypedObjectEvidence, in_parallel: InParallel<'_>) -> Vec<LayoutKey> {
    if known.fragments != fragments.len() {
        *known = UntypedObjectEvidence { fragments: fragments.len(), is_absorbed: vec![false; reach.funcs.len()], classes: usize::MAX, ..UntypedObjectEvidence::default() };
    }
    let UntypedObjectEvidence { recorded: evidence, is_absorbed, .. } = known;
    let mut not_absorbed: Vec<&Notes> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate().filter(|(_, fragment)| !fragment.summary.with_mutations.is_empty()) {
        if fragment.file != NO_FILE && checked.files.module(fragment.file).is_opaque() {
            continue;
        }
        for i in fragment.summary.with_mutations.iter().map(|&i| i as usize) {
            if let Some(body) = &fragment.funcs[i].body
                && reach.has(fragment.program_ids.funcs[i], reached::BODY)
                && index.func(fragment.program_ids.funcs[i]) == Some(FragmentIndex::new(number, i))
                && !std::mem::replace(&mut is_absorbed[fragment.program_ids.funcs[i] as usize], true)
            {
                not_absorbed.push(&body.notes);
            }
        }
    }
    const FUNCTIONS_PER_RUN: usize = 256;
    let learned_more = !not_absorbed.is_empty();
    let mut runs: Vec<(&[&Notes], Notes)> = not_absorbed.chunks(FUNCTIONS_PER_RUN).map(|run| (run, FlowNotes::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, of_run)| run.iter().for_each(|notes| of_run.absorb_untyped_object_evidence(notes)));
    for (_, of_run) in runs {
        evidence.absorb(of_run);
    }
    let retained = |list: Vec<Identity>| -> Vec<TypeId> { list.into_iter().filter_map(|identity| types.get(&identity).copied()).collect() };
    let mut classes: Vec<(LayoutKey, TypeId)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        for (i, shape) in fragment.layouts.iter().enumerate().filter(|(_, shape)| matches!(shape.key, LayoutKey::Instance(..))) {
            let id = fragment.program_ids.layouts[i];
            if reach.has_layout(id, reached::IS_REACHED)
                && index.layout(id) == Some(FragmentIndex::new(number, i))
                && let Some(&ty) = shape.ty.as_ref().and_then(|identity| types.get(identity))
            {
                classes.push((shape.key, ty));
            }
        }
    }
    if !learned_more && known.classes == classes.len() {
        return known.served.clone();
    }
    known.classes = classes.len();
    let (escaped, entered, receiving_untyped_if_escaped) = known.recorded.untyped_object_evidence();
    if escaped.is_empty() && entered.is_empty() {
        known.served = Vec::new();
        return Vec::new();
    }
    let of_classes: Vec<TypeId> = classes.iter().map(|class| class.1).collect();
    let served = checked.checker().classes_served_by_untyped_clones(&retained(escaped), &retained(entered), &retained(receiving_untyped_if_escaped), &of_classes);
    let mut served: Vec<LayoutKey> = classes.into_iter().zip(served).filter(|class| class.1).map(|class| class.0.0).collect();
    served.sort_unstable_by_key(|key| if let LayoutKey::Instance(file, class) = *key { (file.idx(), class.idx()) } else { (0, 0) });
    known.served.clone_from(&served);
    served
}

fn remove_part(func: &mut Func, part: &ModulePart, anything: TyId) {
    for v in part.values(func) {
        func.values[v.idx()] = ir::Value::new(Def::Op(Op::Undefined), 0, anything);
    }
    let ((from, start), (to, end)) = (part.from, part.to);
    if from == to {
        func.blocks[from.idx()].ops.drain(start as usize..end as usize);
        return;
    }
    func.blocks[from.idx()].ops.truncate(start as usize);
    func.blocks[from.idx()].term = Some(Term::Jump(ir::Target { block: to, args: part.passed_through.iter().copied().filter(|handed| handed.is_some()).collect() }));
    let mut handed = part.passed_through.iter();
    func.blocks[to.idx()].params.retain(|_| handed.next().is_some_and(|handed| handed.is_some()));
    for (index, param) in func.blocks[to.idx()].params.clone().into_iter().enumerate() {
        func.values[param.idx()].def = Def::Param(to, index as u32);
    }
    func.blocks[to.idx()].ops.drain(..end as usize);
    for block in (part.blocks.0..part.blocks.1).filter(|&block| block != to.0) {
        func.blocks[block as usize] = ir::Block { params: Vec::new(), ops: Vec::new(), term: Some(Term::Unreachable) };
    }
}

fn remove_unreached_parts(fragments: &mut [Fragment], outline: &mut Outline, reach: &Reachability, in_parallel: InParallel<'_>) {
    let mut funcs_with_parts: Vec<(FragmentIndex, u32)> = outline.funcs_with_parts.iter().map(|&place| (FragmentIndex { fragment: outline.funcs[place as usize].fragment, index: outline.funcs[place as usize].index }, place)).collect();
    funcs_with_parts.sort_unstable_by_key(|function| (function.0.fragment, function.0.index));
    let mut listed: Vec<((u32, &mut Function, &LocalToProgram, FileId), FragmentIndex, TyId)> = Vec::with_capacity(funcs_with_parts.len());
    let (mut fragments_left, mut fragments_passed) = (fragments, 0);
    for of_fragment in funcs_with_parts.chunk_by(|a, b| a.0.fragment == b.0.fragment) {
        let number = of_fragment[0].0.fragment as usize;
        let Some((fragment, behind)) = std::mem::take(&mut fragments_left)[number - fragments_passed..].split_first_mut() else { break };
        (fragments_left, fragments_passed) = (behind, number + 1);
        let Fragment { funcs, program_ids, file, tys, .. } = fragment;
        let (mut funcs_left, mut funcs_passed) = (&mut funcs[..], 0);
        for &(at, place) in of_fragment {
            let Some((function, behind)) = std::mem::take(&mut funcs_left)[at.index as usize - funcs_passed..].split_first_mut() else { break };
            (funcs_left, funcs_passed) = (behind, at.index as usize + 1);
            listed.push(((place, function, &*program_ids, *file), at, tys.anything));
        }
    }
    let running_parts = reach.parts.lock();
    let running_parts: &FxHashSet<(FragmentIndex, u32)> = &running_parts;
    for_each_mut(&mut listed, in_parallel, &|((_, function, _, _), at, anything)| {
        let (Some(func), Some(body)) = (&mut function.func, &mut function.body) else { return };
        for (part_number, part) in std::mem::take(&mut body.parts).iter().enumerate().rev() {
            if !running_parts.contains(&(*at, part_number as u32)) {
                remove_part(func, part, *anything);
            }
        }
        body.mentions = ReferenceCollector::default().collect_func(func);
    });
    let mut again: Vec<(u32, &mut Function, &LocalToProgram, FileId)> = listed.into_iter().map(|function| function.0).collect();
    outline.rebuild_functions(&mut again, in_parallel);
}

struct Maps {
    strs: Vec<StrId>,
    tys: Vec<TyId>,
    layouts: Vec<LayoutId>,
    globals: Vec<GlobalId>,
    modules: Vec<ModuleId>,
    funcs: Vec<FuncId>,
    uses_func: Vec<bool>,
}

enum Pending {
    Layout(u32),
    Global(GlobalId),
}

struct Numbering<'a> {
    fragments: &'a [Fragment],
    index: &'a Index,
    maps: Vec<Maps>,
    strs: Strs,
    unplaced_strs: Vec<(u32, StrId)>,
    tys: DeclaredTable,
    layouts: Vec<FragmentIndex>,
    globals: Vec<FragmentIndex>,
    modules: Vec<FileId>,
    str_ids: Vec<StrId>,
    ty_ids: Vec<TyId>,
    layout_ids: Vec<LayoutId>,
    global_ids: Vec<GlobalId>,
    module_ids: FxHashMap<FileId, ModuleId>,
    record_positions: Vec<u32>,
    pending: VecDeque<Pending>,
}

type Rank = SmallVec<[u64; 4]>;

fn add_text_rank(text: &[u8], rank: &mut Rank) {
    for chunk in text.chunks(8) {
        let mut word = [0; 8];
        word[..chunk.len()].copy_from_slice(chunk);
        rank.push(u64::from_be_bytes(word));
    }
    rank.extend([0, text.len() as u64]);
}

fn record_ranks(fragments: &[Fragment], index: &Index, ids: &ProgramIds, in_parallel: InParallel<'_>) -> Vec<(Rank, u32)> {
    const LAYOUTS_PER_RUN: usize = 2048;
    let bound = ids.layouts.bound();
    let mut runs: Vec<(usize, Vec<(Rank, u32)>)> = (0..bound).step_by(LAYOUTS_PER_RUN).map(|first| (first, Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(first, ranked)| {
        for id in (*first..bound.min(*first + LAYOUTS_PER_RUN)).map(|id| id as u32) {
            let Some(at) = index.layout(id) else { continue };
            let defining = &fragments[at.fragment as usize];
            let shape = &defining.layouts[at.index as usize];
            let LayoutKey::Record(identity) = shape.key else { continue };
            let mut rank = Rank::new();
            add_text_rank(if shape.name.is_none() { &[] } else { defining.strs.get(shape.name) }, &mut rank);
            if let Some(definition) = &shape.definition {
                rank.push(definition.layout.fields.len() as u64);
                for field in &definition.layout.fields {
                    add_text_rank(defining.strs.get(field.name), &mut rank);
                }
            }
            rank.extend(identity);
            ranked.push((rank, id));
        }
        ranked.sort_unstable();
    });
    runs.into_iter().flat_map(|run| run.1).collect()
}

fn record_positions(mut ranked: Vec<(Rank, u32)>, ids: &ProgramIds) -> Vec<u32> {
    ranked.sort();
    let mut places = vec![u32::MAX; ids.layouts.bound()];
    for (place, (_, id)) in ranked.into_iter().enumerate() {
        places[id as usize] = place as u32;
    }
    places
}

const FUNCTIONS_PER_BATCH: usize = 1024;

#[derive(Default)]
struct FirstReferences {
    places: Vec<u32>,
    ends: Vec<[u32; 4]>,
}

fn first_references(outline: &Outline, included: &[(FragmentIndex, bool)], places: &[u32], ids: &ProgramIds, in_parallel: InParallel<'_>) -> Vec<FirstReferences> {
    const LISTS: [usize; 4] = [Outline::STRS, Outline::TYS, Outline::LAYOUTS, Outline::GLOBALS];
    let earliest: [Vec<AtomicU32>; 4] = [ids.strs_upper_bound(), ids.tys_upper_bound(), ids.layouts.bound(), ids.globals.bound()].map(|bound| (0..bound).map(|_| AtomicU32::new(0)).collect());
    let rank_of = |position: usize| u32::MAX - position as u32;
    let Outline { funcs, program, .. } = outline;
    let mut runs: Vec<(usize, &[(FragmentIndex, bool)], &[u32], FirstReferences)> = (included.chunks(FUNCTIONS_PER_BATCH).zip(places.chunks(FUNCTIONS_PER_BATCH)).enumerate()).map(|(run, (functions, places))| (run * FUNCTIONS_PER_BATCH, functions, places, FirstReferences::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(first, functions, places, _)| {
        for (offset, (_, &place)) in functions.iter().zip(places.iter()).enumerate().filter(|function| function.1.0.1) {
            let rank = rank_of(*first + offset);
            for (list, earliest) in LISTS.into_iter().zip(&earliest) {
                for &id in &program[funcs[place as usize].list(list)] {
                    if earliest[id as usize].load(Ordering::Relaxed) < rank {
                        earliest[id as usize].fetch_max(rank, Ordering::Relaxed);
                    }
                }
            }
        }
    });
    for_each_mut(&mut runs, in_parallel, &|(first, functions, places, found)| {
        found.ends.reserve_exact(functions.len());
        for (offset, (&(_, has_body), &place)) in functions.iter().zip(places.iter()).enumerate() {
            let rank = rank_of(*first + offset);
            let mut ends = [found.places.len() as u32; 4];
            for (number, (list, earliest)) in LISTS.into_iter().zip(&earliest).enumerate().filter(|_| has_body) {
                found.places.extend(funcs[place as usize].list(list).filter(|&position| earliest[program[position] as usize].load(Ordering::Relaxed) == rank).map(|position| position as u32));
                ends[number..].fill(found.places.len() as u32);
            }
            found.ends.push(ends);
        }
    });
    runs.into_iter().map(|run| run.3).collect()
}

impl<'a> Numbering<'a> {
    fn new(fragments: &'a [Fragment], index: &'a Index, ids: &ProgramIds, func_ids: &[FuncId], record_positions: Vec<u32>, in_parallel: InParallel<'_>) -> Numbering<'a> {
        let mut maps_of: Vec<(&Fragment, Option<Maps>)> = fragments.iter().map(|fragment| (fragment, None)).collect();
        for_each_mut(&mut maps_of, in_parallel, &|(fragment, maps)| {
            *maps = Some(Maps {
                strs: vec![StrId::NONE; fragment.strs.len()],
                tys: vec![TyId::NONE; fragment.tys.list.len()],
                layouts: vec![LayoutId::NONE; fragment.layouts.len()],
                globals: vec![GlobalId::NONE; fragment.globals.len()],
                modules: vec![ModuleId::NONE; fragment.modules.len()],
                funcs: fragment.program_ids.funcs.iter().map(|&id| func_ids[id as usize]).collect(),
                uses_func: vec![false; fragment.program_ids.funcs.len()],
            });
        });
        let maps = maps_of.into_iter().filter_map(|of_fragment| of_fragment.1).collect();
        Numbering {
            fragments,
            index,
            maps,
            strs: Strs::with_capacity(ids.strs_upper_bound()),
            unplaced_strs: Vec::with_capacity(ids.strs_upper_bound()),
            tys: DeclaredTable::default(),
            layouts: Vec::with_capacity(ids.layouts.bound()),
            globals: Vec::with_capacity(ids.globals.bound()),
            modules: Vec::new(),
            str_ids: vec![StrId::NONE; ids.strs_upper_bound()],
            ty_ids: vec![TyId::NONE; ids.tys_upper_bound()],
            layout_ids: vec![LayoutId::NONE; ids.layouts.bound()],
            global_ids: vec![GlobalId::NONE; ids.globals.bound()],
            module_ids: FxHashMap::default(),
            record_positions,
            pending: VecDeque::new(),
        }
    }

    fn str(&mut self, from: u32, local: StrId) -> StrId {
        if local.is_none() {
            return local;
        }
        self.str_by_program_id(from, local, self.fragments[from as usize].program_ids.strs[local.idx()])
    }

    #[inline]
    fn str_by_program_id(&mut self, from: u32, local: StrId, id: u32) -> StrId {
        let known = &mut self.str_ids[id as usize];
        if known.is_none() {
            *known = StrId::new(self.strs.len() + self.unplaced_strs.len());
            self.unplaced_strs.push((from, local));
        }
        *known
    }

    fn gather_strs(&self, in_parallel: InParallel<'_>) -> Vec<(Vec<u8>, Vec<u32>, Vec<u64>)> {
        const STRINGS_PER_RUN: usize = 4096;
        let Numbering { fragments, unplaced_strs, .. } = self;
        let fragments = *fragments;
        let mut runs: Vec<(&[(u32, StrId)], Vec<u8>, Vec<u32>, Vec<u64>)> = unplaced_strs.chunks(STRINGS_PER_RUN).map(|run| (run, Vec::new(), Vec::new(), Vec::new())).collect();
        for_each_mut(&mut runs, in_parallel, &|(run, bytes, lengths, hashes)| {
            for &(from, local) in run.iter() {
                let of_fragment = &fragments[from as usize].strs;
                bytes.extend_from_slice(of_fragment.get(local));
                lengths.push(of_fragment.get(local).len() as u32);
                hashes.push(of_fragment.hash(local));
            }
        });
        runs.into_iter().map(|(_, bytes, lengths, hashes)| (bytes, lengths, hashes)).collect()
    }

    fn part_rank(&self, from: u32, part: &Part) -> Rank {
        let fragment = &self.fragments[from as usize];
        let mut rank = Rank::new();
        match part {
            Part::Class(layout) if layout.is_none() => rank.push(0),
            Part::Class(layout) => rank.extend(match fragment.layouts[layout.idx()].key {
                LayoutKey::Record(_) => [1, u64::from(self.record_positions[fragment.program_ids.layouts[layout.idx()] as usize]), 0],
                LayoutKey::Instance(file, class) => [2, u64::from(file.0), u64::from(class.0)],
                LayoutKey::ClassEnvironment(file, class) => [3, u64::from(file.0), u64::from(class.0)],
                LayoutKey::Environment(file, number) => [4, u64::from(file.0), u64::from(number)],
            }),
            Part::Global(name, arguments) => {
                let name = fragment.strs.get(*name);
                rank.extend([5, name.len() as u64]);
                rank.extend(name.iter().map(|&byte| u64::from(byte)));
                for &argument in arguments {
                    self.add_ty_rank(from, argument, &mut rank);
                }
            }
            Part::Array(element) => {
                rank.push(6);
                self.add_ty_rank(from, *element, &mut rank);
            }
        }
        rank
    }

    fn add_ty_rank(&self, from: u32, ty: TyId, rank: &mut Rank) {
        if ty.is_none() {
            return rank.push(u64::MAX);
        }
        let Declared { prims, ints, parts, any_object, any_function } = self.fragments[from as usize].tys.get(ty);
        let (minimum, maximum) = ints.unwrap_or((0, 0));
        rank.extend([u64::from(*prims), u64::from(*any_object) | u64::from(*any_function) << 1 | u64::from(ints.is_some()) << 2, minimum as u64, maximum as u64, parts.len() as u64]);
        let mut of_parts: SmallVec<[Rank; 4]> = parts.iter().map(|part| self.part_rank(from, part)).collect();
        of_parts.sort_unstable();
        rank.extend(of_parts.into_iter().flatten());
    }

    fn ty(&mut self, from: u32, local: TyId) -> TyId {
        if local.is_none() {
            return local;
        }
        let fragments = self.fragments;
        let program_id = fragments[from as usize].program_ids.tys[local.idx()] as usize;
        let known = self.ty_ids[program_id];
        if known.is_some() {
            return known;
        }
        let Declared { prims, ints, parts, any_object, any_function } = fragments[from as usize].tys.get(local);
        let mut order: SmallVec<[usize; 4]> = (0..parts.len()).collect();
        if parts.len() > 1 {
            order.sort_by_cached_key(|&part| self.part_rank(from, &parts[part]));
        }
        let mut renumbered: SmallVec<[Part; 1]> = SmallVec::new();
        for part in order.into_iter().map(|part| &parts[part]) {
            renumbered.push(match part {
                Part::Class(layout) => Part::Class(self.layout(from, *layout)),
                Part::Global(name, arguments) => Part::Global(self.str(from, *name), arguments.iter().map(|&argument| self.ty(from, argument)).collect()),
                Part::Array(element) => Part::Array(self.ty(from, *element)),
            });
        }
        renumbered.sort_unstable();
        let id = self.tys.intern(Declared { prims: *prims, ints: *ints, parts: renumbered, any_object: *any_object, any_function: *any_function });
        self.ty_ids[program_id] = id;
        id
    }

    fn layout(&mut self, from: u32, local: LayoutId) -> LayoutId {
        if local.is_none() {
            return local;
        }
        self.mark_layout_reached(self.fragments[from as usize].program_ids.layouts[local.idx()])
    }

    fn mark_layout_reached(&mut self, program_id: u32) -> LayoutId {
        let index = self.index;
        let numbered = Some(self.layout_ids[program_id as usize]).filter(|id| id.is_some());
        match (numbered, index.outline.layout(program_id)) {
            (Some(id), _) => id,
            (None, Some(layout)) => {
                self.layout(layout.fragment, layout.base);
                let id = LayoutId::new(self.layouts.len());
                self.layouts.push(FragmentIndex { fragment: layout.fragment, index: layout.index });
                self.layout_ids[program_id as usize] = id;
                self.pending.push_back(Pending::Layout(program_id));
                id
            }
            (None, None) => LayoutId::NONE,
        }
    }

    fn global(&mut self, from: u32, local: GlobalId) -> GlobalId {
        let fragments = self.fragments;
        let program_id = fragments[from as usize].program_ids.globals[local.idx()];
        match Some(self.global_ids[program_id as usize]).filter(|id| id.is_some()) {
            Some(id) => id,
            None => {
                let id = GlobalId::new(self.globals.len());
                let has_file = fragments[from as usize].globals[local.idx()].key.file().is_some();
                self.globals.push(if has_file { self.index.global(program_id).expect(IS_INDEXED) } else { FragmentIndex::new(from as usize, local.idx()) });
                self.global_ids[program_id as usize] = id;
                self.pending.push_back(Pending::Global(id));
                id
            }
        }
    }

    fn module_of(&mut self, file: FileId) -> ModuleId {
        if let Some(&known) = self.module_ids.get(&file) {
            return known;
        }
        let id = ModuleId::new(self.modules.len());
        self.modules.push(file);
        self.module_ids.insert(file, id);
        id
    }

    fn module(&mut self, from: u32, local: ModuleId) -> ModuleId {
        if local.is_none() {
            return local;
        }
        let id = self.module_of(self.fragments[from as usize].modules[local.idx()]);
        self.maps[from as usize].modules[local.idx()] = id;
        id
    }

    fn mark_function_mentioned(&mut self, from: u32, [strs, tys, layouts, globals]: [&[u32]; 4]) {
        let index = self.index;
        let Outline { local, program, .. } = &index.outline;
        for i in strs.iter().map(|&place| place as usize) {
            if self.str_ids[program[i] as usize].is_none() {
                self.str_by_program_id(from, StrId(local[i]), program[i]);
            }
        }
        for i in tys.iter().map(|&place| place as usize) {
            if self.ty_ids[program[i] as usize].is_none() {
                self.ty(from, TyId(local[i]));
            }
        }
        for i in layouts.iter().map(|&place| place as usize) {
            if self.layout_ids[program[i] as usize].is_none() {
                self.mark_layout_reached(program[i]);
            }
        }
        for i in globals.iter().map(|&place| place as usize) {
            if self.global_ids[program[i] as usize].is_none() {
                self.global(from, GlobalId(local[i]));
            }
        }
    }

    fn number_function_header(&mut self, function: &FunctionOutline) {
        let index = self.index;
        let local = &index.outline.local;
        let [declared_this_type, result, ref handed @ ..] = local[function.list(Outline::HEADER_TYS)] else { unreachable!("{IS_KNOWN}") };
        let (captures, params) = handed.split_at(function.captures as usize);
        self.str(function.fragment, function.name);
        self.module(function.fragment, function.module);
        for &ty in captures.iter().chain([&declared_this_type]).chain(params).chain([&result]) {
            self.ty(function.fragment, TyId(ty));
        }
    }

    fn settle(&mut self) {
        let (fragments, index) = (self.fragments, self.index);
        while let Some(pending) = self.pending.pop_front() {
            match pending {
                Pending::Layout(id) => {
                    let Some(layout) = index.outline.layout(id) else { continue };
                    let Outline { local, program, .. } = &index.outline;
                    for i in layout.list(Outline::STRS - 1) {
                        self.str_by_program_id(layout.fragment, StrId(local[i]), program[i]);
                    }
                    for i in layout.list(Outline::TYS - 1) {
                        if self.ty_ids[program[i] as usize].is_none() {
                            self.ty(layout.fragment, TyId(local[i]));
                        }
                    }
                    for i in layout.list(Outline::LAYOUTS - 1) {
                        self.mark_layout_reached(program[i]);
                    }
                    for i in layout.list(Outline::GLOBALS - 1) {
                        self.global(layout.fragment, GlobalId(local[i]));
                    }
                    if layout.constructs.is_some() {
                        self.mark_layout_reached(layout.constructs_id);
                    }
                }
                Pending::Global(id) => {
                    let at = self.globals[id.idx()];
                    let global = &fragments[at.fragment as usize].globals[at.index as usize].global;
                    self.str(at.fragment, global.name);
                    self.module(at.fragment, global.module);
                    self.ty(at.fragment, global.declared);
                }
            }
        }
    }

    fn fill_maps(&mut self, included_of: &[[&[(FragmentIndex, bool)]; 2]], slots_of: &[[&[u32]; 2]], in_parallel: InParallel<'_>) {
        let Numbering { fragments, index, maps, layouts, globals, str_ids, ty_ids, layout_ids, global_ids, .. } = self;
        let outline = &index.outline;
        let mut defined: Vec<[Vec<u32>; 2]> = vec![Default::default(); fragments.len()];
        for at in layouts.iter() {
            defined[at.fragment as usize][0].push(at.index);
        }
        for at in globals.iter() {
            defined[at.fragment as usize][1].push(at.index);
        }
        let mut of_fragments: Vec<(usize, &Fragment, &mut Maps)> = fragments.iter().zip(maps).enumerate().map(|(number, (fragment, maps))| (number, fragment, maps)).collect();
        for_each_mut(&mut of_fragments, in_parallel, &|(number, fragment, maps)| {
            let ids = &fragment.program_ids;
            let set_str = |maps: &mut Maps, local: u32| {
                if local != StrId::NONE.0 {
                    maps.strs[local as usize] = str_ids[ids.strs[local as usize] as usize];
                }
            };
            let set_ty = |maps: &mut Maps, local: u32| {
                if local != TyId::NONE.0 {
                    maps.tys[local as usize] = ty_ids[ids.tys[local as usize] as usize];
                }
            };
            let set_layout = |maps: &mut Maps, local: u32| {
                if local != LayoutId::NONE.0 {
                    maps.layouts[local as usize] = layout_ids[ids.layouts[local as usize] as usize];
                }
            };
            let set_global = |maps: &mut Maps, local: u32| maps.globals[local as usize] = global_ids[ids.globals[local as usize] as usize];
            let Outline { funcs, local, .. } = outline;
            for (&(_, has_body), &place) in included_of[*number].iter().copied().flatten().zip(slots_of[*number].iter().copied().flatten()) {
                let function = &funcs[place as usize];
                if has_body {
                    local[function.list(Outline::STRS)].iter().for_each(|&text| set_str(maps, text));
                    local[function.list(Outline::TYS)].iter().for_each(|&described| set_ty(maps, described));
                    local[function.list(Outline::LAYOUTS)].iter().chain(&local[function.list(Outline::CLASSES_AS_VALUES)]).for_each(|&shape| set_layout(maps, shape));
                    local[function.list(Outline::GLOBALS)].iter().for_each(|&variable| set_global(maps, variable));
                    for &func in local[function.list(Outline::CALLED)].iter().chain(&local[function.list(Outline::VALUES)]) {
                        maps.uses_func[func as usize] = true;
                    }
                } else {
                    set_str(maps, function.name.0);
                    local[function.list(Outline::HEADER_TYS)].iter().for_each(|&described| set_ty(maps, described));
                }
                set_layout(maps, function.class.0);
            }
            for &index in &defined[*number][0] {
                let Some(layout) = outline.layout(ids.layouts[index as usize]) else { continue };
                local[layout.list(Outline::STRS - 1)].iter().for_each(|&text| set_str(maps, text));
                local[layout.list(Outline::TYS - 1)].iter().for_each(|&described| set_ty(maps, described));
                local[layout.list(Outline::LAYOUTS - 1)].iter().chain([&layout.constructs.0, &layout.base.0]).for_each(|&shape| set_layout(maps, shape));
                local[layout.list(Outline::GLOBALS - 1)].iter().for_each(|&variable| set_global(maps, variable));
                for &func in local[layout.list(Outline::CALLED - 1)].iter().chain(&local[layout.list(Outline::VALUES - 1)]) {
                    maps.uses_func[func as usize] = true;
                }
            }
            for &index in &defined[*number][1] {
                let variable = &fragment.globals[index as usize].global;
                set_str(maps, variable.name.0);
                set_ty(maps, variable.declared.0);
            }
        });
    }

    fn number_type_parts(&mut self, in_parallel: InParallel<'_>) {
        let Numbering { fragments, maps, str_ids, ty_ids, layout_ids, .. } = self;
        let mut of_fragments: Vec<(&Fragment, &mut Maps)> = fragments.iter().zip(maps).collect();
        for_each_mut(&mut of_fragments, in_parallel, &|(fragment, maps)| {
            let ids = &fragment.program_ids;
            for local in (0..maps.tys.len()).rev() {
                if maps.tys[local].is_none() {
                    continue;
                }
                let mut number = |ty: TyId| {
                    if ty.is_some() {
                        maps.tys[ty.idx()] = ty_ids[ids.tys[ty.idx()] as usize];
                    }
                };
                for part in &fragment.tys.list[local].parts {
                    match part {
                        Part::Class(layout) if layout.is_none() => {}
                        Part::Class(layout) => maps.layouts[layout.idx()] = layout_ids[ids.layouts[layout.idx()] as usize],
                        Part::Global(name, arguments) => {
                            if name.is_some() {
                                maps.strs[name.idx()] = str_ids[ids.strs[name.idx()] as usize];
                            }
                            arguments.iter().copied().for_each(&mut number);
                        }
                        Part::Array(element) => number(*element),
                    }
                }
            }
        });
    }

}

fn stub(func: &Func, maps: &Maps, anything: TyId) -> Func {
    let ty = |local: TyId| if local.is_none() { local } else { maps.tys[local.idx()] };
    let or_anything = |ty: TyId| if ty.is_none() { anything } else { ty };
    let mut stub = Func {
        name: if func.name.is_none() { func.name } else { maps.strs[func.name.idx()] },
        module: if func.module.is_none() { func.module } else { maps.modules[func.module.idx()] },
        pos: func.pos,
        source_start: func.source_start,
        source_end: func.source_end,
        kind: func.kind,
        flags: func.flags & !COROUTINE,
        length: func.length,
        captures: func.captures.iter().map(|&capture| ty(capture)).collect(),
        declared_this_type: ty(func.declared_this_type),
        params: func.params.iter().map(|&param| ty(param)).collect(),
        annotated: func.annotated.clone(),
        result: ty(func.result),
        blocks: Vec::new(),
        values: Vec::new(),
        spans: Vec::new(),
    };
    let entry = stub.add_block();
    for capture in stub.captures.clone() {
        stub.add_param(entry, or_anything(capture));
    }
    if stub.has(func_flags::HAS_THIS) {
        stub.add_param(entry, or_anything(stub.declared_this_type));
    }
    for param in stub.params.clone() {
        stub.add_param(entry, or_anything(param));
    }
    stub.blocks[entry.idx()].term = Some(Term::Unreachable);
    stub
}

#[derive(Default)]
struct FieldTypeCache {
    by_field: FxHashMap<(LayoutId, StrId, TyId), TyId>,
    is_found: Vec<bool>,
    subset_cache: FxHashMap<(TyId, TyId), bool>,
}

trait TypeTable {
    fn table(&self) -> &DeclaredTable;
    fn number_of(&mut self, described: Declared) -> Option<TyId>;
}

impl TypeTable for &DeclaredTable {
    fn table(&self) -> &DeclaredTable {
        self
    }
    fn number_of(&mut self, described: Declared) -> Option<TyId> {
        self.find(&described)
    }
}

impl TypeTable for &mut DeclaredTable {
    fn table(&self) -> &DeclaredTable {
        self
    }
    fn number_of(&mut self, described: Declared) -> Option<TyId> {
        Some(self.intern(described))
    }
}

fn retype_reads_from_field_types(func: &mut Func, layouts: &[Layout], tys: &mut impl TypeTable, supertypes_by_layout: &[Vec<LayoutId>], sibling_layouts: &[OnceLock<Vec<LayoutId>>], known: &mut FieldTypeCache) -> bool {
    let mut previous: Vec<(usize, TyId, Prediction)> = Vec::new();
    for index in 0..func.values.len() {
        let Prediction::Field(ty) = func.values[index].prediction() else { continue };
        let read = match func.values[index].def {
            Def::Op(Op::PropGet { obj, name }) => tys.table().get(func.values[obj.idx()].ty).single_layout().map(|view| (view, name)),
            _ => None,
        };
        let is_fact = |tys: &DeclaredTable, view: LayoutId, name: StrId| {
            let view = &layouts[view.idx()];
            let members = || view.members.iter().map(|member| &layouts[member.idx()]);
            let is_pristine = |layout: &Layout| layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE == 0;
            let has_it = |layout: &Layout| {
                let declared = layout.field(name).map_or(TyId::NONE, |field| layout.fields[field as usize].declared);
                declared.is_some() && tys.get(declared).is_subset_of(tys.get(ty))
            };
            !view.accepts_untyped && is_pristine(view) && members().all(is_pristine) && (view.field(name).is_some() || !view.members.is_empty() && members().all(has_it))
        };
        let held = match read {
            None => TyId::NONE,
            Some((view, name)) => match known.by_field.get(&(view, name, ty)) {
                Some(&known) => known,
                None if !is_fact(tys.table(), view, name) => {
                    known.by_field.insert((view, name, ty), TyId::NONE);
                    TyId::NONE
                }
                None => {
                    let FieldTypeCache { is_found, subset_cache, .. } = &mut *known;
                    let beside = sibling_layouts[view.idx()].get_or_init(|| {
                        let mut beside: Vec<LayoutId> = Vec::new();
                        for &other in layouts[view.idx()].members.iter().chain([&view]).flat_map(|member| &supertypes_by_layout[member.idx()]) {
                            if !std::mem::replace(&mut is_found[other.idx()], true) {
                                beside.push(other);
                            }
                        }
                        for other in &beside {
                            is_found[other.idx()] = false;
                        }
                        beside
                    });
                    let layouts_in = |described: &Declared| -> Vec<LayoutId> { described.parts.iter().filter_map(|part| if let Part::Class(layout) = part { layout.is_some().then_some(*layout) } else { None }).collect() };
                    let is_subtype = |sub: LayoutId, sup: LayoutId| {
                        let (below, above) = (&layouts[sub.idx()], &layouts[sup.idx()]);
                        sub == sup || !below.accepts_untyped && below.members.iter().all(|member| above.members.binary_search(member).is_ok())
                    };
                    let read_as = tys.table().get(ty);
                    let is_within = |declared: TyId| {
                        let taken = tys.table().get(declared);
                        let besides = Declared { parts: taken.parts.iter().filter(|part| !matches!(part, Part::Class(_))).cloned().collect(), ..taken.clone() };
                        besides.is_subset_of(read_as) && (read_as.any_object || layouts_in(taken).into_iter().all(|sub| layouts_in(read_as).into_iter().any(|sup| is_subtype(sub, sup))))
                    };
                    let (mut more, mut takes_anything): (Vec<TyId>, bool) = (Vec::new(), false);
                    for other in beside.iter() {
                        let other = &layouts[other.idx()];
                        let Some(field) = other.field(name) else { continue };
                        let declared = other.fields[field as usize].declared;
                        takes_anything |= declared.is_none();
                        if declared.is_some() && declared != ty && !more.contains(&declared) && !*subset_cache.entry((declared, ty)).or_insert_with(|| is_within(declared)) {
                            more.push(declared);
                        }
                    }
                    let held = if takes_anything {
                        TyId::NONE
                    } else if more.is_empty() {
                        ty
                    } else {
                        let described = more.iter().fold(read_as.clone(), |described, &declared| described.or(tys.table().get(declared)));
                        let Some(held) = tys.number_of(described) else {
                            for (index, ty, prediction) in previous.into_iter().rev() {
                                func.values[index].ty = ty;
                                func.values[index].set_prediction(prediction);
                            }
                            return false;
                        };
                        held
                    };
                    known.by_field.insert((view, name, ty), held);
                    held
                }
            },
        };
        let value = &mut func.values[index];
        previous.push((index, value.ty, value.prediction()));
        let prediction;
        (value.ty, prediction) = if held == ty {
            (ty, Prediction::None)
        } else if held.is_some() && value.ty == tys.table().anything {
            (held, Prediction::Ty(ty))
        } else {
            (value.ty, Prediction::Ty(ty))
        };
        value.set_prediction(prediction);
    }
    true
}

pub(crate) mod has {
    pub(super) const DELETIONS: u8 = 1 << 0;
    pub(super) const PREDICTIONS_BY_KEY: u8 = 1 << 1;
    pub(super) const PREDICTIONS_BY_FIELD: u8 = 1 << 2;
    pub(super) const NEW_OBJECTS: u8 = 1 << 3;
    pub(super) const OBJECT_LITERALS: u8 = 1 << 4;
    pub(crate) const CONSTRUCTIONS_OR_SIZES: u8 = 1 << 5;
    pub(super) const NON_NULL_ASSERTIONS: u8 = 1 << 6;
}

fn content_flags(func: &Func, size: Option<StrId>) -> u8 {
    let mut found = 0;
    for value in &func.values {
        found |= match value.prediction() {
            Prediction::ByKey(_) => has::PREDICTIONS_BY_KEY,
            Prediction::Field(_) => has::PREDICTIONS_BY_FIELD,
            _ => 0,
        };
        found |= match value.def {
            Def::Op(Op::PropDelete { .. } | Op::ElemDelete { .. }) => has::DELETIONS,
            Def::Op(Op::New(_) | Op::NewWith { .. }) => has::NEW_OBJECTS,
            Def::Op(Op::NewObject) => has::OBJECT_LITERALS,
            Def::Op(Op::Coerce { why: CoerceReason::NonNull(_), .. }) => has::NON_NULL_ASSERTIONS,
            Def::Op(Op::Construct { .. }) => has::CONSTRUCTIONS_OR_SIZES,
            Def::Op(Op::PropGet { name, .. }) if Some(name) == size => has::CONSTRUCTIONS_OR_SIZES,
            _ => 0,
        };
    }
    found
}

const COROUTINE: u16 = func_flags::ASYNC | func_flags::GENERATOR | func_flags::STARTS_EAGERLY;

const IS_KNOWN: &str = "the index has no function that is only named";

fn spawn_outside_pool<'scope, T: Send + 'scope>(scope: &'scope std::thread::Scope<'scope, '_>, work: impl FnOnce() -> T + Send + 'scope) -> std::thread::ScopedJoinHandle<'scope, T> {
    const STACK: usize = 64 << 20;
    let work = move || {
        bun_core::StackCheck::configure_thread();
        work()
    };
    std::thread::Builder::new().name("AOT link".to_owned()).stack_size(STACK).spawn_scoped(scope, work).expect("a thread of the link could not be started")
}
struct FuncIds<'a> {
    ids: &'a ProgramIds,
    by_program_id: Vec<FuncId>,
}

impl FuncIds<'_> {
    fn get(&self, key: FuncKey) -> Option<FuncId> {
        Some(self.by_program_id[self.ids.funcs.find(&key)? as usize]).filter(|id| id.is_some())
    }
}

const IS_INDEXED: &str = "every fragment that mentions a variable is in the index with it";

struct Renumber<'a>(&'a Maps);

impl Ids for Renumber<'_> {
    fn str(&mut self, id: &mut StrId) {
        *id = self.0.strs[id.idx()];
    }
    fn ty(&mut self, id: &mut TyId) {
        *id = self.0.tys[id.idx()];
    }
    fn layout(&mut self, id: &mut LayoutId) {
        *id = self.0.layouts[id.idx()];
    }
    fn global(&mut self, id: &mut GlobalId) {
        *id = self.0.globals[id.idx()];
    }
    fn module(&mut self, id: &mut ModuleId) {
        *id = self.0.modules[id.idx()];
    }
    fn func(&mut self, id: &mut FuncId, _: Used) {
        *id = self.0.funcs[id.idx()];
    }
}

fn first_evaluating_entry_point(number_of_files: usize, entry_points: &[Vec<usize>], static_imports_of: &dyn Fn(usize) -> Vec<usize>) -> Vec<u32> {
    let mut first = vec![u32::MAX; number_of_files];
    for (entry_point, files) in entry_points.iter().enumerate() {
        let mut pending = files.clone();
        while let Some(file) = pending.pop() {
            if first[file] == u32::MAX {
                first[file] = entry_point as u32;
                pending.extend(static_imports_of(file));
            }
        }
    }
    first
}

fn renumber_func(func: &mut Func, maps: &Maps) {
    for_each_func_id(func, &mut Renumber(maps));
    for value in &mut func.values {
        if value.prediction() == Prediction::Closure(FuncId::NONE) {
            value.set_prediction(Prediction::None);
        }
    }
}

fn explain_start(program: &Program, evaluating: &[(FuncId, FuncKey)]) -> Vec<String> {
    let kinds: [(&str, fn(FuncKey) -> bool); 3] = [
        ("functions that evaluate a module once", |key| matches!(key, FuncKey::Module(_))),
        ("bodies of modules", |key| matches!(key, FuncKey::ModuleBody(_))),
        ("initializers of lazy variables", |key| matches!(key, FuncKey::Initializer(..))),
    ];
    kinds
        .into_iter()
        .map(|(what, is_such)| {
            let (mut functions, mut idle, mut operations) = (0u32, 0u32, 0u32);
            let mut by_name: FxHashMap<String, u32> = FxHashMap::default();
            for &(id, _) in evaluating.iter().filter(|found| is_such(found.1)) {
                functions += 1;
                let before = operations;
                for value in &program.funcs[id.idx()].values {
                    let Def::Op(op) = &value.def else { continue };
                    let of_class = |func: FuncId| if program.funcs[func.idx()].kind == FuncKind::Constructor { " of a class" } else { "" };
                    let name = match op {
                        Op::Undefined | Op::Null | Op::Bool(_) | Op::Int(_) | Op::Double(_) => continue,
                        Op::Operation { which, .. } => which.name().to_owned(),
                        Op::FuncRef(func) => format!("FuncRef{}", of_class(*func)),
                        Op::Closure { func, .. } => format!("Closure{}", of_class(*func)),
                        Op::CallDirect { func, .. } if program.funcs[func.idx()].kind == FuncKind::Module => "CallDirect of such a function".to_owned(),
                        _ => format!("{op:?}").chars().take_while(char::is_ascii_alphanumeric).collect(),
                    };
                    operations += 1;
                    *by_name.entry(name).or_default() += 1;
                }
                idle += u32::from(operations == before);
            }
            let mut by_name: Vec<(String, u32)> = by_name.into_iter().collect();
            by_name.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let by_name = by_name.into_iter().map(|(name, count)| format!("{name} {count}")).collect::<Vec<_>>().join(", ");
            format!("deferred: in the linked program: {what} {functions}, with nothing to do {idle}; operations {operations}: {by_name}")
        })
        .collect()
}

fn entry_function(name: StrId, anything: TyId, roots: &[FuncId], import: Option<FuncId>, first_operation: Option<Operation>) -> Func {
    let mut func = Func {
        name,
        module: ModuleId::NONE,
        pos: 0,
        source_start: 0,
        source_end: 0,
        kind: FuncKind::Module,
        flags: 0,
        length: 0,
        captures: Vec::new(),
        declared_this_type: TyId::NONE,
        params: Vec::new(),
        annotated: Vec::new(),
        result: TyId::NONE,
        blocks: Vec::new(),
        values: Vec::new(),
        spans: Vec::new(),
    };
    let entry = func.add_block();
    if let Some(which) = first_operation {
        func.append(entry, Op::Operation { which, args: ir::Args::new() }, 0, anything);
    }
    for &root in roots {
        func.append(entry, Op::CallDirect { func: root, args: ir::Args::new() }, 0, anything);
    }
    let produced = import.map_or(V::NONE, |import| func.append(entry, Op::FuncRef(import), 0, anything));
    func.blocks[entry.idx()].term = Some(Term::Return(produced));
    func
}

struct Final<'a> {
    program: &'a Program,
    tys: FxHashMap<&'a Declared, TyId>,
    funcs: &'a [FuncId],
    layouts: &'a [LayoutId],
    globals: &'a [GlobalId],
    is_stub: &'a [bool],
}

struct Finder<'a> {
    fragment: &'a Fragment,
    all: &'a Final<'a>,
    tys: Vec<Option<Option<TyId>>>,
}

impl Finder<'_> {
    fn str(&self, local: StrId) -> Option<StrId> {
        if local.is_none() { Some(local) } else { self.all.program.strs.find(self.fragment.strs.get(local)) }
    }

    fn layout(&self, local: LayoutId) -> Option<LayoutId> {
        if local.is_none() { Some(local) } else { Some(self.all.layouts[self.fragment.program_ids.layouts[local.idx()] as usize]).filter(|id| id.is_some()) }
    }

    fn func(&self, local: FuncId) -> Option<FuncId> {
        if local.is_none() { Some(local) } else { Some(self.all.funcs[self.fragment.program_ids.funcs[local.idx()] as usize]).filter(|id| id.is_some()) }
    }

    fn variable(&self, local: u32, is_module_variable: bool) -> Option<u32> {
        if !is_module_variable || local == NO_VARIABLE {
            return Some(local);
        }
        let global = self.all.globals[self.fragment.program_ids.globals[local as usize] as usize];
        global.is_some().then_some(global.0)
    }

    fn ty(&mut self, local: TyId) -> Option<TyId> {
        if local.is_none() {
            return Some(local);
        }
        if let Some(known) = self.tys[local.idx()] {
            return known;
        }
        let found = self.ty_uncached(local);
        self.tys[local.idx()] = Some(found);
        found
    }

    fn ty_uncached(&mut self, local: TyId) -> Option<TyId> {
        let fragment = self.fragment;
        let Declared { prims, ints, parts, any_object, any_function } = fragment.tys.get(local);
        let mut renumbered: SmallVec<[Part; 1]> = SmallVec::new();
        for part in parts {
            renumbered.push(match part {
                Part::Class(layout) => Part::Class(self.layout(*layout)?),
                Part::Global(name, arguments) => {
                    let arguments: Option<SmallVec<[TyId; 2]>> = arguments.iter().map(|&argument| self.ty(argument)).collect();
                    Part::Global(self.str(*name)?, arguments?)
                }
                Part::Array(element) => Part::Array(self.ty(*element)?),
            });
        }
        renumbered.sort_unstable();
        let declared = Declared { prims: *prims, ints: *ints, parts: renumbered, any_object: *any_object, any_function: *any_function };
        self.all.tys.get(&declared).copied()
    }

    fn matches_single_function(&self, local: FuncId, flags: u8, out: FuncId, out_flags: u8) -> bool {
        let found = self.func(local).unwrap_or(FuncId::NONE);
        found == out && (found.is_none() || flags == out_flags)
    }

    fn is_func(&mut self, local: &Func, id: FuncId) -> bool {
        let all = self.all;
        let out = &all.program.funcs[id.idx()];
        let known_later = func_flags::IS_VALUE | func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE | if all.is_stub[id.idx()] { COROUTINE } else { 0 };
        local.kind == out.kind
            && (local.flags ^ out.flags) & !known_later == 0
            && local.annotated == out.annotated
            && local.params.len() == out.params.len()
            && local.captures.len() == out.captures.len()
            && local.captures.iter().zip(&out.captures).all(|(&capture, &same)| self.ty(capture) == Some(same))
            && self.ty(local.declared_this_type) == Some(out.declared_this_type)
            && self.ty(local.result) == Some(out.result)
            && local.params.iter().zip(&out.params).all(|(&param, &same)| self.ty(param) == Some(same))
    }

    fn matches_layout(&mut self, local: &Layout, id: LayoutId) -> bool {
        let all = self.all;
        let out = &all.program.layouts[id.idx()];
        let lists_methods = local.kind != LayoutKind::Record;
        let is_alike = local.kind == out.kind
            && (local.class_flags ^ out.class_flags) & !(class_flags::MAY_HAVE_OTHER_PROTOTYPE | class_flags::HAS_NO_OWN_INSTANCES) == 0
            && local.fields.len() == out.fields.len()
            && (!lists_methods || local.methods.len() == out.methods.len())
            && local.static_fields.len() == out.static_fields.len()
            && self.layout(local.base) == Some(out.base)
            && self.layout(local.environment) == Some(out.environment)
            && self.func(local.constructor) == Some(out.constructor);
        if !is_alike {
            return false;
        }
        for (field, same) in local.fields.iter().zip(&out.fields) {
            if field.flags != same.flags || self.str(field.name) != Some(same.name) || self.ty(field.declared) != Some(same.declared) {
                return false;
            }
            if !self.matches_single_function(field.single_function, field.single_function_flags, same.single_function, same.single_function_flags) {
                return false;
            }
            let is_same_literal = |(literal, same): (&Literal, &Literal)| match (*literal, *same) {
                (Literal::Str(text), Literal::Str(same)) => self.str(text) == Some(same),
                (Literal::Num(number), Literal::Num(same)) => number.to_bits() == same.to_bits(),
                _ => false,
            };
            if field.literals.len() != same.literals.len() || !field.literals.iter().zip(&same.literals).all(is_same_literal) {
                return false;
            }
        }
        let has_module_variables = local.environment.is_none();
        for (method, same) in local.methods.iter().zip(&out.methods).filter(|_| lists_methods) {
            if method.kind != same.kind
                || method.flags != same.flags
                || self.str(method.name) != Some(same.name)
                || self.func(method.func) != Some(same.func)
                || self.variable(method.key, has_module_variables) != Some(same.key)
            {
                return false;
            }
        }
        (local.static_fields.iter().zip(&out.static_fields)).all(|(field, same)| self.str(field.0) == Some(same.0) && self.ty(field.1) == Some(same.1))
    }
}

fn disagreements(fragment: &Fragment, maps: &Maps, all: &Final<'_>, nowhere: FileId) -> Vec<Problem> {
    let mut finder = Finder { fragment, all, tys: vec![None; fragment.tys.list.len()] };
    let file = if fragment.file == NO_FILE { nowhere } else { fragment.file };
    let mut problems = Vec::new();
    for (i, function) in fragment.funcs.iter().enumerate() {
        if let Some(func) = &function.func
            && maps.uses_func[i]
            && maps.funcs[i].is_some()
            && !finder.is_func(func, maps.funcs[i])
        {
            problems.push(Problem { file, pos: 0, what: format!("the function `{}` ({:?}), whose definition differs from the one this file was compiled against", text_of(&fragment.strs, func.name), function.key).into() });
        }
    }
    for (shape, &id) in fragment.layouts.iter().zip(&maps.layouts) {
        if let Some(definition) = &shape.definition
            && id.is_some()
            && !finder.matches_layout(&definition.layout, id)
        {
            problems.push(Problem { file, pos: 0, what: format!("the layout `{}` ({:x?}), whose definition differs from the one this file was compiled against", text_of(&fragment.strs, shape.name), shape.key).into() });
        }
    }
    for (variable, &id) in fragment.globals.iter().zip(&maps.globals) {
        if id.is_none() {
            continue;
        }
        let out = &all.program.globals[id.idx()];
        if variable.global.initialization != out.initialization
            || finder.ty(variable.global.declared) != Some(out.declared)
            || !finder.matches_single_function(variable.global.single_function, variable.global.single_function_flags, out.single_function, out.single_function_flags)
        {
            problems.push(Problem { file, pos: 0, what: format!("the variable `{}` ({:?}), whose definition differs from the one this file was compiled against", text_of(&fragment.strs, variable.global.name), variable.key).into() });
        }
    }
    problems
}

const TYPES_PER_CHECKER: usize = 8192;

fn add_kept_types(program: &Checked<'_>, seen: &mut FxHashSet<TypeId>, types: &mut FxHashMap<Identity, TypeId>, lanes: usize, in_parallel: InParallel<'_>) {
    let mut retained = program.checker().kept_types_on_pool(in_parallel);
    retained.retain(|&ty| seen.insert(ty));
    let mut slices: Vec<(&[TypeId], Vec<Identity>)> = retained.chunks(TYPES_PER_CHECKER).map(|slice| (slice, Vec::new())).collect();
    for_each_mut_in_lanes(&mut slices, lanes, in_parallel, &|(slice, identities)| {
        let mut c = program.checker();
        *identities = slice.iter().map(|&ty| c.type_identity(ty)).collect();
    });
    types.reserve(retained.len());
    let c = program.checker();
    for (&ty, &identity) in retained.iter().zip(slices.iter().flat_map(|slice| &slice.1)) {
        let first = types.entry(identity).or_insert(ty);
        if *first != ty
            && let (Some(written_at), Some(so_far)) = (c.object_literal_span(ty), c.object_literal_span(*first))
            && written_at < so_far
        {
            *first = ty;
        }
    }
}

const NAMES_ON_OBJECT_PROTOTYPE: [&str; 12] = [
    "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
];

const LAYOUTS_PER_TASK: usize = 128;
const MAX_ROUNDS: usize = 32;
const LINK_STEP: u32 = u32::MAX;

fn describe_in_tasks<'s>(
    program: &Checked<'s>,
    missing: &[(Identity, TypeId)],
    index: &Index,
    ids: &ProgramIds,
    kinds_declared: &KindsDeclared,
    in_parallel: InParallel<'_>,
    describe: Describe<'_>,
    (times, since): (&mut Times, &mut Instant),
) -> (Vec<Fragment>, bool) {
    let (mut described, mut ran_out_of_stack) = (Vec::new(), false);
    let asked: FxHashSet<Identity> = missing.iter().map(|&(identity, _)| identity).collect();
    let is_defined = |identity: Identity| asked.contains(&identity) || index.record(ids, identity).is_some();
    let mut slices: Vec<Vec<TypeId>> = missing.chunks(LAYOUTS_PER_TASK).map(|slice| slice.iter().map(|&(_, ty)| ty).collect()).collect();
    while !slices.is_empty() {
        let mut tasks: Vec<(usize, Option<(Fragment, bool, Finished<'s>)>)> = (0..slices.len()).map(|index| (index, None)).collect();
        for_each_mut(&mut tasks, in_parallel, &|(index, outcome)| {
            let mut c = program.checker();
            c.begin_stack_budget();
            c.begin_task(LINK_STEP, *index as u32, true);
            c.withhold_expression_tables();
            let mut fragment = describe(&mut c, &slices[*index], &is_defined);
            ids.assign(&mut fragment);
            *outcome = Some((fragment, c.take_ran_out_of_stack(), c.end_task()));
        });
        times.add("describe", since);
        let mut fragments = Vec::with_capacity(tasks.len());
        let mut finished = Vec::with_capacity(tasks.len());
        for (fragment, is_exhausted, task) in tasks.into_iter().filter_map(|task| task.1) {
            fragments.push(fragment);
            finished.push(task);
            ran_out_of_stack |= is_exhausted;
        }
        let is_invalid = program.validate(&finished, true);
        let mut at = is_invalid.iter();
        finished.retain(|_| at.next().is_some_and(|is_invalid| !is_invalid));
        let mut retried = Vec::new();
        for ((fragment, slice), &is_invalid) in fragments.into_iter().zip(slices).zip(&is_invalid) {
            if is_invalid {
                retried.push(slice);
            } else {
                described.push(fragment);
            }
        }
        kinds_declared.publish(|| {
            program.link(&mut finished, in_parallel);
            program.publish(&mut finished, in_parallel, false);
        });
        times.add("barriers", since);
        slices = retried;
    }
    (described, ran_out_of_stack)
}

const QUERIES_PER_CHECKER: usize = 64;
const CHECKERS_PER_ROUND: usize = 64;

fn answer_queries(program: &Checked<'_>, queries: &[SubtypeQuery], stored: &FxHashSet<Atom>, truncated: &mut Vec<(TypeId, TypeId, u8)>, in_parallel: InParallel<'_>) -> (Vec<SubtypeAnswer>, bool) {
    let known: &[(TypeId, TypeId, u8)] = truncated;
    let mut slices: Vec<(&[SubtypeQuery], Vec<SubtypeAnswer>, bool, Vec<(TypeId, TypeId, u8)>)> = queries.chunks(queries.len().div_ceil(CHECKERS_PER_ROUND).max(QUERIES_PER_CHECKER)).map(|slice| (slice, Vec::new(), false, Vec::new())).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, answers, ran_out_of_stack, cut_now)| {
        let mut c = program.checker();
        c.begin_stack_budget();
        c.set_truncated_queries(known);
        *answers = c.answer(slice, stored);
        *ran_out_of_stack = c.take_ran_out_of_stack();
        *cut_now = c.truncated_queries();
    });
    for slice in &mut slices {
        keep_truncated_queries(truncated, std::mem::take(&mut slice.3));
    }
    let ran_out_of_stack = slices.iter().any(|slice| slice.2);
    (slices.into_iter().flat_map(|slice| slice.1).collect(), ran_out_of_stack)
}

fn keep_truncated_queries(retained: &mut Vec<(TypeId, TypeId, u8)>, mut more: Vec<(TypeId, TypeId, u8)>) {
    if !more.is_empty() {
        retained.append(&mut more);
        retained.sort_unstable_by_key(|query| (query.0.0, query.1.0, query.2));
        retained.dedup();
    }
}

struct Names {
    stored: Vec<bool>,
    read: Vec<bool>,
}

const FUNCTIONS_PER_SLICE: usize = 256;

pub(crate) fn constant_string(func: &Func, mut value: V) -> Option<StrId> {
    while value.is_some() {
        match func.op(value)? {
            Op::Str(text) => return Some(*text),
            Op::ToKey(inner) | Op::Coerce { value: inner, .. } => value = *inner,
            _ => break,
        }
    }
    None
}

fn collect_property_names(func: &Func, layouts: &[Layout], stored: &mut Vec<StrId>, read: &mut Vec<StrId>) {
    for value in &func.values {
        let Def::Op(op) = &value.def else { continue };
        match op {
            Op::PropSet { name, .. } => stored.push(*name),
            Op::NewWith { name, .. } => stored.push(*name),
            Op::FieldSet { layout, field, .. } if layout.is_some() && layouts[layout.idx()].kind != LayoutKind::Environment => stored.push(layouts[layout.idx()].fields[*field as usize].name),
            Op::ElemSet { key, .. } => stored.extend(constant_string(func, *key)),
            Op::PropGet { name, .. } | Op::PropHas { name, .. } | Op::CallMethod { name, .. } => read.push(*name),
            Op::ElemGet { key, .. } | Op::ElemHas { key, .. } => read.extend(constant_string(func, *key)),
            _ => {}
        }
        if let Op::Operation { args, .. } | Op::Call { args, .. } | Op::CallMethod { args, .. } | Op::CallDirect { args, .. } | Op::Construct { args, .. } = op {
            for name in args.iter().filter_map(|&arg| constant_string(func, arg)) {
                stored.push(name);
                read.push(name);
            }
        }
    }
}

struct Marks {
    names: Vec<AtomicU8>,
    is_copied_to: Vec<AtomicBool>,
}

impl Marks {
    const IS_STORED: u8 = 1;
    const IS_READ: u8 = 2;

    fn add_names(&self, names: &mut Vec<StrId>, mark: u8) {
        for name in names.drain(..).filter(|name| name.is_some()) {
            if self.names[name.idx()].load(Ordering::Relaxed) & mark == 0 {
                self.names[name.idx()].fetch_or(mark, Ordering::Relaxed);
            }
        }
    }

    fn add(&self, func: &Func, layouts: &[Layout], stored: &mut Vec<StrId>, read: &mut Vec<StrId>) {
        if !func.has(func_flags::IS_IN_BUILTIN_MODULE) || func.has(func_flags::IS_TYPED) {
            collect_property_names(func, layouts, stored, read);
            self.add_names(stored, Marks::IS_STORED);
            self.add_names(read, Marks::IS_READ);
        }
        for value in &func.values {
            if let Def::Op(Op::Coerce { to, why: CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Coerce | CoerceReason::CoerceFreshGraph, .. }) = value.def
                && to.is_some()
            {
                self.is_copied_to[to.idx()].store(true, Ordering::Relaxed);
            }
        }
    }
}

impl Names {
    fn new(program: &Program, marks: &Marks, is_in_opaque_file: &[bool]) -> Names {
        let mut names = Names { stored: vec![false; program.strs.len()], read: vec![false; program.strs.len()] };
        for (name, marks) in marks.names.iter().enumerate() {
            names.stored[name] = marks.load(Ordering::Relaxed) & Marks::IS_STORED != 0;
            names.read[name] = marks.load(Ordering::Relaxed) & Marks::IS_READ != 0;
        }
        for (layout, _) in program.layouts.iter().zip(is_in_opaque_file).filter(|layout| !layout.1) {
            let of_class = layout.methods.iter().map(|method| method.name).chain(layout.static_fields.iter().map(|field| field.0));
            for name in of_class.filter(|name| name.is_some()) {
                names.stored[name.idx()] = true;
            }
        }
        names
    }
}

fn explain_external_data(program: &Program, is_runtime_layout: &[bool]) -> Vec<String> {
    let is_own = |layout: usize| !is_runtime_layout.get(layout).copied().unwrap_or(false);
    let is_fact = |ty: TyId| ty.is_some() && ty != program.tys.anything;
    let (mut parameters, mut results, mut joins, mut fields) = ((0usize, 0usize), (0usize, 0usize), (0usize, 0usize), (0usize, 0usize));
    let (mut receivers, mut properties, mut containers, mut elements) = ((0usize, 0usize), (0usize, 0usize), (0usize, 0usize), (0usize, 0usize));
    let mut read_through = vec![0usize; program.layouts.len()];
    let count = |counter: &mut (usize, usize), ty: TyId| {
        counter.0 += usize::from(is_fact(ty));
        counter.1 += 1;
    };
    for func in program.funcs.iter().filter(|func| func.flags & func_flags::IS_TYPED != 0 && func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0) {
        for &parameter in &func.params {
            count(&mut parameters, parameter);
        }
        count(&mut results, func.result);
        for value in &func.values {
            match &value.def {
                ir::Def::Param(block, _) if *block != Func::ENTRY => count(&mut joins, value.ty),
                ir::Def::Op(Op::PropGet { obj, .. }) => {
                    let receiver = func.values[obj.idx()].ty;
                    count(&mut receivers, receiver);
                    count(&mut properties, value.ty);
                    if receiver.is_some() {
                        for part in &program.tys.get(receiver).parts {
                            if let Part::Class(view) = part {
                                read_through[view.idx()] += 1;
                            }
                        }
                    }
                }
                ir::Def::Op(Op::ElemGet { obj, .. }) => {
                    count(&mut containers, func.values[obj.idx()].ty);
                    count(&mut elements, value.ty);
                }
                _ => {}
            }
        }
    }
    let mut created = 0usize;
    for (_, layout) in program.layouts.iter().enumerate().filter(|&(index, layout)| is_own(index) && layout.kind != LayoutKind::Environment && layout.is_allocated) {
        created += 1;
        for field in &layout.fields {
            count(&mut fields, field.declared);
        }
    }
    let rows = [
        ("parameters", parameters),
        ("results", results),
        ("joins", joins),
        ("fields of the layouts that objects are made as", fields),
        ("reads of a property: the receiver", receivers),
        ("reads of a property: the value read", properties),
        ("reads of an element: the container", containers),
        ("reads of an element: the value read", elements),
    ];
    let share = |(facts, all): (usize, usize)| format!("{facts} of {all} ({:.1}%)", 100.0 * facts as f64 / all.max(1) as f64);
    let sum = |counted: &[(usize, usize)]| counted.iter().fold((0, 0), |sum, counted| (sum.0 + counted.0, sum.1 + counted.1));
    let in_all = format!("given: facts: {} of the places, {} of the reads", share(sum(&[parameters, results, joins, fields])), share(sum(&[properties, elements])));
    let views = program.layouts.iter().enumerate().filter(|&(index, layout)| is_own(index) && layout.kind != LayoutKind::Environment).map(|(_, layout)| layout);
    let accepting_untyped = format!("given: layouts that admit strangers: {}", share((views.clone().filter(|layout| layout.accepts_untyped).count(), views.count())));
    let created = format!("given: layouts that objects are made as: {created}");
    let mut most_read: Vec<usize> = (0..program.layouts.len()).filter(|&view| read_through[view] > 0 && is_own(view) && program.layouts[view].name.is_some()).collect();
    most_read.sort_by(|&a, &b| read_through[b].cmp(&read_through[a]).then_with(|| program.strs.get(program.layouts[a].name).cmp(program.strs.get(program.layouts[b].name))).then(a.cmp(&b)));
    let named = most_read.iter().take(10).map(|&view| {
        let layout = &program.layouts[view];
        format!("given: read through: {}: {} reads: {}", text_of(&program.strs, layout.name), read_through[view], if layout.accepts_untyped { "open" } else { "closed" })
    });
    [in_all, accepting_untyped, created].into_iter().chain(rows.iter().map(|&(what, counted)| format!("given: {what}: {} are facts", share(counted)))).chain(named).collect()
}

fn explain_fields(program: &Program, names: &Names) -> Vec<String> {
    let is_flagged = |field: &&ir::Field| field.flags & field_flags::NEVER_STORED != 0;
    let created: Vec<&Layout> = program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment && layout.is_allocated).collect();
    let mut layouts_with: Vec<usize> = vec![0; program.strs.len()];
    let mut by_layout: Vec<(usize, &Layout)> = Vec::new();
    let (mut fields, mut flagged, mut never_read) = (0, 0, 0);
    for &layout in &created {
        for field in layout.fields.iter().filter(is_flagged) {
            layouts_with[field.name.idx()] += 1;
        }
        let of_layout = layout.fields.iter().filter(is_flagged).count();
        by_layout.extend((of_layout > 0).then_some((of_layout, layout)));
        fields += layout.fields.len();
        flagged += of_layout;
        never_read += layout.fields.iter().filter(|field| !is_flagged(field) && field.name.is_some() && !names.read[field.name.idx()]).count();
    }
    let mut lines = vec![format!("fields: {flagged} of the {fields} fields of the {} layouts that objects are made as have a name that nothing stores", created.len())];
    let mut by_name: Vec<StrId> = (0..program.strs.len()).filter(|&name| layouts_with[name] > 0).map(StrId::new).collect();
    by_name.sort_by(|&a, &b| layouts_with[b.idx()].cmp(&layouts_with[a.idx()]).then_with(|| program.strs.get(a).cmp(program.strs.get(b))));
    lines.extend(by_name.iter().map(|&name| format!("fields: `{}` in {} layouts", text_of(&program.strs, name), layouts_with[name.idx()])));
    by_layout.sort_by_key(|&(of_layout, _)| std::cmp::Reverse(of_layout));
    for (of_layout, layout) in by_layout {
        let flagged: Vec<String> = layout.fields.iter().filter(is_flagged).map(|field| text_of(&program.strs, field.name)).collect();
        lines.push(format!("fields: `{}`: {of_layout} of {}: {}", text_of(&program.strs, layout.name), layout.fields.len(), flagged.join(", ")));
    }
    lines.push(format!("fields: {never_read} more have a name that is stored and that nothing reads"));
    let is_required = |field: &&ir::Field| field.flags & (field_flags::OPTIONAL | field_flags::NEVER_STORED) == 0;
    let may_be_absent = |field: &&ir::Field| is_required(field) && field.flags & field_flags::NEVER_OBSERVED_ABSENT == 0;
    let required = created.iter().flat_map(|layout| &layout.fields).filter(is_required).count();
    lines.push(format!("fields: {} of the {required} required fields may be seen absent", created.iter().flat_map(|layout| &layout.fields).filter(may_be_absent).count()));
    for layout in created.iter().filter(|layout| layout.fields.iter().any(|field| may_be_absent(&field))) {
        let absent: Vec<String> = layout.fields.iter().filter(may_be_absent).map(|field| text_of(&program.strs, field.name)).collect();
        lines.push(format!("fields: `{}`: may be seen absent: {}", text_of(&program.strs, layout.name), absent.join(", ")));
    }
    let methods = || program.layouts.iter().flat_map(|layout| &layout.methods).filter(|method| method.name.is_some());
    lines.push(format!("fields: {} of the {} methods and accessors have a name that nothing reads", methods().filter(|method| !names.read[method.name.idx()]).count(), methods().count()));
    lines
}

const LAYOUTS_PER_CHECKER: usize = 512;
const MAX_TYPE_TEXT_LEN: usize = 80;

struct TypeTexts<'a> {
    slices: Vec<&'a [(LayoutId, TypeId)]>,
    next: AtomicUsize,
    printed: Vec<OnceLock<LayoutTypeTexts>>,
    declared: OnceLock<LayoutDeclarationSites>,
}

#[derive(Default)]
struct LayoutTypeTexts {
    fields: Vec<Vec<(u32, u64, Vec<u8>)>>,
    declared_at: Vec<Option<(FileId, u32)>>,
}

struct LayoutDeclarationSites {
    display_paths: Vec<Vec<u8>>,
    path_and_line: Vec<Option<(u32, u32)>>,
}

impl<'a> TypeTexts<'a> {
    fn new(views: &'a [(LayoutId, TypeId)]) -> TypeTexts<'a> {
        let slices: Vec<&[(LayoutId, TypeId)]> = views.chunks(LAYOUTS_PER_CHECKER).collect();
        TypeTexts { printed: slices.iter().map(|_| OnceLock::new()).collect(), slices, next: AtomicUsize::new(0), declared: OnceLock::new() }
    }

    fn print(&self, checked: &Checked<'_>, program: &Program, shown_from: &[u8]) {
        loop {
            let at = self.next.fetch_add(1, Ordering::Relaxed);
            let Some(slice) = self.slices.get(at) else { break };
            assert!(self.printed[at].set(layout_type_texts(checked, program, slice)).is_ok(), "a slice is printed once");
        }
        self.declared.get_or_init(|| self.find_layout_declaration_sites(checked, shown_from));
    }

    fn find_layout_declaration_sites(&self, checked: &Checked<'_>, shown_from: &[u8]) -> LayoutDeclarationSites {
        let mut declaring: FxHashMap<FileId, u32> = FxHashMap::default();
        let mut files: Vec<FileId> = Vec::new();
        let mut path_and_line: Vec<Option<(u32, u32)>> = Vec::new();
        for at in self.printed.iter().flat_map(|slice| &slice.wait().declared_at) {
            path_and_line.push(at.map(|(file, pos)| {
                let path = *declaring.entry(file).or_insert_with(|| {
                    files.push(file);
                    files.len() as u32 - 1
                });
                (path, pos)
            }));
        }
        let line_starts: Vec<Vec<u32>> = files.iter().map(|&file| compute_ecma_line_starts(&checked.files.hir(file).text)).collect();
        for (path, line) in path_and_line.iter_mut().flatten() {
            let pos = *line;
            *line = line_starts[*path as usize].partition_point(|&start| start <= pos) as u32;
        }
        let display_paths = (files.iter())
            .map(|&file| {
                let name = checked.files.module(file).file_name();
                match name.starts_with(bun_builtin_syntax::VIRTUAL_ROOT) {
                    true => name.to_vec(),
                    false => get_relative_path_from_directory(shown_from, name, checked.files.is_case_sensitive),
                }
            })
            .collect();
        LayoutDeclarationSites { display_paths, path_and_line }
    }
}

fn layout_type_texts(checked: &Checked<'_>, program: &Program, slice: &[(LayoutId, TypeId)]) -> LayoutTypeTexts {
    let LayoutTypeTexts { fields: mut texts, mut declared_at } = LayoutTypeTexts::default();
    {
        let mut c = checked.checker();
        c.begin_stack_budget();
        let mut printed: FxHashMap<TypeId, (u64, Vec<u8>)> = FxHashMap::default();
        for &(layout, view) in slice.iter() {
            declared_at.push(c.type_declaration_site(view).filter(|at| (at.pos as usize) < checked.files.hir(at.file).text.len()).map(|at| (at.file, at.pos)));
            let mut layout_entry = Vec::new();
            let Some(members) = c.members(view) else {
                texts.push(layout_entry);
                continue;
            };
            let by_name = program.layouts[layout.idx()].fields_by_name();
            for prop in members.shape().props.iter() {
                let name = c.atoms().bytes(prop.name);
                let name = match c.constant_symbol_of_property(prop.name) {
                    Some(symbol) => program.strs.find(&c.constant_symbol_text(symbol)),
                    None => program.strs.find(name).filter(|_| !name.starts_with(&[0xFE])),
                };
                let Some(field) = name.and_then(|name| by_name.get(&program.layouts[layout.idx()], name)) else { continue };
                let ty = c.type_of_prop(prop, members.mapper);
                if let Some((hash, text)) = printed.get(&ty) {
                    layout_entry.push((field, *hash, text.clone()));
                    continue;
                }
                let mut text = c.type_to_string_in_canonical_order(ty);
                if c.take_ran_out_of_stack() {
                    continue;
                }
                if text.len() > MAX_TYPE_TEXT_LEN {
                    let mut end = MAX_TYPE_TEXT_LEN - 3;
                    while text[end] & 0xC0 == 0x80 {
                        end -= 1;
                    }
                    text.truncate(end);
                    text.extend_from_slice(b"...");
                }
                let hash = Strs::hash_of(&text);
                printed.insert(ty, (hash, text.clone()));
                layout_entry.push((field, hash, text));
            }
            for &(name, declaring) in c.undeclared_fields_for(view).iter() {
                let Some(field) = program.strs.find(c.atoms().bytes(name)).and_then(|name| by_name.get(&program.layouts[layout.idx()], name)) else { continue };
                let Some(declared_by) = c.members(declaring) else { continue };
                let Some(prop) = declared_by.shape().props.iter().find(|prop| prop.name == name) else { continue };
                let ty = c.type_of_prop(prop, declared_by.mapper);
                let text = c.type_to_string(ty);
                if !c.take_ran_out_of_stack() && text.len() <= MAX_TYPE_TEXT_LEN {
                    layout_entry.push((field, Strs::hash_of(&text), text));
                }
            }
            texts.push(layout_entry);
        }
    }
    LayoutTypeTexts { fields: texts, declared_at }
}

#[derive(Copy, Clone)]
pub struct Errors<'a> {
    pub places: &'a [(FileId, u32)],
    pub in_dropped_imports: &'a [bool],
    pub imported_by: &'a (dyn Fn(&mut Checker<'_, '_>, FileId) -> Vec<FileId> + Sync),
}

pub enum OutsideProgramReason {
    Cut(u32),
    DroppedImport,
    NotReached(String),
    NoModule,
    RegExpLiteral,
    PrivateNameInOptionalChain,
    PrivateNameOfEnclosingClass,
    StaticMemberNamedConstructor,
    JsComment,
    PackageDeclarations,
}

fn files_imported_for_types(checked: &Checked<'_>, fragments: &[Fragment], reach: &Reachability, ids: &ProgramIds, imported_by: &(dyn Fn(&mut Checker<'_, '_>, FileId) -> Vec<FileId> + Sync), in_parallel: InParallel<'_>) -> FxHashSet<FileId> {
    const FILES_PER_RUN: usize = 256;
    let is_module = |file: FileId| reach.has_body_by_key(ids, FuncKey::Module(file));
    let mut pending: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE && is_module(file)).collect();
    let mut found = FxHashSet::default();
    while !pending.is_empty() {
        let mut runs: Vec<(&[FileId], Vec<FileId>)> = pending.chunks(FILES_PER_RUN).map(|run| (run, Vec::new())).collect();
        for_each_mut(&mut runs, in_parallel, &|(run, imported)| {
            let mut c = checked.checker();
            imported.extend(run.iter().flat_map(|&file| imported_by(&mut c, file)).filter(|&imported| !is_module(imported)));
        });
        pending = runs.into_iter().flat_map(|run| run.1).filter(|&imported| found.insert(imported)).collect();
    }
    found
}

fn enclosing_code_name(checked: &Checked<'_>, file: FileId, pos: u32) -> Option<String> {
    let hir = checked.files.hir(file);
    let c = checked.checker();
    let functions = (0..hir.fns.len() as u32).map(hir::FnId::from).filter(|&func| !matches!(hir[func].body, hir::FnBody::None));
    if let Some(func) = functions.filter(|&func| hir[func].start <= pos && pos < c.end_of_fn(file, func)).min_by_key(|&func| c.end_of_fn(file, func) - hir[func].start) {
        let name = hir[func].name;
        return Some(if name.is_some() { bstr::BStr::new(checked.files.atoms.bytes(name)).to_string() } else { String::new() });
    }
    let around = hir.ids(hir.body).find(|&stmt| hir[stmt].start <= pos && pos < hir[stmt].loc.end)?;
    let declares_nothing = matches!(
        hir[around].kind,
        StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Block(_) | StmtKind::Switch { .. } | StmtKind::Try { .. } | StmtKind::Throw(_) | StmtKind::Labeled { .. }
    );
    declares_nothing.then(String::new)
}

fn classify_error_location(checked: &Checked<'_>, fragments: &[Fragment], index: &Index, reach: &Reachability, ids: &ProgramIds, (file, pos): (FileId, u32), is_imported_for_types: &mut dyn FnMut(FileId) -> bool) -> Option<OutsideProgramReason> {
    if let Some(start) = checked.files.enclosing_dead_range_start(file, pos) {
        return Some(OutsideProgramReason::Cut(start));
    }
    let Some(&number) = index.by_file.get(&file) else {
        let replacement = checked.files.by_path.get(&[checked.files.module(file).file_name(), b".js"].concat());
        if replacement.is_some_and(|code| reach.has_body_by_key(ids, FuncKey::Module(code))) {
            return None;
        }
        return if is_imported_for_types(file) { enclosing_code_name(checked, file, pos).map(OutsideProgramReason::NotReached) } else { Some(OutsideProgramReason::NoModule) };
    };
    let fragment = &fragments[number as usize];
    let holds = |&&(start, end): &&(u32, u32)| start <= pos && pos < end;
    let bodies = fragment.funcs.iter().filter(|function| function.key.file() == file).filter_map(|function| Some((function, function.body.as_ref()?)));
    let around = bodies.clone().flat_map(|(function, body)| body.spans.iter().filter(holds).map(move |span| (span.1 - span.0, function, body)));
    let name_of = |function: &Function| function.func.as_ref().map_or_else(String::new, |func| text_of(&fragment.strs, func.name));
    let around: Vec<_> = around.collect();
    if let Some(smallest) = around.iter().map(|&(length, ..)| length).min() {
        let mut reason = None;
        for &(_, function, body) in around.iter().filter(|&&(length, ..)| length == smallest) {
            if !reach.has_body_by_key(ids, function.key) {
                reason.get_or_insert_with(|| OutsideProgramReason::NotReached(name_of(function)));
                continue;
            }
            {
                let cut = body.cut.iter().find(holds)?;
                reason = Some(OutsideProgramReason::Cut(cut.0))
            }
        }
        return reason;
    }
    let of_module = bodies.filter(|(function, _)| matches!(function.key, FuncKey::Module(_) | FuncKey::ModuleBody(_) | FuncKey::ModuleInner(_)));
    if !reach.has_body_by_key(ids, FuncKey::Module(file)) {
        let name = of_module.map(|(function, _)| name_of(function)).next().unwrap_or_default();
        return (!is_imported_for_types(file)).then_some(OutsideProgramReason::NotReached(name));
    }
    for (_, body) in of_module {
        if body.dropped.iter().any(|span| holds(&span)) {
            return Some(OutsideProgramReason::DroppedImport);
        }
        if let Some(cut) = body.cut.iter().find(holds) {
            return Some(OutsideProgramReason::Cut(cut.0));
        }
    }
    let hir = checked.files.hir(file);
    let imported = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
        StmtKind::Import(import) if !hir[import].type_only && hir[stmt].start <= pos && pos < hir[stmt].loc.end => hir[import].named.iter().map(|spec| &hir[spec]).find(|spec| !spec.type_only && spec.start <= pos && pos < spec.end),
        _ => None,
    })?;
    let exports_locals = hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::ExportNamed(export) if hir[export].spec.is_none()));
    let is_unused = !exports_locals && hir.exprs.iter().filter(|e| matches!(e.kind, hir::ExprKind::Ident(name) if name == imported.local)).map(|e| e.pos).all(|mention| classify_error_location(checked, fragments, index, reach, ids, (file, mention), is_imported_for_types).is_some());
    is_unused.then_some(OutsideProgramReason::DroppedImport)
}

fn is_in_try_block_with_catch(checked: &Checked<'_>, file: FileId, pos: u32) -> bool {
    use bun_sema::bind::Parent;
    let (hir, bound, c) = (checked.files.hir(file), checked.files.bound(file), checked.checker());
    let around = (0..hir.exprs.len() as u32).map(hir::ExprId).filter(|&e| hir[e].pos <= pos && pos < hir[e].end);
    let Some(innermost) = around.min_by_key(|&e| hir[e].end - hir[e].pos) else { return false };
    let (mut child, mut parent) = (hir::StmtId::NONE, bound.expr_parent[innermost.idx()]);
    loop {
        match parent {
            Parent::Stmt(outer) if outer.is_some() => {
                if matches!(hir[outer].kind, StmtKind::Try { block, handler, .. } if block == child && handler.is_some()) {
                    return true;
                }
                child = outer;
            }
            Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => return false,
            _ => {}
        }
        parent = c.parent_of_node(file, parent);
    }
}

pub fn link(
    checked: &Checked<'_>,
    fragments: Vec<Fragment>,
    ids: &ProgramIds,
    roots: &[FileId],
    entry_points: &[Vec<FileId>],
    builtin_modules: &[(u32, FileId)],
    prelude: &[FileId],
    shown_from: &[u8],
    shows_whole_paths: bool,
    function_sources: Option<&mut crate::FunctionSources>,
    errors: Errors<'_>,
    in_parallel: InParallel<'_>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    let kinds_declared = checked.checker().kinds_declared();
    let referenced_by_typeof: OnceLock<FxHashSet<(FileId, ClassId)>> = OnceLock::new();
    std::thread::scope(|scope| {
        for _ in 0..2 {
            spawn_outside_pool(scope, || kinds_declared.help(checked));
        }
        spawn_outside_pool(scope, || {
            referenced_by_typeof.get_or_init(|| {
                kinds_declared.with_publishing_blocked(|| {
                    let mut c = checked.checker();
                    c.begin_stack_budget();
                    c.classes_referenced_by_typeof()
                })
            });
        });
        let (stores_known, stores_awaited) = channel::<Vec<MethodStore>>();
        let (methods_found, methods_awaited) = channel();
        spawn_outside_pool(scope, move || {
            if let Ok(stores) = stores_awaited.recv() {
                let mut c = checked.checker();
                c.begin_stack_budget();
                let replaced = c.replaced_methods(stores);
                methods_found.send((replaced, c.take_notes_recorded(), c.take_ran_out_of_stack())).ok();
            }
        });
        let linked = link_with_helper_threads(scope, checked, fragments, ids, roots, entry_points, builtin_modules, prelude, shown_from, shows_whole_paths, function_sources, errors, &kinds_declared, &referenced_by_typeof, (stores_known, methods_awaited), in_parallel, explain, describe);
        kinds_declared.give_up();
        linked
    })
}

type LineTable = (FileId, Vec<u8>, Vec<u8>);

const BACKGROUND_LANES: usize = 3;

fn for_each_mut_in_lanes<T: Send>(items: &mut [T], lanes: usize, in_parallel: InParallel<'_>, work: &(dyn Fn(&mut T) + Sync)) {
    let next = AtomicUsize::new(0);
    let items: Vec<Guarded<&mut T>> = items.iter_mut().map(Guarded::new).collect();
    in_parallel(lanes.min(items.len()), &|_| {
        while let Some(item) = items.get(next.fetch_add(1, Ordering::Relaxed)) {
            work(&mut **item.lock());
        }
    });
}

fn make_line_tables(checked: &Checked<'_>, shown_from: &[u8], shows_whole_paths: bool, line_tables: &mut [LineTable], lanes: usize, in_parallel: InParallel<'_>) {
    for_each_mut_in_lanes(line_tables, lanes, in_parallel, &|(file, table, shown)| {
        let file = *file;
        let text = crate::original_source(checked.files.module(file).file_name(), &checked.files.hir(file).text);
        *table = line_table(text, &compute_ecma_line_starts(text));
        let builtin = match checked.files.module(file).builtin {
            Some(Builtin::Module(id, _)) => bun_builtin_syntax::Archive::embedded().manifest().module(id),
            _ => None,
        };
        *shown = match builtin {
            Some(module) => module.name.to_vec(),
            None if shows_whole_paths || checked.files.module(file).file_name().starts_with(bun_builtin_syntax::VIRTUAL_ROOT) => crate::runtime_path(crate::original_path(checked.files.module(file).file_name())),
            None => get_relative_path_from_directory(shown_from, checked.files.module(file).file_name(), checked.files.is_case_sensitive),
        };
    });
}

#[allow(
    clippy::large_stack_frames,
    reason = "runs once per build and never calls itself; most of the frame is its `Checker`s, 22 KB each"
)]
fn link_with_helper_threads<'scope>(
    scope: &'scope std::thread::Scope<'scope, '_>,
    checked: &'scope Checked<'_>,
    mut fragments: Vec<Fragment>,
    ids: &ProgramIds,
    roots: &[FileId],
    entry_points: &[Vec<FileId>],
    builtin_modules: &[(u32, FileId)],
    prelude: &[FileId],
    shown_from: &'scope [u8],
    shows_whole_paths: bool,
    function_sources: Option<&mut crate::FunctionSources>,
    errors: Errors<'_>,
    kinds_declared: &KindsDeclared,
    referenced_by_typeof: &OnceLock<FxHashSet<(FileId, ClassId)>>,
    replaced_methods_channel: (Sender<Vec<MethodStore>>, Receiver<(ReplacedMethods, FlowNotes, bool)>),
    in_parallel: InParallel<'scope>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    let (mut times, mut since) = (Times::default(), Instant::now());
    fragments.sort_by_cached_key(|fragment| checked.files.rank_of_file(fragment.file));
    let unproven_int32_values: Vec<CompilerDiagnostic> = fragments.iter_mut().flat_map(|fragment| std::mem::take(&mut fragment.unproven_int32_values)).collect();
    let declares_int32 = fragments.iter().any(|fragment| fragment.declares_int32);
    let translated: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE).collect();
    let is_opaque = |file: FileId| file != NO_FILE && checked.files.module(file).is_opaque();
    let is_runtime = |file: FileId| file != NO_FILE && checked.files.module(file).builtin.is_some();
    let nowhere = roots.first().copied().unwrap_or(FileId(0));
    let mut problems: Vec<Problem> = Vec::new();
    times.add("order", &mut since);
    let (mut types, mut seen, mut ran_out_of_stack) = (FxHashMap::default(), FxHashSet::default(), false);
    let mut kept_types = Some(spawn_outside_pool(scope, move || {
        let (mut types, mut seen) = (FxHashMap::default(), FxHashSet::default());
        add_kept_types(checked, &mut seen, &mut types, BACKGROUND_LANES, in_parallel);
        (types, seen)
    }));

    let mut index = Index::default();
    index.grow(ids);
    for (number, fragment) in fragments.iter().enumerate() {
        index.by_file.entry(fragment.file).or_insert(number as u32);
    }
    in_parallel(fragments.len(), &|number| index.add(number, &fragments[number]));
    exports::drop_unread_exports(&mut fragments, entry_points, in_parallel);
    index.extend_outline(&mut fragments, 0, in_parallel);
    times.add("index", &mut since);

    let mut reach = Reachability::default();
    reach.grow(&fragments, ids);
    for &(method, name) in crate::prelude::FUNCTIONS {
        let defined = fragments.iter().filter(|fragment| prelude.contains(&fragment.file)).flat_map(|fragment| fragment.funcs.iter().map(move |function| (fragment, function)));
        let is_named = |fragment: &Fragment, function: &Function| function.func.as_ref().is_some_and(|func| func.name.is_some() && fragment.strs.get(func.name) == name.as_bytes());
        if let Some((_, function)) = defined.filter(|(_, function)| function.body.is_some()).find(|(fragment, function)| is_named(fragment, function))
            && let Some(id) = ids.funcs.find(&function.key)
        {
            reach.add_prelude_function(method.as_bytes(), id);
        }
    }
    let roots: Vec<FuncKey> = roots.iter().map(|&root| FuncKey::Module(root)).filter(|&root| index.func_by_key(ids, root).is_some()).collect();
    for root in roots.iter().filter_map(|&root| index.func_by_key(ids, root)) {
        reach.add_root(root, true);
    }
    for import in entry_points.iter().filter_map(|files| files.first()).filter_map(|&first| index.func_by_key(ids, FuncKey::DynamicImport(first, false))) {
        reach.add_root(import, true);
        reach.add_flags(import, reached::VALUE);
    }
    for produced in entry_points.iter().filter_map(|files| files.first()).filter_map(|&first| index.func_by_key(ids, FuncKey::NamespaceForHost(first))) {
        reach.add_root(produced, true);
        reach.add_flags(produced, reached::VALUE);
    }
    let mut skipped_builtin_modules: Vec<(u32, Problem)> = Vec::new();
    let mut skipped_builtin_functions: Vec<(u32, Problem)> = Vec::new();
    let mut builtin_roots: Vec<(u32, FuncKey)> = Vec::new();
    let number_of: FxHashMap<FileId, usize> = fragments.iter().enumerate().map(|(number, fragment)| (fragment.file, number)).collect();
    let files_with_loader_entries = checked.files.modules.iter().filter(|module| !module.loader_entry_points.is_empty()).count();
    let mut loader_entries_have_sites = files_with_loader_entries != 0;
    if loader_entries_have_sites {
        let c = checked.checker();
        let mut files_seen: FxHashSet<FileId> = FxHashSet::default();
        for (number, fragment) in fragments.iter().enumerate().filter(|it| it.1.file != NO_FILE) {
            let file = fragment.file;
            let places = checked.files.module(file).loader_entry_points;
            if places.is_empty() {
                continue;
            }
            files_seen.insert(file);
            let hir = checked.files.hir(file);
            let holders: FxHashSet<Option<hir::FnId>> = places
                .iter()
                .filter(|place| place.is_none() || checked.files.enclosing_dead_range_start(file, hir[**place].pos).is_none())
                .map(|&place| {
                    let mut holder = if place.is_none() { None } else { c.enclosing_fn_of_expr(file, place) };
                    while let Some(member) = holder.filter(|&member| matches!(hir[member].kind, hir::FnKind::Method | hir::FnKind::Getter | hir::FnKind::Setter) && hir[place].pos < hir[member].anchor) {
                        holder = checked.files.bound(file).fns[member.idx()].enclosing.some();
                    }
                    holder
                })
                .collect();
            let mut defined: FxHashSet<Option<hir::FnId>> = FxHashSet::default();
            defined.insert(None);
            for (index, function) in fragment.funcs.iter().enumerate() {
                let held: [Option<hir::FnId>; 2] = match function.key {
                    FuncKey::Function(_, held) | FuncKey::TypedBody(_, held) | FuncKey::GenericEntrypoint(_, held) => [Some(held), Some(held)],
                    FuncKey::UntypedClone(_, held, root) => [Some(held), Some(root)],
                    _ => [None, None],
                };
                defined.extend(held);
                if held.iter().any(|held| holders.contains(held)) {
                    reach.loader_entry_points.insert(FragmentIndex::new(number, index));
                }
            }
            loader_entries_have_sites &= holders.iter().all(|holder| defined.contains(holder));
        }
        loader_entries_have_sites &= files_seen.len() == files_with_loader_entries;
    }
    for &(id, file) in builtin_modules {
        let Some(evaluation) = index.func_by_key(ids, FuncKey::Module(file)) else { continue };
        let fragment = &fragments[number_of[&file]];
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        let of_layouts = fragment.layouts.iter().filter_map(|shape| shape.definition.as_ref()).flat_map(|definition| &definition.problems);
        match of_bodies.chain(of_layouts).min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => skipped_builtin_modules.push((id, Problem { file, pos, what: what.clone() })),
            None => {
                builtin_roots.push((id, FuncKey::Module(file)));
                let name: &[u8] = bun_builtin_syntax::Archive::embedded().manifest().module(id).map_or(&[][..], |module| &module.name);
                let loaded_by = match checked.files.module(file).builtin {
                    Some(Builtin::Module(_, loaded_by)) => loaded_by,
                    _ => LoadedBy::RuntimeModulesOnly,
                };
                if loader_entries_have_sites && matches!(loaded_by, LoadedBy::ComputedName | LoadedBy::RuntimeModulesBehindLoader) {
                    reach.runtime.get_mut().hidden_behind_loader_entries.push((i64::from(id), name.to_vec(), file, evaluation));
                } else {
                    reach.runtime.get_mut().add(i64::from(id), name, file, evaluation);
                }
                match loaded_by {
                    LoadedBy::ComputedName | LoadedBy::RuntimeModulesOrComputedName if loader_entries_have_sites => reach.runtime.get_mut().behind_loader_entries.push(evaluation),
                    LoadedBy::NativeCodeOrLiteralName | LoadedBy::ComputedName | LoadedBy::RuntimeModulesOrComputedName => reach.add_root(evaluation, true),
                    LoadedBy::RuntimeModulesOnly | LoadedBy::RuntimeModulesBehindLoader => {}
                }
            }
        }
    }
    let runtime_helpers = checked.files.by_path.get(&crate::prelude::path_of(shown_from, crate::prelude::RUNTIME_HELPERS.0)).map(FuncKey::NamespaceForHost);
    if let Some((namespace, id)) = runtime_helpers.and_then(|namespace| Some((namespace, index.func_by_key(ids, namespace)?))) {
        builtin_roots.push((0x7fff_fffe, namespace));
        if loader_entries_have_sites {
            reach.runtime.get_mut().behind_loader_entries.push(id);
        } else {
            reach.add_root(id, true);
        }
    }
    if let Some((files, id)) = entry_points.iter().filter_map(|files| files.first()).map(|&first| FuncKey::FilesByPath(first)).find_map(|files| Some((files, index.func_by_key(ids, files)?))) {
        builtin_roots.push((0x7fff_ffff, files));
        reach.add_root(id, true);
    }
    let mut builtin_functions: Vec<(u32, FuncKey, u32)> = Vec::new();
    for fragment in fragments.iter().filter(|fragment| !fragment.builtin_functions.is_empty()) {
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        match of_bodies.min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => skipped_builtin_functions.extend(fragment.builtin_functions.iter().map(|function| (function.0, Problem { file, pos, what: what.clone() }))),
            None => builtin_functions.extend(fragment.builtin_functions.iter().filter(|function| index.func_by_key(ids, function.1).is_some())),
        }
    }
    builtin_functions.sort_unstable_by_key(|function| function.0);
    for function in builtin_functions.iter().filter_map(|function| index.func_by_key(ids, function.1)) {
        reach.add_root(function, true);
    }
    let mut generic_entrypoints: FxHashMap<LayoutKey, Vec<u32>> = FxHashMap::default();
    let mut extra_function_entries: Vec<(Option<u32>, u32)> = Vec::new();
    let mut not_translated: FxHashSet<(FileId, hir::FnId)> = FxHashSet::default();
    for function in fragments.iter().flat_map(|fragment| fragment.summary.entrypoints_and_clones.iter().map(move |&i| &fragment.funcs[i as usize])) {
        if let (FuncKey::GenericEntrypoint(file, root) | FuncKey::UntypedClone(file, _, root), Some(body)) = (function.key, &function.body)
            && !body.problems.is_empty()
        {
            not_translated.insert((file, root));
        }
    }
    for fragment in &fragments {
        for (function, id) in fragment.summary.entrypoints_and_clones.iter().map(|&i| (&fragment.funcs[i as usize], fragment.program_ids.funcs[i as usize])) {
            let is_in_arrow_function = matches!(function.key, FuncKey::GenericEntrypoint(file, root) if checked.files.hir(file)[root].kind == hir::FnKind::Arrow);
            if let (FuncKey::GenericEntrypoint(file, root), Some(body)) = (function.key, &function.body)
                && body.class.is_some()
                && !is_in_arrow_function
                && !not_translated.contains(&(file, root))
            {
                generic_entrypoints.entry(fragment.layouts[body.class.idx()].key).or_default().push(id);
            }
            if let (FuncKey::GenericEntrypoint(file, root), Some(body)) = (function.key, &function.body)
                && (body.class.is_none() || is_in_arrow_function)
                && !not_translated.contains(&(file, root))
            {
                extra_function_entries.push((ids.funcs.find(&FuncKey::Function(file, root)), id));
            }
        }
    }
    let entries_translated: usize = generic_entrypoints.values().map(Vec::len).sum();
    let mut unpredicted: FxHashSet<LayoutKey> = FxHashSet::default();
    let mut precomputed_line_tables = None;
    let mut untyped_object_evidence = UntypedObjectEvidence::default();
    loop {
        reach.run(&fragments, &index, in_parallel);
        if precomputed_line_tables.is_none() {
            let mut has_reached_function = vec![false; checked.files.modules.len()];
            for function in index.outline.funcs.iter().filter(|function| function.file != NO_FILE && reach.has(function.id, reached::IS_REACHED)) {
                has_reached_function[function.file.idx()] = true;
            }
            let mut line_tables: Vec<LineTable> = fragments.iter().filter(|fragment| fragment.file != NO_FILE && has_reached_function[fragment.file.idx()]).map(|fragment| (fragment.file, Vec::new(), Vec::new())).collect();
            precomputed_line_tables = Some(spawn_outside_pool(scope, move || {
                make_line_tables(checked, shown_from, shows_whole_paths, &mut line_tables, BACKGROUND_LANES, in_parallel);
                line_tables
            }));
        }
        if let Some(kept_types) = kept_types.take() {
            (types, seen) = kept_types.join().expect("the thread that adds the kept types panicked");
        }
        let named = std::mem::take(&mut reach.unresolved.missing);
        let mut missing: Vec<(Identity, TypeId)> = Vec::with_capacity(named.len());
        for &(identity, at, by) in &named {
            match types.get(&identity) {
                Some(&ty) => missing.push((identity, ty)),
                None => problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: no file defines it and its type was not kept; please report it", layout_name(&fragments, at), by.name(&fragments)))),
            }
        }
        times.add("reach", &mut since);
        if missing.is_empty() {
            let mut reached_more = false;
            let served = classes_served_by_untyped_clones(checked, &fragments, &index, &reach, &types, &mut untyped_object_evidence, in_parallel);
            let mut c = checked.checker();
            for &class in &served {
                if let LayoutKey::Instance(file, of) = class
                    && !c.may_use_untyped_clones(file, of)
                    && unpredicted.insert(class)
                {
                    problems.push(Problem { file, pos: 0, what: "a class that objects come to which its constructor has not made, and of which the text of the program showed no evidence ahead of the translation".into() });
                }
            }
            drop(c);
            for &(whole, entry) in &extra_function_entries {
                if whole.is_some_and(|whole| reach.has(whole, reached::VALUE)) && !reach.has(entry, reached::IS_REACHED) {
                    reach.add_root(entry, false);
                    reached_more = true;
                }
            }
            for class in served {
                for &entry in generic_entrypoints.get(&class).into_iter().flatten() {
                    if !reach.has(entry, reached::IS_REACHED) {
                        reach.add_root(entry, false);
                        reach.add_flags(entry, reached::MEMBER);
                        reached_more = true;
                    }
                }
            }
            if !reached_more {
                break;
            }
            continue;
        }
        if times.rounds == MAX_ROUNDS {
            let (_, at, by) = named[0];
            problems.push(by.problem(&fragments, nowhere, format!("a type that expands without end, such as {} (used by {})", layout_name(&fragments, at), by.name(&fragments))));
            break;
        }
        let (described, is_exhausted) = describe_in_tasks(checked, &missing, &index, ids, kinds_declared, in_parallel, describe, (&mut times, &mut since));
        ran_out_of_stack |= is_exhausted;
        let described_fragments = described.len();
        index.grow(ids);
        for fragment in described {
            index.by_file.entry(fragment.file).or_insert(fragments.len() as u32);
            index.add(fragments.len(), &fragment);
            fragments.push(fragment);
        }
        let first_described = fragments.len() - described_fragments;
        index.extend_outline(&mut fragments[first_described..], first_described, in_parallel);
        times.rounds += 1;
        times.layouts_described += fragments[fragments.len() - described_fragments..].iter().flat_map(|fragment| &fragment.layouts).filter(|shape| shape.definition.is_some()).count();
        for &(_, at, by) in named.iter().filter(|named| types.contains_key(&named.0) && index.record(ids, named.0).is_none()) {
            problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: its layout could not be rebuilt; please report it", layout_name(&fragments, at), by.name(&fragments))));
        }
        times.add("reach", &mut since);
        add_kept_types(checked, &mut seen, &mut types, usize::MAX, in_parallel);
        times.add("kept types", &mut since);
        reach.grow(&fragments, ids);
        let defined = missing.iter().filter_map(|(identity, _)| ids.layouts.find(&LayoutKey::Record(*identity))).filter(|&id| index.layout(id).is_some());
        reach.work.extend(defined.map(Work::Layout));
    }
    remove_unreached_parts(&mut fragments, &mut index.outline, &reach, in_parallel);
    let is_record = |by: ReferencedBy| matches!(by, ReferencedBy::Layout(at) if matches!(fragments[at.fragment as usize].layouts[at.index as usize].key, LayoutKey::Record(_)));
    let mut undefined_funcs: Vec<(u32, ReferencedBy)> = reach.unresolved.undefined_funcs.iter().copied().filter(|undefined| !is_record(undefined.1)).collect();
    undefined_funcs.dedup_by_key(|undefined| undefined.0);
    for (key, by) in undefined_funcs.into_iter().map(|(id, by)| (ids.funcs.key(id), by)) {
        problems.push(by.problem(&fragments, nowhere, format!("function {key:?} (used by {}): internal error: no file defines it; please report it", by.name(&fragments))));
    }
    for &(at, by) in &reach.unresolved.undefined_layouts {
        problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: no file defines it; please report it", layout_name(&fragments, at), by.name(&fragments))));
    }
    let Errors { places, in_dropped_imports, imported_by } = errors;
    let mut imported_for_types: Option<FxHashSet<FileId>> = None;
    let mut is_imported_for_types = |file: FileId| imported_for_types.get_or_insert_with(|| files_imported_for_types(checked, &fragments, &reach, ids, imported_by, in_parallel)).contains(&file);
    let is_in_regexp_literal = |(file, pos): (FileId, u32)| checked.files.hir(file).exprs.iter().any(|e| matches!(e.kind, hir::ExprKind::Regex) && e.pos < pos && pos < e.end);
    let is_private_name_in_optional_chain = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        let is_in_chain = |mut at: hir::ExprId| loop {
            let (chain, inner) = match hir[at].kind {
                hir::ExprKind::Dot { obj, chain, .. } | hir::ExprKind::Index { obj, chain, .. } => (chain, obj),
                hir::ExprKind::Call(call) => (hir[call].chain, hir[call].callee),
                hir::ExprKind::NonNull(inner) => (hir::Chain::No, inner),
                _ => return false,
            };
            if chain != hir::Chain::No {
                return true;
            }
            at = inner;
        };
        hir.is_js && hir::is_private_name_at(hir, pos) && (0..hir.exprs.len() as u32).map(hir::ExprId).any(|e| matches!(hir[e].kind, hir::ExprKind::Dot { name_pos, .. } if name_pos == pos) && is_in_chain(e))
    };
    let is_private_name_of_enclosing_class = |(file, pos): (FileId, u32)| {
        let (hir, bound) = (checked.files.hir(file), checked.files.bound(file));
        hir.is_js && hir::is_private_name_at(hir, pos) && (0..hir.exprs.len() as u32).map(hir::ExprId).any(|e| {
            matches!(hir[e].kind, hir::ExprKind::Dot { obj, name_pos, .. } if name_pos == pos && !matches!(hir[obj].kind, hir::ExprKind::Super))
                && bound.private_class.contains_key(&e)
                && !hir.exprs.iter().any(|around| matches!(around.kind, hir::ExprKind::Unary { op: hir::UnOp::Delete, operand } if operand == e))
        })
    };
    let is_static_member_named_constructor = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        hir.is_js && hir.members.iter().any(|member| (member.name_pos == pos || hir.modifier_list(member.modifiers).iter().any(|modifier| modifier.pos == pos && modifier.kind == hir::ModifierKind::Keyword(Flags::STATIC))) && member.flags.contains(Flags::STATIC) && matches!(member.kind, hir::MemberKind::Method | hir::MemberKind::Getter | hir::MemberKind::Setter) && matches!(member.key, hir::PropKey::Name(name) if checked.files.atoms.bytes(name) == b"constructor"))
    };
    let is_in_js_comment = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        hir.is_js && hir.check_directive.is_none() && checked.files.options.check_js.is_none() && hir::is_in_comment(hir, pos)
    };
    let is_in_package_declarations = |(file, _): (FileId, u32)| {
        checked.files.hir(file).kind == hir::FileKind::Declaration && bun_core::strings::contains(checked.files.module(file).path.text, b"/node_modules/")
    };
    let place_of = |(&place, &is_in_dropped_import): (&(FileId, u32), &bool)| {
        let elsewhere = classify_error_location(checked, &fragments, &index, &reach, ids, place, &mut is_imported_for_types).or_else(|| is_in_dropped_import.then_some(OutsideProgramReason::DroppedImport));
        elsewhere.or_else(|| is_in_regexp_literal(place).then_some(OutsideProgramReason::RegExpLiteral)).or_else(|| is_private_name_in_optional_chain(place).then_some(OutsideProgramReason::PrivateNameInOptionalChain))
            .or_else(|| is_private_name_of_enclosing_class(place).then_some(OutsideProgramReason::PrivateNameOfEnclosingClass))
            .or_else(|| is_static_member_named_constructor(place).then_some(OutsideProgramReason::StaticMemberNamedConstructor))
            .or_else(|| is_in_js_comment(place).then_some(OutsideProgramReason::JsComment))
            .or_else(|| is_in_package_declarations(place).then_some(OutsideProgramReason::PackageDeclarations))
    };
    let errors: Vec<Option<OutsideProgramReason>> = places.iter().zip(in_dropped_imports).map(place_of).collect();
    if errors.iter().any(Option::is_none) {
        return Linked { problems, errors, times, ..Linked::default() };
    }
    let found: Vec<CompilerDiagnostic> = unproven_int32_values.into_iter().filter(|unproven| classify_error_location(checked, &fragments, &index, &reach, ids, (unproven.file, unproven.start), &mut is_imported_for_types).is_none()).collect();
    if !found.is_empty() {
        return Linked { problems, errors, times, found, ..Linked::default() };
    }

    let runtime_flags: FxHashSet<FileId> = builtin_modules.iter().map(|module| module.1).collect();
    let mut included_of: Vec<(usize, [Vec<((FragmentIndex, bool), u32)>; 2])> = (0..fragments.len()).map(|number| (number, Default::default())).collect();
    {
        let (fragments, reach, index) = (&fragments, &reach, &index);
        for_each_mut(&mut included_of, in_parallel, &|(number, included)| {
            for (i, &id) in fragments[*number].program_ids.funcs.iter().enumerate() {
                let at = FragmentIndex::new(*number, i);
                if reach.has(id, reached::IS_REACHED)
                    && index.func(id) == Some(at)
                    && let Some(place) = index.outline.func_slot(id)
                {
                    let function = &index.outline.funcs[place];
                    let evaluates_module = function.has(outline_flags::RUNS_AT_START) && !runtime_flags.contains(&function.file);
                    included[usize::from(!evaluates_module)].push(((at, reach.has(id, reached::BODY)), place as u32));
                }
            }
        });
    }
    {
        let file_fragment: FxHashMap<FileId, usize> = fragments.iter().enumerate().filter(|found| !is_runtime(found.1.file)).map(|(number, fragment)| (fragment.file, number)).collect();
        let starts: Vec<Vec<usize>> = entry_points.iter().map(|files| files.iter().filter_map(|file| file_fragment.get(file).copied()).collect()).collect();
        let static_imports_of = |number: usize| -> Vec<usize> {
            let fragment = &fragments[number];
            let called = fragment.summary.run_at_evaluation.iter().flat_map(|&i| {
                let outlined = index.outline.func(fragment.program_ids.funcs[i as usize]).filter(|function| function.fragment as usize == number);
                let of_function = outlined.map_or(&[][..], |function| &index.outline.local[function.list(Outline::CALLED)]).iter().map(|&callee| FuncId(callee));
                of_function.chain(fragment.funcs[i as usize].body.iter().flat_map(|body| body.parts.iter().flat_map(|part| part.mentions.called())))
            });
            called
                .filter_map(|callee| match fragment.funcs[callee.idx()].key {
                    FuncKey::Module(imported) | FuncKey::Required(imported) => file_fragment.get(&imported).copied(),
                    _ => None,
                })
                .collect()
        };
        let first_entry_point = first_evaluating_entry_point(fragments.len(), &starts, &static_imports_of);
        included_of.sort_by_key(|&(number, _)| (first_entry_point[number], number));
    }
    let key_at = |at: FragmentIndex| fragments[at.fragment as usize].funcs[at.index as usize].key;
    let evaluating_modules: usize = included_of.iter().map(|of_fragment| of_fragment.1[0].len()).sum();
    let (included, included_slots): (Vec<(FragmentIndex, bool)>, Vec<u32>) = [0, 1].into_iter().flat_map(|group| included_of.iter().flat_map(move |of_fragment| &of_fragment.1[group])).copied().unzip();
    let evaluating: Vec<(FuncId, FuncKey)> = included
        .iter()
        .enumerate()
        .filter(|found| explain.deferred && found.1.1)
        .map(|(i, &(at, _))| (FuncId::new(entry_points.len() + i), key_at(at)))
        .filter(|found| matches!(found.1, FuncKey::Module(file) | FuncKey::ModuleBody(file) | FuncKey::ModuleSettling(file) | FuncKey::Initializer(file, _) if !runtime_flags.contains(&file)))
        .collect();

    let entry_name = ids.str(Strs::hash_of(b"main"), b"main");
    let mut func_ids = FuncIds { ids, by_program_id: vec![FuncId::NONE; ids.funcs.bound()] };
    for (i, &place) in included_slots.iter().enumerate() {
        func_ids.by_program_id[index.outline.funcs[place as usize].id as usize] = FuncId::new(entry_points.len() + i);
    }
    let func_ids = func_ids;
    let mut funcs_of: Vec<Vec<Function>> = fragments.iter_mut().map(|fragment| std::mem::take(&mut fragment.funcs)).collect();
    let record_ranks = record_ranks(&fragments, &index, ids, in_parallel);
    let (record_positions, first_references) = std::thread::scope(|scope| {
        let places = spawn_outside_pool(scope, || record_positions(record_ranks, ids));
        let first_references = first_references(&index.outline, &included, &included_slots, ids, in_parallel);
        (places.join().expect("the thread that places the records panicked"), first_references)
    });
    let mut numbering = Numbering::new(&fragments, &index, ids, &func_ids.by_program_id, record_positions, in_parallel);
    numbering.str_ids[entry_name as usize] = numbering.strs.intern(b"main");
    let entry_name = numbering.str_ids[entry_name as usize];
    let mut last = None;
    for &place in &included_slots {
        let file = index.outline.funcs[place as usize].file;
        if last.replace(file) != Some(file) {
            numbering.module_of(file);
        }
    }
    let mut recorded: FlowNotes = FlowNotes::default();
    let mut lost: Vec<(Identity, Problem)> = Vec::new();
    let mut included_by_fragment: Vec<[&[(FragmentIndex, bool)]; 2]> = vec![[&included[..0]; 2]; fragments.len()];
    let mut slots_by_fragment: Vec<[&[u32]; 2]> = vec![[&included_slots[..0]; 2]; fragments.len()];
    let (groups, places_of_groups) = (included.split_at(evaluating_modules), included_slots.split_at(evaluating_modules));
    for (group, (functions, mut places)) in [(groups.0, places_of_groups.0), (groups.1, places_of_groups.1)].into_iter().enumerate() {
        for run in functions.chunk_by(|a, b| a.0.fragment == b.0.fragment) {
            let of_run;
            (of_run, places) = places.split_at(run.len());
            included_by_fragment[run[0].0.fragment as usize][group] = run;
            slots_by_fragment[run[0].0.fragment as usize][group] = of_run;
        }
    }
    let (mut numbering, is_runtime_layout, mut extended_globals, mut prototype_property_names, method_stores) = std::thread::scope(|scope| {
    let numbered = spawn_outside_pool(scope, || {
    let mut is_runtime_layout: Vec<bool> = Vec::new();
    let mut module_before = (u32::MAX, ModuleId::NONE);
    for (position, &(at, has_body)) in included.iter().enumerate() {
        let outline = &index.outline;
        let function = &outline.funcs[included_slots[position] as usize];
        if has_body {
            if std::mem::replace(&mut module_before, (at.fragment, function.module)) != (at.fragment, function.module) {
                numbering.module(at.fragment, function.module);
            }
            let (FirstReferences { places, ends }, offset) = (&first_references[position / FUNCTIONS_PER_BATCH], position % FUNCTIONS_PER_BATCH);
            let mut start = offset.checked_sub(1).map_or(0, |before| ends[before][3]);
            numbering.mark_function_mentioned(at.fragment, ends[offset].map(|end| &places[std::mem::replace(&mut start, end) as usize..end as usize]));
        } else {
            numbering.number_function_header(function);
        }
        numbering.layout(at.fragment, function.class);
        for &class in outline.local[function.list(Outline::CLASSES_AS_VALUES)].iter().filter(|_| has_body) {
            numbering.layout(at.fragment, LayoutId(class));
        }
        numbering.settle();
        if is_runtime_layout.len() < numbering.layouts.len() {
            is_runtime_layout.resize(numbering.layouts.len(), is_runtime(function.file));
        }
    }
    let mut extended_globals: Vec<StrId> = Vec::new();
    let mut prototype_property_names: Vec<StrId> = Vec::new();
    let mut method_stores: Vec<(FileId, MethodStore<Identity>)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        if numbering.module_ids.contains_key(&fragment.file) && !is_opaque(fragment.file) {
            for &name in &fragment.mutated_globals {
                extended_globals.push(numbering.str(number as u32, name));
            }
            for &name in &fragment.prototype_property_names {
                prototype_property_names.push(numbering.str(number as u32, name));
            }
            method_stores.extend(fragment.method_stores.iter().map(|store| (fragment.file, store.clone())));
        }
    }
    (numbering, is_runtime_layout, extended_globals, prototype_property_names, method_stores)
    });

    struct FragmentNotes<'a> {
        program_ids: &'a [u32],
        funcs: &'a mut [Function],
        functions: [&'a [(FragmentIndex, bool)]; 2],
        recorded: [FlowNotes; 2],
        lost: [Vec<(Identity, Problem)>; 2],
    }
    let mut fragment_notes: Vec<FragmentNotes<'_>> = Vec::with_capacity(included_by_fragment.iter().filter(|functions| functions.iter().any(|group| !group.is_empty())).count());
    fragment_notes.extend(
        (funcs_of.iter_mut().zip(&fragments).zip(included_by_fragment.iter().copied()))
            .filter(|(_, functions)| functions.iter().any(|group| !group.is_empty()))
            .map(|((funcs, fragment), functions)| FragmentNotes { program_ids: &fragment.program_ids.funcs, funcs, functions, recorded: Default::default(), lost: Default::default() }),
    );
    for_each_mut(&mut fragment_notes, in_parallel, &|of| {
        for (group, functions) in of.functions.iter().enumerate() {
            let (recorded, lost) = (&mut of.recorded[group], &mut of.lost[group]);
            for index in functions.iter().filter(|function| function.1).map(|function| function.0.index) {
                let function = &mut of.funcs[index as usize];
                let (key, pos) = (function.key, function.func.as_ref().map_or(0, |func| func.pos));
                if is_opaque(key.file()) {
                    continue;
                }
                let Some(body) = &mut function.body else { continue };
                let has_unknown_caller = reach.has(of.program_ids[index as usize], reached::VALUE | reached::MEMBER);
                let when_callee_unknown = has_unknown_caller.then(|| std::mem::take(&mut body.notes_for_unknown_callers));
                for notes in std::iter::once(std::mem::take(&mut body.notes)).chain(when_callee_unknown) {
                    recorded.absorb(notes.renamed(|identity| {
                        let ty = types.get(&identity).copied();
                        if ty.is_none() {
                            lost.push((identity, Problem { file: key.file(), pos, what: format!("a type ({identity:x?}) that is noted for the function {key:?} and that no task has kept").into() }));
                        }
                        ty
                    }));
                }
            }
        }
    });
    const FRAGMENTS_PER_RUN: usize = 1024;
    let mut runs: Vec<(&mut [FragmentNotes<'_>], [FlowNotes; 2])> = fragment_notes.chunks_mut(FRAGMENTS_PER_RUN).map(|run| (run, Default::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, recorded)| {
        for (group, recorded) in recorded.iter_mut().enumerate() {
            for of in run.iter_mut() {
                recorded.absorb(std::mem::take(&mut of.recorded[group]));
            }
        }
    });
    for group in 0..2 {
        for (run, of_run) in &mut runs {
            recorded.absorb(std::mem::take(&mut of_run[group]));
            for of in run.iter_mut() {
                lost.append(&mut of.lost[group]);
            }
        }
    }
    drop(runs);
    drop(fragment_notes);
    numbered.join().expect("the thread that numbers panicked")
    });
    let gathered = numbering.gather_strs(in_parallel);
    let mut strs = std::mem::take(&mut numbering.strs);
    std::thread::scope(|scope| {
        let laid = spawn_outside_pool(scope, || {
            strs.reserve_bytes(gathered.iter().map(|run| run.0.len()).sum());
            for (bytes, lengths, hashes) in &gathered {
                strs.add_all(bytes, lengths, hashes);
            }
        });
        numbering.fill_maps(&included_by_fragment, &slots_by_fragment, in_parallel);
        numbering.number_type_parts(in_parallel);
        laid.join().expect("the thread that lays the strings panicked");
    });
    numbering.strs = strs;
    let Numbering { maps, strs, tys, layouts, globals, modules, str_ids, layout_ids, global_ids, .. } = numbering;
    for (fragment, funcs) in fragments.iter_mut().zip(funcs_of) {
        fragment.funcs = funcs;
    }
    for names in [&mut extended_globals, &mut prototype_property_names] {
        names.sort_unstable_by(|&a, &b| strs.get(a).cmp(strs.get(b)));
        names.dedup();
    }
    let outline = std::mem::take(&mut index.outline);
    let _ = std::thread::Builder::new().spawn(move || drop(outline));
    times.add("number", &mut since);
    let mut invalidated_by_stores: Vec<(Identity, Problem)> = Vec::new();
    let method_stores: Vec<MethodStore> = (method_stores.into_iter())
        .filter_map(|(file, store)| {
            store.renamed(|identity| {
                let ty = types.get(&identity).copied();
                if ty.is_none() {
                    invalidated_by_stores.push((identity, Problem { file, pos: 0, what: format!("the type ({identity:x?}) of an object that a method is stored to, which no task has kept").into() }));
                }
                ty
            })
        })
        .collect();
    let (stores_known, methods_awaited) = replaced_methods_channel;
    stores_known.send(method_stores).expect("the thread that finds the methods that are replaced is there");
    let mut classes_as_values: Vec<LayoutId> = Vec::new();
    let mut implicit_stores: Vec<(u32, StrId)> = Vec::new();
    let (mut number_flows, mut flows_of_runtime): (Vec<(FileId, NumberFlow<StrId>)>, Vec<(FileId, NumberFlow<StrId>)>) = (Vec::new(), Vec::new());
    let is_stub: Vec<bool> = std::iter::repeat_n(false, entry_points.len()).chain(included.iter().map(|function| !function.1)).collect();

    let mut program = Program { strs, tys, extended_globals, prototype_property_names, entries: (0..entry_points.len()).map(FuncId::new).collect(), ..Program::default() };
    for entry_point in entry_points {
        let run: Vec<FuncId> = entry_point.iter().filter_map(|&root| func_ids.get(FuncKey::Module(root))).collect();
        let import = entry_point.first().and_then(|&first| func_ids.get(FuncKey::NamespaceForHost(first)).or_else(|| func_ids.get(FuncKey::DynamicImport(first, false))));
        let is_commonjs = shows_whole_paths && entry_point.first().is_some_and(|&first| checked.files.module(first).is_commonjs() || checked.files.module(first).file_name().ends_with(b".cjs"));
        let first_operation = is_commonjs.then_some(Operation::MarkCommonJSEntryPoint);
        program.funcs.push(entry_function(entry_name, program.tys.anything, &run, import, first_operation));
    }
    let mut views: Vec<(LayoutId, Identity)> = Vec::new();
    let mut classes: Vec<Option<(FileId, ClassId)>> = Vec::with_capacity(layouts.len());
    let mut constructed_by_value: Vec<LayoutId> = Vec::new();
    let mut layout_notes: Vec<(Notes, LayoutKey)> = Vec::new();
    let mut layout_problems: Vec<Problem> = Vec::new();
    let mut shapes_of: Vec<Vec<Option<&mut Shape>>> = fragments.iter_mut().map(|fragment| fragment.layouts.iter_mut().map(Some).collect()).collect();
    let mut taken: Vec<(FragmentIndex, &mut Shape, Option<Box<Definition>>)> = (layouts.iter())
        .map(|&at| (at, shapes_of[at.fragment as usize][at.index as usize].take().expect("`layouts` has each layout once"), None))
        .collect();
    drop(shapes_of);
    for_each_mut(&mut taken, in_parallel, &|(at, shape, taken)| {
        let mut definition = shape.definition.take().expect("the index has no shape that is only named, and `layouts` has each once");
        let layout = &mut definition.layout;
        for_each_layout_id(layout, &mut Renumber(&maps[at.fragment as usize]));
        if layout.kind == LayoutKind::Record {
            layout.methods.retain(|method| method.func.is_some());
        }
        for field in layout.fields.iter_mut().filter(|field| field.single_function.is_none()) {
            field.single_function_flags = 0;
        }
        *taken = Some(definition);
    });
    program.layouts.reserve_exact(taken.len());
    views.reserve_exact(taken.len());
    for (id, (at, shape, definition)) in taken.into_iter().enumerate() {
        let Definition { layout, mentions: _, constructs, notes: of_layout, problems: mut of_declaration } = *definition.expect("every layout has been taken");
        program.layouts.push(layout);
        views.extend(shape.ty.map(|ty| (LayoutId::new(id), ty)));
        classes.push(if let LayoutKey::Instance(file, class) = shape.key { Some((file, class)) } else { None });
        if constructs.is_some() {
            constructed_by_value.push(maps[at.fragment as usize].layouts[constructs.idx()]);
        }
        if let Some(of_layout) = of_layout.filter(|_| !shape.key.file().is_some_and(is_opaque)) {
            layout_notes.push((*of_layout, shape.key));
        }
        layout_problems.append(&mut of_declaration);
    }
    struct Run<'a> {
        included: &'a [(FragmentIndex, bool)],
        functions: Vec<&'a mut Function>,
        funcs: &'a mut [MaybeUninit<Func>],
        contents: &'a mut [u8],
        problems: Vec<Problem>,
        classes_as_values: Vec<LayoutId>,
        implicit_stores: Vec<(u32, StrId)>,
        number_flows: [Vec<(FileId, NumberFlow<StrId>)>; 2],
        regexp_literals: Vec<(StrId, StrId)>,
    }
    let marks = Marks { names: (0..program.strs.len()).map(|_| AtomicU8::new(0)).collect(), is_copied_to: (0..program.tys.list.len()).map(|_| AtomicBool::new(false)).collect() };
    for func in &program.funcs {
        marks.add(func, &program.layouts, &mut Vec::new(), &mut Vec::new());
    }
    let program_layouts = &program.layouts;
    program.funcs.reserve_exact(included.len());
    let anything = program.tys.anything;
    let size = program.strs.find(b"size");
    let mut contents: Vec<u8> = program.funcs.iter().map(|func| content_flags(func, size)).chain(std::iter::repeat_n(0, included.len())).collect();
    let mut remaining_capacity = &mut program.funcs.spare_capacity_mut()[..included.len()];
    let mut remaining_contents = &mut contents[entry_points.len()..];
    let (mut destructured, program_ids): (Vec<Vec<Option<&mut Function>>>, Vec<&LocalToProgram>) = (fragments.iter_mut())
        .map(|fragment| {
            let Fragment { funcs, program_ids, .. } = fragment;
            (funcs.iter_mut().map(Some).collect(), &*program_ids)
        })
        .unzip();
    let mut runs: Vec<Run<'_>> = (included.chunks(FUNCTIONS_PER_SLICE))
        .map(|included| {
            let functions = included.iter().map(|&(at, _)| destructured[at.fragment as usize][at.index as usize].take().expect("a function is in the program once")).collect();
            let (funcs, contents);
            (funcs, remaining_capacity) = std::mem::take(&mut remaining_capacity).split_at_mut(included.len());
            (contents, remaining_contents) = std::mem::take(&mut remaining_contents).split_at_mut(included.len());
            Run { included, functions, funcs, contents, problems: Vec::new(), classes_as_values: Vec::new(), implicit_stores: Vec::new(), number_flows: Default::default(), regexp_literals: Vec::new() }
        })
        .collect();
    drop(destructured);
    for_each_mut(&mut runs, in_parallel, &|run| {
        let (mut stored, mut read) = (Vec::new(), Vec::new());
        for (((&(at, has_body), function), place), contents) in run.included.iter().zip(run.functions.iter_mut()).zip(run.funcs.iter_mut()).zip(run.contents.iter_mut()) {
            let number = at.fragment as usize;
            let program_ids = program_ids[number];
            let key = function.key;
            if let Some(body) = &mut function.body {
                if has_body {
                    run.problems.append(&mut body.problems);
                    run.classes_as_values.extend(body.classes_as_values.iter().map(|class| maps[number].layouts[class.idx()]));
                }
                if has_body && !is_opaque(key.file()) {
                    for &name in &body.implicit_stores {
                        match str_ids[program_ids.strs[name.idx()] as usize] {
                            known if known.is_some() => stored.push(known),
                            _ => run.implicit_stores.push((at.fragment, name)),
                        }
                    }
                    marks.add_names(&mut stored, Marks::IS_STORED);
                    run.number_flows[usize::from(is_runtime(key.file()))].extend(body.number_flows.drain(..).map(|flow| (key.file(), flow.renamed(|name| StrId(program_ids.strs[name.idx()])))));
                }
            }
            let mut func = if has_body {
                let mut func = function.func.take().expect(IS_KNOWN);
                renumber_func(&mut func, &maps[number]);
                func
            } else {
                stub(function.func.as_ref().expect(IS_KNOWN), &maps[number], anything)
            };
            if reach.has(program_ids.funcs[at.index as usize], reached::VALUE) {
                func.flags |= func_flags::IS_VALUE;
            }
            if !modules.get(func.module.idx()).is_some_and(|file| runtime_flags.contains(file)) {
                for value in &func.values {
                    if let Def::Op(Op::Operation { which: Operation::RegExpLiteral, args }) = &value.def
                        && let [pattern, flags] = args[..]
                        && let (Some(pattern), Some(flags)) = (constant_string(&func, pattern), constant_string(&func, flags))
                    {
                        run.regexp_literals.push((pattern, flags));
                    }
                }
            }
            *contents = content_flags(&func, size);
            marks.add(&func, program_layouts, &mut stored, &mut read);
            place.write(func);
        }
    });
    classes_as_values.reserve_exact(runs.iter().map(|run| run.classes_as_values.len()).sum());
    implicit_stores.reserve_exact(runs.iter().map(|run| run.implicit_stores.len()).sum());
    number_flows.reserve_exact(runs.iter().map(|run| run.number_flows[0].len()).sum());
    flows_of_runtime.reserve_exact(runs.iter().map(|run| run.number_flows[1].len()).sum());
    for mut run in runs {
        problems.append(&mut run.problems);
        classes_as_values.append(&mut run.classes_as_values);
        implicit_stores.append(&mut run.implicit_stores);
        number_flows.append(&mut run.number_flows[0]);
        flows_of_runtime.append(&mut run.number_flows[1]);
        program.regexp_literals.append(&mut run.regexp_literals);
    }
    // SAFETY: the runs are all of `included`, and each has written a function for every entry.
    unsafe { program.funcs.set_len(entry_points.len() + included.len()) };
    program.regexp_literals.sort_unstable_by_key(|&(pattern, flags)| (pattern.0, flags.0));
    program.regexp_literals.dedup();
    let file_ranks: Vec<u32> = (0..checked.files.modules.len() as u32).map(|file| checked.files.rank_of_file(FileId(file))).collect();
    let integer_verdicts = std::thread::Builder::new().spawn(move || [number_flows, flows_of_runtime].map(|flows| expected_int32(&flows, |file| file_ranks[file.idx()]))).expect("a thread");
    program.builtin_modules = builtin_roots.iter().filter_map(|(id, root)| Some((*id, func_ids.get(*root)?))).collect();
    program.builtin_functions = builtin_functions.iter().map(|(id, root, visibility)| (*id, func_ids.get(*root).expect("a builtin function that is in the index is reached"), *visibility)).collect();
    let init_of = |file: FileId| func_ids.get(FuncKey::Module(file)).unwrap_or(FuncId::NONE);
    let mut precomputed_line_tables: Vec<LineTable> = precomputed_line_tables.map_or_else(Vec::new, |created| created.join().expect("the thread that makes the line tables panicked"));
    let precomputed: FxHashMap<FileId, usize> = precomputed_line_tables.iter().enumerate().map(|(at, created)| (created.0, at)).collect();
    let mut others: Vec<LineTable> = modules.iter().filter(|&&file| !precomputed.contains_key(&file)).map(|&file| (file, Vec::new(), Vec::new())).collect();
    let lanes = others.len();
    make_line_tables(checked, shown_from, shows_whole_paths, &mut others, lanes, in_parallel);
    let mut others = others.into_iter();
    for &file in &modules {
        let (line_table, shown) = match precomputed.get(&file) {
            Some(&at) => (std::mem::take(&mut precomputed_line_tables[at].1), std::mem::take(&mut precomputed_line_tables[at].2)),
            None => others.next().map(|created| (created.1, created.2)).expect("a line table is made for every other module"),
        };
        let display_path = program.strs.intern(&shown);
        program.modules.push(ir::Module { path: display_path, init: init_of(file), display_path, line_table, printed: Vec::new() });
    }
    if let Some(function_sources) = function_sources {
        let printed_by_module: Vec<Option<&(Vec<u8>, Vec<(u32, u32, u32)>)>> = modules.iter().map(|&file| function_sources.get(checked.files.module(file).file_name())).collect();
        let has_text: Vec<AtomicBool> = modules.iter().map(|_| AtomicBool::new(false)).collect();
        let mut runs: Vec<&mut [Func]> = program.funcs.chunks_mut(FUNCTIONS_PER_SLICE).collect();
        for_each_mut(&mut runs, in_parallel, &|funcs| {
            for func in funcs.iter_mut().filter(|func| func.source_start != 0) {
                let printed = printed_by_module.get(func.module.idx()).copied().flatten();
                let found = printed.and_then(|(_, texts)| Some(texts[texts.binary_search_by_key(&(func.source_start - 1), |text| text.0).ok()?]));
                (func.source_start, func.source_end) = found.map_or((0, 0), |(_, start, end)| (start, end));
                if found.is_some() {
                    has_text[func.module.idx()].store(true, Ordering::Relaxed);
                }
            }
        });
        for ((module, &file), _) in program.modules.iter_mut().zip(&modules).zip(has_text).filter(|module| module.1.load(Ordering::Relaxed)) {
            if let Some((text, _)) = function_sources.get_mut(checked.files.module(file).file_name()) {
                module.printed = std::mem::take(text);
            }
        }
    }
    const VARIABLES_PER_RUN: usize = 1024;
    let mut runs: Vec<(&[FragmentIndex], Vec<ir::Global>)> = globals.chunks(VARIABLES_PER_RUN).map(|run| (run, Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, created)| {
        for &at in run.iter() {
            let ir::Global { name, module, declared, initialization, single_function, single_function_flags } = fragments[at.fragment as usize].globals[at.index as usize].global;
            let mut global = ir::Global { name, module, declared, initialization, single_function, single_function_flags };
            for_each_global_id(&mut global, &mut Renumber(&maps[at.fragment as usize]));
            if global.single_function.is_none() {
                global.single_function_flags = 0;
            }
            created.push(global);
        }
    });
    program.globals.extend(runs.into_iter().flat_map(|run| run.1));
    problems.append(&mut layout_problems);
    const LAYOUTS_PER_RUN: usize = 512;
    let mut runs: Vec<(&mut [(Notes, LayoutKey)], FlowNotes, Vec<(Identity, Problem)>)> = layout_notes.chunks_mut(LAYOUTS_PER_RUN).map(|run| (run, FlowNotes::default(), Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, recorded, lost)| {
        for (notes, key) in run.iter_mut() {
            recorded.absorb(std::mem::take(notes).renamed(|identity| {
                let ty = types.get(&identity).copied();
                if ty.is_none() {
                    lost.push((identity, Problem { file: key.file().unwrap_or(nowhere), pos: 0, what: format!("a type ({identity:x?}) that is noted for the layout {key:x?} and that no task has kept").into() }));
                }
                ty
            }));
        }
    });
    for (_, of_run, mut lost_in_run) in runs {
        recorded.absorb(of_run);
        lost.append(&mut lost_in_run);
    }
    for class in constructed_by_value.into_iter().filter(|class| class.is_some()) {
        program.layouts[class.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
    }
    times.add("renumber", &mut since);

    {
        let all = Final {
            program: &program,
            tys: program.tys.list.iter().enumerate().map(|(i, declared)| (declared, TyId::new(i))).collect(),
            funcs: &func_ids.by_program_id,
            layouts: &layout_ids,
            globals: &global_ids,
            is_stub: &is_stub,
        };
        let mut found: Vec<(usize, Vec<Problem>)> = (0..fragments.len()).map(|number| (number, Vec::new())).collect();
        for_each_mut(&mut found, in_parallel, &|(number, found)| {
            *found = disagreements(&fragments[*number], &maps[*number], &all, nowhere);
        });
        problems.extend(found.into_iter().flat_map(|(_, found)| found));
    }
    times.add("compare", &mut since);

    let mut again = |identity: Identity, file: FileId, of: &dyn Fn() -> String| {
        let ty = types.get(&identity).copied();
        if ty.is_none() {
            lost.push((identity, Problem { file, pos: 0, what: format!("the type ({identity:x?}) of {}, which no task has kept", of()).into() }));
        }
        ty
    };
    let views: Vec<(LayoutId, TypeId)> = (views.into_iter())
        .filter_map(|(layout, identity)| Some((layout, again(identity, nowhere, &|| format!("the layout `{}`", text_of(&program.strs, program.layouts[layout.idx()].name)))?)))
        .collect();
    lost.append(&mut invalidated_by_stores);
    lost.sort_by_key(|lost| lost.0);
    lost.dedup_by_key(|lost| lost.0);
    problems.extend(lost.into_iter().map(|lost| lost.1));

    let c = &mut checked.checker();
    c.begin_stack_budget();

    let (replaced, noted_on_the_way, has_run_out_on_the_way) = methods_awaited.recv().expect("the thread that finds the methods that are replaced panicked");
    ran_out_of_stack |= has_run_out_on_the_way;
    for (layout, class) in program.layouts.iter_mut().zip(&classes) {
        let Some((file, class)) = *class else { continue };
        if replaced.contains(file, class, b"constructor", false) {
            layout.class_flags |= class_flags::CONSTRUCTOR_MAY_BE_REPLACED;
        }
        for method in &mut layout.methods {
            if method.name.is_some() && replaced.contains(file, class, program.strs.get(method.name), method.flags & method_flags::STATIC != 0) {
                method.flags |= method_flags::MAY_BE_REPLACED;
            }
        }
    }
    let extensible = c.classes_with_extensible_prototypes();
    for index in 0..program.layouts.len() {
        let Some(added) = classes[index].and_then(|class| extensible.get(&class)) else { continue };
        let may_replace_constructor = added.has_unknown_name || added.names.iter().any(|name| **name == *b"constructor");
        program.layouts[index].class_flags |= class_flags::PROTOTYPE_MAY_GAIN_MEMBERS | if may_replace_constructor { class_flags::CONSTRUCTOR_MAY_BE_REPLACED } else { 0 };
        let mut at = LayoutId::new(index);
        while at.is_some() {
            let is_ancestor = at.idx() != index;
            let (layouts, strs) = (&mut program.layouts, &program.strs);
            for method in layouts[at.idx()].methods.iter_mut().filter(|method| method.name.is_some() && method.flags & method_flags::STATIC == 0) {
                if is_ancestor || added.has_unknown_name || added.names.iter().any(|name| **name == *strs.get(method.name)) {
                    method.flags |= method_flags::MAY_BE_REPLACED;
                }
            }
            at = layouts[at.idx()].base;
        }
    }

    let has_replaced_static_member = |layout: &Layout| layout.methods.iter().any(|method| method.flags & method_flags::STATIC != 0 && method.flags & method_flags::MAY_BE_REPLACED != 0);
    for &(layout, _) in views.iter().filter(|view| classes[view.0.idx()].is_some()) {
        let mut at = layout;
        while at.is_some() && !has_replaced_static_member(&program.layouts[at.idx()]) {
            at = program.layouts[at.idx()].base;
        }
        if at.is_some() {
            classes_as_values.push(layout);
        }
    }
    let referenced_by_typeof = referenced_by_typeof.get_or_init(|| c.classes_referenced_by_typeof());
    for layout in (0..program.layouts.len()).map(LayoutId::new).filter(|layout| classes[layout.idx()].is_some_and(|class| referenced_by_typeof.contains(&class))) {
        let mut at = layout;
        while at.is_some() {
            classes_as_values.push(at);
            at = program.layouts[at.idx()].base;
        }
    }
    classes_as_values.retain(|class| class.is_some() && program.layouts[class.idx()].class_flags & class_flags::HAS_FIXED_LAYOUT != 0);
    classes_as_values.sort_unstable();
    classes_as_values.dedup();
    for layout in (0..program.layouts.len()).map(LayoutId::new) {
        let Some((file, class)) = classes[layout.idx()] else { continue };
        if program.layouts[layout.idx()].class_flags & class_flags::HAS_FIXED_LAYOUT != 0 && classes_as_values.binary_search(&layout).is_err() && c.is_created_only_through_subclasses(file, class) {
            program.layouts[layout.idx()].class_flags |= class_flags::HAS_NO_OWN_INSTANCES;
        }
    }
    let class_of = |layout: &LayoutId| classes[layout.idx()];
    let is_extending = |layout: &LayoutId| program.layouts[layout.idx()].class_flags & class_flags::HAS_UNTYPED_BASE != 0;
    let extending: Vec<(FileId, ClassId)> = (0..program.layouts.len()).map(LayoutId::new).filter(is_extending).filter_map(|layout| class_of(&layout)).collect();
    let candidates: Vec<(LayoutId, (FileId, ClassId))> = classes_as_values.iter().filter_map(|layout| Some((*layout, class_of(layout)?))).collect();
    let asked: Vec<(FileId, ClassId)> = candidates.iter().map(|candidate| candidate.1).collect();
    let mut extended_by_value = 0usize;
    for (candidate, may_be_extended) in candidates.iter().zip(c.may_be_extended_by_value(&extending, &asked)) {
        if may_be_extended {
            extended_by_value += 1;
            program.layouts[candidate.0.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
            if let Some(&(_, ty)) = views.iter().find(|view| view.0 == candidate.0) {
                c.record_allocation(ty);
            }
        }
    }
    let external_and_invalidated = c.record_external_data(&|identity| types.get(identity).copied());
    if let Some(print_line) = explain.progress {
        print_line(format_args!("aot: progress: the link: {external_and_invalidated} given types that no task has kept"));
    }
    recorded.absorb(noted_on_the_way);
    recorded.absorb(c.take_notes_recorded());
    let classes_used_as_values = candidates.len();

    times.add("classes", &mut since);

    let is_in_opaque_file: Vec<bool> = classes.iter().map(|class| class.is_some_and(|class| is_opaque(class.0))).collect();
    let mut names = Names::new(&program, &marks, &is_in_opaque_file);
    for name in implicit_stores.into_iter().filter_map(|(fragment, name)| program.strs.find(fragments[fragment as usize].strs.get(name))) {
        names.stored[name.idx()] = true;
    }
    let finds_fallible_checks = checked.rule_scopes.get().is_some_and(|scopes| scopes.is_enabled(Rule::CanThrow));
    let function_keys: Vec<FuncKey> = included.iter().filter(|_| explain.mutations || explain.throws || explain.throws_json || finds_fallible_checks).map(|&(at, _)| fragments[at.fragment as usize].funcs[at.index as usize].key).collect();
    for (layout, _) in program.layouts.iter().zip(&is_runtime_layout).filter(|layout| *layout.1 && layout.0.kind != LayoutKind::Environment) {
        for field in layout.fields.iter().filter(|field| field.name.is_some()) {
            names.stored[field.name.idx()] = true;
        }
    }
    for layout in program.layouts.iter_mut().filter(|layout| layout.kind != LayoutKind::Environment) {
        for field in layout.fields.iter_mut().filter(|field| field.name.is_some() && !names.stored[field.name.idx()]) {
            field.flags |= field_flags::NEVER_STORED;
        }
    }
    const NAMES_PER_RUN: usize = 4096;
    let mut runs: Vec<(usize, Vec<Atom>)> = (0..program.strs.len()).step_by(NAMES_PER_RUN).map(|first| (first, Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(first, found)| {
        found.extend((*first..program.strs.len().min(*first + NAMES_PER_RUN)).filter(|&name| names.stored[name]).filter_map(|name| checked.files.atoms.lookup(program.strs.get(StrId::new(name)))));
    });
    let stored: FxHashSet<Atom> = runs.into_iter().flat_map(|run| run.1).collect();
    times.add("names", &mut since);

    let [verdicts, verdicts_of_runtime] = integer_verdicts.join().expect("the thread that follows the numbers panicked").map(|verdicts| -> Vec<(StrId, Int32Verdict<StrId>)> {
        verdicts.into_iter().filter_map(|verdict| Some((Some(str_ids[verdict.name.idx()]).filter(|name| name.is_some())?, verdict))).collect()
    });
    for (verdicts, are_of_runtime) in [(&verdicts, false), (&verdicts_of_runtime, true)] {
        let mut is_expected_int32 = vec![false; program.strs.len()];
        for (name, verdict) in verdicts {
            is_expected_int32[name.idx()] = verdict.is_expected_int32();
        }
        for (layout, _) in program.layouts.iter_mut().zip(&is_runtime_layout).filter(|layout| *layout.1 == are_of_runtime && layout.0.kind != LayoutKind::Environment) {
            for field in layout.fields.iter_mut().filter(|field| field.name.is_some() && field.flags & field_flags::NEVER_STORED == 0 && is_expected_int32[field.name.idx()]) {
                field.flags |= field_flags::EXPECTED_INT32;
            }
        }
    }
    times.add("integers", &mut since);

    let asked: Vec<TypeId> = views.iter().map(|view| view.1).collect();
    let say = |what: &str| {
        if let Some(print_line) = explain.progress {
            print_line(format_args!("aot: progress: the link: {what}"));
        }
    };
    say("the types of the fields");
    let copy_targets: Vec<u32> = marks.is_copied_to.iter().enumerate().filter(|ty| ty.1.load(Ordering::Relaxed)).map(|ty| ty.0 as u32).collect();
    let field_types = crate::field_types::field_types(&program, &views, copy_targets);
    let mut is_exhausted = false;
    let mut truncated = Vec::new();
    let mut relaxed_for_logging = Vec::new();
    let layout_type_texts = TypeTexts::new(&views);
    let membership = std::thread::scope(|scope| {
    let printers = [(); 2].map(|()| spawn_outside_pool(scope, || layout_type_texts.print(checked, &program, shown_from)));
    let mut subtypes = c.begin_subtypes(recorded, &asked, field_types, stored, kinds_declared, explain.progress, in_parallel);
    times.add("flows", &mut since);
    for run in 0..6 {
        if run == 1 {
            subtypes = subtypes.restart();
        }
        if run >= 2 {
            if !subtypes.logs_type_errors() {
                break;
            }
            if run >= 3 {
                relaxed_for_logging.push(subtypes.explain_logging_relaxation());
                if !subtypes.has_relaxed_too_much_for_logging() {
                    break;
                }
            }
            use bun_sema::check::LoggingRelaxation::{BoundedExternalData, Nothing, BoundedUntyped, AllExternalData};
            subtypes = subtypes.restart_final_run([AllExternalData, BoundedExternalData, BoundedUntyped, Nothing][run - 2]);
        }
        while !subtypes.queries().is_empty() || !subtypes.own_queries().is_empty() {
            let (answers, has_this_run_out) = answer_queries(checked, subtypes.queries(), subtypes.stored(), &mut truncated, in_parallel);
            subtypes.log_progress("the answers of the other checkers");
            c.set_truncated_queries(&truncated);
            let local_answers = c.answer(subtypes.own_queries(), subtypes.stored());
            keep_truncated_queries(&mut truncated, c.truncated_queries());
            is_exhausted |= has_this_run_out;
            times.add("answers", &mut since);
            subtypes.advance(&answers, &local_answers);
            times.add("flows", &mut since);
        }
    }
    if let Some(table) = subtypes.is_over_budget() {
        problems.push(Problem { file: nowhere, pos: 0, what: format!("a program with so many flows between its types: {table} is over its budget").into() });
    }
    let membership = subtypes.finish();
    times.add("flows", &mut since);
    layout_type_texts.print(checked, &program, shown_from);
    for printer in printers {
        printer.join().expect("a thread that prints types panicked");
    }
    membership
    });
    times.add("type texts", &mut since);
    checked.release_expression_tables();
    let _ = std::thread::Builder::new().spawn(move || drop((fragments, index, reach, maps, types, seen, included, layout_ids, global_ids)));
    say("the subtypes are found");
    if ran_out_of_stack || is_exhausted || c.take_ran_out_of_stack() {
        problems.push(Problem { file: nowhere, pos: 0, what: "types that are nested too deeply".into() });
    }
    let layouts_at = |indexes: &[u32]| -> Vec<LayoutId> { indexes.iter().map(|&index| views[index as usize].0).collect() };
    let strs = &program.strs;
    let mut remaining_layouts: Vec<Option<&mut Layout>> = program.layouts.iter_mut().map(Some).collect();
    let mut laid: Vec<_> = views.iter().zip(&membership.views).map(|(&(layout, _), reach)| (remaining_layouts[layout.idx()].take().expect("a layout is of one view"), reach)).collect();
    drop(remaining_layouts);
    let symbol_field_names: FxHashMap<Atom, Option<StrId>> = (membership.views.iter())
        .flat_map(|reach| reach.callees.iter().map(|callee| callee.0).chain(reach.never_observed_absent.iter().copied()))
        .filter(|&name| c.atoms().is_symbol_name(name))
        .map(|name| (name, c.constant_symbol_of_property(name).and_then(|symbol| strs.find(&c.constant_symbol_text(symbol)))))
        .collect();
    let field_names_by_symbol: FxHashMap<ConstantSymbol, StrId> = (membership.views.iter())
        .flat_map(|reach| reach.set_at_creation.iter())
        .filter_map(|&(key, _)| match key {
            FieldKey::Symbol(symbol) => Some((symbol, strs.find(&c.constant_symbol_text(symbol))?)),
            FieldKey::Name(_) => None,
        })
        .collect();
    let field_name = |name: Atom| match symbol_field_names.get(&name) {
        Some(&found) => found,
        None => strs.find(checked.files.atoms.bytes(name)),
    };
    for_each_mut(&mut laid, in_parallel, &|(out, reach)| {
        out.is_allocated = reach.is_allocated;
        out.may_be_frozen = reach.may_be_frozen;
        if reach.prototype_is_set_by_typed_code && out.kind == LayoutKind::Record {
            out.class_flags |= class_flags::PROTOTYPE_IS_SET_BY_TYPED_CODE;
        }
        if reach.may_have_other_prototype && out.kind == LayoutKind::Record {
            out.class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
        }
        out.accepts_untyped = reach.accepts_untyped;
        out.is_relaxed_for_logging = reach.is_relaxed_for_logging;
        out.accepts_only_other_layouts = reach.accepts_only_other_layouts;
        out.members = layouts_at(&reach.members);
        out.structural_subtypes = layouts_at(&reach.structural_subtypes);
        out.specializations = layouts_at(&reach.specializations);
        let by_name = out.fields_by_name();
        for &(name, file, func) in &reach.callees {
            let field = field_name(name).and_then(|name| by_name.get(out, name));
            if let (Some(field), Some(func)) = (field, func_ids.get(FuncKey::Function(file, func))) {
                out.fields[field as usize].single_function = func;
            }
        }
        for &(name, is_at_every_creation) in &reach.set_at_creation {
            let name = match name {
                FieldKey::Name(name) => field_name(name),
                FieldKey::Symbol(symbol) => field_names_by_symbol.get(&symbol).copied(),
            };
            if let Some(field) = name.and_then(|name| by_name.get(out, name)) {
                out.fields[field as usize].flags |= if is_at_every_creation { field_flags::SET_AT_CREATION } else { field_flags::MAY_BE_SET_AT_CREATION };
            }
        }
        for &name in &reach.never_observed_absent {
            if let Some(field) = field_name(name).and_then(|name| by_name.get(out, name))
                && out.fields[field as usize].flags & (field_flags::OPTIONAL | field_flags::NEVER_STORED) == 0
            {
                out.fields[field as usize].flags |= field_flags::NEVER_OBSERVED_ABSENT;
            }
        }
    });
    for (file, function) in c.functions_with_mutable_prototype() {
        if let Some(func) = func_ids.get(FuncKey::Function(file, function))
            && program.funcs[func.idx()].declared_this_type.is_some()
            && let Some(view) = program.tys.get(program.funcs[func.idx()].declared_this_type).single_layout()
        {
            let initialized: Vec<LayoutId> = std::iter::once(view).chain(program.layouts[view.idx()].members.iter().copied()).collect();
            for layout in initialized {
                let out = &mut program.layouts[layout.idx()];
                if out.kind == LayoutKind::Record {
                    out.class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
                }
            }
        }
    }
    {
        let layout_of_type: FxHashMap<TypeId, LayoutId> = views.iter().map(|&(layout, ty)| (ty, layout)).collect();
        let layout_of_class: FxHashMap<(FileId, ClassId), LayoutId> = classes.iter().enumerate().filter_map(|(index, class)| Some(((*class)?, LayoutId::new(index)))).collect();
        let layouts = &program.layouts;
        let extends = |mut layout: LayoutId, ancestor: LayoutId| {
            while layout.is_some() && layout != ancestor {
                layout = layouts[layout.idx()].base;
            }
            layout == ancestor
        };
        let mut resolved: Vec<(usize, usize)> = Vec::new();
        for (index, class) in classes.iter().enumerate() {
            let Some((file, class)) = *class else { continue };
            for (at, method) in layouts[index].methods.iter().enumerate() {
                if method.flags & method_flags::MAY_BE_REPLACED == 0 || method.flags & method_flags::STATIC != 0 || method.name.is_none() {
                    continue;
                }
                let Some(evidence) = replaced.structural_evidence(file, class, program.strs.get(method.name)) else { continue };
                let is_reached = evidence.iter().any(|(candidate, receiver)| match (layout_of_class.get(candidate), layout_of_type.get(receiver)) {
                    (Some(&candidate), Some(&receiver)) => layouts[receiver.idx()].members.iter().any(|&member| extends(member, candidate)),
                    _ => true,
                });
                if !is_reached {
                    resolved.push((index, at));
                }
            }
        }
        for (index, at) in resolved {
            program.layouts[index].methods[at].flags &= !method_flags::MAY_BE_REPLACED;
        }
    }
    let mut supertypes_by_layout: Vec<Vec<LayoutId>> = vec![Vec::new(); program.layouts.len()];
    for (index, view) in program.layouts.iter().enumerate() {
        for member in view.members.iter().filter(|member| member.idx() != index) {
            supertypes_by_layout[member.idx()].push(LayoutId::new(index));
        }
    }
    {
        let Program { funcs, layouts, tys, .. } = &mut program;
        let layouts = &layouts[..];
        let unknown_facts = || FieldTypeCache { is_found: vec![false; layouts.len()], ..Default::default() };
        let sibling_layouts: Vec<OnceLock<Vec<LayoutId>>> = layouts.iter().map(|_| OnceLock::new()).collect();
        let functions_per_run = funcs.len().div_ceil(64).max(1);
        let mut runs: Vec<(&mut [Func], &[u8], Vec<usize>)> = funcs.chunks_mut(functions_per_run).zip(contents.chunks(functions_per_run)).map(|(run, contents)| (run, contents, Vec::new())).collect();
        let numbered: &DeclaredTable = tys;
        for_each_mut(&mut runs, in_parallel, &|(run, contents, left)| {
            let mut known = unknown_facts();
            for (index, func) in run.iter_mut().enumerate().filter(|function| contents[function.0] & has::PREDICTIONS_BY_FIELD != 0) {
                if !retype_reads_from_field_types(func, layouts, &mut &*numbered, &supertypes_by_layout, &sibling_layouts, &mut known) {
                    left.push(index);
                }
            }
        });
        let mut known = unknown_facts();
        for (run, _, left) in &mut runs {
            for &index in left.iter() {
                retype_reads_from_field_types(&mut run[index], layouts, &mut &mut *tys, &supertypes_by_layout, &sibling_layouts, &mut known);
            }
        }
    }
    times.add("answers", &mut since);
    let fields_by_name = nullish::fields_with_deleted_names(&program, &contents, in_parallel);
    let deleted = nullish::widen_fields_for_deletions(&mut program, &contents, &fields_by_name, in_parallel);
    reads::retype_reads_from_subtypes(&mut program, in_parallel);
    let written: Vec<TyId> = program.funcs.iter().flat_map(|func| func.params.iter().copied()).collect();
    let mut found_meanwhile = None;
    nullish::widen_for_nullish(&mut program, &contents, &fields_by_name, in_parallel, &mut |program| found_meanwhile = Some((literal_structures::find_single_structure_receivers(program, in_parallel), throws::set_up(program, in_parallel))));
    let ((single_structure_accesses, mut rows), setup_of_what_always_fails) = found_meanwhile.expect("the link waits once for where the functions get");
    let mut left = &written[..];
    for (index, func) in program.funcs.iter().enumerate() {
        let of_function;
        (of_function, left) = left.split_at(func.params.len());
        if func.params != of_function {
            program.declared_parameter_types.insert(index as u32, of_function.to_vec());
        }
    }
    nullish::narrow_integer_arithmetic(&mut program, in_parallel);
    times.add("nil", &mut since);
    say("the subtypes are in the program");
    times.add("members", &mut since);
    let unsound_uses = crate::verify::unsound_uses(&program, 1, in_parallel);
    if let Some(first) = unsound_uses.first() {
        problems.push(Problem { file: nowhere, pos: 0, what: first.what.clone().into() });
    }
    times.add("verify", &mut since);
    say("verified");
    let is_empty_slot = |view: &Layout| view.kind == LayoutKind::Record && nullish::is_uninhabited_layout(view) && !view.is_relaxed_for_logging;
    for view in program.layouts.iter_mut().filter(|view| is_empty_slot(view)) {
        view.name = StrId::NONE;
        for field in &mut view.fields {
            field.literals.clear();
        }
    }
    let mut fields_without_source: FxHashSet<(LayoutId, u32)> = FxHashSet::default();
    for view in (0..program.layouts.len() as u32).map(LayoutId) {
        let looked_through = &program.layouts[view.idx()];
        if looked_through.kind != LayoutKind::Record || looked_through.is_allocated || looked_through.accepts_untyped || looked_through.is_relaxed_for_logging || looked_through.members.is_empty() {
            continue;
        }
        for field in 0..looked_through.fields.len() {
            let looked_through = &program.layouts[view.idx()];
            if looked_through.fields[field].literals.is_empty() {
                continue;
            }
            let name = looked_through.fields[field].name;
            let of_members: Option<Vec<&[Literal]>> = (looked_through.members.iter())
                .map(|member| &program.layouts[member.idx()])
                .map(|member| member.field(name).map(|at| &member.fields[at as usize].literals[..]).filter(|literals| !literals.is_empty()))
                .collect();
            let Some(of_members) = of_members else { continue };
            let held: Vec<Literal> = looked_through.fields[field].literals.iter().copied().filter(|literal| of_members.iter().any(|literals| literals.contains(literal))).collect();
            if held.len() != looked_through.fields[field].literals.len() {
                program.layouts[view.idx()].fields[field].literals = held;
                fields_without_source.insert((view, field as u32));
            }
        }
    }
    let TypeTexts { printed, declared, .. } = layout_type_texts;
    for (&(layout, _), layout_entry) in views.iter().zip(printed.into_iter().flat_map(|slice| slice.into_inner().expect("every slice is printed").fields)) {
        if is_empty_slot(&program.layouts[layout.idx()]) {
            continue;
        }
        for (field, hash, text) in layout_entry.into_iter().filter(|of_field| !fields_without_source.contains(&(layout, of_field.0))) {
            program.layouts[layout.idx()].fields[field as usize].type_text = program.strs.intern_hashed(hash, &text);
        }
    }
    let LayoutDeclarationSites { display_paths, path_and_line } = declared.into_inner().expect("where the views are declared is found behind their texts");
    let paths: Vec<StrId> = display_paths.iter().map(|shown| program.strs.intern(shown)).collect();
    for (&(layout, _), at) in views.iter().zip(path_and_line) {
        let Some((path, line)) = at else { continue };
        let out = &mut program.layouts[layout.idx()];
        if is_empty_slot(out) {
            continue;
        }
        (out.declared_path, out.declared_line) = (paths[path as usize], line);
    }
    times.add("type texts", &mut since);
    say("the texts of the types");
    let mut explained = Vec::new();
    let mut found = Vec::new();
    let (mut open_layouts_found, mut chains_by_name, mut checks_of_parameters, mut accesses_without_known_cause) = (Vec::new(), Vec::new(), FxHashSet::default(), Vec::new());
    if declares_int32 {
        found.append(&mut c.find_int32_members_seen_through_other_types(&asked, &membership));
    }
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::OpenLayout)) {
        let is_left_out: Vec<bool> = views.iter().map(|view| is_runtime_layout.get(view.0.idx()).copied().unwrap_or(false)).collect();
        for (view, finding) in c.find_open_layouts(&asked, &membership, &is_left_out, scopes) {
            open_layouts_found.push((views[view].0, found.len()));
            found.push(finding);
        }
    }
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::ReshapedLayout)) {
        found.append(&mut c.find_reshaped_layouts(&membership, scopes));
    }
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::ExternalType)) {
        found.append(&mut checked.checker().find_external_types(scopes));
    }
    let is_declared_by_program = |index: usize, layout: &Layout| layout.kind == LayoutKind::Instance && !is_runtime_layout.get(index).copied().unwrap_or(false);
    let looks_at_classes = checked.rule_scopes.get().is_some_and(|scopes| [Rule::ByName, Rule::LostLayout, Rule::UntypedBase].into_iter().any(|rule| scopes.is_enabled(rule)));
    let declared: Vec<((FileId, ClassId), bool)> = (program.layouts.iter().enumerate())
        .filter(|&(index, layout)| looks_at_classes && is_declared_by_program(index, layout))
        .filter_map(|(index, layout)| Some((classes[index]?, layout.class_flags & class_flags::HAS_FIXED_LAYOUT != 0)))
        .collect();
    let classes_without_layout: FxHashSet<(FileId, ClassId)> = declared.iter().filter(|class| !class.1).map(|class| class.0).collect();
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::ByName)) {
        let is_wanted_module: Vec<bool> = modules.iter().map(|&file| scopes.may_apply_in(Rule::ByName, file)).collect();
        let sites = by_name::find_sites(&program, &is_wanted_module, in_parallel);
        chains_by_name = by_name::find_chains(&program, checked, &modules, &sites);
        let accesses: Vec<(FileId, hir::ExprId, u32, Vec<u8>)> = chains_by_name.iter().filter(|chain| !chain.begins_with_a_store).map(|chain| (chain.file, chain.receiver, chain.name_pos, chain.name.clone())).collect();
        let (mut reported, unexplained) = checked.checker().find_accesses_by_name(&accesses, &classes_without_layout, scopes);
        if explain.mutations {
            explained.push(format!("by-name: {} sites in the code, {} first in their chain, {} with a reason, {} without", sites.len(), accesses.len(), reported.len(), unexplained.len()));
        }
        found.append(&mut reported);
        accesses_without_known_cause = unexplained;
    }
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::LostLayout) || scopes.is_enabled(Rule::UntypedBase)) {
        found.append(&mut c.find_lost_layouts(&declared, scopes));
    }
    if explain.foreign {
        let is_left_out: Vec<bool> = views.iter().map(|view| !explain.includes_builtin_modules && is_runtime_layout.get(view.0.idx()).copied().unwrap_or(false)).collect();
        explained.append(&mut c.explain_untyped(&asked, &membership, &is_left_out));
    }
    if explain.mutations {
        explained.append(&mut c.explain_mutations(&membership));
        let fixed_layout_classes = || program.layouts.iter().filter(|layout| layout.kind == LayoutKind::Instance && layout.class_flags & class_flags::HAS_FIXED_LAYOUT != 0);
        let beside: FxHashMap<FuncId, FuncId> = (function_keys.iter().enumerate())
            .filter_map(|(i, &key)| match key {
                FuncKey::GenericEntrypoint(file, func) => Some((func_ids.get(FuncKey::Function(file, func))?, FuncId::new(entry_points.len() + i))),
                _ => None,
            })
            .collect();
        explained.push(format!("mutations: classes: {} methods of laid-out classes have an entry that hands a stranger to a second body, of {entries_translated} for which one was translated", beside.len()));
        explained.push(format!("mutations: classes: {} of the {} laid-out classes take objects that their constructor has not made", fixed_layout_classes().filter(|layout| layout.accepts_untyped).count(), fixed_layout_classes().count()));
        let converted_layouts: FxHashSet<LayoutId> = deleted.turned.iter().map(|turned| turned.0).collect();
        explained.push(format!(
            "mutations: deleted through a view: {} places; by the name alone, from any object: {} places; {} required fields of {} layouts may be absent for it, {} of them by the name alone, {} were never seen absent; {} reads may find one absent",
            deleted.places,
            deleted.slots_by_name,
            deleted.turned.len(),
            converted_layouts.len(),
            deleted.converted_by_name,
            deleted.never_observed_absent,
            nullish::count_reads_of_deleted_fields(&program, &deleted)
        ));
        explained.push(format!("mutations: classes: {extended_by_value} of the {classes_used_as_values} laid-out classes that are used as values may be extended by their value"));
        let is_tested: Vec<bool> = program.layouts.iter().map(|view| view.members.iter().any(|member| program.layouts[member.idx()].may_be_frozen)).collect();
        let stores = || program.funcs.iter().flat_map(|func| func.blocks.iter().flat_map(|block| block.ops.iter().map(|v| crate::format::record(&func.values[v.idx()].def)))).filter(|r| r.opcode == crate::format::Opcode::PutField);
        explained.push(format!("mutations: {} of {} stores to fields test the integrity level", stores().filter(|r| is_tested[r.immediates[0] as usize]).count(), stores().count()));
        let records = |is_marked: bool| program.layouts.iter().filter(|layout| layout.is_allocated && layout.kind == LayoutKind::Record && (!is_marked || layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0)).count();
        explained.push(format!("mutations: {} of {} allocated records may inherit from anything", records(true), records(false)));
    }
    for (property, key, (file, func)) in c.functions_by_key() {
        let strings = [property, key].map(|atom| program.strs.find(checked.files.atoms.bytes(atom)));
        if let ([Some(property), Some(key)], Some(func)) = (strings, func_ids.get(FuncKey::Function(file, func))) {
            program.functions_by_key.push((property, key, func));
        }
    }
    program.functions_by_key.sort_unstable_by_key(|entry| (entry.0.0, entry.1.0));
    {
        let Program { funcs, functions_by_key, .. } = &mut program;
        let functions_by_key = &*functions_by_key;
        let mut runs: Vec<(&mut [Func], &[u8])> = funcs.chunks_mut(FUNCTIONS_PER_SLICE).zip(contents.chunks(FUNCTIONS_PER_SLICE)).collect();
        for_each_mut(&mut runs, in_parallel, &|(funcs, contents)| {
            for value in funcs.iter_mut().zip(contents.iter()).filter(|function| function.1 & has::PREDICTIONS_BY_KEY != 0).flat_map(|function| &mut function.0.values) {
                if let Prediction::ByKey(property) = value.prediction()
                    && functions_by_key.binary_search_by_key(&property.0, |entry| entry.0.0).is_err()
                {
                    value.set_prediction(Prediction::None);
                }
            }
        });
    }
    times.add("by key", &mut since);
    if explain.deferred {
        explained.append(&mut c.explain_deferred(&translated));
        explained.append(&mut explain_start(&program, &evaluating));
        explained.append(&mut c.explain_modules(&roots.iter().map(|root| root.file()).collect::<Vec<FileId>>(), &translated));
        explained.append(&mut c.explain_commonjs());
    }
    if explain.fields {
        explained.append(&mut explain_fields(&program, &names));
    }
    if explain.given {
        explained.append(&mut relaxed_for_logging);
        explained.append(&mut explain_external_data(&program, &is_runtime_layout));
        let (in_part, by_looks, all) = checked.checker().count_partially_tainted_unions();
        explained.push(format!("given: written unions of records that are given in part: {in_part} of {all}; in {by_looks} of them no member was found: one only looks like what is given"));
    }
    if explain.throws || explain.throws_json || finds_fallible_checks {
        let mut starts: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
        for (module, &file) in modules.iter().enumerate() {
            starts.insert(module as u32, compute_ecma_line_starts(&checked.files.hir(file).text));
        }
        let line_and_column = |module: u32, pos: u32| {
            let Some(starts) = starts.get(&module) else { return (0, 0) };
            let line = starts.partition_point(|&start| start <= pos).max(1) - 1;
            let text = &checked.files.hir(modules[module as usize]).text;
            let before = &text[(starts[line] as usize).min(text.len())..(pos as usize).min(text.len())];
            (line as u32 + 1, bstr::BStr::new(before).to_string().encode_utf16().count() as u32 + 1)
        };
        let mut asked: Vec<(FuncId, FileId, hir::FnId)> = (function_keys.iter().enumerate())
            .filter_map(|(i, &key)| match key {
                FuncKey::Function(file, root) => Some((FuncId::new(entry_points.len() + i), file, root)),
                _ => None,
            })
            .filter(|asked| program.funcs[asked.0.idx()].has(func_flags::IS_TYPED))
            .collect();
        asked.sort_unstable_by_key(|asked| asked.0);
        in_parallel(64, &|_| checked.checker().help_find_untyped_argument_receivers());
        let mut asking = checked.checker();
        program.may_receive_untyped_arguments = asked.into_iter().filter(|&(func, file, root)| asking.may_receive_untyped_arguments(file, root, program.funcs[func.idx()].has(func_flags::IS_VALUE))).map(|asked| asked.0.idx() as u32).collect();
        if explain.throws || explain.throws_json {
            explained.append(&mut throws::explain(&program, checked.checker().logs_type_errors(), explain.throws_json, explain.throws_all, &line_and_column, in_parallel));
        }
        if let Some(scopes) = checked.rule_scopes.get().filter(|_| finds_fallible_checks) {
            let at = |module: u32, pos: u32, code: u32, args: Vec<Vec<u8>>| {
                let file = modules[module as usize];
                let hir = checked.files.hir(file);
                let end = bun_sema::check::spans::token_end(&hir.text, pos as usize, hir.kind == hir::FileKind::Tsx) as u32;
                CompilerDiagnostic { file, start: pos, end, code, args, related: Vec::new() }
            };
            for check in throws::find_fallible_checks(&program, checked.checker().logs_type_errors(), in_parallel) {
                if !scopes.is_wanted(Rule::CanThrow, modules[check.module as usize], check.pos) {
                    continue;
                }
                if check.is_of_parameters {
                    checks_of_parameters.insert((modules[check.module as usize], check.pos));
                }
                let origin = check.origin.into_iter().map(|(module, pos, what)| at(module, pos, 100018, vec![what.into_bytes()]));
                let related = origin.chain([at(check.module, check.pos, 100049, vec![check.fix.as_bytes().to_vec()])]).collect();
                found.push(CompilerDiagnostic { related, ..at(check.module, check.pos, 100028, vec![check.what.into_bytes()]) });
            }
        }
    }
    if explain.integers {
        let mut is_field_name_atom = vec![false; program.strs.len()];
        let fields = program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment).flat_map(|layout| &layout.fields);
        for field in fields.filter(|field| field.name.is_some() && field.flags & field_flags::NEVER_STORED == 0) {
            is_field_name_atom[field.name.idx()] = true;
        }
        let of_fields = verdicts.iter().filter(|verdict| is_field_name_atom[verdict.0.idx()]);
        let mut by_text: Vec<Int32Verdict<&[u8]>> = of_fields.map(|&(name, Int32Verdict { is_reached_by_int32, contrary, .. })| Int32Verdict { name: program.strs.get(name), is_reached_by_int32, contrary }).collect();
        by_text.sort_by_key(|verdict| verdict.name);
        explained.push(format!("integers: under {} of the {} names of fields that numbers are seen to get to, they are expected to be int32s", by_text.iter().filter(|verdict| verdict.is_expected_int32()).count(), by_text.len()));
        explained.append(&mut c.explain_int32_fields(&by_text));
    }
    program.flagged_values = crate::build::string_sets::find_string_set_sizes(&program, &contents, in_parallel);
    for site in crate::build::fused_joins::find_join_sites(&program, in_parallel) {
        if explain.joins {
            let func = &program.funcs[site.func.idx()];
            let text = &checked.files.hir(modules[func.module.idx()]).text;
            let before = &text[..(func.values[site.join.idx()].pos as usize).min(text.len())];
            let line = bun_core::strings::count_char(before, b'\n') + 1;
            let path = bstr::BStr::new(program.strs.get(program.modules[func.module.idx()].display_path));
            explained.push(match &site.rejection {
                None => format!("joins: {path}:{line}: map().join() is fused into one loop"),
                Some(rejection) => format!("joins: {path}:{line}: map().join() is not fused: {rejection}"),
            });
        }
        if site.rejection.is_none() {
            program.flagged_values[site.func.idx()].push(site.join);
        }
    }
    times.add("collections", &mut since);
    program.single_structure_accesses = single_structure_accesses;
    times.add("rows", &mut since);
    literal_structures::find_first_stores(&mut program, &contents, in_parallel);
    times.add("firsts", &mut since);
    if explain.rows {
        explained.append(&mut rows);
    }
    reuse::mark_environment_releases(&mut program, &contents, in_parallel);
    times.add("releases of environments", &mut since);
    let members = membership.sizes.line();
    since = Instant::now();
    let func_ids = func_ids.by_program_id;
    let _ = std::thread::Builder::new().spawn(move || drop((func_ids, str_ids)));
    drop((membership, names));
    times.add("free", &mut since);
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::Interpreted)) {
        for site in interpreted::find_sites(&program, in_parallel) {
            let file = modules[site.module as usize];
            if scopes.is_wanted(Rule::Interpreted, file, site.pos) {
                let hir = checked.files.hir(file);
                let end = bun_sema::check::spans::token_end(&hir.text, site.pos as usize, hir.kind == hir::FileKind::Tsx) as u32;
                found.push(CompilerDiagnostic { file, start: site.pos, end, code: 100025, args: vec![site.evaluator], related: Vec::new() });
            }
        }
    }
    if let Some(scopes) = checked.rule_scopes.get().filter(|scopes| scopes.is_enabled(Rule::UntypedPackage)) {
        found.append(&mut c.find_untyped_packages(&modules, scopes));
    }
    if explain.costs || explain.costs_json {
        let other_places = checked.checker().find_other_places_where_external_data_enters();
        let sources = costs::Sources { classes_without_layout: &classes_without_layout, other_places_where_external_data_enters: &other_places, program: &program, checked, modules: &modules, shown_from, found: &found, open_layouts: &open_layouts_found, chains: &chains_by_name, checks_of_parameters: &checks_of_parameters, accesses_without_known_cause: &accesses_without_known_cause };
        for as_json in [false, true].into_iter().filter(|&as_json| if as_json { explain.costs_json } else { explain.costs }) {
            explained.append(&mut costs::explain(&sources, as_json, in_parallel));
        }
        if let Some(scopes) = checked.rule_scopes.get() {
            found.retain(|finding| Rule::of_code(finding.code).is_none_or(|rule| scopes.severity(rule, finding.file, finding.start) != Severity::Allow));
        }
    }
    since = Instant::now();
    let typedness = typedness::measure(&program, &is_runtime_layout, &modules, checked, in_parallel);
    times.add("typedness", &mut since);
    let failure_check = Some(FailureCheck { setup: setup_of_what_always_fails, modules });
    Linked { program, problems, members, explained, errors, skipped_builtin_modules, skipped_builtin_functions, found, typedness, times, failure_check }
}

#[cfg(test)]
mod tests {
    use super::first_evaluating_entry_point;

    #[test]
    fn files_belong_to_first_evaluating_entry_point() {
        let static_imports = [vec![2], vec![2, 3], vec![4, 0], vec![], vec![], vec![4]];
        let first = first_evaluating_entry_point(6, &[vec![0], vec![1]], &|file| static_imports[file].clone());
        assert_eq!(first, [0, 1, 0, 1, 0, u32::MAX]);
    }
}
