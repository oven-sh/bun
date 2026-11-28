//! Symbols that the rest of Bun provides, for this crate's `cargo test` binary.

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_dump_stack_trace(
    _first_address: Option<usize>,
    _limits: bun_core::DumpStackTraceOptions,
) {
}
