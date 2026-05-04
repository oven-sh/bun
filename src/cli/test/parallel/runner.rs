//! Coordinator and worker entry points: `run_as_coordinator` (sets up the
//! `Coordinator`, sorts/partitions files, drives the loop, merges fragments)
//! and `run_as_worker` (the `--test-worker` side that reads framed commands
//! from stdin, runs each file under isolation, and streams results to fd 3).

use core::ffi::c_char;
use std::io::Write as _;

use bun_core::{Global, Output};
use bun_jsc::VirtualMachine;
use bun_str::{PathString, ZStr};
use bun_sys::Fd;

use super::aggregate;
use super::channel::Channel;
use super::coordinator::Coordinator;
use super::frame::{self, Frame};
use super::worker::Worker;
use crate::test_command::{self, CommandLineReporter, TestCommand};
use crate::Command;

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
pub const DEFAULT_SCALE_UP_AFTER_MS: i64 = 5;

/// Returns true if files were actually run via the worker pool, false if it
/// fell back to the sequential path (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
pub fn run_as_coordinator(
    reporter: &mut CommandLineReporter,
    vm: &VirtualMachine,
    files: &[PathString],
    ctx: Command::Context,
    coverage_opts: &mut TestCommand::CodeCoverageOptions,
) -> Result<bool, bun_core::Error> {
    // TODO(port): narrow error set
    let n: u32 = u32::try_from(files.len()).unwrap();
    let k: u32 = ctx.test_options.parallel.min(n);
    if k <= 1 {
        // Jest sets JEST_WORKER_ID=1 even with --maxWorkers=1; match that so
        // tests can rely on the var whenever --parallel is passed.
        vm.transpiler.env.map.put("JEST_WORKER_ID", "1");
        vm.transpiler.env.map.put("BUN_TEST_WORKER_ID", "1");
        TestCommand::run_all_tests(reporter, vm, files);
        return Ok(false);
    }

    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B

    // Owned NUL-terminated path bytes (Zig: `[:0]const u8` from allocPrintSentinel).
    // ZStr is a borrow header; we must own the backing storage here.
    let mut worker_tmpdir: Option<Box<[u8]>> = None;
    // Workers' stderr is a pipe; have them format with ANSI when we will be
    // rendering to a color terminal so streamed lines match serial output.
    if Output::enable_ansi_colors_stderr() {
        vm.transpiler.env.map.put("FORCE_COLOR", "1");
    }
    let _tmpdir_guard = scopeguard::guard((), |_| {
        if let Some(d) = &worker_tmpdir {
            let _ = Fd::cwd().delete_tree(d);
        }
    });
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
        // TODO(port): allocPrintSentinel — was arena-backed; sentinel handling for make_path/delete_tree
        let mut dir = format_bytes!(
            "{}/bun-test-worker-{}",
            bstr::BStr::new(bun_fs::FileSystem::RealFS::get_default_temp_dir()),
            pid
        );
        dir.push(0);
        let dir: Box<[u8]> = dir.into_boxed_slice();
        let dir_bytes = &dir[..dir.len() - 1];
        if let Err(e) = Fd::cwd().make_path(&dir) {
            Output::err(e, "failed to create worker temp dir {}", &[&bstr::BStr::new(dir_bytes)]);
            Global::exit(1);
        }
        vm.transpiler.env.map.put("BUN_TEST_WORKER_TMP", dir_bytes);
        // Coordinator's own JunitReporter would otherwise produce an empty
        // document and overwrite the merged one in writeJUnitReportIfNeeded.
        if let Some(jr) = reporter.reporters.junit.take() {
            vm.transpiler.env.map.put("BUN_TEST_WORKER_JUNIT", "1");
            drop(jr);
            // reporter.reporters.junit already None via .take()
        }
        worker_tmpdir = Some(dir);
    }
    // Each worker gets a unique JEST_WORKER_ID / BUN_TEST_WORKER_ID (1-indexed,
    // matching Jest) so tests can pick distinct ports/databases. Serialize the
    // env map once per worker after .put() — appending after the fact would
    // create duplicate entries when the parent already has the variable set,
    // and POSIX getenv() returns the first match.
    // TODO(port): envp type — Zig `[:null]?[*:0]const u8`; verify FFI shape against spawn
    let mut envps: Vec<Box<[Option<*const c_char>]>> = Vec::with_capacity(k as usize);
    for i in 0..k {
        let mut id = Vec::new();
        write!(&mut id, "{}", i + 1).unwrap();
        vm.transpiler.env.map.put("JEST_WORKER_ID", &id);
        vm.transpiler.env.map.put("BUN_TEST_WORKER_ID", &id);
        envps.push(vm.transpiler.env.map.create_null_delimited_env_map()?);
    }
    let argv = build_worker_argv(&ctx)?;

    // Sort lexicographically so adjacent indices share parent directories.
    // Each worker owns a contiguous chunk; co-located files share imports, so
    // this keeps each worker's isolation SourceProvider cache hot. --randomize
    // explicitly opts out of locality (the caller already shuffled).
    let mut sorted: Vec<PathString> = files.to_vec();
    if !ctx.test_options.randomize {
        sorted.sort_by(|a, b| bun_str::strings::order(a.slice(), b.slice()));
    }

    let mut workers: Vec<Worker> = Vec::with_capacity(k as usize);
    // TODO(port): Zig allocates uninitialized then assigns in-place below; Rust
    // pushes constructed values. Self-referential `out.worker = w` / `err.worker = w`
    // backrefs need raw pointers fixed up after the Vec is fully populated.

    let mut coord = Coordinator {
        vm,
        reporter,
        files: sorted,
        cwd: bun_fs::FileSystem::instance().top_level_dir,
        argv,
        envps,
        workers: &mut workers, // TODO(port): lifetime — Coordinator borrows workers slice
        worker_tmpdir: worker_tmpdir.as_deref(),
        parallel_limit: k,
        scale_up_after_ms: if let Some(d) = ctx.test_options.parallel_delay_ms {
            i64::try_from(d).unwrap()
        } else if let Some(s) = vm.transpiler.env.get("BUN_TEST_PARALLEL_SCALE_MS") {
            // TODO(port): parseInt over &[u8]
            core::str::from_utf8(s)
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(DEFAULT_SCALE_UP_AFTER_MS)
                .max(0)
        } else {
            DEFAULT_SCALE_UP_AFTER_MS
        },
        bail: ctx.test_options.bail,
        dots: ctx.test_options.reporters.dots,
        #[cfg(windows)]
        windows_job: Coordinator::create_windows_kill_on_close_job(),
        #[cfg(not(windows))]
        windows_job: (),
    };

    Coordinator::AbortHandler::install();
    let _abort_guard = scopeguard::guard((), |_| Coordinator::AbortHandler::uninstall());

    for i in 0..k {
        let idx: u32 = i;
        // TODO(port): in-place init — Zig assigns into pre-allocated slot with
        // self-referential `out.worker`/`err.worker` backrefs. Construct then
        // fix up raw backrefs after push.
        workers.push(Worker {
            coord: &coord as *const Coordinator, // BACKREF (LIFETIMES.tsv: *const Coordinator)
            idx,
            range: super::worker::Range { lo: idx * n / k, hi: (idx + 1) * n / k },
            out: super::worker::Stream { role: super::worker::Role::Stdout, worker: core::ptr::null_mut() },
            err: super::worker::Stream { role: super::worker::Role::Stderr, worker: core::ptr::null_mut() },
        });
        let w: *mut Worker = workers.last_mut().unwrap();
        // SAFETY: w points into workers; Vec will not reallocate (capacity == k)
        unsafe {
            (*w).out.worker = w;
            (*w).err.worker = w;
        }
    }

    vm.event_loop().ensure_waker();
    vm.run_with_api_lock(&mut coord, Coordinator::drive);

    if ctx.test_options.reporters.junit {
        if let Some(outfile) = ctx.test_options.reporter_outfile {
            aggregate::merge_junit_fragments(&mut coord, outfile, reporter.summary());
        }
    }
    if coverage_opts.enabled {
        if Output::enable_ansi_colors_stderr() {
            aggregate::merge_coverage_fragments::<true>(coord.coverage_fragments.as_slice(), coverage_opts);
        } else {
            aggregate::merge_coverage_fragments::<false>(coord.coverage_fragments.as_slice(), coverage_opts);
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
fn build_worker_argv(ctx: &Command::Context) -> Result<Box<[Option<*const c_char>]>, bun_core::Error> {
    // TODO(port): return type — Zig `[:null]?[*:0]const u8` (null-sentinel slice
    // of nullable C-strings). String storage was arena-owned in Zig; here strings
    // are leaked/boxed and need an owner. Revisit when spawn signature is ported.
    // PERF(port): was arena bulk-free — profile in Phase B
    let mut argv: Vec<Option<*const c_char>> = Vec::new();
    let opts = &ctx.test_options;

    // Helper: format → NUL-terminated, return raw ptr. Ownership TODO above.
    let print_z = |args: core::fmt::Arguments<'_>| -> Result<*const c_char, bun_core::Error> {
        let mut buf = Vec::<u8>::new();
        buf.write_fmt(args).map_err(|_| bun_core::err!("FormatFailed"))?;
        buf.push(0);
        // TODO(port): leaks — was arena-backed
        Ok(Box::leak(buf.into_boxed_slice()).as_ptr() as *const c_char)
    };
    let dupe_z = |s: &[u8]| -> *const c_char {
        let mut buf = Vec::with_capacity(s.len() + 1);
        buf.extend_from_slice(s);
        buf.push(0);
        // TODO(port): leaks — was arena-backed
        Box::leak(buf.into_boxed_slice()).as_ptr() as *const c_char
    };
    let lit = |s: &'static [u8]| -> *const c_char { s.as_ptr() as *const c_char };

    argv.push(Some(
        bun_core::self_exe_path()
            .map_err(|_| bun_core::err!("SelfExePathFailed"))?
            .as_ptr(),
    ));
    argv.push(Some(lit(b"test\0")));
    argv.push(Some(lit(b"--test-worker\0")));
    argv.push(Some(lit(b"--isolate\0")));

    argv.push(Some(print_z(format_args!("--timeout={}", opts.default_timeout_ms))?));
    if opts.run_todo {
        argv.push(Some(lit(b"--todo\0")));
    }
    if opts.only {
        argv.push(Some(lit(b"--only\0")));
    }
    if opts.reporters.dots {
        argv.push(Some(lit(b"--dots\0")));
    }
    if opts.reporters.only_failures {
        argv.push(Some(lit(b"--only-failures\0")));
    }
    if opts.update_snapshots {
        argv.push(Some(lit(b"--update-snapshots\0")));
    }
    if opts.concurrent {
        argv.push(Some(lit(b"--concurrent\0")));
    }
    if opts.randomize {
        argv.push(Some(lit(b"--randomize\0")));
    }
    if let Some(seed) = opts.seed {
        argv.push(Some(print_z(format_args!("--seed={}", seed))?));
    }
    // --bail is intentionally NOT forwarded: workers Global.exit(1) on bail
    // (test_command.zig handleTestCompleted), which the coordinator would
    // misread as a crash. Cross-worker bail is handled at file granularity by
    // the coordinator instead.
    if opts.repeat_count > 0 {
        argv.push(Some(print_z(format_args!("--rerun-each={}", opts.repeat_count))?));
    }
    if opts.retry > 0 {
        argv.push(Some(print_z(format_args!("--retry={}", opts.retry))?));
    }
    argv.push(Some(print_z(format_args!("--max-concurrency={}", opts.max_concurrency))?));
    if let Some(pattern) = opts.test_filter_pattern {
        argv.push(Some(lit(b"-t\0")));
        argv.push(Some(dupe_z(pattern)));
    }
    for preload in ctx.preloads.iter() {
        argv.push(Some(lit(b"--preload\0")));
        argv.push(Some(dupe_z(preload)));
    }
    if let Some(define) = &ctx.args.define {
        debug_assert_eq!(define.keys.len(), define.values.len());
        for (key, value) in define.keys.iter().zip(define.values.iter()) {
            argv.push(Some(lit(b"--define\0")));
            argv.push(Some(print_z(format_args!(
                "{}={}",
                bstr::BStr::new(key),
                bstr::BStr::new(value)
            ))?));
        }
    }
    if let Some(loaders) = &ctx.args.loaders {
        debug_assert_eq!(loaders.extensions.len(), loaders.loaders.len());
        for (ext, loader) in loaders.extensions.iter().zip(loaders.loaders.iter()) {
            argv.push(Some(lit(b"--loader\0")));
            argv.push(Some(print_z(format_args!(
                "{}:{}",
                bstr::BStr::new(ext),
                <&'static str>::from(*loader)
            ))?));
        }
    }
    if let Some(tsconfig) = ctx.args.tsconfig_override {
        argv.push(Some(lit(b"--tsconfig-override\0")));
        argv.push(Some(dupe_z(tsconfig)));
    }
    // PORT NOTE: was `inline for` over heterogeneous-ish tuple; all elements are
    // (&'static [u8], &[&[u8]]) so a const array + plain for suffices.
    let multi_value_flags: [(&'static [u8], &[&[u8]]); 6] = [
        (b"--conditions\0", ctx.args.conditions),
        (b"--drop\0", ctx.args.drop),
        (b"--main-fields\0", ctx.args.main_fields),
        (b"--extension-order\0", ctx.args.extension_order),
        (b"--env-file\0", ctx.args.env_files),
        (b"--feature\0", ctx.args.feature_flags),
    ];
    for (flag, values) in multi_value_flags {
        for value in values {
            argv.push(Some(flag.as_ptr() as *const c_char));
            argv.push(Some(dupe_z(value)));
        }
    }
    if ctx.args.preserve_symlinks.unwrap_or(false) {
        argv.push(Some(lit(b"--preserve-symlinks\0")));
    }
    if ctx.runtime_options.smol {
        argv.push(Some(lit(b"--smol\0")));
    }
    if ctx.runtime_options.experimental_http2_fetch {
        argv.push(Some(lit(b"--experimental-http2-fetch\0")));
    }
    if ctx.runtime_options.experimental_http3_fetch {
        argv.push(Some(lit(b"--experimental-http3-fetch\0")));
    }
    if ctx.args.allow_addons == false {
        argv.push(Some(lit(b"--no-addons\0")));
    }
    if ctx.debug.macros == crate::MacrosOption::Disable {
        // TODO(port): verify enum path for `ctx.debug.macros == .disable`
        argv.push(Some(lit(b"--no-macros\0")));
    }
    if ctx.args.disable_default_env_files {
        argv.push(Some(lit(b"--no-env-file\0")));
    }
    if let Some(jsx) = &ctx.args.jsx {
        if !jsx.factory.is_empty() {
            argv.push(Some(print_z(format_args!("--jsx-factory={}", bstr::BStr::new(jsx.factory)))?));
        }
        if !jsx.fragment.is_empty() {
            argv.push(Some(print_z(format_args!("--jsx-fragment={}", bstr::BStr::new(jsx.fragment)))?));
        }
        if !jsx.import_source.is_empty() {
            argv.push(Some(print_z(format_args!(
                "--jsx-import-source={}",
                bstr::BStr::new(jsx.import_source)
            ))?));
        }
        argv.push(Some(print_z(format_args!(
            "--jsx-runtime={}",
            <&'static str>::from(jsx.runtime)
        ))?));
        if jsx.side_effects {
            argv.push(Some(lit(b"--jsx-side-effects\0")));
        }
    }
    if opts.coverage.enabled {
        argv.push(Some(lit(b"--coverage\0")));
    }

    argv.push(None);
    // Zig: `argv.items[0 .. argv.items.len - 1 :null]` — sentinel slice excluding
    // the trailing null from len but keeping it as sentinel. Rust callers index
    // by .len() so we keep the None in the boxed slice.
    Ok(argv.into_boxed_slice())
}

/// Event-loop-driven coordinator ↔ worker channel. The worker pumps
/// `vm.event_loop()` between files instead of sitting in a blocking read(), so
/// any post-swap cleanup the loop owns (timers the generation guard let
/// through, async dispose, etc.) gets to run, and on macOS — where there's no
/// PDEATHSIG — coordinator death surfaces as channel close. Same `Channel`
/// abstraction as the coordinator side: usockets over the socketpair on POSIX,
/// `uv.Pipe` over the inherited duplex named-pipe on Windows.
pub struct WorkerCommands<'a> {
    pub vm: &'a VirtualMachine,
    // TODO(port): Channel(WorkerCommands, "channel") — second comptime arg is
    // the field name for intrusive container_of recovery; encode via offset_of
    // or trait impl in Phase B.
    pub channel: Channel<WorkerCommands<'a>>,
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pub pending_idx: Option<u32>,
    pub pending_path: Vec<u8>,
    /// EOF, error, `.shutdown`, or a corrupt frame.
    pub done: bool,
}

impl<'a> WorkerCommands<'a> {
    pub fn send(&mut self, frame_bytes: &[u8]) {
        self.channel.send(frame_bytes);
    }

    pub fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader) {
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

    pub fn on_channel_done(&mut self) {
        self.done = true;
    }
}

// PORT NOTE: hoisted from local struct inside run_as_worker — Rust does not
// support method-bearing local structs that need to be named in a generic call.
struct WorkerLoop<'a> {
    reporter: &'a mut CommandLineReporter,
    vm: &'a VirtualMachine,
    cmds: WorkerCommands<'a>,
}

