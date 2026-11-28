//! `bun test --reuse` (or a record directory and `BUN_TEST_INPUT_REUSE`) under `--isolate`: before
//! the run, a test file whose record still holds is not run, and its recorded counts go into the
//! summary.
//!
//! A record holds when the run has the same fingerprint, the file passed with no unhandled error and
//! nothing from an earlier file ran into it, it did nothing a record can't replay (`marks`), no
//! plugin answered a resolution or served a source, every file it loaded or that answered one of its
//! resolutions has the bytes it had, and every question it asked the resolver gets the same answer
//! with the same details when asked again. Each path is hashed once and each question asked once per
//! run, however many records list it. `explain` says why each other file runs. `check` runs every
//! file anyway and fails the run when a file whose record held ends with other counts than its
//! record has: a miss of the records, found in one run. `list` validates, says for each file whether
//! it would run and why, and exits without running any.
//!
//! Records are states in the store of the record directory (`bun_jsc::test_input_store`); a file
//! has up to a few, and the newest one whose inputs hold on the current tree decides.

use bun_collections::HashMap;
use std::io::Write as _;

use bun_core::{Global, env, pretty_error};
use bun_jsc::test_input_recorder as recorder;
use bun_jsc::test_input_store::{self as store, EntryView, Store};
use bun_jsc::test_own_reads::Look;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::{ContextData, MacroOptions, TestGlobals, TestReuse as Mode};
use bun_ptr::Interned;
use bun_sys::{Fd, File};

