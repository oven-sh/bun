//! Coordinator and worker entry points: `run_as_coordinator` (sets up the
//! `Coordinator`, sorts/partitions files, drives the loop, merges fragments)
//! and `run_as_worker` (the `--test-worker` side that reads framed commands
//! from stdin, runs each file under isolation, and streams results to fd 3).

use core::ffi::c_char;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::MacroOptions;
use bun_ptr::Interned;
use bun_resolver::fs::FileSystem;
use bun_sys::Fd;

use super::aggregate;
use super::channel::{Channel, ChannelOwner};
use super::coordinator::{Coordinator, abort_handler};
use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::worker::{Worker, WorkerPipe};
use crate::Command;
use crate::test_command::{self, CommandLineReporter, TestCommand};
use crate::test_runner::bun_test::FirstLast;
use bun_collections::index_sort;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_sourcemap_jsc::code_coverage;

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
const DEFAULT_SCALE_UP_AFTER_MS: i64 = 5;

/// Returns true if files were actually run via the worker pool, false if it
/// fell back to the sequential path (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
pub(crate) fn run_as_coordinator(
    reporter: &'static CommandLineReporter,
    vm: *mut VirtualMachine,
    files: &[Interned],
    ctx: Command::Context,
    coverage_opts: &mut CodeCoverageOptions,
) -> crate::Result<bool> {
    // SAFETY: caller guarantees `vm` is a valid live VM pointer for the duration.
    // Kept as a raw pointer; dereferenced at each use site to sidestep borrowck
    // around the self-referential Coordinator/Worker graph.
    let vm_ptr = vm;
    // SAFETY: env loader is initialized before the test runner runs.
    let env = unsafe { &mut *(*vm_ptr).transpiler.env };
    let n: u32 = u32::try_from(files.len()).unwrap();
    let k: u32 = ctx.test_options.parallel.min(n);
    if k <= 1 {
        // Jest sets JEST_WORKER_ID=1 even with --maxWorkers=1; match that so
        // tests can rely on the var whenever --parallel is passed.
        let _ = env.map.put(b"JEST_WORKER_ID", b"1");
        let _ = env.map.put(b"BUN_TEST_WORKER_ID", b"1");
        // SAFETY: see vm_ptr note above.
        TestCommand::run_all_tests(reporter, unsafe { &mut *vm_ptr }, files);
        return Ok(false);
    }

    // Workers' stderr is a pipe; have them format with ANSI when we will be
    // rendering to a color terminal so streamed lines match serial output.
    if Output::enable_ansi_colors_stderr() {
        let _ = env.map.put(b"FORCE_COLOR", b"1");
    }
    // Each worker gets a unique JEST_WORKER_ID / BUN_TEST_WORKER_ID (1-indexed,
    // matching Jest) so tests can pick distinct ports/databases. Serialize the
    // env map once per worker after .put() — appending after the fact would
    // create duplicate entries when the parent already has the variable set,
    // and POSIX getenv() returns the first match.
    let mut envps: Vec<bun_dotenv::NullDelimitedEnvMap> = Vec::with_capacity(k as usize);
    for i in 0..k {
        let mut id = Vec::new();
        write!(&mut id, "{}", i + 1).unwrap();
        let _ = env.map.put(b"JEST_WORKER_ID", &id);
        let _ = env.map.put(b"BUN_TEST_WORKER_ID", &id);
        envps.push(env.map.create_null_delimited_env_map()?);
    }
    let argv = build_worker_argv(ctx)?;

    // Sort lexicographically so adjacent indices share parent directories.
    // Each worker owns a contiguous chunk; co-located files share imports, so
    // this keeps each worker's isolation SourceProvider cache hot. --randomize
    // explicitly opts out of locality (the caller already shuffled).
    let mut sorted: Vec<Interned> = files.to_vec();
    if !ctx.test_options.randomize {
        index_sort::sort_slice_by(&mut sorted, |a, b| {
            bun_core::order(a.as_bytes(), b.as_bytes())
        });
    }
    // With --timings the contiguous chunks are cut by total duration instead
    // of file count, and each chunk is dispatched slowest-first (cache hits
    // depend on which worker runs a file, not the order within the worker).
    let mut costs: Option<Vec<u64>> = None;
    let timings = reporter.timings.borrow();
    let ranges: Vec<FileRange> = match timings.as_ref() {
        Some(t) if !t.is_empty() && !ctx.test_options.randomize => {
            let ranges = t.partition(&sorted, k);
            for r in &ranges {
                t.sort_slowest_first(&mut sorted[r.lo as usize..r.hi as usize]);
            }
            costs = Some(t.costs(&sorted));
            ranges
        }
        _ => (0..k)
            .map(|idx| FileRange {
                lo: idx * n / k,
                hi: (idx + 1) * n / k,
            })
            .collect(),
    };
    drop(timings);

    let mut workers: Vec<Worker> = Vec::with_capacity(k as usize);
    // Populate fully BEFORE constructing Coordinator so it can hold
    // `&mut [Worker]` without aliasing the push loop. The `coord` backref is
    // null here and patched once Coordinator's address is fixed.
    for i in 0..k {
        let idx: u32 = i;
        workers.push(Worker {
            // BACKREF (LIFETIMES.tsv: *const Coordinator<'static>) — patched below
            coord: core::ptr::null(),
            idx,
            range: ranges[idx as usize],
            out: WorkerPipe::new(core::ptr::null()),
            err: WorkerPipe::new(core::ptr::null()),
            process: None,
            ipc: Channel::default(),
            inflight: None,
            dispatched_at: 0,
            captured: Vec::new(),
            alive: false,
            exit_status: None,
            reap_pending: false,
            reached_ready: false,
            startup_failures: 0,
        });
        let w: *mut Worker = workers.last_mut().unwrap();
        // SAFETY: w points into workers; Vec will not reallocate (capacity == k)
        unsafe {
            (*w).out.worker = w;
            (*w).err.worker = w;
        }
    }

    let mut coord = Coordinator {
        // SAFETY: see vm_ptr note above.
        vm: unsafe { &*vm_ptr },
        // SAFETY: see vm_ptr note above; `event_loop()` returns its live JS loop.
        event_loop_handle: unsafe {
            bun_jsc::EventLoopHandle::init((*vm_ptr).event_loop().cast::<()>())
        },
        reporter,
        files: sorted,
        costs,
        // SAFETY: FileSystem singleton is initialized before any test runner code runs.
        cwd: FileSystem::get().top_level_dir,
        argv,
        envps,
        // Coordinator borrows the workers slice while each Worker holds a raw
        // backref to the Coordinator; the raw pointers (never a second `&mut`)
        // are what keep this sound. See the backref patch loop below.
        workers: &mut workers,
        parallel_limit: k,
        scale_up_after_ms: if let Some(d) = ctx.test_options.parallel_delay_ms {
            i64::from(d)
        } else if let Some(s) = env.get(b"BUN_TEST_PARALLEL_SCALE_MS") {
            bun_core::fmt::parse_int::<i64>(s, 10)
                .unwrap_or(DEFAULT_SCALE_UP_AFTER_MS)
                .max(0)
        } else {
            DEFAULT_SCALE_UP_AFTER_MS
        },
        bail: ctx.test_options.bail,
        dots: ctx.test_options.reporters.dots,
        test_records: if ctx.test_options.reporters.junit {
            (0..n).map(|_| Default::default()).collect()
        } else {
            Vec::new()
        },
        coverage_files: Default::default(),
        last_header_idx: None,
        frame: Frame::default(),
        files_done: 0,
        spawned_count: 0,
        live_workers: 0,
        crashed_files: Vec::new(),
        aborted: None,
        stop_reason: None,
        last_printed_dot: false,
        #[cfg(windows)]
        windows_job: Coordinator::create_windows_kill_on_close_job(),
    };

    let _abort_guard = abort_handler::install();

    // Patch the Worker→Coordinator backref now that `coord`'s address is fixed.
    // Access workers through `coord.workers` to avoid a second &mut on the Vec.
    {
        // `&raw mut` so the stored `*const` backref keeps write provenance —
        // Worker mutates the Coordinator through `coord.cast_mut()`. This only
        // removes the read-only-provenance layer of UB: `coord.drive()` below
        // is called through a fresh `&mut coord` and the backref writes happen
        // during drive(), so the aliasing remains UB-adjacent under
        // Stacked/Tree Borrows. Full fix = `*mut` backref or interior
        // mutability (see `Worker.coord` field doc).
        let coord_ptr = (&raw mut coord).cast::<Coordinator<'static>>().cast_const();
        for w in coord.workers.iter_mut() {
            w.coord = coord_ptr;
        }
    }

    // SAFETY: event_loop pointer is valid while vm lives.
    unsafe { (*(*vm_ptr).event_loop()).ensure_waker() };
    // SAFETY: see vm_ptr note above.
    unsafe { &*vm_ptr }.run_with_api_lock(|| coord.drive());
    coord.end_group();

    aggregate::replay_test_records(&mut coord);
    if coverage_opts.enabled {
        aggregate::write_coverage_report(&mut coord, coverage_opts);
    }
    if let Some(code) = coord.aborted {
        coord.reporter.write_junit_report_if_needed();
        coord.reporter.write_timings_if_needed();
        Output::flush();
        Global::exit(code);
    }
    Ok(true)
}

