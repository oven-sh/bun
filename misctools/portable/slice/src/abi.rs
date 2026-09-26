//! The import table of the image, seen from a program: the list of what is bound, and calls into the
//! functions that the Linux test host has for this test (`bun_host_test` in host/host_posix.c).
//!
//! Those functions are compiled with the calling convention of Windows x64. The image calls them the
//! way it calls `kernel32` on a Windows host, so the plumbing of `#[imports]` and of `#[win_abi]` runs
//! on a machine that has no Windows: arguments beyond the fourth, which Windows passes on the stack,
//! floating point arguments, which Windows numbers by position, a structure that is larger than a
//! register, and a function of the image that the host calls back.

use core::ffi::c_void;

use bun_windows_sys::host_imports::{self, Unbound};

use crate::json::Report;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Pair {
    first: i64,
    second: i64,
}

#[bun_portable_macros::win_abi]
type Callback = unsafe extern "C" fn(*mut c_void, i32, i64, u32, i16, i64, f64) -> i64;

#[bun_portable_macros::imports(library = "bun_host_test")]
unsafe extern "C" {
    fn test_sum6(a: i32, b: i64, c: u32, d: *mut c_void, e: i16, f: i64) -> i64;
    safe fn test_mixed(x: f64, y: i32, z: f64, w: f32, v: i64) -> f64;
    safe fn test_pair_by_value(pair: Pair, add: i64) -> Pair;
    fn test_callback(callback: Callback, context: *mut c_void) -> i64;
    safe fn test_not_there() -> i32;
}

/// What the host calls. It has the calling convention of the host's functions, as a callback of libuv
/// or of Windows has in the image.
#[bun_portable_macros::win_abi]
unsafe extern "C" fn on_callback(context: *mut c_void, a: i32, b: i64, c: u32, d: i16, e: i64, f: f64) -> i64 {
    // SAFETY: `context` is the `i64` that `run` passes to `test_callback` and keeps alive over the call.
    let seen = unsafe { &mut *context.cast::<i64>() };
    *seen += 1;
    i64::from(a) + b + i64::from(c) + i64::from(d) + e + (f * 2.0) as i64
}

pub fn run() -> bool {
    let mut report = Report::new();
    let mut passed = true;
    let mut check = |report: &mut Report, name: &str, ok: bool| {
        report.begin(name);
        report.boolean("as_expected", ok);
        report.end_ok();
        passed &= ok;
    };

    // SAFETY: the function reads its arguments and nothing else.
    let sum = unsafe { test_sum6(-1, 20_000_000_000, 3_000_000_000, 7 as *mut c_void, -4, 5) };
    let expected = -1 + 20_000_000_000 * 10 + 3_000_000_000 * 100 + 7 * 1000 + (-4) * 10000 + 5 * 100000;
    check(&mut report, "six integers", sum == expected);

    let mixed = test_mixed(1.5, -2, 0.25, 3.0, 4);
    check(&mut report, "floating point and integers", mixed == 1.5 * 2.0 - 2.0 * 3.0 + 0.25 * 5.0 + 3.0 * 7.0 + 4.0 * 11.0);

    let pair = test_pair_by_value(Pair { first: 10, second: 20 }, 3);
    check(&mut report, "a structure of 16 bytes, by value", pair == Pair { first: 23, second: 7 });

    let mut calls = 0i64;
    // SAFETY: `on_callback` has the signature the host calls, and `calls` outlives the call.
    let result = unsafe { test_callback(on_callback, (&raw mut calls).cast()) };
    let expected = -1 + 20_000_000_000 + 3_000_000_000 - 4 + 5 + 13 + 1;
    check(&mut report, "a function of the image, called by the host", result == expected && calls == 1);

    report.begin("imports of this test");
    report.number("in_the_table", host_imports::all().filter(|import| import.library().to_bytes() == b"bun_host_test").count() as i64);
    report.end_ok();

    report.print() && passed
}

/// Binds everything and prints what could not be bound.
pub fn print_imports() -> bool {
    let mut report = Report::new();
    let mut total = 0;
    let mut missing = 0;
    for import in host_imports::all() {
        if import.library().to_bytes() == b"bun_host_test" {
            continue;
        }
        total += 1;
        if let Err(why) = import.bind() {
            missing += 1;
            report.begin("import");
            report.string("library", import.library().to_bytes());
            report.string("symbol", import.symbol().to_bytes());
            report.string(
                "why",
                match why {
                    Unbound::HostIsNotWindows(_) => b"the host is not Windows",
                    Unbound::NotFound => b"not found",
                },
            );
            report.boolean("ok", false);
            report.end_line();
        }
    }
    report.begin("imports");
    report.number("total", total);
    report.number("missing", missing);
    report.end_ok();
    let _ = test_not_there;
    report.print() && missing == 0
}