/// What the run was started with that can change a test file's outcome, one `name=value` per line.
/// Paths under the record root (`recorder::record_root`) are relative to it, and the root itself is
/// not in it, so the fingerprint is the same in another checkout of the repository.
pub(crate) fn fingerprint(ctx: &ContextData, vm: &VirtualMachine) -> Vec<u8> {
    let root = recorder::record_root(vm);
    let relative = |path: &[u8]| -> Vec<u8> { root.relative(path).unwrap_or(path).to_vec() };
    let mut out = Vec::with_capacity(1024);
    // Where in the repository the run starts: its working directory.
    let _ = writeln!(
        out,
        "project={}",
        bstr::BStr::new(&relative(vm.top_level_dir()))
    );
    // Under `--aot` loads that compiled code refuses fail the run, so the same inputs can give
    // another outcome. Such a run does not record (see `test_command`); the line keeps the two
    // kinds of record apart if that changes.
    let _ = writeln!(out, "aot={}", ctx.bundler_options.aot.is_some());
    let list = |out: &mut Vec<u8>, name: &str, items: &mut dyn Iterator<Item = Vec<u8>>| {
        let _ = write!(out, "{name}=");
        for (i, item) in items.enumerate() {
            if i > 0 {
                out.push(b',');
            }
            out.extend_from_slice(&item);
        }
        out.push(b'\n');
    };
    let bytes =
        |items: &[Box<[u8]>]| -> Vec<Vec<u8>> { items.iter().map(|it| it.to_vec()).collect() };
    let opt = |it: &Option<Box<[u8]>>| bstr::BString::from(it.as_deref().unwrap_or(b"-"));

    let test = &ctx.test_options;
    // Another build of Bun may record other inputs for the same file.
    let _ = writeln!(out, "bun={}", Global::package_json_version_with_revision);
    let _ = writeln!(
        out,
        "recorder={}.{}",
        recorder::RECORD_VERSION,
        bun_jsc::test_input_store::STORE_VERSION
    );
    let _ = writeln!(
        out,
        "platform={}-{}",
        env::OS.npm_name(),
        env::ARCH.npm_name()
    );
    let _ = writeln!(out, "timeout={}", test.default_timeout_ms);
    let _ = writeln!(out, "updateSnapshots={}", test.update_snapshots);
    let _ = writeln!(out, "rerunEach={}", test.repeat_count);
    let _ = writeln!(out, "retry={}", test.retry);
    let _ = writeln!(out, "todo={}", test.run_todo);
    let _ = writeln!(out, "only={}", test.only);
    let _ = writeln!(out, "concurrent={}", test.concurrent);
    // Without `--seed`, a randomized run draws one, and no record of it is reused.
    let _ = writeln!(out, "randomize={}", test.randomize);
    if test.randomize {
        let _ = writeln!(out, "seed={:?}", test.seed);
    }
    list(
        &mut out,
        "concurrentTestGlob",
        &mut test
            .concurrent_test_glob
            .iter()
            .flatten()
            .map(|it| it.to_vec()),
    );
    let _ = writeln!(out, "coverage={}", test.coverage.enabled);
    let _ = writeln!(out, "testNamePattern={}", opt(&test.test_filter_pattern));
    let _ = writeln!(out, "maxConcurrency={}", test.max_concurrency);
    let _ = writeln!(
        out,
        "resetsBeforeEachTest={:?}",
        test.resets_before_each_test
    );
    let _ = writeln!(out, "isolateModules={}", test.isolate_modules);
    let _ = writeln!(
        out,
        "environment={}",
        test.environment.map_or("-", |it| it.name())
    );
    let _ = writeln!(
        out,
        "globals={}",
        match test.globals {
            None => "-",
            Some(TestGlobals::Bun) => "bun",
            Some(TestGlobals::Vitest) => "vitest",
        }
    );
    match &test.react_compiler {
        None => out.extend_from_slice(b"reactCompiler=-\n"),
        Some(scope) => {
            list(
                &mut out,
                "reactCompiler.include",
                &mut bytes(&scope.include).into_iter(),
            );
            list(
                &mut out,
                "reactCompiler.exclude",
                &mut bytes(&scope.exclude).into_iter(),
            );
        }
    }
    list(
        &mut out,
        "preload",
        &mut ctx.preloads.iter().map(|it| relative(it)),
    );

    let args = &ctx.args;
    match &args.jsx {
        None => out.extend_from_slice(b"jsx=-\n"),
        Some(jsx) => {
            let _ = writeln!(
                out,
                "jsx={:?},{},{},{},{},{}",
                jsx.runtime,
                bstr::BStr::new(&jsx.factory),
                bstr::BStr::new(&jsx.fragment),
                jsx.development,
                bstr::BStr::new(&jsx.import_source),
                jsx.side_effects
            );
        }
    }
    let _ = writeln!(
        out,
        "tsconfigOverride={}",
        bstr::BString::from(
            args.tsconfig_override
                .as_deref()
                .map_or_else(|| b"-".to_vec(), relative)
        )
    );
    match &args.define {
        None => out.extend_from_slice(b"define=-\n"),
        Some(define) => list(
            &mut out,
            "define",
            &mut define.keys.iter().zip(&define.values).map(|(key, value)| {
                let mut pair = key.to_vec();
                pair.push(b'=');
                pair.extend_from_slice(value);
                pair
            }),
        ),
    }
    list(&mut out, "drop", &mut bytes(&args.drop).into_iter());
    list(
        &mut out,
        "featureFlags",
        &mut bytes(&args.feature_flags).into_iter(),
    );
    let _ = writeln!(out, "preserveSymlinks={:?}", args.preserve_symlinks);
    list(
        &mut out,
        "inject",
        &mut args.inject.iter().map(|it| relative(it)),
    );
    list(&mut out, "external", &mut bytes(&args.external).into_iter());
    match &args.loaders {
        None => out.extend_from_slice(b"loaders=-\n"),
        Some(loaders) => list(
            &mut out,
            "loaders",
            &mut loaders
                .extensions
                .iter()
                .zip(&loaders.loaders)
                .map(|(ext, loader)| {
                    let mut pair = ext.to_vec();
                    let _ = write!(pair, "={loader:?}");
                    pair
                }),
        ),
    }
    list(
        &mut out,
        "mainFields",
        &mut bytes(&args.main_fields).into_iter(),
    );
    let _ = writeln!(out, "target={:?}", args.target);
    list(
        &mut out,
        "envFiles",
        &mut bytes(&args.env_files).into_iter(),
    );
    let _ = writeln!(
        out,
        "disableDefaultEnvFiles={}",
        args.disable_default_env_files
    );
    list(
        &mut out,
        "extensionOrder",
        &mut bytes(&args.extension_order).into_iter(),
    );
    list(
        &mut out,
        "conditions",
        &mut bytes(&args.conditions).into_iter(),
    );
    let _ = writeln!(out, "packages={:?}", args.packages);
    let _ = writeln!(out, "ignoreDceAnnotations={}", args.ignore_dce_annotations);
    let _ = writeln!(out, "allowAddons={:?}", args.allow_addons);
    let _ = writeln!(out, "allowFfiCc={:?}", args.allow_ffi_cc);
    let _ = writeln!(out, "unhandledRejections={:?}", args.unhandled_rejections);
    match &ctx.debug.macros {
        MacroOptions::Unspecified => out.extend_from_slice(b"macros=-\n"),
        MacroOptions::Disable => out.extend_from_slice(b"macros=off\n"),
        MacroOptions::Map(map) => list(
            &mut out,
            "macros",
            &mut map.keys().iter().zip(map.values()).map(|(package, names)| {
                let mut entry = package.to_vec();
                for (name, replacement) in names.keys().iter().zip(names.values()) {
                    let _ = write!(
                        entry,
                        ":{}={}",
                        bstr::BStr::new(name),
                        bstr::BStr::new(replacement)
                    );
                }
                entry
            }),
        ),
    }
    // What both transpile paths take for every module from the transpiler's options: set from the
    // flags above and from the root directory's tsconfig.json, which is a file and not a flag.
    let options = &vm.transpiler.get().options;
    let jsx = &options.jsx;
    let members = |list: &bun_options_types::jsx::MemberList| -> bstr::BString {
        let parts: Vec<&[u8]> = list.iter().collect();
        bstr::BString::from(parts.join(&b"."[..]))
    };
    let _ = writeln!(
        out,
        "transpiler.jsx={:?},{},{},{},{},{},{},{}",
        jsx.runtime,
        members(&jsx.factory),
        members(&jsx.fragment),
        bstr::BStr::new(&jsx.import_source.production),
        bstr::BStr::new(&jsx.import_source.development),
        bstr::BStr::new(&jsx.classic_import_source),
        jsx.development,
        jsx.side_effects
    );
    let _ = writeln!(
        out,
        "transpiler.decorators={},{}",
        options.experimental_decorators, options.emit_decorator_metadata
    );
    let _ = writeln!(
        out,
        "transpiler.useDefineForClassFields={}",
        options.use_define_for_class_fields
    );
    let _ = writeln!(
        out,
        "transpiler.features={:?},{},{},{},{},{},{},{}",
        options.trim_unused_imports,
        options.tree_shaking,
        options.no_macros,
        options.inlining,
        options.auto_import_jsx,
        options.allow_runtime,
        options.defers_requires,
        options.rewrite_jest_for_tests
    );
    list(
        &mut out,
        "transpiler.macroRemap",
        &mut options.macro_remap.keys().iter().map(|it| it.to_vec()),
    );
    let runtime = &ctx.runtime_options;
    let _ = writeln!(out, "smol={}", runtime.smol);
    let _ = writeln!(out, "exposeGc={}", runtime.expose_gc);
    let _ = writeln!(out, "consoleDepth={:?}", runtime.console_depth);
    let _ = writeln!(
        out,
        "preserveSymlinksMain={}",
        runtime.preserve_symlinks_main
    );
    let _ = writeln!(
        out,
        "dnsResultOrder={}",
        bstr::BStr::new(&runtime.dns_result_order)
    );
    write_environment(&mut out, ctx, vm);
    let salt = bun_core::env_var::BUN_TEST_INPUT_RECORD_SALT
        .get()
        .unwrap_or(b"");
    let _ = writeln!(out, "salt={}", bstr::BStr::new(salt));
    out
}