/// Build the argv used for every worker (re)spawn. Forwards every `bun test`
/// flag that affects how tests *execute inside* a worker, plus `--dots` and
/// `--only-failures` since the worker formats result lines and the coordinator
/// prints them verbatim. `--reporter=junit` is forwarded (without the outfile)
/// so workers attach the per-test detail the coordinator's JunitReporter
/// needs. Coordinator-only concerns — file discovery
/// (`--path-ignore-patterns`, `--changed`), `--reporter-outfile`,
/// `--pass-with-no-tests`, `--parallel` itself — are intentionally not
/// forwarded.
fn build_worker_argv(ctx: &Command::ContextData) -> crate::Result<Box<[bun_spawn::CStrPtr]>> {
    // Null-sentinel slice of C-string pointers. String storage routes through
    // the process-lifetime CLI arena (bulk-freed on exit).
    let mut argv: Vec<bun_spawn::CStrPtr> = Vec::new();
    let opts = &ctx.test_options;

    // Helper: format → NUL-terminated, return raw ptr (arena-owned).
    let print_z = |args: core::fmt::Arguments<'_>| -> crate::Result<*const c_char> {
        let mut buf = Vec::<u8>::new();
        buf.write_fmt(args)
            .map_err(|_| crate::Error::FormatFailed)?;
        Ok(crate::cli::cli_dupe_z(&buf))
    };
    let dupe_z = |s: &[u8]| -> *const c_char { crate::cli::cli_dupe_z(s) };
    let lit = |s: &'static [u8]| -> *const c_char { s.as_ptr().cast::<c_char>() };

    argv.push(
        bun_core::self_exe_path()
            .map_err(|_| crate::Error::SelfExePathFailed)?
            .as_ptr(),
    );
    argv.push(lit(b"test\0"));
    argv.push(lit(b"--test-worker\0"));
    argv.push(if opts.isolate {
        lit(b"--isolate\0")
    } else {
        lit(b"--no-isolate\0")
    });

    argv.push(print_z(format_args!(
        "--timeout={}",
        opts.default_timeout_ms
    ))?);
    if opts.run_todo {
        argv.push(lit(b"--todo\0"));
    }
    if opts.only {
        argv.push(lit(b"--only\0"));
    }
    if opts.reporters.dots {
        argv.push(lit(b"--dots\0"));
    }
    if opts.reporters.only_failures {
        argv.push(lit(b"--only-failures\0"));
    }
    if opts.reporters.junit {
        argv.push(lit(b"--reporter=junit\0"));
    }
    if opts.update_snapshots {
        argv.push(lit(b"--update-snapshots\0"));
    }
    if opts.concurrent {
        argv.push(lit(b"--concurrent\0"));
    }
    if opts.randomize {
        argv.push(lit(b"--randomize\0"));
    }
    if let Some(seed) = opts.seed {
        argv.push(print_z(format_args!("--seed={}", seed))?);
    }
    // --bail is intentionally NOT forwarded: workers Global.exit(1) on bail
    // (see test_command.rs handle_test_completed), which the coordinator would
    // misread as a crash. Cross-worker bail is handled at file granularity by
    // the coordinator instead.
    if opts.repeat_count > 0 {
        argv.push(print_z(format_args!("--rerun-each={}", opts.repeat_count))?);
    }
    if opts.retry > 0 {
        argv.push(print_z(format_args!("--retry={}", opts.retry))?);
    }
    argv.push(print_z(format_args!(
        "--max-concurrency={}",
        opts.max_concurrency
    ))?);
    if let Some(pattern) = &opts.test_filter_pattern {
        argv.push(lit(b"-t\0"));
        argv.push(dupe_z(pattern));
    }
    for preload in ctx.preloads.iter() {
        argv.push(lit(b"--preload\0"));
        argv.push(dupe_z(preload));
    }
    if let Some(define) = &ctx.args.define {
        debug_assert_eq!(define.keys.len(), define.values.len());
        for (key, value) in define.keys.iter().zip(define.values.iter()) {
            argv.push(lit(b"--define\0"));
            argv.push(print_z(format_args!(
                "{}={}",
                bstr::BStr::new(key),
                bstr::BStr::new(value)
            ))?);
        }
    }
    if let Some(loaders) = &ctx.args.loaders {
        debug_assert_eq!(loaders.extensions.len(), loaders.loaders.len());
        for (ext, loader) in loaders.extensions.iter().zip(loaders.loaders.iter()) {
            argv.push(lit(b"--loader\0"));
            argv.push(print_z(format_args!(
                "{}:{}",
                bstr::BStr::new(ext),
                api_loader_tag_name(*loader)
            ))?);
        }
    }
    if let Some(tsconfig) = &ctx.args.tsconfig_override {
        argv.push(lit(b"--tsconfig-override\0"));
        argv.push(dupe_z(tsconfig));
    }
    // Was `inline for` over a heterogeneous-ish tuple; all elements are
    // (&'static [u8], &[Box<[u8]>]) so a const array + plain for suffices.
    // No `--env-file`: a worker loads no env file (see `TestCommand::exec`).
    let multi_value_flags: [(&'static [u8], &[Box<[u8]>]); 5] = [
        (b"--conditions\0", &ctx.args.conditions),
        (b"--drop\0", &ctx.args.drop),
        (b"--main-fields\0", &ctx.args.main_fields),
        (b"--extension-order\0", &ctx.args.extension_order),
        (b"--feature\0", &ctx.args.feature_flags),
    ];
    for (flag, values) in multi_value_flags {
        for value in values {
            argv.push(flag.as_ptr().cast::<c_char>());
            argv.push(dupe_z(value));
        }
    }
    if ctx.args.preserve_symlinks.unwrap_or(false) {
        argv.push(lit(b"--preserve-symlinks\0"));
    }
    if ctx.runtime_options.smol {
        argv.push(lit(b"--smol\0"));
    }
    if ctx.runtime_options.experimental_http2_fetch {
        argv.push(lit(b"--experimental-http2-fetch\0"));
    }
    if ctx.runtime_options.experimental_http3_fetch {
        argv.push(lit(b"--experimental-http3-fetch\0"));
    }
    if ctx.args.allow_addons == Some(false) {
        argv.push(lit(b"--no-addons\0"));
    }
    if ctx.args.allow_ffi_cc == Some(false) {
        argv.push(lit(b"--no-ffi-cc\0"));
    }
    if matches!(ctx.debug.macros, MacroOptions::Disable) {
        argv.push(lit(b"--no-macros\0"));
    }
    if let Some(jsx) = &ctx.args.jsx {
        if !jsx.factory.is_empty() {
            argv.push(print_z(format_args!(
                "--jsx-factory={}",
                bstr::BStr::new(&jsx.factory)
            ))?);
        }
        if !jsx.fragment.is_empty() {
            argv.push(print_z(format_args!(
                "--jsx-fragment={}",
                bstr::BStr::new(&jsx.fragment)
            ))?);
        }
        if !jsx.import_source.is_empty() {
            argv.push(print_z(format_args!(
                "--jsx-import-source={}",
                bstr::BStr::new(&jsx.import_source)
            ))?);
        }
        argv.push(print_z(format_args!(
            "--jsx-runtime={}",
            jsx_runtime_tag_name(jsx.runtime)
        ))?);
        if jsx.side_effects {
            argv.push(lit(b"--jsx-side-effects\0"));
        }
    }
    if opts.coverage.enabled {
        argv.push(lit(b"--coverage\0"));
    }

    argv.push(core::ptr::null());
    // Callers index by .len(), so keep the trailing null in the boxed slice.
    Ok(argv.into_boxed_slice())
}

