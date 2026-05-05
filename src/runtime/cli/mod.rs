//! Port of src/runtime/cli/cli.zig — CLI entry point + command dispatch.
//!
//! B-2: full draft (1773 lines, preserved in `cli_body.rs`) depends on
//! `bun_output` macros, `bun_schema::api`, `bun_options_types::compile_target`,
//! `bun_crash_handler::handle_root_error`, and `bun_core::time::nano_timestamp`.
//! Per-command submodules likewise gated.

use core::cell::Cell;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "cli_body.rs"]
mod cli_body;
// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "ci_info.rs"]
pub mod ci_info;
/// Stub for the build.zig-registered `@import("ci_info")` module (output of
/// `src/codegen/ci_info.ts`). Real codegen wiring lands in Phase B; until then
/// the generated probes are no-ops so `ci_info::is_ci`/`detect_ci_name` compile.
// TODO(port): wire to actual codegen output (src/codegen/ci_info.ts).
pub(crate) mod ci_info_generated {
    #[inline]
    pub fn is_ci_uncached_generated() -> bool { false }
    #[inline]
    pub fn detect_uncached_generated() -> Option<&'static [u8]> { None }
}

#[path = "which_npm_client.rs"]
pub mod which_npm_client;
#[path = "add_completions.rs"]
pub mod add_completions;
#[path = "colon_list_type.rs"]
pub mod colon_list_type;

// TODO(port): Zig `var start_time: i128 = undefined;` — mutable static, single-threaded init in Cli::start
// Per PORTING.md §Concurrency: mutable globals → OnceLock or atomic. Kept as
// raw mutable static here only because the Zig writes once at process startup
// before any thread spawn; revisit with `AtomicI128` shim if needed.
pub static mut START_TIME: i128 = 0;

#[allow(non_upper_case_globals)]
// TODO(port): mutable static Option<&[u8]>; written from C++ side (process.title)
pub static mut Bun__Node__ProcessTitle: Option<&'static [u8]> = None;

thread_local! {
    pub static IS_MAIN_THREAD: Cell<bool> = const { Cell::new(false) };
}

// ─── opaque type surface ─────────────────────────────────────────────────────
// TODO(b2-blocked): bun_output::declare_scope
// TODO(b2-blocked): bun_schema::api
// TODO(b2-blocked): bun_crash_handler::handle_root_error
pub mod command {
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Tag {
        // TODO(b2-blocked): full variant list from cli.zig Command.Tag
        Run,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/cli/cli.zig
//   confidence: low (B-2 thin un-gate)
// ──────────────────────────────────────────────────────────────────────────
