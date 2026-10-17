
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
    let is_tried = cfg!(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64", target_env = "gnu"),
    ));
    if !is_tried && bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_AOT_ON_UNTRIED_PLATFORMS.get() != Some(true) {
        return Some("ahead-of-time compilation is not available on this platform yet. It works on macOS arm64 and on Linux x64 with glibc");
    }
    if !target.is_host_platform() {
        return Some("ahead-of-time compilation makes machine code for the platform it runs on and cannot target another. Run this build on the target platform, with that platform's Bun");
    }
    None
}

#[cold]
pub(crate) fn print_stamp_and_exit() -> ! {
    unsafe extern "C" {
        safe fn Bun__AOT__stamp() -> u64;
    }
    bun_jsc::initialize(bun_jsc::InitializeOptions { use_aot: true, ..Default::default() });
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
        argv: vec![Box::<[u8]>::from(executable), Box::<[u8]>::from(&b"--aot-stamp"[..])],
        envp: Some(envp.as_ptr()),
        stdout: spawn_sync::SyncStdio::Buffer,
        stderr: spawn_sync::SyncStdio::Ignore,
        stdin: spawn_sync::SyncStdio::Ignore,
        #[cfg(windows)]
        windows: crate::api::bun::process::WindowsOptions {
            loop_: bun_event_loop::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(None, None)),
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
    if !result.status.is_ok() || answer.len() != 16 || !answer.iter().all(u8::is_ascii_hexdigit) || answer.iter().all(|&digit| digit == b'0') {
        return Err(b"it does not answer --aot-stamp");
    }
    Ok(answer.to_vec())
}

pub(crate) fn why_cannot_be_carried(target: &CompileTarget, env: &mut bun_dotenv::Loader, executable_path: Option<&[u8]>) -> Option<Vec<u8>> {
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
        (Err(why), _) => format!("this Bun could not be run with --aot-stamp: {}", bstr::BStr::new(why)),
    };
    Some(message.into_bytes())
}

#[cfg(unix)]
pub(crate) fn graph(
    ctx: &ContextData,
) -> crate::Result<Option<&'static mut bun_standalone_graph::Graph>> {
    let Some(fd) = ctx.runtime_options.aot_graph_fd else {
        return Ok(None);
    };
    let Some(graph) = bun_standalone_graph::Graph::from_fd(bun_sys::Fd::from_native(fd))? else {
        pretty_errorln!("<r><red>error<r>: --aot-graph-fd is not a module graph");
        Global::exit(1);
    };
    // SAFETY: `from_fd` just allocated the graph for the life of the process, and nobody else has
    // the pointer.
    Ok(Some(unsafe { &mut *graph }))
}

#[cfg(not(unix))]
pub(crate) fn graph(
    _ctx: &ContextData,
) -> crate::Result<Option<&'static mut bun_standalone_graph::Graph>> {
    Ok(None)
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
    let end_of_line = |text: &[u8]| (0..text.len()).find(|&at| matches!(text[at..], [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])).unwrap_or(text.len());
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

const BUILD_FLAGS: [&[u8]; 4] = [b"--aot", b"--aot-explain", b"--aot-huge-heap", b"--aot-type-errors"];
const RUN_FLAGS: [&[u8]; 4] = [b"--aot", b"--aot-audit", b"--aot-huge-heap", b"--aot-type-errors"];
const RUN_INTERNAL_FLAGS: [&[u8]; 3] = [b"--aot-decode-crash-report", b"--aot-graph-fd", b"--aot-stamp"];
const SHARED_INTERNAL_FLAGS: [&[u8]; 1] = [b"--aot-crash-if-interpreter-is-used"];
pub(crate) const COMPILE_OPTIONS: [&[u8]; 3] = [b"aot", b"aotExplain", b"aotTypeErrors"];
pub(crate) const COMPILE_INTERNAL_OPTIONS: [&[u8]; 1] = [b"aotCrashIfInterpreterIsUsed"];

pub(crate) fn did_you_mean(prefix: &str, known: &[&[u8]], written: &[u8]) -> String {
    let distance = |name: &[u8]| bun_core::strings::edit_distance(written.iter().copied(), name);
    let nearest = known.iter().copied().min_by_key(|name| distance(name));
    match nearest.filter(|name| distance(name) <= written.len().max(3) / 3) {
        Some(name) => format!(" Did you mean {prefix}{}?", bstr::BStr::new(name)),
        None => String::new(),
    }
}

pub(crate) fn reject_unknown_flags(is_build: bool, passed_through: usize) {
    let (known, of_others, others) = if is_build {
        (BUILD_FLAGS, RUN_FLAGS, "bun run and bun test")
    } else {
        (RUN_FLAGS, BUILD_FLAGS, "bun build")
    };
    let end_of_options = bun_core::argv().len().saturating_sub(passed_through);
    for (index, arg) in bun_core::argv().iter().enumerate().take(end_of_options).skip(1) {
        let arg: &[u8] = arg;
        if arg == b"--" {
            break;
        }
        let name = bun_core::strings::split(arg, b"=").next().unwrap_or(arg);
        if !name.starts_with(b"--aot") || known.contains(&name) || SHARED_INTERNAL_FLAGS.contains(&name) || (!is_build && RUN_INTERNAL_FLAGS.contains(&name)) {
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
                did_you_mean("", &known, name),
                bstr::BStr::new(&list),
            );
        }
        Global::exit(1);
    }
}

#[cfg(unix)]
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
            if ctx.test_options.parallel > 0 { "--parallel" } else { "--isolate" }
        );
        Global::exit(1);
    }
    if ctx.debug.hot_reload != bun_options_types::context::HotReload::None {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r> does not support <b>{}<r>: an ahead-of-time compiled program is built before it runs and is not rebuilt when a file changes. Remove one of the two.",
            if ctx.debug.hot_reload == bun_options_types::context::HotReload::Hot { "--hot" } else { "--watch" }
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
    // What is a builtin module to the program that runs is one to the build.
    if bun_resolve_builtins::expose_internals_enabled() {
        args.push(b"--expose-internals".to_vec());
    }
    if bun_resolve_builtins::stream_iter_enabled() {
        args.push(b"--experimental-stream-iter".to_vec());
    }
    for (name, is_given) in [
        (&b"--preserve-symlinks"[..], ctx.args.preserve_symlinks.unwrap_or(false)),
        (b"--preserve-symlinks-main", ctx.runtime_options.preserve_symlinks_main),
        (b"--no-macros", matches!(ctx.debug.macros, bun_options_types::context::MacroOptions::Disable)),
        (b"--no-compile-autoload-dotenv", ctx.args.disable_default_env_files && ctx.args.env_files.is_empty()),
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
        if index < end_of_options && (is_cwd_value || arg == b"--cwd" || arg.starts_with(b"--cwd=")) {
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
        let path: &[u8] = preload.strip_prefix(b"file://".as_slice()).unwrap_or(&**preload);
        if !path.starts_with(b"node:") && !path.starts_with(b"bun:") {
            args.push(path.to_vec());
        }
    }
    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
    let errno = bun_core::exec_self(&args, None);
    pretty_errorln!(
        "<r><red>error<r>: failed to start the build for <b>--aot<r>: errno {}",
        errno
    );
    Global::exit(1);
}

#[cfg(not(unix))]
pub(crate) fn exec_build(_ctx: &ContextData, _entry_points: &[&[u8]], _for_tests: bool) -> ! {
    pretty_errorln!("<r><red>error<r>: <b>--aot<r> is not supported on this platform yet");
    Global::exit(1);
}
