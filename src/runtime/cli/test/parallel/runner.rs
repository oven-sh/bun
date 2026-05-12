//! Coordinator and worker entry points: `run_as_coordinator` (sets up the
//! `Coordinator`, sorts/partitions files, drives the loop, merges fragments)
//! and `run_as_worker` (the `--test-worker` side that reads framed commands
//! from stdin, runs each file under isolation, and streams results to fd 3).

use core::ffi::c_char;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_core::PathString;
use bun_core::ZBox;
use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::MacroOptions;
use bun_resolver::fs::{FileSystem, RealFS};
use bun_sys::{Fd, FdDirExt, FdExt};

use super::aggregate;
use super::channel::{Channel, ChannelOwner};
use super::coordinator::{Coordinator, abort_handler};
use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::worker::{PipeRole, Worker, WorkerPipe};
use crate::Command;
#[cfg(unix)]
use crate::api::bun::process::PosixStdio as Stdio;
#[cfg(not(unix))]
use crate::api::bun::process::WindowsStdio as Stdio;
use crate::test_command::{self, CommandLineReporter, TestCommand};
use crate::test_runner::bun_test::FirstLast;
use bun_options_types::code_coverage_options::CodeCoverageOptions;

// TODO(port): `format_bytes!` placeholder — needs a macro that writes fmt args
// into a Vec<u8> (no UTF-8 validation). Define in bun_core or use
// `{ let mut v = Vec::new(); write!(&mut v, ...).unwrap(); v }` inline.
macro_rules! format_bytes {
    ($($arg:tt)*) => {{
        let mut __v: Vec<u8> = Vec::new();
        ::std::io::Write::write_fmt(&mut __v, format_args!($($arg)*)).unwrap();
        __v
    }};
}

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
pub const DEFAULT_SCALE_UP_AFTER_MS: i64 = 5;

/// Owns the coordinator-side per-run worker temp directory path bytes;
/// recursively removes it on drop. Mirrors the Zig
/// `defer if (worker_tmpdir) |d| bun.FD.cwd().deleteTree(d) catch {}`.
/// Zig stored a `[:0]const u8` whose `.len` excludes the sentinel; here we
/// store the bare path with no trailing NUL so `path()`/Drop hand the exact
/// same bytes to `delete_tree` that `make_path` created.
struct WorkerTmpdir(Option<Box<[u8]>>);

impl WorkerTmpdir {
    #[inline]
    fn path(&self) -> Option<&[u8]> {
        self.0.as_deref()
    }
}

impl Drop for WorkerTmpdir {
    fn drop(&mut self) {
        if let Some(d) = &self.0 {
            let _ = Fd::cwd().delete_tree(d);
        }
    }
}

