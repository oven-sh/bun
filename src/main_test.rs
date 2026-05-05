// pub const bun = @import("./bun.zig");
// PORT NOTE: in Rust the `bun` facade is the `bun_core` (and sibling) crates; no re-export needed here.

use core::ffi::c_void;

use bun_core::{Global, Output};
use bun_runtime::test_runner::harness::recover;

// pub const panic = bun.crash_handler.panic;
// PORT NOTE: Zig's `pub const panic` hook is replaced by Rust's `#[panic_handler]` /
// std panic hook. The test harness installs `recover::panic` as the hook at runtime.
// TODO(port): wire `recover::panic` via `std::panic::set_hook` (or `#[panic_handler]` in no_std).

// pub const std_options = std.Options{ .enable_segfault_handler = false, .cryptoRandomSeed = bun.csprng };
// PORT NOTE: Zig std runtime hook — no Rust equivalent. Segfault handling and CSPRNG seeding
// are configured elsewhere (bun_crash_handler / bun_core::csprng).
// TODO(port): ensure segfault handler is disabled and csprng seed is wired in the Rust binary root.

// pub const io_mode = .blocking;
// PORT NOTE: Zig std I/O mode hook — no Rust equivalent; Bun owns its event loop.

const _: () = assert!(cfg!(target_endian = "little"));

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub static mut _environ: *mut c_void;
    pub static mut environ: *mut c_void;
}

pub fn main() {
    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    #[cfg(windows)]
    {
        // SAFETY: mimalloc fns match the libuv allocator signatures; environ is process-global.
        unsafe {
            let _ = bun_sys::windows::libuv::uv_replace_allocator(
                bun_alloc::mimalloc::mi_malloc as *mut _,
                bun_alloc::mimalloc::mi_realloc as *mut _,
                bun_alloc::mimalloc::mi_calloc as *mut _,
                bun_alloc::mimalloc::mi_free as *mut _,
            );
            // TODO(port): std.os.environ.ptr — obtain the raw environ block pointer for Windows.
            environ = core::ptr::null_mut();
            _environ = core::ptr::null_mut();
        }
    }

    if let Err(err) = bun_core::init_argv() {
        Output::panic(format_args!("Failed to initialize argv: {}\n", err.name()));
    }

    Output::source::Stdio::init();
    // PORT NOTE: `defer Output.flush()` — Global::exit is noreturn, so this guard only fires
    // on unwind; kept for structural parity.
    let _flush = scopeguard::guard((), |_| Output::flush());
    bun_core::StackCheck::configure_thread();
    let exit_code = run_tests();
    Global::exit(exit_code);
}

#[derive(Default)]
struct Stats {
    pass: u32,
    fail: u32,
    leak: u32,
    panic: u32,
    start: i64,
}

impl Stats {
    fn init() -> Stats {
        let mut stats = Stats::default();
        stats.start = milli_timestamp();
        stats
    }

    /// Time elapsed since start in milliseconds
    fn elapsed(&self) -> i64 {
        milli_timestamp() - self.start
    }

    /// Total number of tests run
    fn total(&self) -> u32 {
        self.pass + self.fail + self.leak + self.panic
    }

    fn exit_code(&self) -> u8 {
        let mut result: u8 = 0;
        if self.fail > 0 {
            result |= 1;
        }
        if self.leak > 0 {
            result |= 2;
        }
        if self.panic > 0 {
            result |= 4;
        }
        result
    }
}

fn run_tests() -> u8 {
    let mut stats = Stats::init();
    // TODO(port): std.fs.File.stderr() + .lock(.exclusive)/.unlock() — need bun_sys equivalent
    // for advisory file locking on stderr. Stubbed as no-op for now.
    let stderr = bun_sys::File::stderr();
    let _ = &stderr;

    // PORT NOTE: reshaped for borrowck — Zig used a threadlocal `namebuf: []u8` assigned here
    // and read inside extract_name(); Rust passes the buffer explicitly so the returned slice
    // can borrow from it.
    let mut namebuf = vec![0u8; NAMEBUF_SIZE].into_boxed_slice();

    // TODO(port): builtin.test_functions — Zig compiler-provided list of all `test "..."` fns.
    // Rust has no equivalent; Phase B must supply a registry (e.g. `inventory` / linker section).
    let tests: &[TestFn] = test_functions();
    for t in tests {
        // TODO(port): std.testing.allocator_instance = .{} — Zig leak-checking allocator reset.
        // No Rust equivalent; leak detection would need a custom global allocator hook.

        // TODO(port): stderr.lock(.exclusive) / stderr.unlock()
        let did_lock = false;
        let _unlock = scopeguard::guard((), |_| {
            if did_lock {
                // stderr.unlock();
            }
        });

        let start = milli_timestamp();
        let result = recover::call_for_test(t.func);
        let elapsed = milli_timestamp() - start;

        let name = extract_name(t, &mut namebuf);
        // TODO(port): std.testing.allocator_instance.deinit() -> .leak / .ok
        let memory_check = MemoryCheck::Ok;

        match result {
            Ok(_) => {
                if memory_check == MemoryCheck::Leak {
                    Output::pretty(format_args!(
                        "<yellow>leak</r> - {} <i>({}ms)</r>\n",
                        bstr::BStr::new(name),
                        elapsed
                    ));
                    stats.leak += 1;
                } else {
                    Output::pretty(format_args!(
                        "<green>pass</r> - {} <i>({}ms)</r>\n",
                        bstr::BStr::new(name),
                        elapsed
                    ));
                    stats.pass += 1;
                }
            }
            Err(err) => {
                if err == bun_core::err!("Panic") {
                    Output::pretty(format_args!(
                        "<magenta><b>panic</r> - {} <i>({}ms)</r>\n{}",
                        bstr::BStr::new(t.name),
                        elapsed,
                        err.name()
                    ));
                    stats.panic += 1;
                } else {
                    Output::pretty(format_args!(
                        "<red>fail</r> - {} <i>({}ms)</r>\n{}",
                        bstr::BStr::new(t.name),
                        elapsed,
                        err.name()
                    ));
                    stats.fail += 1;
                }
            }
        }
    }

    let total = stats.total();
    let total_time = stats.elapsed();

    if total == stats.pass {
        Output::pretty(format_args!("\n<green>All tests passed</r>\n"));
    } else {
        Output::pretty(format_args!("\n<green>{}</r> passed", stats.pass));
        if stats.fail > 0 {
            Output::pretty(format_args!(", <red>{}</r> failed", stats.fail));
        } else {
            Output::pretty(format_args!(", 0 failed"));
        }
        if stats.leak > 0 {
            Output::pretty(format_args!(", <yellow>{}</r> leaked", stats.leak));
        }
        if stats.panic > 0 {
            Output::pretty(format_args!(", <magenta>{}</r> panicked", stats.panic));
        }
    }

    Output::pretty(format_args!(
        "\n\tRan <b>{}</r> tests in <b>{}</r>ms\n\n",
        total, total_time
    ));
    stats.exit_code()
}