/// Local shim for `@tagName(loader)` — `bun_options_types::schema::api::Loader`
/// has no `From<Loader> for &str` impl upstream.
fn api_loader_tag_name(l: bun_options_types::schema::api::Loader) -> &'static str {
    use bun_options_types::schema::api::Loader as L;
    match l {
        L::jsx => "jsx",
        L::js => "js",
        L::ts => "ts",
        L::tsx => "tsx",
        L::css => "css",
        L::file => "file",
        L::json => "json",
        L::jsonc => "jsonc",
        L::toml => "toml",
        L::wasm => "wasm",
        L::napi => "napi",
        L::base64 => "base64",
        L::dataurl => "dataurl",
        L::text => "text",
        L::bunsh => "bunsh",
        L::sqlite => "sqlite",
        L::sqlite_embedded => "sqlite_embedded",
        L::html => "html",
        L::yaml => "yaml",
        L::json5 => "json5",
        L::md => "md",
        L::xml => "xml",
        L::_none => "_none",
    }
}

/// Local shim for `@tagName(jsx.runtime)`.
fn jsx_runtime_tag_name(r: bun_options_types::schema::api::JsxRuntime) -> &'static str {
    use bun_options_types::schema::api::JsxRuntime as J;
    match r {
        J::Automatic => "automatic",
        J::Classic => "classic",
        J::Solid => "solid",
        J::_none => "_none",
    }
}

