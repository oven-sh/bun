//! The native libraries that the engine's crates call, for programs that link the engine without the rest of Bun:
//! the shell and the tests of each crate. A test names the crate (`use bun_engine_standalone as _;`) to link them.

#[cfg(not(bun_asan))]
#[global_allocator]
static ALLOCATOR: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

#[unsafe(no_mangle)]
fn __bun_crash_handler_out_of_memory() -> ! {
    std::process::abort()
}

#[unsafe(no_mangle)]
fn __bun_crash_handler_dump_stack_trace(_: Option<usize>, _: bun_core::DumpStackTraceOptions) {}
