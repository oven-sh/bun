//! Module loading for the VMs that run a linter's or a formatter's configuration and plugins. These load hundreds of small
//! modules, one `require` after the other. Here other threads resolve, read, transpile and compile a module's imports as soon
//! as they are known, and the VMs of a process share the result.

use core::cell::{Cell, RefCell};
use std::borrow::Cow;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use bun_alloc::Arena;
use bun_ast::{ASTMemoryAllocator, ImportKind, Loader};
use bun_bundler::options::{ImportPathFormat, ModuleType};
use bun_bundler::transpiler::{AlreadyBundled, ParseOptions, Transpiler};
use bun_collections::HashMap;
use bun_core::{MutableString, String, strings};
use bun_js_parser::lower::defer_requires::{LOADS, has_react_compiler, is_in_known_package};
use bun_js_printer::{BufferPrinter, BufferWriter};
use bun_jsc::resolved_source::{Bytecode, PrintedAst, Tag};
use bun_jsc::runtime_transpiler_cache::{ModuleType as CacheModuleType, RuntimeTranspilerCache};
use bun_jsc::virtual_machine::{SharedResolution, VirtualMachine};
use bun_jsc::{JSGlobalObject, ResolvedSource};
use bun_options_types::Format;
use bun_paths::fs::Path;
use bun_removable_features::removable_body_behind_value;
use bun_threading::{Condition, Guarded};

use crate::typescript_front;

unsafe extern "C" {
    /// src/jsc/bindings/LintNodes.cpp
    fn Bun__Lint__deferRequires(global: &JSGlobalObject, source: *const u8, len: usize) -> bool;
}

#[unsafe(no_mangle)]
extern "C" fn Bun__hasChangedRequireExtensions(global: &JSGlobalObject) -> bool {
    has_changed_extensions(global.bun_vm())
}

/// # Safety
/// `path` points to `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Lint__isInKnownPackage(path: *const u8, len: usize) -> bool {
    // SAFETY: the caller's contract.
    is_in_known_package(unsafe { bun_core::ffi::slice(path, len) })
}

fn has_changed_extensions(vm: &VirtualMachine) -> bool {
    vm.has_mutated_built_in_extensions.get() > 0 || vm.commonjs_custom_extensions.get().len() > 0
}

