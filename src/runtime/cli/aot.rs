//! `bun run --aot` and `bun test --aot`: compile the program ahead of time, as `bun build --compile --compile-aot` does, and run that.
//!
//! The process replaces itself twice, so it stays one process, and the run starts from one that has done nothing else:
//!
//! 1. `bun run --aot app.ts a b` finds out what to build ([`exec_build`]).
//! 2. `bun build --compile --compile-aot --compile-run ... app.ts` builds it, into a temporary file that has no name.
//! 3. `bun run --aot-graph-fd=5 app.ts a b` runs it ([`graph`]).
//!
//! The last has the arguments of the first, so every other option means there what it meant.

use bun_core::{Global, pretty_errorln};
use bun_options_types::compile_target::CompileTarget;

use crate::cli::command::ContextData;

/// Why this bun cannot compile ahead of time for `target`, if it cannot.
pub(crate) fn why_unsupported(target: &CompileTarget) -> Option<&'static str> {
    unsafe extern "C" {
        safe fn Bun__AOT__hasCompiler() -> bool;
    }
    if !cfg!(all(target_arch = "aarch64", unix)) {
        return Some("ahead-of-time compilation only supports arm64 macOS and Linux so far");
    }
    if !Bun__AOT__hasCompiler() {
        return Some("this build of Bun does not include the ahead-of-time compiler");
    }
    // The compiler emits code for the machine it runs on, which only the runtime it is part of can load.
    if !target.is_default() {
        return Some("ahead-of-time compilation cannot target another platform or version of Bun");
    }
    None
}

/// Step 3: loads the graph that step 2 built.
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
    // SAFETY: `from_fd` returns the process-static graph, which nothing else refers to yet.
    Ok(Some(unsafe { &mut *graph }))
}

#[cfg(not(unix))]
pub(crate) fn graph(
    _ctx: &ContextData,
) -> crate::Result<Option<&'static mut bun_standalone_graph::Graph>> {
    Ok(None)
}

/// The graph as the trait object that the resolver and the VM expect.
pub(crate) fn as_dyn(
    graph: &bun_standalone_graph::Graph,
) -> &'static dyn bun_resolver::StandaloneModuleGraph {
    // SAFETY: `graph` lives in the process-global INSTANCE static and is never freed.
    unsafe {
        &*(std::ptr::from_ref::<bun_standalone_graph::Graph>(graph)
            as *const (dyn bun_resolver::StandaloneModuleGraph + 'static))
    }
}

/// Step 1: replaces this process with the build of `entry_points` (absolute paths).
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

    let mut args: Vec<Vec<u8>> = [
        &b"build"[..],
        b"--compile",
        b"--compile-aot",
        b"--compile-run",
        // As `bun run` does. Executables leave these two off by default.
        b"--compile-autoload-tsconfig",
        b"--compile-autoload-package-json",
        b"--target=bun",
        // For stack traces.
        b"--sourcemap=inline",
    ]
    .map(<[u8]>::to_vec)
    .to_vec();
    if for_tests {
        args.push(b"--rewrite-jest-for-tests".to_vec());
    }

    // Options that affect how modules are resolved or transpiled are forwarded to the build, which now does both.
    let mut option = |name: &[u8], value: &[u8]| args.push([name, b"=", value].concat());
    if let Some(define) = &ctx.args.define {
        for (key, value) in define.keys.iter().zip(define.values.iter()) {
            option(b"--define", &[&**key, b"=", &**value].concat());
        }
    }
    if let Some(tsconfig) = &ctx.args.tsconfig_override {
        option(b"--tsconfig-override", tsconfig);
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

    // (`BUN_OPTIONS` is spliced in after argv[0], and will be again.)
    let mut has_replaced_option = false;
    for arg in bun_core::argv()
        .iter()
        .skip(1 + bun_core::bun_options_argc())
    {
        let arg: &[u8] = arg;
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
