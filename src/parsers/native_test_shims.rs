//! Native symbols normally provided by Bun's C++ side, shimmed for this
//! crate's `cargo test` / `cargo bench` binaries. Never compiled into the
//! real build, where the real definitions exist.

/// `StackCheck` upper bound: conservatively claim the stack ends 512 KiB
/// below the caller's frame (Rust test threads only get a 2 MiB stack).
#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    (approx_sp.saturating_sub(512 * 1024)) as *mut core::ffi::c_void
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}