pub(crate) fn is_enabled(vm: &VirtualMachine) -> bool {
    if !vm.transpiler.get().options.defers_requires {
        return false;
    }
    // A hook gets to see the code, and can save what it makes of it for other runtimes.
    if has_changed_extensions(vm) {
        vm.transpiler
            .with_mut(|it| it.options.defers_requires = false);
        return false;
    }
    true
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Lint__setWantsWhole(value: bool) {
    WANTS_WHOLE.set(value);
}

/// Of a file up to this size all functions are compiled. Of a larger one few are ever called.
const SMALL: usize = 4 << 10;
/// To compile a larger one takes more memory than it saves time, unless it leaves tens of megabytes unloaded.
const LARGE: usize = 64 << 10;
/// Per byte of code: what a VM takes to start a module without bytecode, and what it takes to make the bytecode
const NANOSECONDS_TO_PARSE: u64 = 20;
const NANOSECONDS_FOR_TOP_LEVEL: u64 = 16;
const NANOSECONDS_FOR_ALL: u64 = 80;
const MISSES_IN_A_ROW: usize = 2;
const MAX_FILES_IN_DIRECTORY: usize = 512;
const MAX_THREADS: usize = 3;

struct Module {
    loader: Loader,
    module_type: ModuleType,
    version: Version,
    code: String,
    printed: PrintedAst,
    mappings: Vec<u8>,
    /// Never freed: JSC decodes a function when it is first called.
    bytecode: OnceLock<&'static [u8]>,
    /// When `bytecode` is expected
    is_compiled_at: OnceLock<Instant>,
}

#[derive(Clone)]
enum Slot {
    InTheMaking,
    Made(Arc<Module>),
    /// It is for the VM to load it, and to say what is wrong with it.
    Refused,
}

enum Job {
    Load {
        directory: Arc<[u8]>,
        specifier: Box<[u8]>,
        /// See [`LOADS`]
        kind: u8,
        is_guess: bool,
    },
    /// Many plugins list the directory with their rules and require each file.
    LoadAllIn(Arc<[u8]>),
}

/// Who has a module made
#[derive(Copy, Clone, PartialEq)]
enum By {
    Vm,
    Foresight,
    Guess,
}

#[derive(Default)]
struct State {
    slots: HashMap<Box<[u8]>, Slot>,
    /// The last one is needed first.
    jobs: Vec<Job>,
    /// For when there is nothing else to do
    guesses: VecDeque<Job>,
    /// The directory of the module that a VM has last had to make itself, and how many in a row were from there
    missed: (Arc<[u8]>, usize),
    /// The VM has loaded what a stand-in is for, which needs the others.
    has_loaded_large: bool,
    threads: usize,
    idle: usize,
}

struct Template(Box<Transpiler<'static>>);
// SAFETY: only read, by `Transpiler::for_worker`, as the bundler's threads read the one they are made from. It has
// nothing of the VM that it's a copy of: see `new`.
unsafe impl Send for Template {}
// SAFETY: as above.
unsafe impl Sync for Template {}

impl Template {
    fn new(vm: &VirtualMachine) -> Option<Template> {
        let mut copy = copy_of(vm.transpiler.get());
        // An assignment to `process.env` can change the one of the VM.
        let env = bun_core::handle_oom(vm.env_loader().clone_loaded());
        let env = core::ptr::NonNull::from(Box::leak(Box::new(env)));
        (copy.env, copy.resolver.env_loader) = (env.as_ptr(), Some(env));
        copy.load_own_defines().ok()?;
        Some(Template(copy))
    }
}

struct ReadAhead {
    template: Template,
    state: Guarded<State>,
    has_jobs: Condition,
    is_made: Condition,
    max_threads: usize,
    reads_configuration: bool,
}

static READ_AHEAD: OnceLock<ReadAhead> = OnceLock::new();
/// Until there is a [`READ_AHEAD`]
static EXPECTED: Guarded<Vec<Job>> = Guarded::new(Vec::new());

struct Tools {
    transpiler: Box<Transpiler<'static>>,
    printer: BufferPrinter,
}

thread_local! {
    /// See [`typescript_front`]
    static WANTS_WHOLE: Cell<bool> = const { Cell::new(false) };
    static TOOLS: RefCell<Option<Tools>> = const { RefCell::new(None) };
}

fn copy_of(from: &Transpiler<'static>) -> Box<Transpiler<'static>> {
    let (arena, log) = (
        Box::leak(Box::new(Arena::new())),
        Box::leak(Box::new(bun_ast::Log::init())),
    );
    let mut copy = Box::new(Transpiler::for_worker(from, arena, log));
    copy.resolver.opts.packages_require_like_node();
    copy.resolver.opts.preserve_symlinks = from.resolver.opts.preserve_symlinks;
    copy.options.no_macros = true;
    copy
}

#[derive(PartialEq)]
struct Version {
    inode: u64,
    size: u64,
    modified: (i64, i64),
}

impl Version {
    fn of(path: &[u8]) -> Option<Version> {
        let mut buffer = bun_paths::path_buffer_pool::get();
        if path.len() >= buffer.len() {
            return None;
        }
        let stat = bun_sys::stat(bun_paths::resolve_path::z(path, &mut buffer)).ok()?;
        let stat = bun_sys::PosixStat::init(&stat);
        Some(Version {
            inode: stat.ino,
            size: stat.size,
            modified: (stat.mtim.sec, stat.mtim.nsec),
        })
    }
}

/// Call it with the lock of `vm`, whose options are final and those of every other VM that it is called for.
pub(crate) fn enable(vm: &VirtualMachine, reads_configuration: bool) {
    removable_body_behind_value!(RuntimeTranspiler, { start(vm, reads_configuration) })
}

fn start(vm: &VirtualMachine, reads_configuration: bool) {
    if vm.debugger.get().is_some()
        || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DEFERRED_REQUIRE::get()
            == Some(true)
    {
        return;
    }
    let source = include_bytes!("defer_require.js");
    // SAFETY: `source` is static.
    if !unsafe { Bun__Lint__deferRequires(vm.global(), source.as_ptr(), source.len()) } {
        return;
    }
    vm.transpiler
        .with_mut(|it| it.options.defers_requires = true);
    vm.transpiler_store.enabled.set(false);
    if reads_configuration {
        make_bytecode();
    }
    if READ_AHEAD.get().is_none() {
        let Some(template) = Template::new(vm) else {
            return;
        };
        let cores = usize::from(bun_core::get_thread_count());
        let _ = READ_AHEAD.set(ReadAhead {
            template,
            state: Guarded::default(),
            has_jobs: Condition::default(),
            is_made: Condition::default(),
            max_threads: cores
                .saturating_sub(1)
                .min(MAX_THREADS + usize::from(reads_configuration)),
            reads_configuration,
        });
    }
    expect(core::iter::empty());
}

/// While rules run, it's memory on top of what they take.
static MAKES_BYTECODE: AtomicBool = AtomicBool::new(false);

pub(crate) fn make_bytecode() {
    MAKES_BYTECODE.store(true, Ordering::Relaxed);
}

/// A VM is going to load the files at `paths`, in this order.
pub(crate) fn expect<'p>(paths: impl DoubleEndedIterator<Item = &'p [u8]>) {
    let mut expected = EXPECTED.lock();
    expected.extend(paths.rev().map(|path| Job::Load {
        directory: b"/"[..].into(),
        specifier: path.into(),
        kind: b'i',
        is_guess: false,
    }));
    if let Some(this) = READ_AHEAD.get() {
        let mut state = this.state.lock();
        state.jobs.append(&mut expected);
        this.hand_out(&mut state);
    }
}

/// Of [`State::slots`]. It is longer than `path` if the module is what `path` is without a [`typescript_front`].
fn key_of(path: &[u8], wants_whole: bool) -> Cow<'_, [u8]> {
    match wants_whole {
        true => Cow::Owned([path, b"\0"].concat()),
        false => Cow::Borrowed(path),
    }
}

/// What `vm` would make of the file at `path`. `None`: it has to do so itself.
pub(crate) fn load(
    vm: &VirtualMachine,
    specifier: &String,
    path: &Path<'_>,
    loader: Loader,
    module_type: ModuleType,
    tag: Tag,
) -> Option<ResolvedSource> {
    let this = READ_AHEAD.get()?;
    let key = key_of(path.text, WANTS_WHOLE.take());
    let mut state = this.state.lock();
    let module = loop {
        match state.slots.get(&key[..]) {
            Some(Slot::InTheMaking) => this.is_made.wait_guarded(&mut state),
            Some(Slot::Made(module)) => {
                let module = Arc::clone(module);
                drop(state);
                let is_current = (module.loader, module.module_type) == (loader, module_type)
                    && Version::of(path.text).as_ref() == Some(&module.version);
                break is_current.then_some(module)?;
            }
            Some(Slot::Refused) => return None,
            None => {
                state.slots.insert(key[..].into(), Slot::InTheMaking);
                drop(state);
                break this
                    .with_tools(|it| this.make(it, &key, path, loader, module_type, By::Vm))?;
            }
        }
    };
    let source = bun_ast::Source {
        path: *path,
        ..Default::default()
    };
    let list = module.mappings.clone();
    let _ = (vm.source_mappings).put_mappings(&source, MutableString { list });
    Some(ResolvedSource {
        source_url: specifier.create_if_different(path.text),
        tag,
        bytecode_cache: Bytecode::persistent(module.take_bytecode()),
        is_static: VirtualMachine::is_file_on_disk_static(false, path.text),
        ..ResolvedSource::printed(module.printed, module.code.clone())
    })
}

impl Module {
    /// What follows [`LOADS`]
    fn loads(&self) -> &[u8] {
        let code = self.code.byte_slice();
        let Some(at) = strings::last_index_of(code, LOADS) else {
            return b"";
        };
        let line = &code[at + LOADS.len()..];
        &line[..strings::index_of_char_usize(line, b'\n').unwrap_or(line.len())]
    }

    /// Empty if the VM is done sooner if it compiles the code itself.
    fn take_bytecode(&self) -> &'static [u8] {
        if let Some(bytecode) = self.bytecode.get() {
            return bytecode;
        }
        let itself = Duration::from_nanos(self.code.length() as u64 * NANOSECONDS_TO_PARSE);
        match self.is_compiled_at.get() {
            Some(at) if *at < Instant::now() + itself => self.bytecode.wait(),
            _ => b"",
        }
    }

    /// Returns how deep the functions are that are to be compiled.
    fn announce_bytecode(&self) -> u32 {
        let code = self.code.byte_slice();
        let (depth, nanoseconds_per_byte) = match self.loads().first() {
            Some(digit) if code.len() > SMALL => (
                u32::from(digit.saturating_sub(b'0')),
                NANOSECONDS_FOR_TOP_LEVEL,
            ),
            _ => (u32::MAX, NANOSECONDS_FOR_ALL),
        };
        let duration = Duration::from_nanos(code.len() as u64 * nanoseconds_per_byte);
        let _ = self.is_compiled_at.set(Instant::now() + duration);
        depth
    }

    fn compile(&self, path: &[u8]) {
        let (code, depth) = (self.code.byte_slice(), self.announce_bytecode());
        let format = match self.printed.is_commonjs_module {
            true => Format::Cjs,
            false => Format::Esm,
        };
        let url = String::clone_utf8(path);
        let bytecode = bun_jsc::cached_bytecode::generate(format, code, &url, depth);
        let _ = self.bytecode.set(Box::leak(bytecode.unwrap_or_default()));
    }
}

