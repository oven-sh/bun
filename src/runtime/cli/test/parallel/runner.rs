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
use super::coordinator::{Coordinator, StopReason, abort_handler};
use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::parts::Parts;
use super::reservation::Reservation;
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

/// What workers hand on to the end of a run that plain `bun test` does in its own process.
#[derive(Default)]
pub(crate) struct LeftByWorkers {
    /// `process.exitCode = 3` in a test.
    pub(crate) exit_code: Option<u8>,
    pub(crate) failed_to_write_inline_snapshots: bool,
    pub(crate) bailed_out: bool,
}

/// Returns true if files were actually run via the worker pool, false if it
/// left them to the caller to run sequentially (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
#[optimize(size)]
pub(crate) fn run_as_coordinator(
    reporter: &mut CommandLineReporter,
    vm: &VirtualMachine,
    files: &[Interned],
    ctx: Command::Context,
    coverage_opts: &mut CodeCoverageOptions,
    splits_files: bool,
    left_by_workers: &mut LeftByWorkers,
) -> crate::Result<bool> {
    // SAFETY: env loader is initialized before the test runner runs.
    let env = unsafe { &mut *vm.transpiler.env };
    let n: u32 = u32::try_from(files.len()).unwrap();
    let k: u32 = ctx
        .test_options
        .parallel
        .max(u32::from(splits_files))
        .min(n);
    if k <= 1 && !splits_files {
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
    let mut envps: Vec<bun_dotenv::NullDelimitedEnvMap> = Vec::with_capacity(k as usize);
    for i in 0..k {
        if ctx.test_options.parallel > 0 {
            let mut id = Vec::new();
            write!(&mut id, "{}", i + 1).unwrap();
            for name in WORKER_ID_VARIABLES {
                let _ = env.map.put(name, &id);
            }
        } else {
            set_ids_without_workers(env);
        }
        envps.push(env.map.create_null_delimited_env_map()?);
    }
    let (argv, image_flag_slot) = build_worker_argv(ctx, splits_files)?;

    // Sort lexicographically so adjacent indices share parent directories.
    // Each worker owns a contiguous chunk; co-located files share imports, so
    // this keeps each worker's isolation SourceProvider cache hot. --randomize
    // explicitly opts out of locality (the caller already shuffled).
    let ends_as_in_one_process = ctx.test_options.parallel.min(n) <= 1;
    let mut sorted: Vec<Interned> = files.to_vec();
    if !ctx.test_options.randomize && !ends_as_in_one_process {
        index_sort::sort_slice_by(&mut sorted, |a, b| {
            bun_core::order(a.as_bytes(), b.as_bytes())
        });
    }
    let runs_compiled_code = splits_files || crate::cli::run_compiled::runs_compiled_code();
    let reservation = (ctx.test_options.aot_memory_limit)
        .filter(|_| runs_compiled_code)
        .map(|limit| Reservation::new(limit, k as usize));
    if let (Some(reservation), Some(timings)) = (&reservation, reporter.timings.as_mut()) {
        timings.heavy_over = reservation.share_of_worker();
    }
    // With --timings the contiguous chunks are cut by total duration instead
    // of file count, and each chunk is dispatched slowest-first (cache hits
    // depend on which worker runs a file, not the order within the worker).
    let mut costs: Option<Vec<u64>> = None;
    // Empty: they are cut by number.
    let mut ranges_of_parts: Vec<FileRange> = Vec::new();
    // What the first of them took, each of which is one heavy file.
    let mut heavy_growths: Vec<u32> = Vec::new();
    let ranges: Vec<FileRange> = match reporter.timings.as_ref() {
        _ if splits_files => {
            // A program above the layers holds test files alone, so it gains nothing from neighbours.
            if let Some(timings) = reporter.timings.as_ref()
                && !timings.is_empty()
                && !ctx.test_options.randomize
                && ctx.test_options.parallel > 0
                && crate::cli::run_compiled::test_run_layers(ctx) > 0
            {
                timings.sort_slowest_first(&mut sorted);
                // A worker runs a part from its first file to its last. A heavy file has to wait for another to end, so each is a
                // part of its own, which waits without a worker.
                let heavy_parts = timings.move_heavy_first(&mut sorted) as u32;
                let growth_of = |file: &Interned| timings.growth_of(file.as_bytes()).unwrap_or(0);
                heavy_growths = sorted[..heavy_parts as usize]
                    .iter()
                    .map(growth_of)
                    .collect();
                let light = &mut sorted[heavy_parts as usize..];
                let costs = timings.costs_where_unknown_is_slow(light);
                let files = crate::cli::run_compiled::test_part_files(ctx).unwrap_or(n);
                let count = (light.len() as u32).div_ceil(files);
                ranges_of_parts = (0..heavy_parts)
                    .map(|file| FileRange {
                        lo: file,
                        hi: file + 1,
                    })
                    .collect();
                let of_light = super::parts::cut_by_time(light, &costs, count);
                ranges_of_parts.extend(of_light.into_iter().map(|range| FileRange {
                    lo: range.lo + heavy_parts,
                    hi: range.hi + heavy_parts,
                }));
            }
            vec![FileRange { lo: 0, hi: 0 }; k as usize]
        }
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
            part: 0,
            waits_for_heavy_file_to_end: false,
            first_loads: Vec::new(),
        });
    }

    let sorted_for_parts = sorted.len() as u32;
    let room_for_heavy_files = (reporter.timings.as_ref()).map_or(0, |t| t.largest_growth(&sorted));
    let room_beside_heavy_files = (reporter.timings.as_ref()).map_or(0, |t| {
        t.growth_of_average_files(&sorted, k.saturating_sub(1))
    });
    let growth_of_running_light_file =
        (reporter.timings.as_ref()).map_or(0, |t| t.growth_of_running_light_file(&sorted));
    let heavy_files_to_hand_out = (reporter.timings.as_ref()).map_or(0, |t| {
        sorted
            .iter()
            .filter(|file| t.is_heavy(file.as_bytes()))
            .count() as u32
    });
    let mut coord = Coordinator {
        vm,
        event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
        reporter,
        files: sorted,
        costs,
        cwd: FileSystem::get().top_level_dir(),
        cwd_of_builds: (ctx.original_cwd.as_deref())
            .unwrap_or_else(|| FileSystem::get().top_level_dir()),
        argv,
        envps,
        // Coordinator borrows the workers slice while each Worker holds a raw
        // backref to the Coordinator; the raw pointers (never a second `&mut`)
        // are what keep this sound. See the backref patch loop below.
        workers: &mut workers,
        parallel_limit: k,
        keeps_heavy_files_apart: runs_compiled_code,
        // With a limit as well: what a file without a record takes says what the next one may take.
        children_of_workers: (cfg!(target_os = "linux")
            && (ctx.test_options.update_timings || reservation.is_some())
            && runs_compiled_code)
            .then(Default::default),
        reservation,
        growth_of_running_light_file,
        room_for_heavy_files,
        room_beside_heavy_files,
        heavy_files_to_hand_out,
        max_worker_peak_rss_mb: 0,
        max_exited_worker_rss_mb: 0,
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
        header_printed_by_worker: None,
        frame: Frame::default(),
        files_done: 0,
        spawned_count: if splits_files { k } else { 0 },
        parts: splits_files.then(|| {
            Box::new(Parts::new(
                sorted_for_parts,
                crate::cli::run_compiled::test_part_files(ctx).unwrap_or(sorted_for_parts),
                ranges_of_parts,
                &heavy_growths,
                image_flag_slot,
                crate::cli::run_compiled::test_run_layers(ctx),
                crate::cli::run_compiled::stands_on_library_of_this_bun(ctx),
                crate::cli::run_compiled::test_run_has_layer_of_computed_imports(ctx),
            ))
        }),
        live_workers: 0,
        aborted: None,
        ends_as_in_one_process,
        exit_code_left_by_tests: None,
        failed_to_write_inline_snapshots: false,
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
    unsafe { (*vm.event_loop()).ensure_waker() };
    crate::cli::run_compiled::log_step_of_test_run(format_args!("the coordinator is set up"));
    vm.run_with_api_lock(|| coord.drive());
    coord.end_group();
    crate::cli::run_compiled::log_largest_worker(
        coord.max_worker_peak_rss_mb,
        coord.max_exited_worker_rss_mb,
    );
    crate::cli::run_compiled::log_account_of_process(format_args!("coordinator | files {n}"));

    aggregate::replay_test_records(&mut coord);
    if coverage_opts.enabled {
        aggregate::write_coverage_report(&mut coord, coverage_opts);
    }
    if let Some(code) = coord.aborted {
        coord.parts = None;
        coord.reporter.write_junit_report_if_needed();
        coord.reporter.write_timings_if_needed();
        Output::flush();
        Global::exit(code);
    }
    *left_by_workers = LeftByWorkers {
        exit_code: coord.exit_code_left_by_tests,
        failed_to_write_inline_snapshots: coord.failed_to_write_inline_snapshots,
        bailed_out: coord.ends_as_in_one_process && coord.stop_reason == Some(StopReason::Bail),
    };
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
fn build_worker_argv(
    ctx: &Command::ContextData,
    splits_files: bool,
) -> crate::Result<(Box<[bun_spawn::CStrPtr]>, usize)> {
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
    // Not everything in the file has a flag below.
    if let Some(config_file) = &opts.config_file {
        argv.push(print_z(format_args!(
            "--config={}",
            bstr::BStr::new(config_file)
        ))?);
    }
    argv.push(if opts.isolate_modules {
        lit(b"--isolate=modules\0")
    } else if opts.isolate {
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
    // No `--cpu-prof-name` or `--heap-prof-name`: every worker writes a profile, and the default names have the pid in them.
    let cpu_prof = &ctx.runtime_options.cpu_prof;
    if cpu_prof.enabled {
        if cpu_prof.json_format {
            argv.push(lit(b"--cpu-prof\0"));
        }
        if cpu_prof.md_format {
            argv.push(lit(b"--cpu-prof-md\0"));
        }
        if !cpu_prof.dir.is_empty() {
            argv.push(lit(b"--cpu-prof-dir\0"));
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
            b"--heap-prof-md\0"
        } else {
            b"--heap-prof\0"
        }));
        if !heap_prof.dir.is_empty() {
            argv.push(lit(b"--heap-prof-dir\0"));
            argv.push(dupe_z(heap_prof.dir));
        }
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
    if crate::cli::run_compiled::is_checked() {
        argv.push(lit(b"--aot-checked=-\0"));
    }
    if let Some(flag) = crate::cli::run_compiled::graph_flag_of_test_worker() {
        argv.push(dupe_z(&flag));
    }
    // Each spawn writes here the program of the worker's part.
    let image_flag_slot = argv.len();
    if splits_files {
        argv.push(core::ptr::null());
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
    match bun_core::code_generation_from_strings_by_flags() {
        bun_core::CodeGenerationFromStrings::Allowed => {}
        bun_core::CodeGenerationFromStrings::DisallowedLikeNode => {
            argv.push(lit(b"--disallow-code-generation-from-strings\0"));
        }
        bun_core::CodeGenerationFromStrings::Strict => {
            argv.push(lit(b"--disallow-code-generation-from-strings=strict\0"));
        }
    }
    if let Some(flag) = bun_core::Global::ca_store_flag() {
        argv.push(flag.as_ptr().cast());
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
        argv.push(lit(b"--react-compiler\0"));
    }

    argv.push(core::ptr::null());
    // Callers index by .len(), so keep the trailing null in the boxed slice.
    Ok((argv.into_boxed_slice(), image_flag_slot))
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
pub(crate) struct PendingFile {
    idx: u32,
    /// What the files before this one have left in `process.exitCode`, in whichever worker they ran.
    exit_code: Option<u8>,
    stands_for_one_process: bool,
    failures_until_bail: u32,
}

struct RunningFile {
    idx: u32,
    before: crate::test_runner::jest::Summary,
    before_unhandled: u32,
    exit_code_before: u8,
    started_ns: u64,
    resident_at_start: Option<ResidentAtStart>,
}

pub(crate) struct WorkerCommands {
    pub(crate) channel: Channel<WorkerCommands>,
    /// Reused across all worker → coordinator emits.
    frame: Frame,
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pub(crate) pending_file: Option<PendingFile>,
    pub(crate) pending_path: Vec<u8>,
    /// `first_loads` of the process that ran in this one's place before it.
    pub(crate) pending_first_loads: Vec<u8>,
    running: Option<RunningFile>,
    /// EOF, error, `.shutdown`, or a corrupt frame.
    pub(crate) done: bool,
    /// `worker_flush_aggregates`. Whatever lets a timer fire reaches `bail_out`, `Bun.spawnSync` in an executable too, and the flush reaches the
    /// transpiler and the bundler. Held here, only `run_as_worker` names it, and an executable that never runs tests need not hold what it reaches.
    flush_aggregates: FlushAggregates,
}

type FlushAggregates =
    fn(&mut CommandLineReporter, &mut VirtualMachine, &CodeCoverageOptions, &mut WorkerCommands);

impl WorkerCommands {
    /// Sends one frame of `kind`; `fill` writes its payload.
    fn emit(&mut self, kind: frame::Kind, fill: impl FnOnce(&mut Frame)) {
        self.frame.begin(kind);
        fill(&mut self.frame);
        self.channel.send(self.frame.finish());
    }

    /// Says what the file that runs has counted: at its end, or where `--bail` ends it.
    fn emit_file_done(&mut self, reporter: &mut CommandLineReporter, vm: &VirtualMachine) {
        let Some(file) = self.running.take() else {
            return;
        };
        let growth = file.resident_at_start.map(growth_since).unwrap_or_default();
        let elapsed_ns = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(file.started_ns);
        let (before, after) = (file.before, *reporter.summary());
        // What the file printed goes out ahead of the word that it is done, so that it is printed under the file's name.
        Output::flush();
        for refusal in crate::cli::run_compiled::refused_changes() {
            self.emit(frame::Kind::RefusedChange, |wf| wf.str(&refusal));
        }
        let first_loads = first_loads(vm);
        self.emit(frame::Kind::FileDone, |wf| {
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
                reporter.jest.unhandled_errors_between_tests - file.before_unhandled,
            ] {
                wf.u32(v);
            }
            wf.u64(elapsed_ns);
            wf.u32(growth.of_worker);
            wf.u32(growth.largest_child);
            wf.u32(growth.peak);
            wf.u32(growth.rest);
            wf.u32(match vm.exit_handler.exit_code {
                code if code == file.exit_code_before => 0,
                code => u32::from(code) + 1,
            });
            wf.str(&first_loads);
        });
    }
}

bun_core::intrusive_field!(WorkerCommands, channel: Channel<WorkerCommands>);
impl ChannelOwner for WorkerCommands {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        match kind {
            frame::Kind::Run => {
                let idx = rd.u32();
                self.pending_path.clear();
                self.pending_path.extend_from_slice(rd.str());
                let exit_code = rd.u32().checked_sub(1).map(|code| code as u8);
                self.pending_first_loads.clear();
                self.pending_first_loads.extend_from_slice(rd.str());
                self.pending_file = Some(PendingFile {
                    idx,
                    exit_code,
                    stands_for_one_process: rd.u32() != 0,
                    failures_until_bail: rd.u32(),
                });
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
struct WorkerLoop<'a> {
    reporter: &'a mut CommandLineReporter,
    cmds: WorkerCommands,
    files_run: u32,
}

impl<'a> WorkerLoop<'a> {
    fn begin(&mut self, vm: &mut VirtualMachine) {
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

        self.cmds.emit(frame::Kind::Ready, |_| {});

        loop {
            while self.cmds.pending_file.is_none() && !self.cmds.done {
                vm.event_loop_ref().tick();
                if self.cmds.pending_file.is_some() || self.cmds.done {
                    break;
                }
                vm.event_loop_ref().auto_tick();
            }
            let Some(PendingFile {
                idx,
                exit_code,
                stands_for_one_process,
                failures_until_bail,
            }) = self.cmds.pending_file.take()
            else {
                break;
            };
            if self.files_run == 0 {
                note_first_loads_of_earlier_process(vm, &self.cmds.pending_first_loads);
            }
            self.files_run += 1;

            self.reporter.worker_ipc_file_idx = Some(idx);
            self.reporter.worker_stands_for_one_process = stands_for_one_process;
            self.reporter.jest.bail = match failures_until_bail {
                0 => 0,
                left => self.reporter.summary().fail + left,
            };
            self.cmds.emit(frame::Kind::FileStart, |wf| wf.u32(idx));

            if let Some(code) = exit_code {
                vm.exit_handler.exit_code = code;
            }
            self.cmds.running = Some(RunningFile {
                idx,
                before: *self.reporter.summary(),
                before_unhandled: self.reporter.jest.unhandled_errors_between_tests,
                exit_code_before: vm.exit_handler.exit_code,
                started_ns: bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns(),
                resident_at_start: start_measuring_growth(),
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
            if vm.test_isolation_enabled {
                crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
                vm.swap_global_for_test_isolation();
                self.reporter
                    .jest
                    .bun_test_root
                    .reset_hook_scope_for_test_isolation();
                crate::test_runner::Expect::reset_for_test_isolation(vm.global());
            } else {
                Global::mimalloc_cleanup(false);
            }
            self.reporter.jest.default_timeout_override = u32::MAX;
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
    /// What the worker holds of its own now that the file has ended.
    rest: u32,
}

/// Sets the highest resident size that the kernel remembers back to the present one, and answers that. A compiled run asks; only
/// Linux can.
fn start_measuring_growth() -> Option<ResidentAtStart> {
    #[cfg(target_os = "linux")]
    if crate::cli::run_compiled::runs_compiled_code() {
        let [peak, all, of_files, of_shared_memory] =
            read_kilobytes([b"VmHWM:", b"VmRSS:", b"RssFile:", b"RssShmem:"])?;
        let flags = bun_sys::O::WRONLY | bun_sys::O::CLOEXEC;
        let marks =
            bun_sys::File::openat(bun_sys::Fd::cwd(), b"/proc/self/clear_refs", flags, 0).ok()?;
        let written = marks.write_all(b"5");
        let _ = marks.close();
        written.ok()?;
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
    if let Some([highest, own, of_files, of_shared_memory]) =
        read_kilobytes([b"VmHWM:", b"RssAnon:", b"RssFile:", b"RssShmem:"])
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
            rest: megabytes(own),
        };
    }
    let _ = at_start;
    Growth::default()
}

/// Worker side: read framed commands from the IPC channel via the event loop,
/// run each file with isolation, stream per-test events back. Never returns.
#[optimize(size)]
pub(crate) fn run_as_worker(
    reporter: &mut CommandLineReporter,
    vm: &mut VirtualMachine,
    ctx: Command::Context,
) -> ! {
    vm.test_isolation_enabled = ctx.test_options.isolate;
    vm.test_isolation_state.shares_global = ctx.test_options.isolate_modules;
    vm.auto_killer.enabled = ctx.test_options.isolate;

    // `vm.arena` is currently a write-only backref: the `MimallocArena.gc()`
    // reader was dropped from the GC path (see web_worker.rs, which wires its
    // own arena the same way and notes the dropped read).
    let mut arena = bun_alloc::MimallocArena::new();
    // SAFETY: event_loop pointer is valid while vm lives.
    unsafe { (*vm.event_loop()).ensure_waker() };
    vm.arena = Some(NonNull::from(&mut arena));
    // vm.allocator = arena.arena(); — allocator params dropped in Rust

    let mut wloop = WorkerLoop {
        reporter,
        cmds: WorkerCommands {
            channel: Channel::default(),
            frame: Frame::default(),
            pending_file: None,
            pending_path: Vec::new(),
            pending_first_loads: Vec::new(),
            running: None,
            done: false,
            flush_aggregates: worker_flush_aggregates,
        },
        files_run: 0,
    };
    vm.run_with_api_lock_mut(|vm| wloop.begin(vm));
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

    worker_flush_aggregates(
        wloop.reporter,
        vm,
        &ctx.test_options.coverage,
        &mut wloop.cmds,
    );
    // Mirror TestCommand::exec's exit path so BUN_DESTRUCT_VM_ON_EXIT teardown
    // (lastChanceToFinalize) runs; bypassing it leaks JSC-owned native state.
    vm.exit_handler.exit_code = 0;
    vm.exit_handler.skip_exit_listeners = test_command::skip_exit_listeners(wloop.reporter);
    vm.exit_handler.requested = test_command::exit_is_requested();
    vm.run_with_api_lock_mut(|vm| {
        vm.on_exit();
        vm.global_exit()
    });
    {
        Global::exit(0);
    }
}

#[optimize(size)]
fn worker_flush_aggregates(
    reporter: &mut CommandLineReporter,
    vm: &mut VirtualMachine,
    coverage: &CodeCoverageOptions,
    cmds: &mut WorkerCommands,
) {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    let runner = &mut reporter.jest;
    let wrote_inline_snapshots = runner
        .snapshots
        .write_inline_snapshots(&runner.files)
        .unwrap_or(false);
    let _ = runner.snapshots.write_snapshot_file(&runner.files);
    if crate::cli::run_compiled::runs_compiled_code() {
        let counted = &runner.snapshots;
        let numbers = [
            counted.total,
            counted.passed,
            counted.failed,
            counted.added,
            usize::from(!wrote_inline_snapshots),
        ];
        cmds.emit(frame::Kind::Snapshots, |wf| {
            for number in numbers {
                wf.u32(number as u32);
            }
        });
    }

    cmds.emit(frame::Kind::RepeatBufs, |wf| {
        wf.str(reporter.failures_to_repeat_buf.as_slice());
        wf.str(reporter.skips_to_repeat_buf.as_slice());
        wf.str(reporter.todos_to_repeat_buf.as_slice());
    });

    if coverage.enabled {
        let mut encoded: Vec<u8> = Vec::new();
        CommandLineReporter::add_compiled_files_to_coverage(vm);
        CommandLineReporter::for_each_coverage_report(vm, coverage, |report| {
            encoded.clear();
            code_coverage::wire::encode(&report, &mut encoded);
            cmds.emit(frame::Kind::CoverageFile, |wf| wf.str(&encoded));
        });
    }

    // Drain any backpressure-buffered frames before exit so the coordinator
    // sees repeat_bufs / coverage_file.
    vm.run_with_api_lock(|| {
        while cmds.channel.has_pending_writes() && !cmds.channel.done.get() {
            // SAFETY: event_loop pointer is valid while vm lives.
            unsafe { (*vm.event_loop()).tick() };
            if !cmds.channel.has_pending_writes() || cmds.channel.done.get() {
                break;
            }
            // SAFETY: event_loop pointer is valid while vm lives.
            unsafe { (*vm.event_loop()).auto_tick() };
        }
    });
}

/// `--bail` is reached in a worker that stands for the one process of plain `bun test`: no further test runs, as there.
pub(crate) fn worker_ends_at_bail(reporter: &mut CommandLineReporter, vm: &mut VirtualMachine) {
    // SAFETY: single-threaded worker; WORKER_CMDS only written/read on this thread.
    let Some(cmds_ptr) = (unsafe { WORKER_CMDS.read() }) else {
        return;
    };
    // SAFETY: cmds_ptr was set from &mut WorkerCommands in run_as_worker; pointee
    // outlives all callers (process exits before it is dropped).
    let cmds = unsafe { &mut *cmds_ptr };
    cmds.emit_file_done(reporter, vm);
    let options = reporter.jest.test_options;
    (cmds.flush_aggregates)(reporter, vm, &options.coverage, cmds);
}

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
#[optimize(size)]
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
    cmds.emit(frame::Kind::TestDone, |wf| {
        wf.u32(file_idx);
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