impl<'a> WorkerLoop<'a> {
    pub fn begin(&mut self) {
        if !self.cmds.channel.adopt(self.vm, Fd::from_uv(3)) {
            Output::pretty_errorln("<red>error<r>: test worker failed to adopt IPC fd", &[]);
            Global::exit(1);
        }
        // SAFETY: single-threaded worker; WORKER_CMDS is only read on this thread
        unsafe {
            WORKER_CMDS = Some(&mut self.cmds as *mut WorkerCommands<'_>);
        }

        // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer
        let wf = unsafe { &mut *core::ptr::addr_of_mut!(WORKER_FRAME) };
        wf.begin(frame::Kind::Ready);
        self.cmds.send(wf.finish());

        loop {
            while self.cmds.pending_idx.is_none() && !self.cmds.done {
                self.vm.event_loop().tick();
                if self.cmds.pending_idx.is_some() || self.cmds.done {
                    break;
                }
                self.vm.event_loop().auto_tick();
            }
            let Some(idx) = self.cmds.pending_idx else { break };
            self.cmds.pending_idx = None;

            self.reporter.worker_ipc_file_idx = idx;
            wf.begin(frame::Kind::FileStart);
            wf.u32_(idx);
            self.cmds.send(wf.finish());

            let before = *self.reporter.summary();
            let before_unhandled = self.reporter.jest.unhandled_errors_between_tests;

            // Workers always run with --isolate; every file is its own
            // complete run from the preload's perspective.
            if let Err(err) = TestCommand::run(
                self.reporter,
                self.vm,
                self.cmds.pending_path.as_slice(),
                TestCommand::RunPosition { first: true, last: true },
            ) {
                test_command::handle_top_level_test_error_before_javascript_start(err);
            }
            self.vm.swap_global_for_test_isolation();
            self.reporter.jest.bun_test_root.reset_hook_scope_for_test_isolation();
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
    vm: &VirtualMachine,
    ctx: Command::Context,
) -> ! {
    vm.test_isolation_enabled = true;
    vm.auto_killer.enabled = true;

    // TODO(port): MimallocArena assigned to vm.arena/vm.allocator — verify
    // whether Rust VM still needs explicit arena wiring or if this is a no-op.
    let mut arena = bun_alloc::MimallocArena::init();
    vm.event_loop().ensure_waker();
    vm.arena = &mut arena;
    // vm.allocator = arena.allocator(); — allocator params dropped in Rust

    let worker_tmp = vm.transpiler.env.get("BUN_TEST_WORKER_TMP");
    if vm.transpiler.env.get("BUN_TEST_WORKER_JUNIT").is_some() && reporter.reporters.junit.is_none() {
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
    vm.run_with_api_lock(&mut wloop, WorkerLoop::begin);

    worker_flush_aggregates(wloop.reporter, vm, ctx, worker_tmp, &mut wloop.cmds);
    // Drain any backpressure-buffered frames before exit so the coordinator
    // sees repeat_bufs/junit_file/coverage_file.
    while wloop.cmds.channel.has_pending_writes() && !wloop.cmds.channel.done {
        vm.event_loop().tick();
        if !wloop.cmds.channel.has_pending_writes() || wloop.cmds.channel.done {
            break;
        }
        vm.event_loop().auto_tick();
    }
    Global::exit(0);
}

fn worker_flush_aggregates(
    reporter: &mut CommandLineReporter,
    vm: &VirtualMachine,
    ctx: Command::Context,
    worker_tmp: Option<&[u8]>,
    cmds: &mut WorkerCommands<'_>,
) {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    if let Some(runner) = bun_jsc::Jest::Jest::runner() {
        let _ = runner.snapshots.write_inline_snapshots().unwrap_or(false);
        let _ = runner.snapshots.write_snapshot_file();
    }

    // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer
    let wf = unsafe { &mut *core::ptr::addr_of_mut!(WORKER_FRAME) };

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
            // TODO(port): allocPrintSentinel → ZStr; was bun.default_allocator (leaked)
            let path = ZStr::from_bytes(
                format_bytes!("{}/w{}.xml", bstr::BStr::new(dir), id).as_slice(),
            );
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
                    Output::err(e, "failed to write JUnit fragment to {}", &[&bstr::BStr::new(path.as_bytes())]);
                }
            }
        }
        if ctx.test_options.coverage.enabled {
            let path = ZStr::from_bytes(
                format_bytes!("{}/cov{}.lcov", bstr::BStr::new(dir), id).as_slice(),
            );
            match reporter.write_lcov_only(vm, &ctx.test_options.coverage, &path) {
                Ok(_) => {
                    wf.begin(frame::Kind::CoverageFile);
                    wf.str(path.as_bytes());
                    cmds.send(wf.finish());
                }
                Err(e) => {
                    Output::err(e, "failed to write coverage fragment to {}", &[&bstr::BStr::new(path.as_bytes())]);
                }
            }
        }
    }
}

