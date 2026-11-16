//! Coordinator and worker entry points: `run_as_coordinator` (sets up the
//! `Coordinator`, sorts/partitions files, drives the loop, merges fragments)
//! and `run_as_worker` (the `--test-worker` side that reads framed commands
//! from stdin, runs each file under isolation, and streams results to fd 3).

use core::cell::Cell;
use core::ffi::CStr;
use std::io::Write as _;

use bun_core::{CStrRef, Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::MacroOptions;
use bun_ptr::{CellExt as _, Interned};
use bun_resolver::fs::FileSystem;
use bun_sys::Fd;

use super::aggregate;
use super::channel::Channel;
use super::coordinator::{Coordinator, abort_handler};
use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::worker::Worker;
use crate::Command;
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
    let runs_compiled_code = crate::cli::run_compiled::runs_compiled_code();
    let mut timings = reporter.timings.take();
    if runs_compiled_code && let Some(timings) = timings.as_mut() {
        timings.record_workers(ctx.test_options.parallel);
    }
    // With --timings the contiguous chunks are cut by total duration instead
    // of file count, and each chunk is dispatched slowest-first (cache hits
    // depend on which worker runs a file, not the order within the worker).
    let mut costs: Option<Vec<u64>> = None;
    let ranges: Vec<FileRange> = match timings.as_ref() {
        Some(t) if !t.is_empty() && !ctx.test_options.randomize => {
            let ranges = if crate::cli::run_compiled::runs_compiled_code() {
                let mut ranges = vec![FileRange { lo: 0, hi: 0 }; k as usize];
                ranges[0] = FileRange { lo: 0, hi: n };
                ranges
            } else {
                t.partition(&sorted, k)
            };
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

    let mut workers: Vec<Worker> = Vec::with_capacity(k as usize);
    for i in 0..k {
        let idx: u32 = i;
        workers.push(Worker {
            event_loop: bun_jsc::EventLoopHandle::init(vm.event_loop_ptr()),
            idx,
            range: ranges[idx as usize],
            out: bun_io::BufferedReader::init(),
            err: bun_io::BufferedReader::init(),
            process: None,
            ipc: Channel::default(),
            inflight: None,
            dispatched_at: 0,
            captured: Vec::new(),
            alive: false,
            exit_status: None,
            peak_rss_mb: 0,
            reached_ready: false,
            startup_failures: 0,
            waits_for_heavy_file_to_end: false,
            first_loads: Vec::new(),
        });
    }

    let room_for_heavy_files = timings.as_ref().map_or(0, |t| t.largest_growth(&sorted));
    let room_beside_heavy_files = timings.as_ref().map_or(0, |t| {
        t.growth_of_average_files(&sorted, k.saturating_sub(1))
    });
    let heavy_files_to_hand_out = timings.as_ref().map_or(0, |t| {
        sorted
            .iter()
            .filter(|file| t.is_heavy(file.as_bytes()))
            .count() as u32
    });
    let mut coord = Coordinator {
        vm,
        reporter,
        timings,
        files: sorted,
        costs,
        cwd: FileSystem::get().top_level_dir(),
        argv,
        envps,
        workers: &mut workers,
        parallel_limit: k,
        keeps_heavy_files_apart: runs_compiled_code,
        children_of_workers: (cfg!(target_os = "linux")
            && ctx.test_options.update_timings
            && runs_compiled_code)
            .then(Default::default),
        room_for_heavy_files,
        room_beside_heavy_files,
        heavy_files_to_hand_out,
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
        aborted: None,
        stop_reason: None,
        last_printed_dot: false,
        // Open until this process ends.
        #[cfg(windows)]
        windows_job: bun_sys::windows::create_kill_on_close_job()
            .map(std::os::windows::io::IntoRawHandle::into_raw_handle),
    };

    let _abort_guard = abort_handler::install();

    vm.event_loop().ensure_waker();
    crate::cli::run_compiled::log_step_of_test_run(format_args!("the coordinator is set up"));
    vm.run_with_api_lock(|| coord.drive());
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

/// Build the argv used for every worker (re)spawn. Forwards every `bun test`
/// flag that affects how tests *execute inside* a worker, plus `--dots` and
/// `--only-failures` since the worker formats result lines and the coordinator
/// prints them verbatim. `--reporter=junit` is forwarded (without the outfile)
/// so workers attach the per-test detail the coordinator's JunitReporter
/// needs. Coordinator-only concerns — file discovery
/// (`--path-ignore-patterns`, `--changed`), `--reporter-outfile`,
/// `--pass-with-no-tests`, `--parallel` itself — are intentionally not
/// forwarded.
fn build_worker_argv(ctx: &Command::ContextData) -> crate::Result<Box<[Option<CStrRef<'static>>]>> {
    // Null-sentinel slice of C-string pointers. String storage routes through
    // the process-lifetime CLI arena (bulk-freed on exit).
    let mut argv: Vec<Option<CStrRef<'static>>> = Vec::new();
    let opts = &ctx.test_options;

    let dupe_z = |s: &[u8]| Some(crate::cli::cli_dupe_z(s));
    let lit = |s: &'static CStr| Some(CStrRef::from(s));
    let print_z = |args: core::fmt::Arguments<'_>| -> crate::Result<_> {
        let mut buf = Vec::<u8>::new();
        buf.write_fmt(args)
            .map_err(|_| crate::Error::FormatFailed)?;
        Ok(dupe_z(&buf))
    };

    let exe = bun_core::self_exe_path().map_err(|_| crate::Error::SelfExePathFailed)?;
    argv.push(Some(exe.into()));
    argv.push(lit(c"test"));
    argv.push(lit(c"--test-worker"));
    // Not everything in the file has a flag below.
    if let Some(config_file) = &opts.config_file {
        argv.push(print_z(format_args!(
            "--config={}",
            bstr::BStr::new(config_file)
        ))?);
    }
    argv.push(if opts.isolate_modules {
        lit(c"--isolate=modules")
    } else if opts.isolate {
        lit(c"--isolate")
    } else {
        lit(c"--no-isolate")
    });

    argv.push(print_z(format_args!(
        "--timeout={}",
        opts.default_timeout_ms
    ))?);
    if opts.run_todo {
        argv.push(lit(c"--todo"));
    }
    if opts.only {
        argv.push(lit(c"--only"));
    }
    if opts.reporters.dots {
        argv.push(lit(c"--dots"));
    }
    if opts.reporters.only_failures {
        argv.push(lit(c"--only-failures"));
    }
    if opts.reporters.junit {
        argv.push(lit(c"--reporter=junit"));
    }
    if opts.update_snapshots {
        argv.push(lit(c"--update-snapshots"));
    }
    if opts.concurrent {
        argv.push(lit(c"--concurrent"));
    }
    if opts.randomize {
        argv.push(lit(c"--randomize"));
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
        argv.push(lit(c"-t"));
        argv.push(dupe_z(pattern));
    }
    // No `--cpu-prof-name` or `--heap-prof-name`: every worker writes a profile, and the default names have the pid in them.
    let cpu_prof = &ctx.runtime_options.cpu_prof;
    if cpu_prof.enabled {
        if cpu_prof.json_format {
            argv.push(lit(c"--cpu-prof"));
        }
        if cpu_prof.md_format {
            argv.push(lit(c"--cpu-prof-md"));
        }
        if !cpu_prof.dir.is_empty() {
            argv.push(lit(c"--cpu-prof-dir"));
            argv.push(dupe_z(cpu_prof.dir));
        }
        argv.push(print_z(format_args!(
            "--cpu-prof-interval={}",
            cpu_prof.interval
        ))?);
    }
    let heap_prof = &ctx.runtime_options.heap_prof;
    if heap_prof.enabled {
        argv.push(lit(if heap_prof.text_format {
            c"--heap-prof-md"
        } else {
            c"--heap-prof"
        }));
        if !heap_prof.dir.is_empty() {
            argv.push(lit(c"--heap-prof-dir"));
            argv.push(dupe_z(heap_prof.dir));
        }
    }
    for preload in ctx.preloads.iter() {
        argv.push(lit(c"--preload"));
        argv.push(dupe_z(preload));
    }
    if let Some(define) = &ctx.args.define {
        debug_assert_eq!(define.keys.len(), define.values.len());
        for (key, value) in define.keys.iter().zip(define.values.iter()) {
            argv.push(lit(c"--define"));
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
            argv.push(lit(c"--loader"));
            argv.push(print_z(format_args!(
                "{}:{}",
                bstr::BStr::new(ext),
                api_loader_tag_name(*loader)
            ))?);
        }
    }
    if let Some(tsconfig) = &ctx.args.tsconfig_override {
        argv.push(lit(c"--tsconfig-override"));
        argv.push(dupe_z(tsconfig));
    }
    // Was `inline for` over a heterogeneous-ish tuple; all elements are
    // (&'static CStr, &[Box<[u8]>]) so a const array + plain for suffices.
    // No `--env-file`: a worker loads no env file (see `TestCommand::exec`).
    let multi_value_flags: [(&'static CStr, &[Box<[u8]>]); 5] = [
        (c"--conditions", &ctx.args.conditions),
        (c"--drop", &ctx.args.drop),
        (c"--main-fields", &ctx.args.main_fields),
        (c"--extension-order", &ctx.args.extension_order),
        (c"--feature", &ctx.args.feature_flags),
    ];
    for (flag, values) in multi_value_flags {
        for value in values {
            argv.push(lit(flag));
            argv.push(dupe_z(value));
        }
    }
    if ctx.args.preserve_symlinks.unwrap_or(false) {
        argv.push(lit(c"--preserve-symlinks"));
    }
    if crate::cli::run_compiled::is_checked() {
        argv.push(lit(c"--aot-checked=-"));
    }
    if let Some(flag) = crate::cli::run_compiled::graph_flag_of_test_worker() {
        argv.push(dupe_z(&flag));
    }
    if ctx.runtime_options.smol {
        argv.push(lit(c"--smol"));
    }
    if ctx.runtime_options.experimental_http2_fetch {
        argv.push(lit(c"--experimental-http2-fetch"));
    }
    if ctx.runtime_options.experimental_http3_fetch {
        argv.push(lit(c"--experimental-http3-fetch"));
    }
    if ctx.args.allow_addons == Some(false) {
        argv.push(lit(c"--no-addons"));
    }
    if ctx.args.allow_ffi_cc == Some(false) {
        argv.push(lit(c"--no-ffi-cc"));
    }
    match bun_core::code_generation_from_strings_by_flags() {
        bun_core::CodeGenerationFromStrings::Allowed => {}
        bun_core::CodeGenerationFromStrings::DisallowedLikeNode => {
            argv.push(lit(c"--disallow-code-generation-from-strings"));
        }
        bun_core::CodeGenerationFromStrings::Strict => {
            argv.push(lit(c"--disallow-code-generation-from-strings=strict"));
        }
    }
    if let Some(flag) = bun_core::Global::ca_store_flag() {
        argv.push(Some(flag.into()));
    }
    if matches!(ctx.debug.macros, MacroOptions::Disable) {
        argv.push(lit(c"--no-macros"));
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
            argv.push(lit(c"--jsx-side-effects"));
        }
    }
    if opts.coverage.enabled {
        argv.push(lit(c"--coverage"));
    }
    if let Some(environment) = opts.environment {
        argv.push(print_z(format_args!(
            "--environment={}",
            environment.name()
        ))?);
    }
    if let Some(globals) = opts.globals {
        argv.push(print_z(format_args!("--globals={}", globals.name()))?);
    }
    // Each worker reads `include` and `exclude` from bunfig.toml itself.
    if opts.react_compiler.is_some() {
        argv.push(lit(c"--react-compiler"));
    }

    argv.push(None);
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

struct WorkerCommands {
    link: &'static CoordinatorLink,
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pending_idx: Option<u32>,
    pending_path: Vec<u8>,
    /// `first_loads` of the process that ran in this one's place before it.
    pending_first_loads: Vec<u8>,
    /// A compiled run with `--update-timings`.
    pending_is_growth_written: bool,
    running: Option<RunningFile>,
    shutdown: bool,
}

struct RunningFile {
    idx: u32,
    before: crate::test_runner::jest::Summary,
    before_unhandled: u32,
    started_ns: u64,
    resident_at_start: Option<ResidentAtStart>,
}

impl WorkerCommands {
    /// Returns whether the wait is over: a file to run, a shutdown or a closed channel.
    fn read_commands(&mut self) -> bool {
        if let Some(mut incoming) = self.link.channel.take_incoming() {
            while let Some((kind, mut rd)) = incoming.next_frame() {
                match kind {
                    frame::Kind::Run => {
                        self.pending_idx = Some(rd.u32());
                        self.pending_path.clear();
                        self.pending_path.extend_from_slice(rd.str());
                        self.pending_first_loads.clear();
                        self.pending_first_loads.extend_from_slice(rd.str());
                        self.pending_is_growth_written = rd.u32() != 0;
                    }
                    frame::Kind::Shutdown => self.shutdown = true,
                    _ => {}
                }
            }
            self.link.channel.restore_incoming(incoming);
        }
        self.pending_idx.is_some() || self.shutdown || self.link.channel.done.get()
    }

    /// Says what the file that runs has counted.
    fn emit_file_done(&mut self, reporter: &CommandLineReporter, vm: &VirtualMachine) {
        let Some(file) = self.running.take() else {
            return;
        };
        let mut growth = file.resident_at_start.map(growth_since).unwrap_or_default();
        if file.resident_at_start.is_none() && crate::cli::run_compiled::logs_accounts() {
            growth.peak = crate::cli::run_compiled::peak_of_this_process_mb();
        }
        let elapsed_ns = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(file.started_ns);
        let (before, after) = (file.before, reporter.summary());
        // What the file printed goes out ahead of the word that it is done, so that it is printed under the file's name.
        Output::flush();
        for refusal in crate::cli::run_compiled::refused_changes() {
            self.link
                .emit(frame::Kind::RefusedChange, |wf| wf.str(&refusal));
        }
        let first_loads = first_loads(vm);
        self.link.emit(frame::Kind::FileDone, |wf| {
            for v in [
                file.idx,
                after.pass - before.pass,
                after.fail - before.fail,
                after.skip - before.skip,
                after.todo - before.todo,
                after.expectations - before.expectations,
                after.skipped_because_label - before.skipped_because_label,
                after.files - before.files,
                after.shuffled - before.shuffled,
                reporter.jest.unhandled_errors_between_tests.get() - file.before_unhandled,
            ] {
                wf.u32(v);
            }
            wf.u64(elapsed_ns);
            wf.u32(growth.of_worker);
            wf.u32(growth.largest_child);
            wf.u32(growth.peak);
            wf.str(&first_loads);
        });
    }
}

// Hoisted from a local struct inside run_as_worker — Rust does not
// support method-bearing local structs that need to be named in a generic call.
struct WorkerLoop {
    reporter: &'static CommandLineReporter,
    cmds: WorkerCommands,
    files_run: u32,
}

impl WorkerLoop {
    fn begin(&mut self, vm: &VirtualMachine) {
        let end = bun_sys::File::from_fd(Fd::from_uv(3));
        if !self.cmds.link.channel.adopt(vm, end) {
            bun_core::pretty_errorln!("<red>error<r>: test worker failed to adopt IPC fd");
            Global::exit(1);
        }

        // Test hook: "abort" dies by SIGABRT (the startup-panic branch),
        // anything else exits 1 (the bounded-respawn branch). Real init
        // failures aren't reproducible from a test. Debug/ASAN builds only,
        // so a stray env var can't disable --parallel in a release build.
        if cfg!(any(debug_assertions, bun_asan)) {
            // SAFETY: env loader is initialized before the test runner runs.
            let env = unsafe { &*vm.transpiler.get().env };
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

        self.cmds.link.emit(frame::Kind::Ready, |_| {});

        loop {
            // The channel holds no reference on the loop, and a loop that nothing holds polls without sleeping.
            let waits_for_command = bun_io::JsKeepAlive::active();
            while !self.cmds.read_commands() {
                vm.event_loop().tick();
                if self.cmds.read_commands() {
                    break;
                }
                vm.event_loop().auto_tick();
            }
            drop(waits_for_command);
            let Some(idx) = self.cmds.pending_idx.take() else {
                break;
            };
            if self.files_run == 0 {
                note_first_loads_of_earlier_process(vm, &self.cmds.pending_first_loads);
            }
            self.files_run += 1;

            self.cmds.link.file_idx.set(idx);
            (self.cmds.link).emit(frame::Kind::FileStart, |wf| wf.u32(idx));

            self.cmds.running = Some(RunningFile {
                idx,
                before: self.reporter.summary(),
                before_unhandled: self.reporter.jest.unhandled_errors_between_tests.get(),
                started_ns: bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns(),
                resident_at_start: start_measuring_growth(vm, self.cmds.pending_is_growth_written),
            });

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
            if vm.test_isolation_enabled.get() {
                crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
                vm.swap_global_for_test_isolation();
                self.reporter
                    .jest
                    .bun_test_root
                    .reset_preload_for_test_isolation();
                crate::test_runner::Expect::reset_for_test_isolation(vm.global());
            } else {
                Global::mimalloc_cleanup(false);
            }
            self.reporter.jest.default_timeout_override.set(u32::MAX);
            self.cmds.emit_file_done(self.reporter, vm);
        }
    }
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
    let mut wloop = WorkerLoop {
        reporter,
        cmds: WorkerCommands {
            link,
            pending_idx: None,
            pending_path: Vec::new(),
            pending_first_loads: Vec::new(),
            pending_is_growth_written: false,
            running: None,
            shutdown: false,
        },
        files_run: 0,
    };
    vm.run_with_api_lock(|| wloop.begin(vm));
    crate::cli::run_compiled::log_account_of_process(format_args!(
        "worker | files {}",
        wloop.files_run
    ));

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
    vm.run_with_api_lock(|| {
        while channel.has_pending_writes() && !channel.done.get() {
            vm.event_loop().tick();
            if !channel.has_pending_writes() || channel.done.get() {
                break;
            }
            vm.event_loop().auto_tick();
        }
    });
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
    });
    {
        Global::exit(0);
    }
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
