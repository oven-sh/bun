//! Runs scripts and modules on the engine alone, for conformance suites and benchmarks.

#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]
// The wrappers that these lints point to need the rest of Bun.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

mod command_line;
mod edge_counters;
mod files;
mod functions;
mod global;
mod inspector;
mod modules;
mod perf_map;
mod persistent;
mod run;
mod state;

use bun_engine_standalone as _;

use crate::command_line::CommandLine;

/// What nearly every module of this crate uses.
mod prelude {
    pub(crate) use bun_engine_macros::native_abi;
    pub(crate) use bun_engine_text::{Identifier, StringRef};
    pub(crate) use bun_engine_vm::{
        Attributes, CallFrame, Cx, ErrorType, Gc, JsObject, JsResult, JsString, NativeFunction,
        Value,
    };

    pub(crate) use crate::functions::Functions;
    pub(crate) use crate::state::State;
}

fn main() {
    // SAFETY: nothing has run yet.
    unsafe { bun_icu::use_default_allocator() };
    let (command_line, options) = CommandLine::parse(std::env::args_os().skip(1));
    bun_engine_vm::set_options(options);
    if command_line.writes_perf_map {
        bun_engine_exec_memory::set_observer(perf_map::record);
    }
    if let Some(exit_codes) = &command_line.exit_codes_path {
        return persistent::serve(&command_line, exit_codes);
    }
    let code = run::run(&command_line, |cx| run::run_scripts(cx, &command_line));
    if command_line.prints_footprint {
        let (current, peak) = functions::footprint();
        println!("Memory Footprint:\n    Current Footprint: {current}\n    Peak Footprint: {peak}");
    }
    run::exit(code)
}