impl ReadAhead {
    fn with_tools<R>(&self, then: impl FnOnce(&mut Tools) -> R) -> R {
        TOOLS.with_borrow_mut(|tools| {
            then(tools.get_or_insert_with(|| Tools {
                transpiler: copy_of(&self.template.0),
                printer: BufferPrinter::init(BufferWriter::init()),
            }))
        })
    }

    fn compiles(&self, path: &[u8], module: &Module) -> bool {
        MAKES_BYTECODE.load(Ordering::Relaxed)
            && (module.code.length() <= LARGE || has_react_compiler(path))
    }

    /// The caller has put [`Slot::InTheMaking`] at `key`.
    fn make(
        &'static self,
        tools: &mut Tools,
        key: &[u8],
        path: &Path<'_>,
        loader: Loader,
        module_type: ModuleType,
        by: By,
    ) -> Option<Arc<Module>> {
        let version = Version::of(path.text);
        let front = (key == path.text && typescript_front::is_typescript(key))
            .then(|| bun_sys::File::read_from(bun_sys::Fd::cwd(), key).ok())
            .and_then(|it| typescript_front::front_of(&it?))
            .map(|it| bun_ast::Source::init_path_string_owned(path.text, it));
        let module = version
            .and_then(|it| transpile(tools, path, it, front.as_ref(), loader, module_type))
            .map(Arc::new);
        let mut state = self.state.lock();
        if let Some(module) = &module {
            let directory: Arc<[u8]> = path.name().dir_with_trailing_slash().into();
            if by != By::Vm && self.compiles(path.text, module) {
                module.announce_bytecode();
            }
            if by == By::Vm {
                state.has_loaded_large |= has_stand_in(path.text);
                if state.missed.0 != directory {
                    state.missed = (Arc::clone(&directory), 0);
                }
                state.missed.1 += 1;
                let has_only_modules = path.is_node_module() || path.name().dir.ends_with(b"rules");
                if state.missed.1 == MISSES_IN_A_ROW && has_only_modules {
                    state.jobs.push(Job::LoadAllIn(Arc::clone(&directory)));
                }
            }
            let first = state.jobs.len();
            let loads = strings::split(module.loads(), b"\t").skip(1);
            for (&kind, specifier) in loads.filter_map(<[u8]>::split_first) {
                let is_guess = by == By::Guess || kind == b'p';
                let job = Job::Load {
                    directory: Arc::clone(&directory),
                    specifier: specifier.into(),
                    kind,
                    is_guess,
                };
                match is_guess {
                    true => state.guesses.push_back(job),
                    false => state.jobs.push(job),
                }
            }
            state.jobs[first..].reverse();
            self.hand_out(&mut state);
        }
        let slot = module.clone().map_or(Slot::Refused, Slot::Made);
        state.slots.insert(key.into(), slot);
        drop(state);
        self.is_made.broadcast();
        module
    }