/// The environment Bun itself acts on, the `.env` files `bun test` loads, and the variables named in
/// `BUN_TEST_INPUT_RECORD_ENV`. What test code reads from `process.env` is not recorded per file:
/// a variable that differs on every run, such as a database port, would make every record stale.
fn write_environment(out: &mut Vec<u8>, ctx: &ContextData, vm: &VirtualMachine) {
    // SAFETY: `vm.transpiler.env` is the process-lifetime DotEnv loader pointer.
    let loaded = unsafe { &*vm.transpiler.get().env };
    let value = |name: &[u8]| bstr::BString::from(loaded.get(name).unwrap_or(b"-"));
    let _ = writeln!(out, "env.TZ={}", value(b"TZ"));
    let _ = writeln!(out, "env.NODE_ENV={}", value(b"NODE_ENV"));
    let _ = writeln!(out, "env.CI={}", bun_core::ci_info::is_ci());
    let _ = writeln!(
        out,
        "env.BUN_DISABLE_TRANSPILER={}",
        value(b"BUN_DISABLE_TRANSPILER")
    );
    let _ = writeln!(
        out,
        "env.NODE_PRESERVE_SYMLINKS_MAIN={}",
        value(b"NODE_PRESERVE_SYMLINKS_MAIN")
    );
    // JSC options and feature flags are read from the process environment, before any `.env` file.
    let mut process: Vec<(Vec<u8>, Vec<u8>)> = std::env::vars_os()
        .filter_map(|(name, value)| {
            let name = name.as_encoded_bytes();
            (name.starts_with(b"BUN_JSC_") || name.starts_with(b"BUN_FEATURE_FLAG_"))
                .then(|| (name.to_vec(), value.as_encoded_bytes().to_vec()))
        })
        .collect();
    process.sort();
    for (name, value) in process {
        let _ = writeln!(
            out,
            "env.{}={}",
            bstr::BStr::new(&name),
            bstr::BStr::new(&value)
        );
    }
    if let Some(names) = bun_core::env_var::BUN_TEST_INPUT_RECORD_ENV.get_not_empty() {
        let mut names: Vec<&[u8]> = bun_core::strings::split(names, b",")
            .map(|it| it.trim_ascii())
            .filter(|it| !it.is_empty())
            .collect();
        names.sort();
        names.dedup();
        for name in names {
            let _ = writeln!(out, "env.{}={}", bstr::BStr::new(name), value(name));
        }
    }

    // The files `bun test` loads: the `--env-file` list, or else the test defaults in the working
    // directory. A missing file is written as such, so creating one changes the fingerprint.
    let args = &ctx.args;
    let files: Vec<&[u8]> = if !args.env_files.is_empty() {
        args.env_files.iter().map(|it| &**it).collect()
    } else if !args.disable_default_env_files {
        vec![b".env.test.local", b".env.test", b".env"]
    } else {
        Vec::new()
    };
    for file in files {
        let _ = write!(out, "envFile.{}=", bstr::BStr::new(file));
        match File::read_from(Fd::cwd(), file) {
            Ok(contents) => {
                recorder::write_hex(out, &recorder::source_hash(&contents));
                out.push(b'\n');
            }
            Err(_) => out.extend_from_slice(b"-\n"),
        }
    }
}

/// A test file that is not run: its record holds.
pub(crate) struct Reused {
    pub(crate) file: Interned,
    pub(crate) pass: u32,
    pub(crate) skip: u32,
    pub(crate) todo: u32,
    pub(crate) expectations: u32,
}

/// Where records go when `--reuse` is on and `BUN_TEST_INPUT_RECORD_DIR` is not set, under the
/// record root: beside what `bun install` and other tools cache there.
pub(crate) const DEFAULT_RECORD_DIR: &[u8] = b"node_modules/.cache/bun-test-reuse";

/// The record directory, absolute: `BUN_TEST_INPUT_RECORD_DIR`, else the default under the record
/// root when `--reuse` is on. `None` when nothing is recorded.
pub(crate) fn record_dir(ctx: &ContextData, vm: &VirtualMachine) -> Option<Vec<u8>> {
    if let Some(dir) = bun_core::env_var::BUN_TEST_INPUT_RECORD_DIR.get_not_empty() {
        return Some(
            bun_paths::Path::resolve(&[vm.top_level_dir(), dir])
                .as_bytes()
                .to_vec(),
        );
    }
    ctx.test_options.reuse?;
    let root = recorder::record_root(vm);
    Some(
        bun_paths::Path::resolve(&[&root.given, DEFAULT_RECORD_DIR])
            .as_bytes()
            .to_vec(),
    )
}