/// Returns true if files were actually run via the worker pool, false if it
/// fell back to the sequential path (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
pub fn run_as_coordinator(
    reporter: &mut CommandLineReporter,
    vm: *mut VirtualMachine,
    files: &[PathString],
    ctx: Command::Context,
    coverage_opts: &mut CodeCoverageOptions,
) -> Result<bool, bun_core::Error> {
    // SAFETY: caller guarantees `vm` is a valid live VM pointer for the duration.
    // Kept as a raw pointer; dereferenced at each use site to sidestep borrowck
    // around the self-referential Coordinator/Worker graph.
    let vm_ptr = vm;
    // SAFETY: env loader is initialized before the test runner runs.
    let env = unsafe { &mut *(*vm_ptr).transpiler.env };
    // TODO(port): narrow error set
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

    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B

    // Owned path bytes (Zig: `[:0]const u8` from allocPrintSentinel — the
    // sentinel was for C interop only, `.len` excluded it). ZStr is a borrow
    // header; we must own the backing storage here. Drop recursively removes
    // the directory once the run finishes.
    let mut worker_tmpdir = WorkerTmpdir(None);
    // Workers' stderr is a pipe; have them format with ANSI when we will be
    // rendering to a color terminal so streamed lines match serial output.
    if Output::enable_ansi_colors_stderr() {
        let _ = env.map.put(b"FORCE_COLOR", b"1");
    }
    if ctx.test_options.reporters.junit || coverage_opts.enabled {
        let pid: i64 = {
            #[cfg(windows)]
            {
                bun_sys::windows::GetCurrentProcessId() as i64
            }
            #[cfg(not(windows))]
            {
                // SAFETY: getpid is always safe
                unsafe { libc::getpid() as i64 }
            }
        };
        // TODO(port): allocPrintSentinel — was arena-backed; sentinel dropped (no C-string consumer on this path)
        let dir: Box<[u8]> = format_bytes!(
            "{}/bun-test-worker-{}",
            bstr::BStr::new(RealFS::get_default_temp_dir()),
            pid
        )
        .into_boxed_slice();
        let dir_bytes: &[u8] = &dir;
        if let Err(e) = Fd::cwd().make_path(dir_bytes) {
            Output::err(
                e,
                "failed to create worker temp dir {}",
                &[&bstr::BStr::new(dir_bytes)],
            );
            Global::exit(1);
        }
        let _ = env.map.put(b"BUN_TEST_WORKER_TMP", dir_bytes);
        // Coordinator's own JunitReporter would otherwise produce an empty
        // document and overwrite the merged one in writeJUnitReportIfNeeded.
        if let Some(jr) = reporter.reporters.junit.take() {
            let _ = env.map.put(b"BUN_TEST_WORKER_JUNIT", b"1");
            drop(jr);
            // reporter.reporters.junit already None via .take()
        }
        worker_tmpdir.0 = Some(dir);
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
    let mut sorted: Vec<PathString> = files.to_vec();
    if !ctx.test_options.randomize {
        sorted.sort_by(|a, b| bun_core::order(a.slice(), b.slice()));
    }

    let mut workers: Vec<Worker> = Vec::with_capacity(k as usize);
    // TODO(port): Zig allocates uninitialized then assigns in-place; Rust pushes
    // constructed values. Populate fully BEFORE constructing Coordinator so it
    // can hold `&mut [Worker]` without aliasing the push loop. The `coord`
    // backref is null here and patched once Coordinator's address is fixed.
    for i in 0..k {
        let idx: u32 = i;
        workers.push(Worker {
            // BACKREF (LIFETIMES.tsv: *const Coordinator<'static>) — patched below
            coord: core::ptr::null(),
            idx,
            range: FileRange {
                lo: idx * n / k,
                hi: (idx + 1) * n / k,
            },
            out: WorkerPipe::new(PipeRole::Stdout, core::ptr::null()),
            err: WorkerPipe::new(PipeRole::Stderr, core::ptr::null()),
            process: None,
            ipc: Channel::default(),
            inflight: None,
            dispatched_at: 0,
            captured: Vec::new(),
            alive: false,
            exit_status: None,
            extra_fd_stdio: [Stdio::Ignore],
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
        event_loop_handle: bun_jsc::EventLoopHandle::init(
            unsafe { (*vm_ptr).event_loop() }.cast::<()>(),
        ),
        reporter,
        files: sorted,
        // SAFETY: FileSystem singleton is initialized before any test runner code runs.
        cwd: FileSystem::get().top_level_dir,
        argv,
        envps,
        workers: &mut workers, // TODO(port): lifetime — Coordinator borrows workers slice
        worker_tmpdir: worker_tmpdir.path(),
        parallel_limit: k,
        scale_up_after_ms: if let Some(d) = ctx.test_options.parallel_delay_ms {
            i64::try_from(d).unwrap()
        } else if let Some(s) = env.get(b"BUN_TEST_PARALLEL_SCALE_MS") {
            bun_core::fmt::parse_int::<i64>(s, 10)
                .unwrap_or(DEFAULT_SCALE_UP_AFTER_MS)
                .max(0)
        } else {
            DEFAULT_SCALE_UP_AFTER_MS
        },
        bail: ctx.test_options.bail,
        dots: ctx.test_options.reporters.dots,
        junit_fragments: Vec::new(),
        coverage_fragments: Vec::new(),
        last_header_idx: None,
        frame: Frame::default(),
        files_done: 0,
        spawned_count: 0,
        live_workers: 0,
        crashed_files: Vec::new(),
        bailed: false,
        last_printed_dot: false,
        #[cfg(windows)]
        windows_job: Coordinator::create_windows_kill_on_close_job(),
    };

    let _abort_guard = abort_handler::install();

    // Patch the Worker→Coordinator backref now that `coord`'s address is fixed.
    // Access workers through `coord.workers` to avoid a second &mut on the Vec.
    {
        let coord_ptr = (&raw const coord).cast::<Coordinator<'static>>();
        for w in coord.workers.iter_mut() {
            w.coord = coord_ptr;
        }
    }

    // SAFETY: event_loop pointer is valid while vm lives.
    unsafe { (*(*vm_ptr).event_loop()).ensure_waker() };
    // SAFETY: see vm_ptr note above.
    unsafe { &*vm_ptr }.run_with_api_lock(|| coord.drive());

    if ctx.test_options.reporters.junit {
        if let Some(outfile) = &ctx.test_options.reporter_outfile {
            // `coord` holds the unique &mut to `reporter`; obtain the summary
            // through it. Raw-pointer reborrow because merge_junit_fragments
            // also needs &mut coord (it only reads from summary).
            let summary_ptr: *const crate::test_runner::jest::Summary = coord.reporter.summary();
            // SAFETY: summary lives in *coord.reporter, which outlives this call
            // and is not mutated by merge_junit_fragments.
            aggregate::merge_junit_fragments(&mut coord, outfile, unsafe { &*summary_ptr });
        }
    }
    if coverage_opts.enabled {
        let frags: Vec<&[u8]> = coord
            .coverage_fragments
            .iter()
            .map(|b| b.as_ref())
            .collect();
        if Output::enable_ansi_colors_stderr() {
            aggregate::merge_coverage_fragments::<true>(&frags, coverage_opts);
        } else {
            aggregate::merge_coverage_fragments::<false>(&frags, coverage_opts);
        }
    }
    Ok(true)
}

/// Build the argv used for every worker (re)spawn. Forwards every `bun test`
/// flag that affects how tests *execute inside* a worker, plus `--dots` and
/// `--only-failures` since the worker formats result lines and the coordinator
/// prints them verbatim. Coordinator-only concerns — file discovery
/// (`--path-ignore-patterns`, `--changed`), `--reporter`/`--reporter-outfile`,
/// `--pass-with-no-tests`, `--parallel` itself — are intentionally not
/// forwarded.
fn build_worker_argv(
    ctx: &Command::ContextData,
) -> Result<Box<[bun_spawn::CStrPtr]>, bun_core::Error> {
    // Zig `[:null]?[*:0]const u8` — null-sentinel slice of C-string pointers.
    // String storage was arena-owned in Zig; route through the process-lifetime
    // CLI arena (bulk-freed on exit).
    let mut argv: Vec<bun_spawn::CStrPtr> = Vec::new();
    let opts = &ctx.test_options;

    // Helper: format → NUL-terminated, return raw ptr (arena-owned).
    let print_z = |args: core::fmt::Arguments<'_>| -> Result<*const c_char, bun_core::Error> {
        let mut buf = Vec::<u8>::new();
        buf.write_fmt(args)
            .map_err(|_| bun_core::err!("FormatFailed"))?;
        Ok(crate::cli::cli_dupe_z(&buf))
    };
    let dupe_z = |s: &[u8]| -> *const c_char { crate::cli::cli_dupe_z(s) };
    let lit = |s: &'static [u8]| -> *const c_char { s.as_ptr().cast::<c_char>() };

    argv.push(
        bun_core::self_exe_path()
            .map_err(|_| bun_core::err!("SelfExePathFailed"))?
            .as_ptr(),
    );
    argv.push(lit(b"test\0"));
    argv.push(lit(b"--test-worker\0"));
    argv.push(lit(b"--isolate\0"));

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
    // (test_command.zig handleTestCompleted), which the coordinator would
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
    // PORT NOTE: was `inline for` over heterogeneous-ish tuple; all elements are
    // (&'static [u8], &[Box<[u8]>]) so a const array + plain for suffices.
    let multi_value_flags: [(&'static [u8], &[Box<[u8]>]); 6] = [
        (b"--conditions\0", &ctx.args.conditions),
        (b"--drop\0", &ctx.args.drop),
        (b"--main-fields\0", &ctx.args.main_fields),
        (b"--extension-order\0", &ctx.args.extension_order),
        (b"--env-file\0", &ctx.args.env_files),
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
    if matches!(ctx.debug.macros, MacroOptions::Disable) {
        argv.push(lit(b"--no-macros\0"));
    }
    if ctx.args.disable_default_env_files {
        argv.push(lit(b"--no-env-file\0"));
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
    // Zig: `argv.items[0 .. argv.items.len - 1 :null]` — sentinel slice excluding
    // the trailing null from len but keeping it as sentinel. Rust callers index
    // by .len() so we keep the None in the boxed slice.
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
    pub vm: *mut VirtualMachine,
    // TODO(port): Channel(WorkerCommands, "channel") — second comptime arg is
    // the field name for intrusive container_of recovery; encode via offset_of
    // or trait impl in Phase B.
    pub channel: Channel<WorkerCommands>,
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pub pending_idx: Option<u32>,
    pub pending_path: Vec<u8>,
    /// EOF, error, `.shutdown`, or a corrupt frame.
    pub done: bool,
}

impl WorkerCommands {
    pub fn send(&mut self, frame_bytes: &[u8]) {
        self.channel.send(frame_bytes);
    }
}

bun_core::intrusive_field!(WorkerCommands, channel: Channel<WorkerCommands>);
impl ChannelOwner for WorkerCommands {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        match kind {
            frame::Kind::Run => {
                self.pending_idx = Some(rd.u32_());
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

// PORT NOTE: hoisted from local struct inside run_as_worker — Rust does not
// support method-bearing local structs that need to be named in a generic call.
struct WorkerLoop<'a> {
    reporter: &'a mut CommandLineReporter,
    vm: *mut VirtualMachine,
    cmds: WorkerCommands,
}

impl<'a> WorkerLoop<'a> {
    pub fn begin(&mut self) {
        // SAFETY: vm pointer is valid for the worker's lifetime.
        let vm = unsafe { &mut *self.vm };
        if !self.cmds.channel.adopt(vm, Fd::from_uv(3)) {
            Output::pretty_errorln("<red>error<r>: test worker failed to adopt IPC fd");
            Global::exit(1);
        }
        // SAFETY: single-threaded worker; WORKER_CMDS is only read on this thread
        unsafe {
            WORKER_CMDS.write(Some(&raw mut self.cmds));
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

            self.reporter.worker_ipc_file_idx = Some(idx);
            wf.begin(frame::Kind::FileStart);
            wf.u32_(idx);
            self.cmds.send(wf.finish());

            let before = *self.reporter.summary();
            let before_unhandled = self.reporter.jest.unhandled_errors_between_tests;

            // Workers always run with --isolate; every file is its own
            // complete run from the preload's perspective.
            if let Err(err) = TestCommand::run(
                self.reporter,
                vm,
                self.cmds.pending_path.as_slice(),
                FirstLast {
                    first: true,
                    last: true,
                },
            ) {
                test_command::handle_top_level_test_error_before_javascript_start(err);
            }
            vm.swap_global_for_test_isolation();
            self.reporter
                .jest
                .bun_test_root
                .reset_hook_scope_for_test_isolation();
            self.reporter.jest.default_timeout_override = u32::MAX;

            let after = *self.reporter.summary();
            wf.begin(frame::Kind::FileDone);
            // PORT NOTE: was `inline for (.{...}) |v| worker_frame.u32_(v)` —
            // all elements are u32, so a plain array + for loop is equivalent.
            for v in [
                idx,
                after.pass - before.pass,
                after.fail - before.fail,
                after.skip - before.skip,
                after.todo - before.todo,
                after.expectations - before.expectations,
                after.skipped_because_label - before.skipped_because_label,
                after.files - before.files,
                self.reporter.jest.unhandled_errors_between_tests - before_unhandled,
            ] {
                wf.u32_(v);
            }
            self.cmds.send(wf.finish());
        }
    }
}

/// Worker side: read framed commands from the IPC channel via the event loop,
/// run each file with isolation, stream per-test events back. Never returns.
pub fn run_as_worker(
    reporter: &mut CommandLineReporter,
    vm: *mut VirtualMachine,
    ctx: Command::Context,
) -> ! {
    // SAFETY: caller guarantees `vm` is a valid live VM pointer for the duration.
    let vm_ref = unsafe { &mut *vm };
    vm_ref.test_isolation_enabled = true;
    vm_ref.auto_killer.enabled = true;

    // TODO(port): MimallocArena assigned to vm.arena/vm.allocator — verify
    // whether Rust VM still needs explicit arena wiring or if this is a no-op.
    let mut arena = bun_alloc::MimallocArena::new();
    // SAFETY: event_loop pointer is valid while vm lives.
    unsafe { (*vm_ref.event_loop()).ensure_waker() };
    vm_ref.arena = Some(NonNull::from(&mut arena));
    // vm.allocator = arena.arena(); — allocator params dropped in Rust

    let env = vm_ref.env_loader();
    let worker_tmp = env.get(b"BUN_TEST_WORKER_TMP");
    if env.get(b"BUN_TEST_WORKER_JUNIT").is_some() && reporter.reporters.junit.is_none() {
        reporter.reporters.junit = Some(test_command::JunitReporter::init());
    }

    let mut wloop = WorkerLoop {
        reporter,
        vm,
        cmds: WorkerCommands {
            vm,
            channel: Channel::default(),
            pending_idx: None,
            pending_path: Vec::new(),
            done: false,
        },
    };
    vm_ref.run_with_api_lock(|| wloop.begin());

    worker_flush_aggregates(wloop.reporter, vm_ref, ctx, worker_tmp, &mut wloop.cmds);
    // Drain any backpressure-buffered frames before exit so the coordinator
    // sees repeat_bufs/junit_file/coverage_file.
    while wloop.cmds.channel.has_pending_writes() && !wloop.cmds.channel.done {
        // SAFETY: event_loop pointer is valid while vm lives.
        unsafe { (*vm_ref.event_loop()).tick() };
        if !wloop.cmds.channel.has_pending_writes() || wloop.cmds.channel.done {
            break;
        }
        // SAFETY: event_loop pointer is valid while vm lives.
        unsafe { (*vm_ref.event_loop()).auto_tick() };
    }
    Global::exit(0);
}

fn worker_flush_aggregates(
    reporter: &mut CommandLineReporter,
    vm: &mut VirtualMachine,
    ctx: &Command::ContextData,
    worker_tmp: Option<&[u8]>,
    cmds: &mut WorkerCommands,
) {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    if let Some(runner) = crate::test_runner::jest::Jest::runner() {
        let _ = runner.snapshots.write_inline_snapshots().unwrap_or(false);
        let _ = runner.snapshots.write_snapshot_file();
    }

    // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer
    let wf = unsafe { &mut *WORKER_FRAME.get() };

    wf.begin(frame::Kind::RepeatBufs);
    wf.str(reporter.failures_to_repeat_buf.as_slice());
    wf.str(reporter.skips_to_repeat_buf.as_slice());
    wf.str(reporter.todos_to_repeat_buf.as_slice());
    cmds.send(wf.finish());

    if let Some(dir) = worker_tmp {
        let id: i64 = {
            #[cfg(windows)]
            {
                i64::from(bun_sys::windows::GetCurrentProcessId())
            }
            #[cfg(not(windows))]
            {
                // SAFETY: getpid is always safe
                i64::from(unsafe { libc::getpid() })
            }
        };
        if let Some(junit) = &mut reporter.reporters.junit {
            // TODO(port): allocPrintSentinel → ZBox; was bun.default_allocator (leaked)
            let path =
                ZBox::from_bytes(format_bytes!("{}/w{}.xml", bstr::BStr::new(dir), id).as_slice());
            if !junit.current_file.is_empty() {
                let _ = junit.end_test_suite();
            }
            match junit.write_to_file(&path) {
                Ok(_) => {
                    wf.begin(frame::Kind::JunitFile);
                    wf.str(path.as_bytes());
                    cmds.send(wf.finish());
                }
                Err(e) => {
                    Output::err(
                        e,
                        "failed to write JUnit fragment to {}",
                        &[&bstr::BStr::new(path.as_bytes())],
                    );
                }
            }
        }
        if ctx.test_options.coverage.enabled {
            let path = ZBox::from_bytes(
                format_bytes!("{}/cov{}.lcov", bstr::BStr::new(dir), id).as_slice(),
            );
            match reporter.write_lcov_only(vm, &ctx.test_options.coverage, &path) {
                Ok(_) => {
                    wf.begin(frame::Kind::CoverageFile);
                    wf.str(path.as_bytes());
                    cmds.send(wf.finish());
                }
                Err(e) => {
                    Output::err(
                        e,
                        "failed to write coverage fragment to {}",
                        &[&bstr::BStr::new(path.as_bytes())],
                    );
                }
            }
        }
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
// TODO(port): lifetime — stores a 'a-bound pointer as 'static; sound because
// the pointee outlives all callers (process exits before it's dropped).

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes). The coordinator prints these bytes verbatim so output matches serial.
pub fn worker_emit_test_done(file_idx: u32, formatted_line: &[u8]) {
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
    wf.u32_(file_idx);
    wf.str(formatted_line);
    cmds.send(wf.finish());
}

// ported from: src/cli/test/parallel/runner.zig