    fn hand_out(&'static self, state: &mut State) {
        if self.max_threads == 0 {
            state.guesses.clear();
            return state.jobs.clear();
        }
        let jobs = state.jobs.len() + state.guesses.len();
        self.has_jobs.notify_many(jobs.min(state.idle));
        // One at a time: it starts the next.
        if jobs > state.idle && state.threads < self.max_threads {
            let started = std::thread::Builder::new()
                .stack_size(bun_sema_driver::WORKER_STACK_SIZE as usize)
                .spawn(move || removable_body_behind_value!(RuntimeTranspiler, { self.work() }));
            state.threads += usize::from(started.is_ok());
        }
    }

    fn work(&'static self) {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Bun Read Ahead"));
        bun_ast::initialize_store();
        let mut state = self.state.lock();
        loop {
            let Some(job) = state.jobs.pop().or_else(|| state.guesses.pop_front()) else {
                state.idle += 1;
                let has_waited = self.has_jobs.timed_wait_guarded(&mut state, 3_000_000);
                if has_waited.is_err() {
                    drop(state);
                    TOOLS.with_borrow_mut(|tools| {
                        if let Some(tools) = tools {
                            tools.printer = BufferPrinter::init(BufferWriter::init());
                        }
                    });
                    bun_jsc::cached_bytecode::destroy_bytecode_cache_vm();
                    bun_core::Global::mimalloc_cleanup(true);
                    state = self.state.lock();
                    if state.jobs.is_empty() && state.guesses.is_empty() {
                        self.has_jobs.wait_guarded(&mut state);
                    }
                }
                state.idle -= 1;
                continue;
            };
            self.hand_out(&mut state);
            drop(state);
            match job {
                Job::LoadAllIn(directory) => {
                    expect(scripts_in(&directory).iter().map(|it| &it[..]))
                }
                Job::Load {
                    directory,
                    specifier,
                    kind,
                    is_guess,
                } => {
                    let by = if is_guess { By::Guess } else { By::Foresight };
                    self.with_tools(|it| self.load_ahead(it, &directory, &specifier, kind, by));
                }
            }
            state = self.state.lock();
        }
    }