/// What is done with the files whose record holds: `BUN_TEST_INPUT_REUSE` when set, else `--reuse`
/// or `[test] reuse`. `None` when they run as any other.
pub(crate) fn mode(ctx: &ContextData) -> Option<Mode> {
    let Some(setting) = bun_core::env_var::BUN_TEST_INPUT_REUSE.get_not_empty() else {
        return ctx.test_options.reuse;
    };
    match setting {
        b"0" | b"false" | b"no" | b"off" => None,
        b"1" => Some(Mode::Reuse),
        other => match Mode::from_name(other) {
            Some(mode) => Some(mode),
            None => {
                // A mistyped off switch must not skip files.
                pretty_error!(
                    "<r><red>error<r><d>:<r> BUN_TEST_INPUT_REUSE={} is not one of 1, true, explain, check, list, or 0, false, no, off\n",
                    bstr::BStr::new(other)
                );
                bun_core::Output::flush();
                Global::exit(1);
            }
        },
    }
}

/// Why a file runs: a short kind, and what it is about (a path, a question, a mark), if anything.
struct Why {
    kind: &'static str,
    detail: Vec<u8>,
}

impl Why {
    fn new(kind: &'static str) -> Why {
        Why {
            kind,
            detail: Vec::new(),
        }
    }

    fn with(kind: &'static str, detail: Vec<u8>) -> Why {
        Why { kind, detail }
    }
}

/// A file whose record held under `check`, with the outcome its record has.
struct WouldReuse {
    file: Interned,
    recorded: [u32; 6],
}

thread_local! {
    /// Files `check` runs although their record held, until the run ends. Test files run on one thread.
    /// With when the run started, in nanoseconds since the epoch: the states written since are this run's.
    static CHECKING: core::cell::RefCell<Option<(Vec<WouldReuse>, u64)>> = const { core::cell::RefCell::new(None) };
}

/// With a reuse `mode`, moves the files to run to the front of `files` and returns how many there
/// are, with the files whose record holds. `None` when reuse is off. Under `check`, every file runs
/// and none is returned as reused; [`finish_run`] compares them after the run.
///
/// `BUN_TEST_INPUT_REUSE_REPORT=<path>` writes one JSON line per file: whether its record held, and
/// if not, why (`why`, and `detail` when there is one).
pub(crate) fn take_reusable(
    vm: &VirtualMachine,
    mode: Option<Mode>,
    files: &mut [Interned],
) -> Option<(usize, Vec<Reused>)> {
    let mode = mode?;
    // The store's safety with `--parallel` and two runs at once rests on `flock`.
    if cfg!(not(unix)) {
        pretty_error!(
            "<r><yellow>warn<r><d>:<r> --reuse is not available on this platform; every file runs\n"
        );
        return None;
    }
    let (Some(fingerprint), Some(dir)) = (recorder::fingerprint_hash(vm), recorder::record_dir(vm))
    else {
        pretty_error!(
            "<r><yellow>warn<r><d>:<r> --reuse needs a record directory and --isolate; every file runs\n"
        );
        return None;
    };
    let run_started = now_ns();
    let loading = std::time::Instant::now();
    let store = Store::load(dir);
    let load_ms = loading.elapsed().as_micros() as f64 / 1000.0;
    if store.other_format > 0 {
        pretty_error!(
            "<r><d>reuse:<r> {} {} of another record store format ignored; this run's records replace {}\n",
            store.other_format,
            if store.other_format == 1 {
                "file"
            } else {
                "files"
            },
            if store.other_format == 1 {
                "it"
            } else {
                "them"
            },
        );
    }
    let mut validator = Validator::new(vm, fingerprint, &store);
    let mut listed = Vec::new();
    let mut report = Vec::new();
    let mut reused = Vec::new();
    let mut checking = Vec::new();
    let mut kept = 0;
    let started = std::time::Instant::now();
    // Records of another build, record format, flags or environment: said once in every mode, so
    // that a Bun upgrade does not look like reuse silently stopped working.
    let mut ignored = 0usize;
    vm.run_with_api_lock(|| {
        for i in 0..files.len() {
            let file = files[i];
            let title = validator.shown(file.as_bytes());
            report.extend_from_slice(b"{\"file\":");
            json_string(&mut report, &title);
            match validator.holds(file.as_bytes()) {
                Ok(outcome) => {
                    report.extend_from_slice(b",\"held\":true}\n");
                    if mode == Mode::List {
                        let _ = writeln!(listed, "{}: would be reused", bstr::BStr::new(&title));
                        reused.push(Reused {
                            file,
                            pass: outcome[0],
                            skip: outcome[2],
                            todo: outcome[3],
                            expectations: outcome[4],
                        });
                    } else if mode == Mode::Check {
                        checking.push(WouldReuse {
                            file,
                            recorded: outcome,
                        });
                        files[kept] = file;
                        kept += 1;
                    } else {
                        reused.push(Reused {
                            file,
                            pass: outcome[0],
                            skip: outcome[2],
                            todo: outcome[3],
                            expectations: outcome[4],
                        });
                    }
                }
                Err(why) => {
                    if why.kind == "fingerprint" {
                        ignored += 1;
                    }
                    if mode == Mode::List {
                        let _ = writeln!(
                            listed,
                            "{}: runs: {}{}{}",
                            bstr::BStr::new(&title),
                            why.kind,
                            if why.detail.is_empty() { "" } else { " " },
                            bstr::BStr::new(&why.detail)
                        );
                    }
                    let _ = write!(report, ",\"held\":false,\"why\":\"{}\"", why.kind);
                    if !why.detail.is_empty() {
                        report.extend_from_slice(b",\"detail\":");
                        json_string(&mut report, &why.detail);
                    }
                    report.extend_from_slice(b"}\n");
                    if mode == Mode::Explain {
                        pretty_error!(
                            "<r><d>reuse: {} runs: {}{}{}<r>\n",
                            bstr::BStr::new(&title),
                            why.kind,
                            if why.detail.is_empty() { "" } else { " " },
                            bstr::BStr::new(&why.detail)
                        );
                    }
                    files[kept] = file;
                    kept += 1;
                }
            }
        }
    });
    let held = reused.len() + checking.len();
    if ignored > 0 {
        pretty_error!(
            "<r><d>reuse:<r> {} {} ignored: written by another build or with other settings{}\n",
            ignored,
            if ignored == 1 { "record" } else { "records" },
            if mode == Mode::Explain {
                ""
            } else {
                " (--reuse=explain names each)"
            }
        );
    }
    if mode != Mode::Reuse {
        pretty_error!(
            "<r><d>reuse: {} of {} files {}; {} paths hashed, {} questions asked, {} looks repeated, in {} ms<r>\n",
            held,
            files.len(),
            if mode == Mode::Reuse || mode == Mode::Explain {
                "reused"
            } else {
                "would be reused"
            },
            validator.hashes.len(),
            validator.checks.len(),
            validator.looks.len(),
            started.elapsed().as_micros() as f64 / 1000.0
        );
    }
    write_report(&report, false);
    if mode == Mode::List {
        let _ = bun_core::Output::writer().write_all(&listed);
        pretty_error!(
            "<r><d>reuse list: store of {} states, {} entries and {} strings, {:.1} MB in the store and {} {}, loaded in {} ms; fingerprint {}<r>\n",
            store.states.len(),
            store.entries.len(),
            store.strings.len(),
            store.bytes as f64 / 1e6,
            store.segments,
            if store.segments == 1 {
                "segment"
            } else {
                "segments"
            },
            load_ms,
            bstr::BStr::new(&recorder::fingerprint_hex(vm).unwrap_or_default())
        );
        bun_core::Output::flush();
        Global::exit(0);
    }
    if mode == Mode::Check {
        CHECKING.with_borrow_mut(|it| *it = Some((checking, run_started)));
    }
    Some((kept, reused))
}