/// Event-loop-driven coordinator ↔ worker channel. The worker pumps
/// `vm.event_loop()` between files instead of sitting in a blocking read(), so
/// any post-swap cleanup the loop owns (timers the generation guard let
/// through, async dispose, etc.) gets to run, and on macOS — where there's no
/// PDEATHSIG — coordinator death surfaces as channel close. Same `Channel`
/// abstraction as the coordinator side: usockets over the socketpair on POSIX,
/// `uv.Pipe` over the inherited duplex named-pipe on Windows.
pub struct WorkerCommands {
    pub(crate) channel: Channel<WorkerCommands>,
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pub(crate) pending_idx: Option<u32>,
    pub(crate) pending_path: Vec<u8>,
    /// EOF, error, `.shutdown`, or a corrupt frame.
    pub(crate) done: bool,
}

impl WorkerCommands {
    pub(crate) fn send(&mut self, frame_bytes: &[u8]) {
        self.channel.send(frame_bytes);
    }
}

bun_core::intrusive_field!(WorkerCommands, channel: Channel<WorkerCommands>);
impl ChannelOwner for WorkerCommands {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        match kind {
            frame::Kind::Run => {
                self.pending_idx = Some(rd.u32());
                self.pending_path.clear();
                self.pending_path.extend_from_slice(rd.str());
            }
            frame::Kind::Shutdown => self.done = true,
            _ => {}
        }
    }

    fn on_channel_done(&mut self) {
        self.done = true;
    }
}

