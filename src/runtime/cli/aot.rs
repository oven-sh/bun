use bun_aot::rules::{Baseline, EVERY_RULE, RULES, Settings, Severity};
use bun_core::{Global, pretty_errorln};
use bun_options_types::compile_target::CompileTarget;

use crate::cli::command::ContextData;

pub(crate) fn unsupported_reason(target: &CompileTarget) -> Option<&'static str> {
    unsafe extern "C" {
        safe fn Bun__AOT__hasCompiler() -> bool;
    }
    if !cfg!(any(target_arch = "aarch64", target_arch = "x86_64")) {
        return Some("ahead-of-time compilation only supports arm64 and x64");
    }
    if !Bun__AOT__hasCompiler() {
        return Some("this build of Bun does not include the ahead-of-time compiler");
    }
    if !target.is_host_platform() {
        return Some(
            "ahead-of-time compilation makes machine code for the platform it runs on and cannot target another. Run this build on the target platform, with that platform's Bun",
        );
    }
    None
}

#[cold]
pub(crate) fn print_stamp_and_exit() -> ! {
    unsafe extern "C" {
        safe fn Bun__AOT__stamp() -> u64;
    }
    bun_jsc::initialize(bun_jsc::InitializeOptions {
        use_aot: true,
        ..Default::default()
    });
    let w = bun_core::Output::writer();
    let _ = w.write_all(format!("{:016x}\n", Bun__AOT__stamp()).as_bytes());
    bun_core::Output::flush();
    Global::exit(0);
}

fn stamp_of(executable: &[u8]) -> Result<Vec<u8>, &'static [u8]> {
    use crate::api::bun::process::sync as spawn_sync;
    let mut envp: Vec<*const core::ffi::c_char> = bun_sys::environ().to_vec();
    envp.push(c"BUN_BE_BUN=1".as_ptr());
    envp.push(core::ptr::null());
    let spawned = spawn_sync::spawn(&spawn_sync::Options {
        argv: vec![
            Box::<[u8]>::from(executable),
            Box::<[u8]>::from(&b"--aot-stamp"[..]),
        ],
        envp: Some(envp.as_ptr()),
        stdout: spawn_sync::SyncStdio::Buffer,
        stderr: spawn_sync::SyncStdio::Ignore,
        stdin: spawn_sync::SyncStdio::Ignore,
        #[cfg(windows)]
        windows: crate::api::bun::process::WindowsOptions {
            loop_: bun_event_loop::EventLoopHandle::init_mini(
                bun_event_loop::MiniEventLoop::init_global(None, None),
            ),
            ..Default::default()
        },
        ..Default::default()
    });
    let result = match spawned {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => return Err(error.name()),
        Err(error) => return Err(error.name().as_bytes()),
    };
    let answer = result.stdout.as_slice().trim_ascii();
    if !result.status.is_ok()
        || answer.len() != 16
        || !answer.iter().all(u8::is_ascii_hexdigit)
        || answer.iter().all(|&digit| digit == b'0')
    {
        return Err(b"it does not answer --aot-stamp");
    }
    Ok(answer.to_vec())
}