/// After files of this run ran: checks the records of the files in `reused` again, as they are on
/// disk now, keeps those that still hold (with the outcome of the state that holds now), and returns
/// the others, to run. A file that ran may have written what a reused file looks at, so a decision
/// taken before the run is not enough. Under `explain`, says why each one runs. After `--bail`
/// stopped the run (`bailed`), nothing runs again: each file whose record no longer holds is said
/// not to have run, with why, whatever the mode.
pub(crate) fn validate_again(
    vm: &VirtualMachine,
    mode: Option<Mode>,
    reused: &mut Vec<Reused>,
    bailed: bool,
) -> Vec<Interned> {
    let (Some(fingerprint), Some(dir)) = (recorder::fingerprint_hash(vm), recorder::record_dir(vm))
    else {
        return Vec::new();
    };
    let explain = mode == Some(Mode::Explain);
    // The directories this process listed before are listed again: a file that ran may have
    // written to one, in a worker the cache knows nothing of.
    bun_resolver::Resolver::bust_all_dir_caches_in(
        &mut bun_resolver::fs::FileSystem::instance().fs,
    );
    let store = Store::load(dir);
    let mut validator = Validator::new(vm, fingerprint, &store);
    let mut report = Vec::new();
    let mut runs = Vec::new();
    vm.run_with_api_lock(|| {
        reused.retain_mut(|it| match validator.holds(it.file.as_bytes()) {
            Ok(outcome) => {
                it.pass = outcome[0];
                it.skip = outcome[2];
                it.todo = outcome[3];
                it.expectations = outcome[4];
                true
            }
            Err(why) => {
                let title = validator.shown(it.file.as_bytes());
                report.extend_from_slice(b"{\"file\":");
                json_string(&mut report, &title);
                let after = if bailed { "bail" } else { "run" };
                let _ = write!(
                    report,
                    ",\"held\":false,\"after\":\"{}\",\"why\":\"{}\"",
                    after, why.kind
                );
                if !why.detail.is_empty() {
                    report.extend_from_slice(b",\"detail\":");
                    json_string(&mut report, &why.detail);
                }
                report.extend_from_slice(b"}\n");
                if bailed {
                    pretty_error!(
                        "<r><d>{}: not run after --bail: {}{}{}<r>\n",
                        bstr::BStr::new(&title),
                        why.kind,
                        if why.detail.is_empty() { "" } else { " " },
                        bstr::BStr::new(&why.detail)
                    );
                } else if explain {
                    pretty_error!(
                        "<r><d>reuse: {} runs after the others: {}{}{}<r>\n",
                        bstr::BStr::new(&title),
                        why.kind,
                        if why.detail.is_empty() { "" } else { " " },
                        bstr::BStr::new(&why.detail)
                    );
                }
                runs.push(it.file);
                false
            }
        });
    });
    if !report.is_empty() {
        write_report(&report, true);
    }
    runs
}

/// At the end of a recording run, in the process that started it: merges this run's records into the
/// store. After a `check` run, then compares each file whose record held with the record this run
/// wrote for it, prints a line per file whose outcome differs and a summary line, and returns how many
/// differ. `None` when this run was not a `check`.
pub(crate) fn finish_run(vm: &VirtualMachine) -> Option<usize> {
    let dir = recorder::record_dir(vm)?;
    recorder::close_segment(vm);
    if let Err(err) = store::merge(dir) {
        pretty_error!(
            "<r><yellow>warn<r><d>:<r> the test input records could not be merged into the store in {}: {}\n",
            bstr::BStr::new(dir),
            err
        );
    }
    finish_check(vm, dir)
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |it| it.as_nanos() as u64)
}