// Hoisted from a local struct inside run_as_worker — Rust does not
// support method-bearing local structs that need to be named in a generic call.
struct WorkerLoop {
    reporter: &'static CommandLineReporter,
    vm: *mut VirtualMachine,
    cmds: WorkerCommands,
}

impl WorkerLoop {
    fn begin(&mut self) {
        // SAFETY: vm pointer is valid for the worker's lifetime.
        let vm = unsafe { &mut *self.vm };
        if !Channel::adopt(&raw mut self.cmds.channel, vm, Fd::from_uv(3)) {
            bun_core::pretty_errorln!("<red>error<r>: test worker failed to adopt IPC fd");
            Global::exit(1);
        }
        // SAFETY: single-threaded worker; WORKER_CMDS is only read on this thread
        unsafe {
            WORKER_CMDS.write(Some(&raw mut self.cmds));
        }

        // Test hook: "abort" dies by SIGABRT (the startup-panic branch),
        // anything else exits 1 (the bounded-respawn branch). Real init
        // failures aren't reproducible from a test. Debug/ASAN builds only,
        // so a stray env var can't disable --parallel in a release build.
        if cfg!(any(debug_assertions, bun_asan)) {
            // SAFETY: env loader is initialized before the test runner runs.
            let env = unsafe { &*vm.transpiler.env };
            if let Some(mode) = env.get(b"BUN_TEST_WORKER_EXIT_BEFORE_READY") {
                bun_core::pretty_errorln!(
                    "test worker exiting before ready (BUN_TEST_WORKER_EXIT_BEFORE_READY)"
                );
                Output::flush();
                if bun_core::strings::eql(mode, b"abort") {
                    std::process::abort();
                }
                Global::exit(1);
            }
        }

        // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer
        let wf = unsafe { &mut *WORKER_FRAME.get() };
        wf.begin(frame::Kind::Ready);
        self.cmds.send(wf.finish());

        loop {
            while self.cmds.pending_idx.is_none() && !self.cmds.done {
                vm.event_loop_ref().tick();
                if self.cmds.pending_idx.is_some() || self.cmds.done {
                    break;
                }
                vm.event_loop_ref().auto_tick();
            }
            let Some(idx) = self.cmds.pending_idx else {
                break;
            };
            self.cmds.pending_idx = None;

            self.reporter.worker_ipc_file_idx.set(Some(idx));
            wf.begin(frame::Kind::FileStart);
            wf.u32(idx);
            self.cmds.send(wf.finish());

            let before = *self.reporter.summary();
            let before_unhandled = self.reporter.jest.unhandled_errors_between_tests.get();
            let started_ns =
                bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns();

            // A worker never knows which file is its last, so preload-level hooks wrap every file (with or without --isolate).
            if let Err(err) = TestCommand::run(
                self.reporter,
                vm,
                self.cmds.pending_path.as_slice(),
                FirstLast {
                    first: true,
                    last: true,
                },
            ) {
                test_command::handle_top_level_test_error_before_javascript_start(&err);
            }
            if vm.test_isolation_enabled {
                crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
                vm.swap_global_for_test_isolation();
                self.reporter
                    .jest
                    .bun_test_root
                    .reset_hook_scope_for_test_isolation();
            } else {
                Global::mimalloc_cleanup(false);
            }
            self.reporter.jest.default_timeout_override.set(u32::MAX);

            let elapsed_ns = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
                .ns()
                .saturating_sub(started_ns);

            let after = *self.reporter.summary();
            wf.begin(frame::Kind::FileDone);
            for v in [
                idx,
                after.pass - before.pass,
                after.fail - before.fail,
                after.skip - before.skip,
                after.todo - before.todo,
                after.expectations - before.expectations,
                after.skipped_because_label - before.skipped_because_label,
                after.files - before.files,
                self.reporter.jest.unhandled_errors_between_tests.get() - before_unhandled,
            ] {
                wf.u32(v);
            }
            wf.u64(elapsed_ns);
            self.cmds.send(wf.finish());
        }
    }
}