pub(crate) fn why_cannot_be_carried(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader,
    executable_path: Option<&[u8]>,
) -> Option<Vec<u8>> {
    use bun_standalone_graph::StandaloneModuleGraph::{target_builtins, target_executable};
    if let Some(why) = unsupported_reason(target) {
        return Some(why.as_bytes().to_vec());
    }
    if executable_path.is_none() && target.is_default() {
        return None;
    }
    let carrier = match target_executable(target, env, executable_path) {
        Ok(path) => path,
        Err(error) => return Some(error.slice().to_vec()),
    };
    let Ok(this_bun) = bun_core::self_exe_path() else {
        return Some(b"failed to get self executable path".to_vec());
    };
    if carrier.as_bytes() == this_bun.as_bytes() {
        return None;
    }
    let theirs = match target_builtins(target, env, executable_path) {
        Ok(Some(_)) => stamp_of(carrier.as_bytes()),
        Ok(None) => Err(&b"it is not a Bun, or it is an older one"[..]),
        Err(error) => return Some(error.slice().to_vec()),
    };
    let shown = bstr::BStr::new(carrier.as_bytes());
    let message = match (stamp_of(this_bun.as_bytes()), theirs) {
        (Ok(ours), Ok(theirs)) if ours == theirs => return None,
        (Ok(ours), Ok(theirs)) => format!(
            "{shown} has another build of the JavaScript engine (for instance another version of Bun: {}) than the Bun that runs this build ({}). It would refuse the compiled code when the program starts. Use the same version of Bun for both",
            bstr::BStr::new(&theirs),
            bstr::BStr::new(&ours),
        ),
        (Ok(_), Err(why)) => format!(
            "{shown} cannot carry code compiled by this Bun: {}. The executable has to be a Bun for this platform, of the same version",
            bstr::BStr::new(why),
        ),
        (Err(why), _) => format!(
            "this Bun could not be run with --aot-stamp: {}",
            bstr::BStr::new(why)
        ),
    };
    Some(message.into_bytes())
}

pub(crate) fn graph(
    ctx: &ContextData,
) -> crate::Result<Option<&'static mut bun_standalone_graph::Graph>> {
    let Some(fd) = ctx.runtime_options.aot_graph_fd else {
        return Ok(None);
    };
    #[cfg(unix)]
    let fd = bun_sys::Fd::from_native(fd);
    #[cfg(windows)]
    let fd = bun_sys::Fd::from_system(fd as isize as *mut core::ffi::c_void);
    let Some(graph) = bun_standalone_graph::Graph::from_fd(fd)? else {
        pretty_errorln!("<r><red>error<r>: --aot-graph-fd is not a module graph");
        Global::exit(1);
    };
    // SAFETY: `from_fd` just allocated the graph for the life of the process, and nobody else has
    // the pointer.
    Ok(Some(unsafe { &mut *graph }))
}