fn finish_check(vm: &VirtualMachine, dir: &[u8]) -> Option<usize> {
    let (checking, run_started) = CHECKING.with_borrow_mut(|it| it.take())?;
    let fingerprint = recorder::fingerprint_hash(vm)?;
    let store = Store::load(dir);
    let validator = Validator::new(vm, fingerprint, &store);
    let mut report = Vec::new();
    let mut mismatches = 0;
    // The number of `expect()` calls is not deterministic in every test (a retry loop, a callback
    // that runs a varying number of times), so a difference in it alone is said, not a mismatch.
    let mut expectations_only = 0;
    for it in &checking {
        let title = validator.shown(it.file.as_bytes());
        // The state this run wrote for the file.
        let fresh = recorder::written_path(vm, it.file.as_bytes())
            .and_then(|path| validator.by_file.get(&*path))
            .and_then(|states| {
                states
                    .iter()
                    .map(|&i| &store.states[i])
                    .find(|state| state.fingerprint == fingerprint && state.time >= run_started)
            })
            .and_then(|state| state.header.outcome);
        report.extend_from_slice(b"{\"file\":");
        json_string(&mut report, &title);
        if fresh == Some(it.recorded) {
            report.extend_from_slice(b",\"check\":\"same\"}\n");
            continue;
        }
        let without_expectations =
            |counts: &[u32; 6]| [counts[0], counts[1], counts[2], counts[3], counts[5]];
        if let Some(fresh) = fresh
            && without_expectations(&fresh) == without_expectations(&it.recorded)
        {
            expectations_only += 1;
            pretty_error!(
                "<r><d>reuse check: {} has the recorded outcome, with {} expect() calls where the record has {}<r>\n",
                bstr::BStr::new(&title),
                fresh[4],
                it.recorded[4]
            );
            let _ = writeln!(
                report,
                ",\"check\":\"expectations\",\"recorded\":{},\"thisRun\":{}}}",
                it.recorded[4], fresh[4]
            );
            continue;
        }
        mismatches += 1;
        let counts = |out: &mut Vec<u8>, counts: &[u32; 6]| {
            for (i, (name, count)) in OUTCOME.iter().zip(counts).enumerate() {
                let _ = write!(
                    out,
                    "{}{} {}",
                    if i > 0 { ", " } else { "" },
                    count,
                    bstr::BStr::new(name)
                );
            }
        };
        let mut line = Vec::new();
        counts(&mut line, &it.recorded);
        line.extend_from_slice(b"; this run: ");
        match &fresh {
            Some(fresh) => counts(&mut line, fresh),
            None => line.extend_from_slice(b"no outcome"),
        }
        pretty_error!(
            "<r><red>reuse check:<r> {} would have been reused, but its outcome differs. Recorded: {}\n",
            bstr::BStr::new(&title),
            bstr::BStr::new(&line)
        );
        report.extend_from_slice(b",\"check\":\"differs\",\"recorded\":");
        outcome_json(&mut report, &it.recorded);
        report.extend_from_slice(b",\"thisRun\":");
        match &fresh {
            Some(fresh) => outcome_json(&mut report, fresh),
            None => report.extend_from_slice(b"null"),
        }
        report.extend_from_slice(b"}\n");
    }
    // The markup is read from the format string, so each color is its own literal.
    let mut expectations = Vec::new();
    if expectations_only > 0 {
        let _ = write!(expectations, ", other expect() counts {expectations_only}");
    }
    if mismatches > 0 {
        pretty_error!(
            "<r><red>reuse check:<r> would reuse {}, mismatches {}{}\n",
            checking.len(),
            mismatches,
            bstr::BStr::new(&expectations)
        );
    } else {
        pretty_error!(
            "<r><d>reuse check:<r> would reuse {}, mismatches {}{}\n",
            checking.len(),
            mismatches,
            bstr::BStr::new(&expectations)
        );
    }
    write_report(&report, true);
    Some(mismatches)
}

fn outcome_json(out: &mut Vec<u8>, counts: &[u32; 6]) {
    out.push(b'{');
    for (i, (name, count)) in OUTCOME.iter().zip(counts).enumerate() {
        let _ = write!(
            out,
            "{}\"{}\":{}",
            if i > 0 { "," } else { "" },
            bstr::BStr::new(name),
            count
        );
    }
    out.push(b'}');
}

fn json_string(out: &mut Vec<u8>, value: &[u8]) {
    let _ = write!(
        out,
        "{}",
        bun_core::fmt::format_json_string_utf8(value, Default::default())
    );
}

/// Writes (or, after the run, appends) to `BUN_TEST_INPUT_REUSE_REPORT`, if it is set.
fn write_report(lines: &[u8], append: bool) {
    let Some(path) = bun_core::env_var::BUN_TEST_INPUT_REUSE_REPORT.get_not_empty() else {
        return;
    };
    let flags = bun_sys::O::WRONLY
        | bun_sys::O::CREAT
        | bun_sys::O::CLOEXEC
        | if append {
            bun_sys::O::APPEND
        } else {
            bun_sys::O::TRUNC
        };
    let written =
        File::openat(Fd::cwd(), path, flags, 0o666).and_then(|file| file.write_all(lines));
    if let Err(err) = written {
        pretty_error!(
            "<r><yellow>warn<r><d>:<r> BUN_TEST_INPUT_REUSE_REPORT could not be written: {}\n",
            err
        );
    }
}