    fn load_ahead(
        &'static self,
        tools: &mut Tools,
        directory: &[u8],
        specifier: &[u8],
        kind: u8,
        by: By,
    ) -> Option<()> {
        let config = bun_jsc::module_loader::alias_cfg();
        // The VM takes a query off, and has modules of its own.
        let has_scheme =
            !bun_paths::is_absolute(specifier) && strings::contains_char(specifier, b':');
        if has_scheme
            || strings::contains_char(specifier, b'?')
            || bun_resolve_builtins::Alias::has(specifier, bun_ast::Target::Bun, config)
        {
            return None;
        }
        let shared = || SharedResolution::new(directory, specifier, kind == b'i');
        if shared().get().is_none() {
            // The resolver parses into these.
            bun_ast::initialize_store_or_reset();
            let import_kind = match kind {
                b'i' => ImportKind::Stmt,
                _ => ImportKind::Require,
            };
            let resolver = &mut tools.transpiler.resolver;
            let resolved = resolver.resolve(directory, specifier, import_kind).ok()?;
            shared().set(resolved.path_const()?.text);
        }
        let path = Path::init(shared().get().filter(|_| kind != b'f')?);
        let loader = crate::jsc_hooks::loader_for_path(&path, &tools.transpiler.options.loaders)?;
        if !loader.is_java_script_like() {
            return None;
        }
        let mut state = self.state.lock();
        let is_unlikely = self.reads_configuration && !state.has_loaded_large;
        if state.slots.contains_key(path.text) || is_unlikely && has_stand_in(path.text) {
            return None;
        }
        state.slots.insert(path.text.into(), Slot::InTheMaking);
        drop(state);
        let directory = tools.transpiler.resolver.read_dir_info(path.name().dir);
        let package_json = (directory.ok().flatten())
            .and_then(|it| it.package_json().or(it.enclosing_package_json));
        let module_type = crate::jsc_hooks::module_type_of(&path, package_json);
        let module = self.make(tools, path.text, &path, loader, module_type, by)?;
        if self.compiles(path.text, &module) {
            module.compile(path.text);
        }
        Some(())
    }
}

/// See `large` in evaluate-stand-ins.js
fn has_stand_in(path: &[u8]) -> bool {
    let ends_with = |end: &[u8]| {
        let is_same = |(a, b): (&u8, &u8)| a == b || (*a, *b) == (bun_paths::SEP, b'/');
        path.len() >= end.len() && path.iter().rev().zip(end.iter().rev()).all(is_same)
    };
    typescript_front::is_typescript(path)
        || ends_with(b"/@typescript-eslint/typescript-estree/dist/index.js")
        || ends_with(b"/@typescript-eslint/scope-manager/dist/index.js")
        || ends_with(b"/@typescript-eslint/eslint-plugin/dist/rules/index.js")
}