pub(crate) fn as_dyn(
    graph: &bun_standalone_graph::Graph,
) -> &'static dyn bun_resolver::StandaloneModuleGraph {
    // SAFETY: the one caller passes what `graph` above returns, which is never freed.
    unsafe {
        &*(std::ptr::from_ref::<bun_standalone_graph::Graph>(graph)
            as *const (dyn bun_resolver::StandaloneModuleGraph + 'static))
    }
}

pub(crate) fn is_only_comments(mut text: &[u8]) -> bool {
    let end_of_line = |text: &[u8]| {
        (0..text.len())
            .find(|&at| {
                matches!(
                    text[at..],
                    [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..]
                )
            })
            .unwrap_or(text.len())
    };
    if text.starts_with(b"#!") {
        text = &text[end_of_line(text)..];
    }
    loop {
        text = text.trim_ascii_start();
        text = match text {
            [] => return true,
            [0xE2, 0x80, 0xA8 | 0xA9, rest @ ..] => rest,
            [b'/', b'/', rest @ ..] => &rest[end_of_line(rest)..],
            [b'/', b'*', rest @ ..] => match bun_core::strings::index_of(rest, b"*/") {
                Some(end) => &rest[end + 2..],
                None => return false,
            },
            _ => return false,
        };
    }
}

const BUILD_FLAGS: [&[u8]; 9] = [
    b"--aot",
    b"--aot-allow",
    b"--aot-baseline",
    b"--aot-deny",
    b"--aot-explain",
    b"--aot-huge-heap",
    b"--aot-type-errors",
    b"--aot-update-baseline",
    b"--aot-warn",
];
const RUN_FLAGS: [&[u8]; 4] = [
    b"--aot",
    b"--aot-audit",
    b"--aot-huge-heap",
    b"--aot-type-errors",
];
const RUN_INTERNAL_FLAGS: [&[u8]; 3] = [
    b"--aot-decode-crash-report",
    b"--aot-graph-fd",
    b"--aot-stamp",
];
const SHARED_INTERNAL_FLAGS: [&[u8]; 1] = [b"--aot-crash-if-interpreter-is-used"];
pub(crate) const COMPILE_OPTIONS: [&[u8]; 3] = [b"aot", b"aotExplain", b"aotTypeErrors"];
pub(crate) const COMPILE_INTERNAL_OPTIONS: [&[u8]; 1] = [b"aotCrashIfInterpreterIsUsed"];

pub(crate) const RULE_PARAMS: &[bun_clap::Param<bun_clap::Help>] = &[
    bun_clap::parse_param!(
        "--aot-deny <STR>...              With --aot: fail where a rule finds something. --aot-deny=untyped-file,open-layout, or all. Limit a rule to some files with --aot-deny=open-layout:src/server/**"
    ),
    bun_clap::parse_param!("--aot-warn <STR>...              With --aot: the same, as warnings"),
    bun_clap::parse_param!(
        "--aot-allow <STR>...             With --aot: turn a rule off. Of two flags that name the same rule and file, the later one counts"
    ),
    bun_clap::parse_param!(
        "--aot-baseline <STR>             With --aot: a file with the number of findings per rule and file that are accepted. Only a file that has more is reported"
    ),
    bun_clap::parse_param!(
        "--aot-update-baseline            With --aot-baseline: write the file anew from this build"
    ),
];

const RULE_FLAGS: [(&[u8], Severity); 3] = [
    (b"--aot-allow", Severity::Allow),
    (b"--aot-deny", Severity::Deny),
    (b"--aot-warn", Severity::Warn),
];
const RULE_KEYS: [(&[u8], Severity); 3] = [
    (b"aot.allow", Severity::Allow),
    (b"aot.deny", Severity::Deny),
    (b"aot.warn", Severity::Warn),
];
const BASELINE_FLAG: &[u8] = b"--aot-baseline";
const BASELINE_KEY: &[u8] = b"aot.baseline";
const UPDATE_BASELINE_FLAG: &[u8] = b"--aot-update-baseline";

pub(crate) fn rule_flags<'a>(args: impl Iterator<Item = &'a [u8]>) -> Vec<Box<[u8]>> {
    let mut written = Vec::new();
    let mut args = args.take_while(|arg| *arg != b"--");
    while let Some(arg) = args.next() {
        let (name, value) = match bun_core::strings::index_of_char_usize(arg, b'=') {
            Some(at) => (&arg[..at], Some(&arg[at + 1..])),
            None => (arg, None),
        };
        if name == UPDATE_BASELINE_FLAG {
            written.push(Box::from(name));
        } else if (name == BASELINE_FLAG || RULE_FLAGS.iter().any(|flag| flag.0 == name))
            && let Some(value) = value.or_else(|| args.next())
        {
            written.push([name, b"=", value].concat().into_boxed_slice());
        }
    }
    written
}

pub(crate) fn baseline_path(written: &[Box<[u8]>]) -> Option<&[u8]> {
    written.iter().rev().find_map(|flag| {
        let at = bun_core::strings::index_of_char_usize(flag, b'=')?;
        (&flag[..at] == BASELINE_FLAG || &flag[..at] == BASELINE_KEY).then_some(&flag[at + 1..])
    })
}

pub(crate) fn finish_baseline(
    written: &[Box<[u8]>],
    outcome: Option<bun_aot::rules::BaselineOutcome>,
) {
    let (Some(path), Some(outcome)) = (baseline_path(written), outcome) else {
        return;
    };
    if let Some(text) = outcome.updated_text {
        if let bun_sys::Result::Err(err) =
            bun_sys::File::write_file(bun_sys::Fd::cwd(), &bun_core::ZBox::from_bytes(path), &text)
        {
            bun_core::Output::err(err, "could not write \"{}\"", (bstr::BStr::new(path),));
            Global::exit(1);
        }
    } else if outcome.lower_counts > 0 {
        let counts = if outcome.lower_counts == 1 {
            "count"
        } else {
            "counts"
        };
        bun_core::note!(
            "{} accepts more than this build found ({} {}). --aot-update-baseline lowers it",
            bstr::BStr::new(path),
            outcome.lower_counts,
            counts
        );
    }
}