// heap-allocated on start to avoid increasing binary size
// PORT NOTE: was `threadlocal var namebuf: []u8 = undefined;` — see reshape note in run_tests().
const NAMEBUF_SIZE: usize = 4096;
const _: () = assert!(NAMEBUF_SIZE.is_power_of_two());

fn extract_name<'a>(t: &TestFn, namebuf: &'a mut [u8]) -> &'a [u8] {
    const TEST_SEPS: [&[u8]; 2] = [b".test.", b".decltest."];
    for test_sep in TEST_SEPS {
        if let Some(marker) = bun_str::strings::last_index_of(t.name, test_sep) {
            let prefix = &t.name[..marker];
            let test_name = &t.name[marker + test_sep.len()..];
            // std.fmt.bufPrint(namebuf, "{s}\t{s}", .{ prefix, test_name })
            use std::io::Write;
            let mut cursor: &mut [u8] = namebuf;
            let cap = cursor.len();
            write!(
                cursor,
                "{}\t{}",
                bstr::BStr::new(prefix),
                bstr::BStr::new(test_name)
            )
            .expect("name buffer too small");
            let written = cap - cursor.len();
            return &namebuf[..written];
        }
    }

    t.name
}

pub mod overrides {
    pub mod mem {
        // TODO(port): move to <area>_sys
        unsafe extern "C" {
            pub fn wcslen(s: *const u16) -> usize;
        }

        // PORT NOTE: Zig signature `indexOfSentinel(comptime T: type, comptime sentinel: T, p: [*:sentinel]const T)`.
        // Rust const generics cannot take a value of generic type `T` on stable, so `sentinel`
        // is demoted to a runtime arg and the comptime fast-paths are dropped.
        // PERF(port): was comptime monomorphization (strlen for u8/0, wcslen for u16/0 on Windows) — profile in Phase B.
        // TODO(port): restore u8/u16 specializations via separate fns or trait specialization.
        pub fn index_of_sentinel<T: PartialEq + Copy>(sentinel: T, p: *const T) -> usize {
            // SAFETY: caller guarantees `p` is a valid sentinel-terminated buffer.
            let mut i: usize = 0;
            unsafe {
                while *p.add(i) != sentinel {
                    i += 1;
                }
            }
            i
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__panic(msg: *const u8, len: usize) -> ! {
    // SAFETY: caller passes a valid (msg, len) byte slice.
    let s = unsafe { core::slice::from_raw_parts(msg, len) };
    Output::panic(format_args!("{}", bstr::BStr::new(s)));
}

// PORT NOTE: `comptime { _ = @import(...) }` force-reference block dropped — Rust links what's `pub`.

// ─── Port shims ───────────────────────────────────────────────────────────

/// Mirrors `std.builtin.TestFn`.
// TODO(port): Zig compiler-provided type; Phase B must define the real registry entry shape.
pub struct TestFn {
    pub name: &'static [u8],
    pub func: fn() -> Result<(), bun_core::Error>,
}

// TODO(port): builtin.test_functions registry stub.
fn test_functions() -> &'static [TestFn] {
    &[]
}

// TODO(port): std.time.milliTimestamp() — wall-clock ms since Unix epoch as i64.
fn milli_timestamp() -> i64 {
    bun_core::time::milli_timestamp()
}

#[derive(PartialEq, Eq)]
enum MemoryCheck {
    Ok,
    Leak,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/main_test.zig (206 lines)
//   confidence: low
//   todos:      14
//   notes:      Zig test-harness entrypoint; builtin.test_functions / std.testing leak-allocator / stderr file-lock have no Rust equivalents — Phase B needs a real test registry + leak-check strategy.
// ──────────────────────────────────────────────────────────────────────────
