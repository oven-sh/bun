//! Native symbols shimmed for this crate's `cargo test` binary only. The
//! shared set lives in `bun_test_native_link`; the `OutputSink[Sys]` dispatch
//! stubs below are per-crate because bun_sys (whose own tests must not see a
//! second definition) provides the real ones.

// Pull the shared shim crate (+ its prebuilt-libuv archive) and the real
// `ErrnoNames[Sys]` dispatch impl into the link.
use bun_errno as _;
use bun_test_native_link as _;

macro_rules! panic_stubs {
    ($($name:ident),* $(,)?) => {$(
        #[allow(non_snake_case)]
        #[unsafe(no_mangle)]
        extern "Rust" fn $name() -> ! {
            panic!(concat!(
                "bun_paths test stub `",
                stringify!($name),
                "` was called at runtime — tests must not write through \
                 bun_core::Output"
            ));
        }
    )*};
}

panic_stubs!(
    __bun_dispatch__OutputSink__Sys__create_file,
    __bun_dispatch__OutputSink__Sys__is_terminal,
    __bun_dispatch__OutputSink__Sys__make_path,
    __bun_dispatch__OutputSink__Sys__quiet_writer_adapt,
    __bun_dispatch__OutputSink__Sys__quiet_writer_from_fd,
    __bun_dispatch__OutputSink__Sys__quiet_writer_write_all,
    __bun_dispatch__OutputSink__Sys__read,
    __bun_dispatch__OutputSink__Sys__stderr,
);