pub(crate) fn rule_settings(written: &[Box<[u8]>]) -> Result<Settings, String> {
    let mut settings = Settings::default();
    settings.updates_baseline = written.iter().any(|flag| &flag[..] == UPDATE_BASELINE_FLAG);
    match baseline_path(written) {
        Some(path) => match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
            Ok(text) => match bun_sema_driver::host::parse_json_object(&text)
                .and_then(|json| Baseline::from_json(&json))
            {
                Some(baseline) => settings.baseline = Some(baseline),
                None => {
                    return Err(format!(
                        "\"{}\" is not a baseline. --aot-update-baseline writes one",
                        bstr::BStr::new(path)
                    ));
                }
            },
            Err(_) if settings.updates_baseline => {}
            Err(_) => {
                return Err(format!(
                    "could not read the baseline \"{}\". --aot-update-baseline writes one",
                    bstr::BStr::new(path)
                ));
            }
        },
        None if settings.updates_baseline => return Err(
            "--aot-update-baseline requires --aot-baseline, or baseline in [aot] of bunfig.toml"
                .to_owned(),
        ),
        None => {}
    }
    for flag in written {
        let at = bun_core::strings::index_of_char_usize(flag, b'=').unwrap_or(flag.len());
        let Some(&(name, severity)) = RULE_FLAGS
            .iter()
            .chain(&RULE_KEYS)
            .find(|known| known.0 == &flag[..at])
        else {
            continue;
        };
        if let Err(unknown) = settings.add(severity, flag.get(at + 1..).unwrap_or_default()) {
            let known: Vec<&[u8]> = RULES
                .iter()
                .map(|rule| rule.name.as_bytes())
                .chain([EVERY_RULE.as_bytes()])
                .collect();
            return Err(format!(
                "{}{} does not take \"{}\".{} The rules are {}",
                bstr::BStr::new(name),
                if name.starts_with(b"--") {
                    ""
                } else {
                    " in bunfig.toml"
                },
                bstr::BStr::new(&unknown.written),
                did_you_mean("", &known, &unknown.written),
                bstr::BStr::new(&known.join(&b", "[..])),
            ));
        }
    }
    Ok(settings)
}

pub(crate) fn did_you_mean(prefix: &str, known: &[&[u8]], written: &[u8]) -> String {
    let distance = |name: &[u8]| bun_core::strings::edit_distance(written.iter().copied(), name);
    let nearest = known.iter().copied().min_by_key(|name| distance(name));
    match nearest.filter(|name| distance(name) <= written.len().max(3) / 3) {
        Some(name) => format!(" Did you mean {prefix}{}?", bstr::BStr::new(name)),
        None => String::new(),
    }
}

pub(crate) fn reject_unknown_flags(is_build: bool, passed_through: usize) {
    let (known, of_others, others): (&[&[u8]], &[&[u8]], &str) = if is_build {
        (&BUILD_FLAGS, &RUN_FLAGS, "bun run and bun test")
    } else {
        (&RUN_FLAGS, &BUILD_FLAGS, "bun build")
    };
    let end_of_options = bun_core::argv().len().saturating_sub(passed_through);
    for (index, arg) in bun_core::argv()
        .iter()
        .enumerate()
        .take(end_of_options)
        .skip(1)
    {
        let arg: &[u8] = arg;
        if arg == b"--" {
            break;
        }
        let name = bun_core::strings::split(arg, b"=").next().unwrap_or(arg);
        if !name.starts_with(b"--aot")
            || known.contains(&name)
            || SHARED_INTERNAL_FLAGS.contains(&name)
            || (!is_build && RUN_INTERNAL_FLAGS.contains(&name))
        {
            continue;
        }
        let is_other_command_flag = of_others.contains(&name);
        if is_other_command_flag && index <= bun_core::bun_options_argc() {
            continue;
        }
        let list = known.join(&b", "[..]);
        if is_other_command_flag {
            pretty_errorln!(
                "<r><red>error<r>: <b>{}<r> is only valid with {}. The --aot flags available here are {}",
                bstr::BStr::new(name),
                others,
                bstr::BStr::new(&list),
            );
        } else {
            pretty_errorln!(
                "<r><red>error<r>: unknown flag <b>{}<r>.{} The --aot flags available here are {}",
                bstr::BStr::new(name),
                did_you_mean("", known, name),
                bstr::BStr::new(&list),
            );
        }
        Global::exit(1);
    }
}