fn scripts_in(directory: &[u8]) -> Vec<Vec<u8>> {
    let mut paths = Vec::new();
    let Ok(opened) = bun_sys::Dir::open(directory) else {
        return paths;
    };
    let mut entries = bun_sys::iterate_dir(opened.fd());
    while let Ok(Some(entry)) = entries.next()
        && paths.len() < MAX_FILES_IN_DIRECTORY
    {
        let name = entry.name.slice_u8();
        if name.ends_with(b".js") || name.ends_with(b".cjs") {
            paths.push([directory, name].concat());
        }
    }
    paths
}

fn transpile(
    tools: &mut Tools,
    path: &Path<'_>,
    version: Version,
    virtual_source: Option<&bun_ast::Source>,
    loader: Loader,
    module_type: ModuleType,
) -> Option<Module> {
    let (arena, macro_load_states) = (Arena::new(), Default::default());
    let mut ast_memory = ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory.enter();
    let mut cache = RuntimeTranspilerCache::default();
    let transpiler = &mut *tools.transpiler;
    // SAFETY: the log is this thread's (`copy_of`), and nothing borrows from it.
    let log = unsafe { &mut *transpiler.log };
    *log = bun_ast::Log::init();
    let mut file = None;
    let options = &transpiler.options;
    let parse_options = ParseOptions {
        arena: &arena,
        path: *path,
        loader,
        dirname_fd: bun_sys::Fd::INVALID,
        file_descriptor: None,
        opened_file: Some(&mut file),
        macro_remappings: Default::default(),
        macro_js_ctx: bun_bundler::transpiler::default_macro_js_value(),
        macro_load_states: &macro_load_states,
        jsx: options.jsx.clone(),
        emit_decorator_metadata: options.emit_decorator_metadata,
        experimental_decorators: options.experimental_decorators,
        use_define_for_class_fields: options.use_define_for_class_fields,
        virtual_source,
        replace_exports: Default::default(),
        dont_bundle_twice: true,
        allow_commonjs: true,
        inject_jest_globals: false,
        is_test_entry_point: false,
        set_breakpoint_on_first_line: false,
        runtime_transpiler_cache: match RuntimeTranspilerCache::is_disabled() {
            true => None,
            false => Some(&mut cache),
        },
        remove_cjs_module_wrapper: false,
        module_type,
        keep_json_and_toml_as_one_statement: true,
        allow_bytecode_cache: true,
    };
    let mut parsed = transpiler
        .parse_maybe_return_file_only_allow_shared_buffer::<false, false>(parse_options, None)?;
    // SAFETY: as above.
    let has_errors = unsafe { (*transpiler.log).errors > 0 };
    if has_errors
        || parsed.empty
        || parsed.loader != loader
        || !matches!(parsed.already_bundled, AlreadyBundled::None)
    {
        return None;
    }
    let (mut code, printed, mappings) = match cache.entry.take() {
        Some(mut entry) => (
            core::mem::take(&mut entry.output_code),
            PrintedAst::cached(entry.metadata.module_type == CacheModuleType::Cjs),
            core::mem::take(&mut entry.sourcemap).into_vec(),
        ),
        None => {
            let (origin, format) = (Default::default(), ImportPathFormat::AbsolutePath);
            (transpiler.linker)
                .link::<false, true>(&transpiler.options, path, &mut parsed, &origin, format)
                .ok()?;
            let printed = PrintedAst::new(&parsed.ast);
            let chunk = Cell::new(None);
            tools.printer.ctx.reset();
            let format = bun_js_printer::Format::EsmAscii;
            transpiler
                .print_with_source_map(&arena, parsed, &mut tools.printer, format, &chunk, None)
                .ok()?;
            let code = tools.printer.ctx.get_written();
            let mappings = chunk.take().map_or_else(Vec::new, |it| it.buffer.list);
            cache.put(code, &mappings, None).ok()?;
            (String::clone_latin1(code), printed, mappings)
        }
    };
    if code.is_utf16() || printed.depends_on_more_than_source() {
        return None;
    }
    code.make_thread_shareable();
    Some(Module {
        loader,
        module_type,
        version,
        code,
        printed,
        mappings,
        bytecode: OnceLock::new(),
        is_compiled_at: OnceLock::new(),
    })
}
