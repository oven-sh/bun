//! Entry points of `bun test --parallel`: `run_as_coordinator`, and `run_as_worker` for the processes that it starts.

use core::cell::Cell;
use core::fmt::Display;
use core::ops::Range;
use std::io::Write as _;

use bstr::BStr;
use bun_core::{CStrList, CStrRef, Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::LoaderExt as _;
use bun_options_types::context::MacroOptions;
use bun_ptr::{CellExt as _, Interned};
use bun_resolver::fs::FileSystem;
use bun_sys::Fd;
use bun_test_schedule::{Schedule, Steal, TestFile};

use super::aggregate;
use super::channel::Channel;
use super::coordinator::{Coordinator, abort_handler};
use super::frame::{self, Frame};
use super::worker::{SpawnContext, Worker};
use crate::Command;
use crate::cli::test::timings::Timings;
use crate::test_command::{self, CommandLineReporter, TestCommand};
use crate::test_runner::bun_test::FirstLast;
use crate::test_runner::snapshot::Snapshots;
use bun_collections::index_sort;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_sourcemap_jsc::code_coverage;

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
const DEFAULT_SCALE_UP_AFTER_MS: i64 = 5;

/// All set to the worker's 1-based index. Vitest instead increments VITEST_WORKER_ID for every file.
const WORKER_ID_VARIABLES: [&[u8]; 4] = [
    b"JEST_WORKER_ID",
    b"BUN_TEST_WORKER_ID",
    b"VITEST_POOL_ID",
    b"VITEST_WORKER_ID",
];

/// Vitest sets these even without workers. JEST_WORKER_ID stays unset because libraries use it to detect Jest.
pub(crate) fn set_ids_without_workers(env: &mut bun_dotenv::Loader) {
    for name in [b"VITEST_POOL_ID".as_slice(), b"VITEST_WORKER_ID"] {
        let _ = env.map.put(name, b"1");
    }
}

/// Returns true if files were actually run via the worker pool, false if it
/// left them to the caller to run sequentially (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
#[optimize(size)]
pub(crate) fn run_as_coordinator(
    reporter: &CommandLineReporter,
    vm: &VirtualMachine,
    files: &[Interned],
    ctx: Command::Context,
    coverage_opts: &mut CodeCoverageOptions,
) -> crate::Result<bool> {
    // SAFETY: env loader is initialized before the test runner runs.
    let env = unsafe { &mut *vm.transpiler.get().env };
    let n: u32 = u32::try_from(files.len()).unwrap();
    let k: u32 = ctx.test_options.parallel.min(n);
    if k <= 1 {
        // Jest sets JEST_WORKER_ID=1 even with --maxWorkers=1; match that so
        // tests can rely on the var whenever --parallel is passed.
        for name in WORKER_ID_VARIABLES {
            let _ = env.map.put(name, b"1");
        }
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
    let mut envps: Vec<bun_core::CStringList> = Vec::with_capacity(k as usize);
    for i in 0..k {
        let mut id = Vec::new();
        write!(&mut id, "{}", i + 1).unwrap();
        for name in WORKER_ID_VARIABLES {
            let _ = env.map.put(name, &id);
        }
        envps.push(env.map.to_envp());
    }
    let mut argv = build_worker_argv(ctx)?;

    let runs_compiled_code = crate::cli::run_compiled::runs_compiled_code();
    let mut timings = reporter.timings.take();
    if runs_compiled_code && let Some(timings) = timings.as_mut() {
        timings.record_workers(ctx.test_options.parallel);
    }
    let schedule = make_schedule(files, k, timings.as_deref(), ctx.test_options.randomize);

    let mut workers: Vec<Worker> = Vec::with_capacity(k as usize);
    for idx in 0..k {
        workers.push(Worker {
            event_loop: bun_jsc::EventLoopHandle::init(vm.event_loop_ptr()),
            idx,
            out: bun_io::BufferedReader::init(),
            err: bun_io::BufferedReader::init(),
            process: None,
            ipc: Channel::default(),
            captured: Vec::new(),
            alive: false,
            peak_rss_mb: 0,
            startup_failures: 0,
            first_loads: Vec::new(),
        });
    }

    // Open until this process ends.
    #[cfg(windows)]
    let windows_job =
        bun_sys::windows::create_kill_on_close_job().map(core::mem::ManuallyDrop::new);
    let mut coord = Coordinator {
        reporter,
        timings,
        schedule,
        spawn: SpawnContext {
            vm,
            cwd: FileSystem::get().top_level_dir(),
            argv: CStrList::from_unterminated(&mut argv.0),
            envps: &envps,
            compiled_program: crate::cli::run_compiled::graph_descriptor(),
            #[cfg(windows)]
            windows_job: windows_job.as_deref(),
        },
        workers: &mut workers,
        children_of_workers: (cfg!(target_os = "linux")
            && ctx.test_options.update_timings
            && runs_compiled_code)
            .then(Default::default),
        max_worker_peak_rss_mb: 0,
        scale_up_after_ms: if let Some(d) = ctx.test_options.parallel_delay_ms {
            i64::from(d)
        } else if let Some(s) = env.get(b"BUN_TEST_PARALLEL_SCALE_MS") {
            bun_core::fmt::parse_int::<i64>(s, 10)
                .unwrap_or(DEFAULT_SCALE_UP_AFTER_MS)
                .max(0)
        } else {
            DEFAULT_SCALE_UP_AFTER_MS
        },
        test_records: if ctx.test_options.reporters.junit {
            (0..n).map(|_| Default::default()).collect()
        } else {
            Vec::new()
        },
        coverage_files: Default::default(),
        last_header_idx: None,
        frame: Frame::default(),
        spawned_count: 0,
        aborted: None,
        stop_reason: None,
    };

    let abort_guard = abort_handler::install();

    vm.event_loop().ensure_waker();
    crate::cli::run_compiled::log_step_of_test_run(format_args!("the coordinator is set up"));
    vm.run_with_api_lock(|| coord.drive(&abort_guard));
    reporter.timings.set(coord.timings.take());
    coord.end_group();
    crate::cli::run_compiled::log_largest_worker(
        coord.max_worker_peak_rss_mb,
        (coord.workers.iter())
            .map(|w| w.peak_rss_mb)
            .max()
            .unwrap_or(0),
    );
    crate::cli::run_compiled::log_account_of_process(format_args!("coordinator | files {n}"));

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

#[optimize(size)]
fn make_schedule(
    files: &[Interned],
    k: u32,
    timings: Option<&Timings>,
    randomize: bool,
) -> Schedule {
    let mut sorted: Vec<Interned> = files.to_vec();
    // Files of one directory share imports, so each worker gets neighbours. With --randomize the caller has shuffled them.
    if !randomize {
        index_sort::sort_slice_by(&mut sorted, |a, b| {
            bun_core::order(a.as_bytes(), b.as_bytes())
        });
    }
    let (n, slots) = (files.len(), k as usize);
    let runs_compiled_code = crate::cli::run_compiled::runs_compiled_code();
    let timed = timings.filter(|t| !t.is_empty() && !randomize);
    let queues: Vec<Range<usize>> = match timed {
        Some(_) if runs_compiled_code => {
            let mut queues = vec![0..0; slots];
            queues[0] = 0..n;
            queues
        }
        Some(t) => t.partition(&sorted, k),
        None => (0..slots)
            .map(|i| i * n / slots..(i + 1) * n / slots)
            .collect(),
    };
    // What a worker has cached depends on which files it runs, not on their order.
    if let Some(t) = timed {
        for queue in &queues {
            t.sort_slowest_first(&mut sorted[queue.clone()]);
        }
    }
    let measured = timings.filter(|_| runs_compiled_code);
    let files = sorted
        .iter()
        .map(|file| file.as_bytes())
        .map(|path| TestFile {
            path,
            growth: measured
                .and_then(|t| t.growth_of(path))
                .map_or(0, u64::from),
        });
    let steal = timed.map_or(Steal::BackHalf, |t| Steal::Slowest {
        costs: t.costs(&sorted),
    });
    Schedule::new(files.collect(), queues, steal)
}

/// The strings live in the CLI arena.
#[derive(Default)]
struct Argv(Vec<Option<CStrRef<'static>>>);

impl Argv {
    fn push(&mut self, arg: &[u8]) {
        self.0.push(Some(crate::cli::cli_dupe_z(arg)));
    }

    fn flag(&mut self, name: &str, is_set: bool) {
        if is_set {
            self.push(name.as_bytes());
        }
    }

    /// `name=value`
    fn option(&mut self, name: &str, value: Option<impl Display>) {
        if let Some(value) = value {
            self.push(format!("{name}={value}").as_bytes());
        }
    }

    /// `name value`, for each of `values`
    fn pairs<'v>(&mut self, name: &str, values: impl IntoIterator<Item = &'v [u8]>) {
        for value in values {
            self.push(name.as_bytes());
            self.push(value);
        }
    }
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
fn build_worker_argv(ctx: &Command::ContextData) -> crate::Result<Argv> {
    use bun_core::CodeGenerationFromStrings as CodeGeneration;
    let (opts, args, runtime) = (&ctx.test_options, &ctx.args, &ctx.runtime_options);
    let unless_zero = |count: u32| (count > 0).then_some(count);
    fn unless_empty(value: &[u8]) -> Option<&[u8]> {
        (!value.is_empty()).then_some(value)
    }

    let mut argv = Argv::default();
    let exe = bun_core::self_exe_path().map_err(|_| crate::Error::SelfExePathFailed)?;
    argv.push(exe.as_bytes());
    argv.push(b"test");
    argv.push(b"--test-worker");
    // Not everything in the file has a flag below.
    argv.option("--config", opts.config_file.as_deref().map(BStr::new));
    argv.push(match (opts.isolate_modules, opts.isolate) {
        (true, _) => b"--isolate=modules",
        (false, true) => b"--isolate",
        (false, false) => b"--no-isolate",
    });
    argv.option("--timeout", Some(opts.default_timeout_ms));
    argv.flag("--todo", opts.run_todo);
    argv.flag("--only", opts.only);
    argv.flag("--dots", opts.reporters.dots);
    argv.flag("--only-failures", opts.reporters.only_failures);
    argv.flag("--reporter=junit", opts.reporters.junit);
    argv.flag("--update-snapshots", opts.update_snapshots);
    argv.flag("--concurrent", opts.concurrent);
    argv.flag("--randomize", opts.randomize);
    argv.option("--seed", opts.seed);
    // No `--bail`: the coordinator counts the failures.
    argv.option("--rerun-each", unless_zero(opts.repeat_count));
    argv.option("--retry", unless_zero(opts.retry));
    argv.option("--max-concurrency", Some(opts.max_concurrency));
    argv.pairs("-t", opts.test_filter_pattern.as_deref());
    // No `--cpu-prof-name` or `--heap-prof-name`: every worker writes a profile, and the default names have the pid in them.
    if runtime.cpu_prof.enabled {
        argv.flag("--cpu-prof", runtime.cpu_prof.json_format);
        argv.flag("--cpu-prof-md", runtime.cpu_prof.md_format);
        argv.pairs("--cpu-prof-dir", unless_empty(runtime.cpu_prof.dir));
        argv.option("--cpu-prof-interval", Some(runtime.cpu_prof.interval));
    }
    if runtime.heap_prof.enabled {
        argv.flag("--heap-prof-md", runtime.heap_prof.text_format);
        argv.flag("--heap-prof", !runtime.heap_prof.text_format);
        argv.pairs("--heap-prof-dir", unless_empty(runtime.heap_prof.dir));
    }
    argv.pairs("--preload", ctx.preloads.iter().map(|it| &**it));
    if let Some(define) = &args.define {
        debug_assert_eq!(define.keys.len(), define.values.len());
        for (key, value) in define.keys.iter().zip(&define.values) {
            let define = format!("{}={}", BStr::new(key), BStr::new(value));
            argv.pairs("--define", [define.as_bytes()]);
        }
    }
    if let Some(loaders) = &args.loaders {
        debug_assert_eq!(loaders.extensions.len(), loaders.loaders.len());
        for (ext, &loader) in loaders.extensions.iter().zip(&loaders.loaders) {
            let name = <&str>::from(bun_ast::Loader::from_api(loader));
            let loader = format!("{}:{name}", BStr::new(ext));
            argv.pairs("--loader", [loader.as_bytes()]);
        }
    }
    argv.pairs("--tsconfig-override", args.tsconfig_override.as_deref());
    // No `--env-file`: a worker loads no env file (see `TestCommand::exec`).
    for (name, values) in [
        ("--conditions", &args.conditions),
        ("--drop", &args.drop),
        ("--main-fields", &args.main_fields),
        ("--extension-order", &args.extension_order),
        ("--feature", &args.feature_flags),
    ] {
        argv.pairs(name, values.iter().map(|it| &**it));
    }
    argv.flag("--preserve-symlinks", args.preserve_symlinks == Some(true));
    argv.flag("--aot-checked=-", crate::cli::run_compiled::is_checked());
    if let Some(flag) = crate::cli::run_compiled::graph_flag_of_test_worker() {
        argv.push(&flag);
    }
    argv.flag("--smol", runtime.smol);
    argv.flag(
        "--experimental-http2-fetch",
        runtime.experimental_http2_fetch,
    );
    argv.flag(
        "--experimental-http3-fetch",
        runtime.experimental_http3_fetch,
    );
    argv.flag("--no-addons", args.allow_addons == Some(false));
    argv.flag("--no-ffi-cc", args.allow_ffi_cc == Some(false));
    match bun_core::code_generation_from_strings_by_flags() {
        CodeGeneration::Allowed => {}
        CodeGeneration::DisallowedLikeNode => argv.push(b"--disallow-code-generation-from-strings"),
        CodeGeneration::Strict => argv.push(b"--disallow-code-generation-from-strings=strict"),
    }
    if let Some(flag) = bun_core::Global::ca_store_flag() {
        argv.push(flag.as_bytes());
    }
    argv.flag(
        "--no-macros",
        matches!(ctx.debug.macros, MacroOptions::Disable),
    );
    if let Some(jsx) = &args.jsx {
        for (name, value) in [
            ("--jsx-factory", &jsx.factory),
            ("--jsx-fragment", &jsx.fragment),
            ("--jsx-import-source", &jsx.import_source),
        ] {
            argv.option(name, unless_empty(value).map(BStr::new));
        }
        argv.option("--jsx-runtime", Some(jsx_runtime_tag_name(jsx.runtime)));
        argv.flag("--jsx-side-effects", jsx.side_effects);
    }
    argv.flag("--coverage", opts.coverage.enabled);
    argv.option("--environment", opts.environment.map(|it| it.name()));
    argv.option("--globals", opts.globals.map(|it| it.name()));
    // Each worker reads `include` and `exclude` from bunfig.toml itself.
    argv.flag("--react-compiler", opts.react_compiler.is_some());
    Ok(argv)
}

/// Local shim for `@tagName(jsx.runtime)`.
fn jsx_runtime_tag_name(r: bun_options_types::schema::api::JsxRuntime) -> &'static str {
    use bun_options_types::schema::api::JsxRuntime as J;
    match r {
        J::Automatic => "automatic",
        J::Classic => "classic",
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
#[derive(Default)]
pub(crate) struct CoordinatorLink {
    channel: Channel,
    /// Reused across all worker → coordinator emits.
    frame: Cell<Frame>,
    /// The coordinator-assigned index of the file currently being executed.
    file_idx: Cell<u32>,
}

impl CoordinatorLink {
    /// Sends one frame of `kind`; `fill` writes its payload.
    fn emit(&self, kind: frame::Kind, fill: impl FnOnce(&mut Frame)) {
        self.frame.with_taken(|frame| {
            frame.begin(kind);
            fill(frame);
            self.channel.send(frame.finish());
        });
    }
}

/// What the coordinator has sent and this worker has yet to act on.
#[derive(Default)]
struct Commands {
    /// The payload of `Run`, or empty. The next one comes after `FileDone`.
    run: Vec<u8>,
    shutdown: bool,
}

impl Commands {
    /// Returns whether the wait is over: a file to run, a shutdown or a closed channel.
    fn read(&mut self, channel: &Channel) -> bool {
        if let Some(mut incoming) = channel.take_incoming() {
            while let Some((kind, rd)) = incoming.next_frame() {
                match kind {
                    frame::Kind::Run => rd.p.clone_into(&mut self.run),
                    frame::Kind::Shutdown => self.shutdown = true,
                    _ => {}
                }
            }
            channel.restore_incoming(incoming);
        }
        !self.run.is_empty() || self.shutdown || channel.done.get()
    }

    fn wait_for_run(
        &mut self,
        channel: &Channel,
        vm: &VirtualMachine,
    ) -> Option<frame::Reader<'_>> {
        self.run.clear();
        // The channel holds no reference on the loop, and a loop that nothing holds polls without sleeping.
        let _waits_for_command = bun_io::JsKeepAlive::active();
        tick_until(vm, || self.read(channel));
        (!self.run.is_empty()).then_some(frame::Reader { p: &self.run })
    }
}

fn tick_until(vm: &VirtualMachine, mut is_over: impl FnMut() -> bool) {
    while !is_over() {
        vm.event_loop().tick();
        if is_over() {
            break;
        }
        vm.event_loop().auto_tick();
    }
}

struct RunningFile {
    before: crate::test_runner::jest::Summary,
    before_unhandled: u32,
    started_ns: u64,
    resident_at_start: Option<ResidentAtStart>,
}

impl RunningFile {
    /// Says what the file has counted.
    fn emit_done(
        mut self,
        link: &CoordinatorLink,
        reporter: &CommandLineReporter,
        vm: &VirtualMachine,
    ) {
        let mut growth = self.resident_at_start.map(growth_since).unwrap_or_default();
        if self.resident_at_start.is_none() && crate::cli::run_compiled::logs_accounts() {
            growth.peak = crate::cli::run_compiled::peak_of_this_process_mb();
        }
        let elapsed_ns = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(self.started_ns);
        let mut after = reporter.summary();
        // What the file printed goes out ahead of the word that it is done, so that it is printed under the file's name.
        Output::flush();
        for refusal in crate::cli::run_compiled::refused_changes() {
            link.emit(frame::Kind::RefusedChange, |wf| wf.str(&refusal));
        }
        let first_loads = first_loads(vm);
        link.emit(frame::Kind::FileDone, |wf| {
            wf.u32(link.file_idx.get());
            let before = frame::counters(&mut self.before);
            for (after, before) in frame::counters(&mut after).into_iter().zip(before) {
                wf.u32(*after - *before);
            }
            wf.u32(reporter.jest.unhandled_errors_between_tests.get() - self.before_unhandled);
            wf.u64(elapsed_ns);
            wf.u32(growth.of_worker);
            wf.u32(growth.largest_child);
            wf.u32(growth.peak);
            wf.str(&first_loads);
        });
    }
}

/// Returns how many files it ran.
fn run_files(
    reporter: &'static CommandLineReporter,
    vm: &VirtualMachine,
    link: &CoordinatorLink,
) -> u32 {
    let end = bun_sys::File::from_fd(Fd::from_uv(3));
    if !link.channel.adopt(vm, end) {
        bun_core::pretty_errorln!("<red>error<r>: test worker failed to adopt IPC fd");
        Global::exit(1);
    }

    // Test hook: a real failure to start cannot be staged. Not in release builds, where a stray variable would disable --parallel.
    if cfg!(any(debug_assertions, bun_asan))
        && let Some(mode) = vm.env_loader().get(b"BUN_TEST_WORKER_EXIT_BEFORE_READY")
    {
        bun_core::pretty_errorln!(
            "test worker exiting before ready (BUN_TEST_WORKER_EXIT_BEFORE_READY)"
        );
        Output::flush();
        if mode == b"abort" {
            std::process::abort();
        }
        Global::exit(1);
    }

    link.emit(frame::Kind::Ready, |_| {});

    let mut commands = Commands::default();
    let mut files_run = 0;
    while let Some(mut run) = commands.wait_for_run(&link.channel, vm) {
        let (idx, path, first_loads) = (run.u32(), run.str(), run.str());
        let is_growth_written = run.u32() != 0;
        if files_run == 0 {
            note_first_loads_of_earlier_process(vm, first_loads);
        }
        files_run += 1;

        link.file_idx.set(idx);
        link.emit(frame::Kind::FileStart, |wf| wf.u32(idx));

        let running = RunningFile {
            before: reporter.summary(),
            before_unhandled: reporter.jest.unhandled_errors_between_tests.get(),
            started_ns: bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns(),
            resident_at_start: start_measuring_growth(vm, is_growth_written),
        };

        // A worker never knows which file is its last, so preload-level hooks wrap every file (with or without --isolate).
        let first_last = FirstLast {
            first: true,
            last: true,
        };
        if let Err(err) = TestCommand::run(reporter, vm, path, first_last) {
            test_command::handle_top_level_test_error_before_javascript_start(&err);
        }
        if vm.test_isolation_enabled.get() {
            crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
            vm.swap_global_for_test_isolation();
            reporter
                .jest
                .bun_test_root
                .reset_preload_for_test_isolation();
            crate::test_runner::Expect::reset_for_test_isolation(vm.global());
        } else {
            Global::mimalloc_cleanup(false);
        }
        reporter.jest.default_timeout_override.set(u32::MAX);
        running.emit_done(link, reporter, vm);
    }
    files_run
}

/// For each file of `compiled_program::for_each_first_load`: u32, 1 where the load was synchronous, and str path.
fn first_loads(vm: &VirtualMachine) -> Vec<u8> {
    let mut list = Vec::new();
    bun_jsc::compiled_program::for_each_first_load(vm.global(), &mut |path, was_synchronous| {
        list.extend_from_slice(&u32::from(was_synchronous).to_le_bytes());
        list.extend_from_slice(&(path.len() as u32).to_le_bytes());
        list.extend_from_slice(path);
    });
    list
}

fn note_first_loads_of_earlier_process(vm: &VirtualMachine, list: &[u8]) {
    let mut rd = frame::Reader { p: list };
    while !rd.p.is_empty() {
        let was_synchronous = rd.u32() != 0;
        let path = rd.str();
        if path.is_empty() {
            break;
        }
        bun_jsc::compiled_program::note_first_load_in_earlier_process(
            vm.global(),
            path,
            was_synchronous,
        );
    }
}

/// Lines of /proc/self/status, in kilobytes.
#[cfg(target_os = "linux")]
fn read_kilobytes<const N: usize>(names: [&[u8]; N]) -> Option<[u64; N]> {
    let status = bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/self/status").ok()?;
    let mut values = [0; N];
    for (value, name) in values.iter_mut().zip(names) {
        let line = bun_core::strings::split(&status, b"\n").find(|line| line.starts_with(name))?;
        let digits: Vec<u8> = (line.iter().copied()).filter(u8::is_ascii_digit).collect();
        *value = bun_core::fmt::parse_int::<u64>(&digits, 10).ok()?;
    }
    Some(values)
}

/// In kilobytes, when a test file begins.
#[derive(Clone, Copy)]
#[cfg_attr(not(target_os = "linux"), expect(dead_code))]
struct ResidentAtStart {
    all: u64,
    /// Pages of files and of memory that processes share: the images above all. The workers have them in common, and the kernel
    /// drops those of files when it needs room.
    shared: u64,
}

/// In megabytes.
#[derive(Default)]
struct Growth {
    of_worker: u32,
    largest_child: u32,
    /// The highest resident size of this process so far.
    peak: u32,
}

/// Sets the highest resident size that the kernel remembers back to the present one, and answers that. A compiled run asks; only
/// Linux can.
///
/// What the file before left behind is still resident until a collection finds it. Counted at the start and freed while this file
/// grows, it would be taken off this file's growth. So where the growth is written the worker lets go of it first.
#[cfg_attr(not(target_os = "linux"), expect(unused_variables))]
fn start_measuring_growth(vm: &VirtualMachine, is_written: bool) -> Option<ResidentAtStart> {
    #[cfg(target_os = "linux")]
    if crate::cli::run_compiled::runs_compiled_code() {
        if is_written {
            vm.garbage_collect_from_js(true);
        }
        let [peak, all, of_files, of_shared_memory] =
            read_kilobytes([b"VmHWM:", b"VmRSS:", b"RssFile:", b"RssShmem:"])?;
        let flags = bun_sys::O::WRONLY | bun_sys::O::CLOEXEC;
        bun_sys::File::openat(bun_sys::Fd::cwd(), b"/proc/self/clear_refs", flags, 0)
            .and_then(|marks| marks.write_all(b"5"))
            .ok()?;
        crate::cli::run_compiled::record_peak_rss_kb(peak);
        bun_spawn::LARGEST_REAPED_CHILD.store(0, core::sync::atomic::Ordering::Relaxed);
        return Some(ResidentAtStart {
            all,
            shared: of_files + of_shared_memory,
        });
    }
    None
}

/// A build inside a test takes gigabytes for a few seconds and gives them back, so the highest size counts. The kernel remembers it
/// for all pages alike. What the file touched of the images is taken off: a file loads its modules first and grows then.
fn growth_since(at_start: ResidentAtStart) -> Growth {
    #[cfg(target_os = "linux")]
    if let Some([highest, of_files, of_shared_memory]) =
        read_kilobytes([b"VmHWM:", b"RssFile:", b"RssShmem:"])
    {
        // A build that a test starts as a process of its own takes as much as one inside the worker. When a child starts its
        // program, the kernel sets the child's highest size to that of the process it came from, so a child says something about
        // itself only above the worker's.
        let child = bun_spawn::LARGEST_REAPED_CHILD.load(core::sync::atomic::Ordering::Relaxed);
        let child = if child > highest { child } else { 0 };
        let megabytes = |kilobytes: u64| u32::try_from(kilobytes / 1024).unwrap_or(u32::MAX);
        let more_shared = (of_files + of_shared_memory).saturating_sub(at_start.shared);
        return Growth {
            of_worker: megabytes(highest.saturating_sub(at_start.all + more_shared)),
            largest_child: megabytes(child),
            peak: megabytes(crate::cli::run_compiled::record_peak_rss_kb(highest)),
        };
    }
    let _ = at_start;
    Growth::default()
}

/// Worker side: read framed commands from the IPC channel via the event loop,
/// run each file with isolation, stream per-test events back. Never returns.
#[optimize(size)]
pub(crate) fn run_as_worker(
    reporter: &'static CommandLineReporter,
    vm: &VirtualMachine,
    ctx: Command::Context,
) -> ! {
    vm.test_isolation_enabled.set(ctx.test_options.isolate);
    vm.test_isolation_state
        .shares_global
        .set(crate::cli::run_compiled::test_files_share_global(ctx));
    vm.auto_killer.enabled.set(ctx.test_options.isolate);

    vm.event_loop().ensure_waker();

    let link = reporter.worker.get_or_init(CoordinatorLink::default);
    let files_run = vm.run_with_api_lock(|| run_files(reporter, vm, link));
    crate::cli::run_compiled::log_account_of_process(format_args!("worker | files {files_run}"));

    // Test hook, like BUN_TEST_WORKER_EXIT_BEFORE_READY. A test can't otherwise reproduce a crash during exit.
    if cfg!(any(debug_assertions, bun_asan))
        && vm
            .env_loader()
            .get(b"BUN_TEST_WORKER_ABORT_AFTER_SHUTDOWN")
            .is_some()
    {
        std::process::abort();
    }

    worker_flush_aggregates(reporter, vm, &ctx.test_options.coverage, link);
    // Drain backpressure-buffered frames so the coordinator sees repeat_bufs / coverage_file.
    let channel = &link.channel;
    vm.run_with_api_lock(|| tick_until(vm, || !channel.has_pending_writes() || channel.done.get()));
    // Mirror TestCommand::exec's exit path so BUN_DESTRUCT_VM_ON_EXIT teardown
    // (lastChanceToFinalize) runs; bypassing it leaks JSC-owned native state.
    vm.exit_handler.exit_code.set(0);
    vm.exit_handler
        .skip_exit_listeners
        .set(test_command::skip_exit_listeners(reporter));
    vm.exit_handler
        .requested
        .set(test_command::exit_is_requested());
    vm.run_with_api_lock(|| {
        vm.on_exit();
        vm.global_exit()
    })
}

#[optimize(size)]
fn worker_flush_aggregates(
    reporter: &CommandLineReporter,
    vm: &VirtualMachine,
    coverage: &CodeCoverageOptions,
    link: &CoordinatorLink,
) {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    let runner = &reporter.jest;
    let _ = runner.with_snapshots(Snapshots::write_inline_snapshots);
    let _ = runner.with_snapshots(Snapshots::write_snapshot_file);

    link.emit(frame::Kind::RepeatBufs, |wf| {
        wf.str(&reporter.failures_to_repeat_buf.take());
        wf.str(&reporter.skips_to_repeat_buf.take());
        wf.str(&reporter.todos_to_repeat_buf.take());
    });

    if coverage.enabled {
        let mut encoded: Vec<u8> = Vec::new();
        CommandLineReporter::add_compiled_files_to_coverage(vm);
        CommandLineReporter::for_each_coverage_report(vm, coverage, |report| {
            encoded.clear();
            code_coverage::wire::encode(&report, &mut encoded);
            link.emit(frame::Kind::CoverageFile, |wf| wf.str(&encoded));
        });
    }
}

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes), which the coordinator prints verbatim so output matches serial, and,
/// when the coordinator asked for it (`--reporter`), the structured result it
/// replays into its own reporters.
#[optimize(size)]
pub(crate) fn worker_emit_test_done(
    link: &CoordinatorLink,
    formatted_line: &[u8],
    test: Option<&test_command::TestCaseReport<'_>>,
) {
    link.emit(frame::Kind::TestDone, |wf| {
        wf.u32(link.file_idx.get());
        wf.str(formatted_line);
        if let Some(test) = test {
            encode_test_case(wf, test);
        }
    });
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
    // Earlier attempts' failures first, then the last attempt's if it failed.
    wf.u32(u32::from(t.failure.is_some()));
    wf.u32(u32::try_from(t.earlier_failures.len()).expect("int cast"));
    for f in t.earlier_failures.iter().chain(&t.failure) {
        wf.str(&f.name);
        wf.str(&f.message);
        wf.str(&f.body);
        wf.u32(u32::from(f.uncaught));
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
    let has_failure = rd.u32() != 0;
    let earlier = rd.u32() as usize;
    let mut read_failure = || test_command::TestFailure {
        name: rd.str().to_vec(),
        message: rd.str().to_vec(),
        body: rd.str().to_vec(),
        uncaught: rd.u32() != 0,
    };
    let earlier_failures: Vec<_> = (0..earlier).map(|_| read_failure()).collect();
    let failure = has_failure.then(read_failure);
    Some(test_command::TestCaseReport {
        file,
        scopes,
        name,
        status,
        assertions,
        elapsed_ns,
        line_number,
        failure,
        earlier_failures,
    })
}
