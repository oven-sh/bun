
use bun_core::{Global, pretty_errorln};
use bun_options_types::compile_target::CompileTarget;

use crate::cli::command::ContextData;

pub(crate) fn why_unsupported(target: &CompileTarget) -> Option<&'static str> {
    unsafe extern "C" {
        safe fn Bun__AOT__hasCompiler() -> bool;
    }
    if !cfg!(any(target_arch = "aarch64", target_arch = "x86_64")) {
        return Some("ahead-of-time compilation only supports arm64 and x64");
    }
    if !Bun__AOT__hasCompiler() {
        return Some("this build of Bun does not include the ahead-of-time compiler");
    }
    if !target.is_default() {
        return Some("ahead-of-time compilation cannot target another platform or version of Bun");
    }
    None
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
            [b'/', b'*', rest @ ..] => match rest.windows(2).position(|pair| pair == b"*/") {
                Some(end) => &rest[end + 2..],
                None => return false,
            },
            _ => return false,
        };
    }
}

#[cfg(unix)]
pub(crate) fn exec_build(ctx: &ContextData, entry_points: &[&[u8]], for_tests: bool) -> ! {
    if let Some(why) = why_unsupported(&CompileTarget::default()) {
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
    if !ctx.runtime_options.eval.script.is_empty() {
        pretty_errorln!(
            "<r><red>error<r>: <b>--aot<r>: not compiled yet: a program that is in no file: <b>-e<r> | <b>-p<r> | <b>-<r>"
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
    let mut is_value_of_cwd = false;
    for (index, arg) in bun_core::argv()
        .iter()
        .enumerate()
        .skip(1 + bun_core::bun_options_argc())
    {
        let arg: &[u8] = arg;
        if index < end_of_options && (is_value_of_cwd || arg == b"--cwd" || arg.starts_with(b"--cwd=")) {
            is_value_of_cwd = !is_value_of_cwd && arg == b"--cwd";
            continue;
        }
        if !has_replaced_option && arg == b"--aot" {
            has_replaced_option = true;
            option(b"--compile-run-arg", b"--aot-graph-fd=");
        } else {
            option(b"--compile-run-arg", arg);
        }
    }
    if !has_replaced_option {
        pretty_errorln!("<r><red>error<r>: <b>--aot<r> has to be given on the command line");
        Global::exit(1);
    }

    args.extend(entry_points.iter().map(|path| path.to_vec()));
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