struct Validator<'a> {
    vm: &'a VirtualMachine,
    fingerprint: [u8; 32],
    store: &'a Store,
    /// State indexes by the test file's path as records write it, newest first.
    by_file: HashMap<&'a [u8], Vec<usize>>,
    /// By absolute path: the SHA-256 of the file now, `None` if it can't be read.
    hashes: HashMap<Vec<u8>, Option<[u8; 32]>>,
    /// By absolute path: the `aotConfig` of the module now.
    aot: HashMap<Vec<u8>, Option<[u8; 32]>>,
    /// By question: the `check` of its answer now, `None` if it can't be asked again.
    checks: HashMap<Vec<u8>, Option<[u8; 32]>>,
    /// By look, path and extra: what looking again gives now.
    looks: HashMap<Vec<u8>, Box<[u8]>>,
    /// By entry id, two bits per step of [`Validator::inputs_why`]: the entry passed that step.
    passed: Vec<u8>,
}

/// pass, fail, skip, todo, expectations, unhandledErrors.
const OUTCOME: [&[u8]; 6] = [
    b"pass",
    b"fail",
    b"skip",
    b"todo",
    b"expectations",
    b"unhandledErrors",
];

/// The steps of [`Validator::inputs_why`], as bits of [`Validator::passed`].
const STATIC: u8 = 1;
const CONTENTS: u8 = 2;
const AOT: u8 = 4;
const AGAIN: u8 = 8;