pub(crate) fn exec_build(ctx: &ContextData, entry_points: &[&[u8]], for_tests: bool) -> ! {
    if let Some(why) = unsupported_reason(&CompileTarget::default()) {
        pretty_errorln!("<r><red>error<r>: <b>--aot<r>: {}", why);
        Global::exit(1);
    }
    if matches!(
        ctx.runtime_options.debugger,
        bun_options_types::context::Debugger::Enable(_)
    ) {
        pretty_errorln!(
            "<r><red>error<r>: the debugger is not supported with <b>--aot<r>. Run without <b>--aot<r> to use it."
        );
        Global::exit(1);
    }
    if for_tests && (ctx.test_options.parallel > 0 || ctx.test_options.isolate) {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r> does not support <b>{}<r>: an ahead-of-time compiled program is loaded once, into a single global object. Remove one of the two.",
            if ctx.test_options.parallel > 0 {
                "--parallel"
            } else {
                "--isolate"
            }
        );
        Global::exit(1);
    }
    if ctx.debug.hot_reload != bun_options_types::context::HotReload::None {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r> does not support <b>{}<r>: an ahead-of-time compiled program is built before it runs and is not rebuilt when a file changes. Remove one of the two.",
            if ctx.debug.hot_reload == bun_options_types::context::HotReload::Hot {
                "--hot"
            } else {
                "--watch"
            }
        );
        Global::exit(1);
    }
    if for_tests && ctx.test_options.repeat_count > 1 {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r> does not support <b>--rerun-each<r> (or \"rerunEach\" in bunfig.toml): an ahead-of-time compiled program is loaded once, into a single global object. Remove one of the two."
        );
        Global::exit(1);
    }
    if for_tests && ctx.test_options.coverage.enabled {
        pretty_errorln!(
            "<r><yellow>warn<r><d>:<r> <b>--coverage<r> is ignored with <b>--aot<r>: ahead-of-time compiled code is not instrumented. Run without <b>--aot<r> to measure coverage."
        );
        bun_core::Output::flush();
    }
    if !ctx.runtime_options.eval.script.is_empty() {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r> cannot be combined with <b>-e<r>, <b>-p<r> or a script from stdin"
        );
        Global::exit(1);
    }

    let mut args: Vec<Vec<u8>> = [
        &b"build"[..],
        b"--compile",
        b"--aot",
        b"--compile-run",
        b"--compile-autoload-tsconfig",
        b"--compile-autoload-package-json",
        b"--target=bun",
        b"--sourcemap=inline",
        b"--entry-naming=[dir]/[name]-[hash].[ext]",
    ]
    .map(<[u8]>::to_vec)
    .to_vec();
    if for_tests {
        args.push(b"--rewrite-jest-for-tests".to_vec());
    }
    if ctx.bundler_options.ignore_dce_annotations {
        args.push(b"--ignore-dce-annotations".to_vec());
    }
    if ctx.runtime_options.aot_logs_type_errors {
        args.push(b"--aot-type-errors=log".to_vec());
    }
    if ctx.runtime_options.aot_crash_if_interpreter_is_used {
        args.push(b"--aot-crash-if-interpreter-is-used".to_vec());
    }
    if ctx.runtime_options.aot_huge_heap {
        args.push(b"--aot-huge-heap".to_vec());
    }
    if ctx.args.jsx.as_ref().is_some_and(|jsx| jsx.side_effects) {
        args.push(b"--jsx-side-effects".to_vec());
    }
    if bun_resolve_builtins::expose_internals_enabled() {
        args.push(b"--expose-internals".to_vec());
    }
    if bun_resolve_builtins::stream_iter_enabled() {
        args.push(b"--experimental-stream-iter".to_vec());
    }
    for (name, is_given) in [
        (
            &b"--preserve-symlinks"[..],
            ctx.args.preserve_symlinks.unwrap_or(false),
        ),
        (
            b"--preserve-symlinks-main",
            ctx.runtime_options.preserve_symlinks_main,
        ),
        (
            b"--no-macros",
            matches!(
                ctx.debug.macros,
                bun_options_types::context::MacroOptions::Disable
            ),
        ),
        (
            b"--no-compile-autoload-dotenv",
            ctx.args.disable_default_env_files && ctx.args.env_files.is_empty(),
        ),
    ] {
        if is_given {
            args.push(name.to_vec());
        }
    }

    let mut option = |name: &[u8], value: &[u8]| args.push([name, b"=", value].concat());
    if let Some(define) = &ctx.args.define {
        for (key, value) in define.keys.iter().zip(define.values.iter()) {
            option(b"--define", &[&**key, b"=", &**value].concat());
        }
    }
    if let Some(tsconfig) = &ctx.args.tsconfig_override {
        option(b"--tsconfig-override", tsconfig);
    }
    if let Some(jsx) = &ctx.args.jsx {
        for (name, value) in [
            (&b"--jsx-factory"[..], &jsx.factory),
            (b"--jsx-fragment", &jsx.fragment),
            (b"--jsx-import-source", &jsx.import_source),
        ] {
            if !value.is_empty() {
                option(name, value);
            }
        }
        use bun_options_types::schema::api::JsxRuntime;
        match jsx.runtime {
            JsxRuntime::Classic => option(b"--jsx-runtime", b"classic"),
            JsxRuntime::Automatic => option(b"--jsx-runtime", b"automatic"),
            _ => {}
        }
    }
    for (name, values) in [
        (&b"--conditions"[..], &ctx.args.conditions),
        (b"--drop", &ctx.args.drop),
        (b"--main-fields", &ctx.args.main_fields),
        (b"--extension-order", &ctx.args.extension_order),
        (b"--feature", &ctx.args.feature_flags),
    ] {
        for value in values {
            option(name, value);
        }
    }
    if let Some(loaders) = &ctx.args.loaders {
        for (extension, loader) in loaders.extensions.iter().zip(loaders.loaders.iter()) {
            let name = match crate::cli::test::parallel::runner::api_loader_tag_name(*loader) {
                "bunsh" => "sh",
                name => name,
            };
            option(b"--loader", &[&**extension, b":", name.as_bytes()].concat());
        }
    }

    let mut has_replaced_option = false;
    let end_of_options = bun_core::argv().len().saturating_sub(ctx.passthrough.len());
    let mut is_cwd_value = false;
    for (index, arg) in bun_core::argv()
        .iter()
        .enumerate()
        .skip(1 + bun_core::bun_options_argc())
    {
        let arg: &[u8] = arg;
        if index < end_of_options && (is_cwd_value || arg == b"--cwd" || arg.starts_with(b"--cwd="))
        {
            is_cwd_value = !is_cwd_value && arg == b"--cwd";
            continue;
        }
        if !has_replaced_option && (arg == b"--aot" || arg == b"--debug-aot") {
            has_replaced_option = true;
            option(b"--compile-run-arg", b"--aot-graph-fd=");
        } else {
            option(b"--compile-run-arg", arg);
        }
    }
    if !has_replaced_option {
        pretty_errorln!("<r><red>error<r>: <b>--aot<r> must be passed on the command line");
        Global::exit(1);
    }

    args.extend(entry_points.iter().map(|path| path.to_vec()));
    for preload in &ctx.preloads {
        let path: &[u8] = preload
            .strip_prefix(b"file://".as_slice())
            .unwrap_or(&**preload);
        if !path.starts_with(b"node:") && !path.starts_with(b"bun:") {
            args.push(path.to_vec());
        }
    }
    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
    #[cfg(windows)]
    run_build_then_program(&args);
    #[cfg(unix)]
    {
        let errno = bun_core::exec_self(&args, None);
        pretty_errorln!(
            "<r><red>error<r>: failed to start the build for <b>--aot<r>: errno {}",
            errno
        );
        Global::exit(1);
    }
}