/// Worker side: read framed commands from the IPC channel via the event loop,
/// run each file with isolation, stream per-test events back. Never returns.
///
/// # Safety
/// `vm` must be a valid, exclusively-accessed pointer to a live `VirtualMachine`
/// for the entire duration of the call (i.e. for the rest of the process, since
/// this never returns).
// `vm` must stay a raw pointer: it is stored in `WorkerLoop`/`WorkerCommands`
// while a `&mut` derived from it (`vm_ref`) is also live, so a reference param
// would alias. The `# Safety` contract above documents the caller's obligation.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub(crate) fn run_as_worker(
    reporter: &'static CommandLineReporter,
    vm: *mut VirtualMachine,
    ctx: Command::Context,
) -> ! {
    // SAFETY: caller guarantees `vm` is a valid live VM pointer for the duration.
    let vm_ref = unsafe { &mut *vm };
    vm_ref.test_isolation_enabled = ctx.test_options.isolate;
    vm_ref.auto_killer.enabled = ctx.test_options.isolate;

    // `vm.arena` is currently a write-only backref: the `MimallocArena.gc()`
    // reader was dropped from the GC path (see web_worker.rs, which wires its
    // own arena the same way and notes the dropped read).
    let mut arena = bun_alloc::MimallocArena::new();
    // SAFETY: event_loop pointer is valid while vm lives.
    unsafe { (*vm_ref.event_loop()).ensure_waker() };
    vm_ref.arena = Some(NonNull::from(&mut arena));
    // vm.allocator = arena.arena(); — allocator params dropped in Rust

    let mut wloop = WorkerLoop {
        reporter,
        vm,
        cmds: WorkerCommands {
            channel: Channel::default(),
            pending_idx: None,
            pending_path: Vec::new(),
            done: false,
        },
    };
    vm_ref.run_with_api_lock(|| wloop.begin());

    worker_flush_aggregates(wloop.reporter, vm_ref, ctx, &mut wloop.cmds);
    // Drain any backpressure-buffered frames before exit so the coordinator
    // sees repeat_bufs / coverage_file.
    while wloop.cmds.channel.has_pending_writes() && !wloop.cmds.channel.done.get() {
        // SAFETY: event_loop pointer is valid while vm lives.
        unsafe { (*vm_ref.event_loop()).tick() };
        if !wloop.cmds.channel.has_pending_writes() || wloop.cmds.channel.done.get() {
            break;
        }
        // SAFETY: event_loop pointer is valid while vm lives.
        unsafe { (*vm_ref.event_loop()).auto_tick() };
    }
    // Mirror TestCommand::exec's exit path so BUN_DESTRUCT_VM_ON_EXIT teardown
    // (lastChanceToFinalize) runs; bypassing it leaks JSC-owned native state.
    vm_ref.exit_handler.exit_code = 0;
    vm_ref.exit_handler.skip_exit_listeners = test_command::skip_exit_listeners(wloop.reporter);
    vm_ref.run_with_api_lock(|| {
        // SAFETY: caller guarantees `vm` is a valid live VM pointer for the worker's lifetime.
        unsafe {
            (*vm).on_exit();
            (*vm).global_exit()
        }
    });
    {
        Global::exit(0);
    }
}