/// Reused across all worker → coordinator emits.
// SAFETY: only accessed from the single worker thread after run_as_worker begins.
static mut WORKER_FRAME: Frame = Frame::DEFAULT;
// TODO(port): Frame::DEFAULT must be a const; if not available, wrap in
// Lazy/OnceCell or thread_local!.

/// Set in `run_as_worker` so `worker_emit_test_done` (called from
/// `CommandLineReporter.handleTestCompleted`) can reach the channel.
// SAFETY: only accessed from the single worker thread.
static mut WORKER_CMDS: Option<*mut WorkerCommands<'static>> = None;
// TODO(port): lifetime — stores a 'a-bound pointer as 'static; sound because
// the pointee outlives all callers (process exits before it's dropped).

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes). The coordinator prints these bytes verbatim so output matches serial.
pub fn worker_emit_test_done(file_idx: u32, formatted_line: &[u8]) {
    // SAFETY: single-threaded worker; WORKER_CMDS only written/read on this thread.
    let Some(cmds_ptr) = (unsafe { WORKER_CMDS }) else { return };
    // SAFETY: cmds_ptr was set from &mut WorkerCommands in run_as_worker; pointee
    // outlives all callers (process exits before it is dropped).
    let cmds = unsafe { &mut *cmds_ptr };
    // SAFETY: single-threaded worker; WORKER_FRAME is a process-global scratch buffer.
    let wf = unsafe { &mut *core::ptr::addr_of_mut!(WORKER_FRAME) };
    wf.begin(frame::Kind::TestDone);
    wf.u32_(file_idx);
    wf.str(formatted_line);
    cmds.send(wf.finish());
}

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
use format_bytes;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/runner.zig (457 lines)
//   confidence: medium
//   todos:      17
//   notes:      argv/envp C-string ownership was arena-backed (now leaks); Worker self-ref backptrs + Coordinator field shapes need verification; static mut globals for worker frame/cmds.
// ──────────────────────────────────────────────────────────────────────────