impl<'a> Validator<'a> {
    fn new(vm: &'a VirtualMachine, fingerprint: [u8; 32], store: &'a Store) -> Validator<'a> {
        Validator {
            vm,
            fingerprint,
            store,
            by_file: store.by_file(),
            hashes: HashMap::new(),
            aot: HashMap::new(),
            checks: HashMap::new(),
            looks: HashMap::new(),
            passed: vec![0; store.entries.len()],
        }
    }

    /// A path as reasons show it: relative to the root when under it.
    fn shown(&self, path: &[u8]) -> Vec<u8> {
        let root = self.vm.top_level_dir();
        match path.strip_prefix(root) {
            Some(rest) if rest.first().is_some_and(|&c| bun_paths::is_sep(c)) => rest[1..].to_vec(),
            _ => path.to_vec(),
        }
    }

    /// A question as reasons show it: `kind specifier from importer`.
    fn question(&self, kind: &[u8], specifier: &[u8], importer: &[u8]) -> Vec<u8> {
        let mut out = kind.to_vec();
        out.push(b' ');
        out.extend_from_slice(&self.shown(specifier));
        out.extend_from_slice(b" from ");
        out.extend_from_slice(&self.shown(importer));
        out
    }

    /// A file's path as a record writes it, made absolute: relative ones are under the root.
    fn file(&self, path: &[u8]) -> Vec<u8> {
        if bun_paths::is_absolute(path) {
            path.to_vec()
        } else {
            recorder::from_root(self.vm, path)
        }
    }

    /// A specifier or importer as a record writes it: made absolute when it was made relative to the root.
    fn asked(&self, path: &[u8], from_root: bool) -> Vec<u8> {
        if from_root {
            recorder::from_root(self.vm, path)
        } else {
            path.to_vec()
        }
    }

    /// The recorded outcome, or why the file runs. The newest state whose inputs hold decides; when
    /// none does, the reason is the newest state's.
    fn holds(&mut self, file: &[u8]) -> Result<[u32; 6], Why> {
        let Some(path) = recorder::written_path(self.vm, file) else {
            return Err(Why::new("not-recording"));
        };
        let Some(states) = self.by_file.get(&*path) else {
            return Err(Why::new("no-record"));
        };
        let store = self.store;
        let states: Vec<&'a store::State> = states
            .iter()
            .map(|&i| &store.states[i])
            .filter(|state| state.fingerprint == self.fingerprint)
            .collect();
        let mut newest = None;
        for state in states {
            let header = self.header_why(state);
            match self.inputs_why(state) {
                None => {
                    return header.map_or_else(|| Ok(state.header.outcome.unwrap_or_default()), Err);
                }
                Some(why) => {
                    if newest.is_none() {
                        newest = Some(header.unwrap_or(why));
                    }
                }
            }
        }
        Err(newest.unwrap_or_else(|| Why::new("fingerprint")))
    }

    /// What the record says that makes it not reusable even when its inputs hold.
    fn header_why(&self, state: &store::State) -> Option<Why> {
        let Some(outcome) = state.header.outcome else {
            return Some(Why::new("error-before-tests"));
        };
        if outcome[1] > 0 {
            return Some(Why::new("failed"));
        }
        if outcome[5] > 0 {
            return Some(Why::new("unhandled-error"));
        }
        if state.header.unattributed_before > 0 {
            return Some(Why::new("earlier-file-work"));
        }
        if let Some(&name) = state.header.marks.first() {
            return Some(Why::with("mark", self.store.string(name).to_vec()));
        }
        None
    }

    /// Runs `step` on entry `id` unless it passed that step before in this run.
    fn step(
        &mut self,
        id: u32,
        bit: u8,
        step: impl FnOnce(&mut Self, EntryView<'a>) -> Option<Why>,
    ) -> Option<Why> {
        if self.passed[id as usize] & bit != 0 {
            return None;
        }
        let store = self.store;
        let Some(entry) = store.entry(id) else {
            return Some(Why::new("unreadable-record"));
        };
        let why = step(self, entry);
        if why.is_none() {
            self.passed[id as usize] |= bit;
        }
        why
    }

    /// Why the state's inputs do not hold on the current tree, if they don't.
    fn inputs_why(&mut self, state: &store::State) -> Option<Why> {
        let [resolutions, modules, answers, reads] = &state.lists;
        for &id in modules {
            let why = self.step(id, STATIC, |this, entry| {
                let EntryView::Module { flags, path, .. } = entry else {
                    return None;
                };
                if flags & store::VIRTUAL != 0 {
                    return Some(Why::with("virtual", this.shown(&this.file(path))));
                }
                if flags & store::CHANGED_DURING_RUN != 0 {
                    let path = this.shown(&this.file(path));
                    return Some(Why::with("changed-during-run", path));
                }
                None
            });
            if why.is_some() {
                return why;
            }
        }
        for &id in resolutions {
            let why = self.step(id, STATIC, |this, entry| {
                let EntryView::Resolution {
                    flags,
                    kind,
                    specifier,
                    importer,
                    check,
                    ..
                } = entry
                else {
                    return None;
                };
                if flags & store::PLUGIN == 0 && check.is_some() {
                    return None;
                }
                let specifier = this.asked(specifier, flags & store::SPECIFIER_FROM_ROOT != 0);
                let importer = this.asked(importer, flags & store::IMPORTER_FROM_ROOT != 0);
                let question = this.question(kind, &specifier, &importer);
                Some(Why::with(
                    if flags & store::PLUGIN != 0 {
                        "plugin"
                    } else {
                        "no-check"
                    },
                    question,
                ))
            });
            if why.is_some() {
                return why;
            }
        }
        for &id in modules.iter().chain(answers) {
            let why = self.step(id, CONTENTS, |this, entry| {
                let (path, sha256) = match entry {
                    EntryView::Module { path, sha256, .. } | EntryView::Answer { path, sha256 } => {
                        (path, sha256)
                    }
                    _ => return None,
                };
                let path = this.file(path);
                let Some(sha256) = sha256 else {
                    return Some(Why::with("no-hash", this.shown(&path)));
                };
                if this.hash(&path) != Some(*sha256) {
                    return Some(Why::with("changed", this.shown(&path)));
                }
                None
            });
            if why.is_some() {
                return why;
            }
        }
        for &id in modules {
            let why = self.step(id, AOT, |this, entry| {
                let EntryView::Module { path, aot, .. } = entry else {
                    return None;
                };
                let path = this.file(path);
                let vm = this.vm;
                let now = *this
                    .aot
                    .entry(path.clone())
                    .or_insert_with(|| recorder::aot_config_check(vm, &path));
                if now.as_ref() != aot {
                    return Some(Why::with("package-config", this.shown(&path)));
                }
                None
            });
            if why.is_some() {
                return why;
            }
        }
        for &id in reads {
            let why = self.step(id, AGAIN, |this, entry| {
                let EntryView::Read {
                    look,
                    path,
                    extra,
                    value,
                } = entry
                else {
                    return None;
                };
                let Some(look) = Look::from_name(look) else {
                    return Some(Why::new("unreadable-record"));
                };
                let path = this.file(path);
                let mut key = look.name().as_bytes().to_vec();
                for part in [&path[..], extra] {
                    key.push(0);
                    key.extend_from_slice(part);
                }
                let vm = this.vm;
                let now = this
                    .looks
                    .entry(key)
                    .or_insert_with(|| recorder::observe_again(vm, look, &path, extra));
                if **now != *value {
                    let mut detail = look.name().as_bytes().to_vec();
                    detail.push(b' ');
                    detail.extend_from_slice(&this.shown(&path));
                    let kind = if extra == bun_jsc::test_own_reads::AFTER_WRITE {
                        "own-write"
                    } else {
                        "own-read"
                    };
                    return Some(Why::with(kind, detail));
                }
                None
            });
            if why.is_some() {
                return why;
            }
        }
        for &id in resolutions {
            let why = self.step(id, AGAIN, |this, entry| {
                let EntryView::Resolution {
                    flags,
                    kind,
                    specifier,
                    importer,
                    paths,
                    check,
                } = entry
                else {
                    return None;
                };
                let specifier = this.asked(specifier, flags & store::SPECIFIER_FROM_ROOT != 0);
                let importer = this.asked(importer, flags & store::IMPORTER_FROM_ROOT != 0);
                let paths: Vec<Box<[u8]>> = paths
                    .iter()
                    .map(|&(path, from_root)| {
                        if from_root {
                            recorder::from_root(this.vm, path).into_boxed_slice()
                        } else {
                            Box::from(path)
                        }
                    })
                    .collect();
                let asked = recorder::Asked {
                    kind,
                    specifier: &specifier,
                    importer: &importer,
                    importer_is_file: flags & store::IMPORTER_IS_FILE != 0,
                    paths: &paths,
                };
                if this.check(&asked) != check.copied() {
                    return Some(Why::with(
                        "answer",
                        this.question(kind, &specifier, &importer),
                    ));
                }
                None
            });
            if why.is_some() {
                return why;
            }
        }
        None
    }

    fn hash(&mut self, path: &[u8]) -> Option<[u8; 32]> {
        *self.hashes.entry(path.to_vec()).or_insert_with(|| {
            let contents = File::read_from(Fd::cwd(), path).ok()?;
            Some(recorder::source_hash(&contents))
        })
    }

    fn check(&mut self, asked: &recorder::Asked<'_>) -> Option<[u8; 32]> {
        let mut key = Vec::with_capacity(256);
        for part in [asked.kind, asked.specifier, asked.importer] {
            key.extend_from_slice(part);
            key.push(0);
        }
        key.push(asked.importer_is_file as u8);
        for path in asked.paths {
            key.push(0);
            key.extend_from_slice(path);
        }
        let vm = self.vm;
        *self
            .checks
            .entry(key)
            .or_insert_with(|| recorder::check_again(vm, asked))
    }
}