fn worker_flush_aggregates(
    reporter: &CommandLineReporter,
    vm: &mut VirtualMachine,
    ctx: &Command::ContextData,
    cmds: &mut WorkerCommands,
) {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    if let Some(runner) = crate::test_runner::jest::Jest::runner() {
        let mut snapshots = runner.snapshots.borrow_mut();
        let _ = snapshots.write_inline_snapshots().unwrap_or(false);
        let _ = snapshots.write_snapshot_file();
    }

    // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer
    let wf = unsafe { &mut *WORKER_FRAME.get() };

    wf.begin(frame::Kind::RepeatBufs);
    wf.str(reporter.failures_to_repeat_buf.borrow().as_slice());
    wf.str(reporter.skips_to_repeat_buf.borrow().as_slice());
    wf.str(reporter.todos_to_repeat_buf.borrow().as_slice());
    cmds.send(wf.finish());

    if ctx.test_options.coverage.enabled {
        let mut encoded: Vec<u8> = Vec::new();
        CommandLineReporter::for_each_coverage_report(vm, &ctx.test_options.coverage, |report| {
            encoded.clear();
            code_coverage::wire::encode(&report, &mut encoded);
            wf.begin(frame::Kind::CoverageFile);
            wf.str(&encoded);
            cmds.send(wf.finish());
        });
    }
}