#[cfg(windows)]
fn run_build_then_program(args: &[&[u8]]) -> ! {
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    const GENERIC_READ_WRITE_EXECUTE: u32 = 0x8000_0000 | 0x4000_0000 | 0x2000_0000;
    const FILE_SHARE_READ_WRITE_DELETE: u32 = 7;
    const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;
    const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;
    const HANDLE_FLAG_INHERIT: u32 = 1;
    const RUN_ARG: &[u8] = b"--compile-run-arg=";
    unsafe extern "system" {
        fn SetHandleInformation(handle: *mut core::ffi::c_void, mask: u32, flags: u32) -> i32;
    }
    let fail = |what: &str, error: std::io::Error| -> ! {
        pretty_errorln!(
            "<r><red>error<r>: failed to {} for <b>--aot<r>: {}",
            what,
            error
        );
        Global::exit(1);
    };
    let path = std::env::temp_dir().join(format!(
        "bun-aot-{:x}-{:x}",
        std::process::id(),
        bun_core::fast_random()
    ));
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .access_mode(GENERIC_READ_WRITE_EXECUTE)
        .share_mode(FILE_SHARE_READ_WRITE_DELETE)
        .attributes(FILE_ATTRIBUTE_TEMPORARY)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) => fail("create a temporary file", error),
    };
    let handle = file.as_raw_handle();
    // SAFETY: `handle` is the open handle of `file`, which lives until the process exits.
    if unsafe { SetHandleInformation(handle.cast(), HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0
    {
        fail("hand on a temporary file", std::io::Error::last_os_error());
    }
    // SAFETY: no arguments; it only marks the standard handles inheritable.
    unsafe { bun_sys::windows::windows_enable_stdio_inheritance() };
    let Ok(this_bun) = bun_core::self_exe_path() else {
        pretty_errorln!("<r><red>error<r>: failed to get self executable path");
        Global::exit(1);
    };
    let this_bun = String::from_utf8_lossy(this_bun.as_bytes()).into_owned();
    let graph_fd = format!("--aot-graph-fd={}", handle as isize);
    let run = |arguments: Vec<String>, what: &str| -> u32 {
        match std::process::Command::new(&this_bun)
            .args(arguments)
            .status()
        {
            Ok(status) => status.code().unwrap_or(1) as u32,
            Err(error) => fail(what, error),
        }
    };
    let with_handle = |arg: &[u8]| -> String {
        match arg {
            b"--aot-graph-fd=" => graph_fd.clone(),
            arg => String::from_utf8_lossy(arg).into_owned(),
        }
    };
    let build = args
        .iter()
        .map(|arg| match arg.strip_prefix(RUN_ARG) {
            Some(b"--aot-graph-fd=") => format!("--compile-run-arg={graph_fd}"),
            _ => String::from_utf8_lossy(arg).into_owned(),
        })
        .collect();
    let code = run(build, "start the build");
    if code != 0 {
        Global::exit(code);
    }
    let program = args
        .iter()
        .filter_map(|arg| arg.strip_prefix(RUN_ARG))
        .map(|arg| with_handle(arg))
        .collect();
    Global::exit(run(program, "start the program"));
}