/// Reused across all worker → coordinator emits.
// PORTING.md §Global mutable state: only accessed from the single worker
// thread after run_as_worker begins → RacyCell.
static WORKER_FRAME: bun_core::RacyCell<Frame> = bun_core::RacyCell::new(Frame::DEFAULT);

/// Set in `run_as_worker` so `worker_emit_test_done` (called from
/// `CommandLineReporter.handleTestCompleted`) can reach the channel.
// PORTING.md §Global mutable state: single-worker-thread ptr slot → RacyCell.
static WORKER_CMDS: bun_core::RacyCell<Option<*mut WorkerCommands>> = bun_core::RacyCell::new(None);
// Lifetime note: stores an 'a-bound pointer as 'static; sound because the
// pointee outlives all callers (process exits before it's dropped).

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes), which the coordinator prints verbatim so output matches serial, and,
/// when the coordinator asked for it (`--reporter`), the structured result it
/// replays into its own reporters.
pub(crate) fn worker_emit_test_done(
    file_idx: u32,
    formatted_line: &[u8],
    test: Option<&test_command::TestCaseReport<'_>>,
) {
    // SAFETY: single-threaded worker; WORKER_CMDS only written/read on this thread.
    let Some(cmds_ptr) = (unsafe { WORKER_CMDS.read() }) else {
        return;
    };
    // SAFETY: cmds_ptr was set from &mut WorkerCommands in run_as_worker; pointee
    // outlives all callers (process exits before it is dropped).
    let cmds = unsafe { &mut *cmds_ptr };
    // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer.
    let wf = unsafe { &mut *WORKER_FRAME.get() };
    wf.begin(frame::Kind::TestDone);
    wf.u32(file_idx);
    wf.str(formatted_line);
    if let Some(test) = test {
        encode_test_case(wf, test);
    }
    cmds.send(wf.finish());
}

fn encode_test_case(wf: &mut Frame, t: &test_command::TestCaseReport<'_>) {
    wf.u32(t.status as u32);
    wf.u32(t.assertions);
    wf.u64(t.elapsed_ns);
    wf.u32(t.line_number);
    wf.str(t.name);
    wf.u32(u32::try_from(t.scopes.len()).expect("int cast"));
    for &(name, line) in &t.scopes {
        wf.str(name);
        wf.u32(line);
    }
    match &t.failure {
        None => wf.u32(0),
        Some(f) => {
            wf.u32(1);
            wf.str(&f.name);
            wf.str(&f.message);
            wf.str(&f.body);
        }
    }
}

/// Inverse of `encode_test_case`; strings borrow the frame payload. The file
/// isn't on the wire: the frame's `file_idx` names it.
pub(crate) fn decode_test_case<'a>(
    rd: &mut frame::Reader<'a>,
    file: &'a [u8],
) -> Option<test_command::TestCaseReport<'a>> {
    use crate::test_runner::execution::Result;
    let status =
        Result::from_repr(u8::try_from(rd.u32()).ok()?).filter(|s| *s != Result::Pending)?;
    let assertions = rd.u32();
    let elapsed_ns = rd.u64();
    let line_number = rd.u32();
    let name = rd.str();
    let n = rd.u32() as usize;
    if n > 64 {
        return None;
    }
    let mut scopes = Vec::with_capacity(n);
    for _ in 0..n {
        scopes.push((rd.str(), rd.u32()));
    }
    let failure = (rd.u32() != 0).then(|| test_command::TestFailure {
        name: rd.str().to_vec(),
        message: rd.str().to_vec(),
        body: rd.str().to_vec(),
    });
    Some(test_command::TestCaseReport {
        file,
        scopes,
        name,
        status,
        assertions,
        elapsed_ns,
        line_number,
        failure,
    })
}
