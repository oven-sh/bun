//! The loop slice: a program of the portable image that runs bun's event loop.
//!
//!   bun_loop_slice                runs the steps and prints one JSON object for each
//!   bun_loop_slice child <mode>   what a step starts as its child process
//!   bun_loop_slice --imports      binds every function of Windows and of libuv that the image can call
//!                                 and prints the ones the host could not resolve
//!
//! The steps are the crate `loop_program`. The image holds it, and bun's crates for the event loop, for
//! sockets, for pipes and for child processes, once for each OS it has the code of: the code for POSIX
//! as bun compiles it for Linux, the code for Windows as bun compiles it for Windows
//! (misctools/portable/loop/flavor.ts). This function picks, once, by the OS of the host.
#![no_main]

use core::ffi::{c_char, c_int};

use bun_sys::{Fd, File};
use bun_windows_sys::host_imports::{self, Unbound};

/// mimalloc as the process allocator, as in bun's `bin_entry`.
#[global_allocator]
static ALLOCATOR: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

unsafe extern "C" {
    /// bun_core: what bun runs when the process ends.
    safe fn Bun__onExit();
}

fn error(message: &[&[u8]]) {
    let stderr = Fd::stderr();
    let stderr = File::borrow(&stderr);
    for part in message {
        let _ = stderr.write_all(part);
    }
}

/// Binds everything and prints what could not be bound.
fn print_imports() -> bool {
    let mut out = Vec::new();
    let mut total = 0;
    let mut missing = 0;
    for import in host_imports::all() {
        total += 1;
        if let Err(why) = import.bind() {
            missing += 1;
            out.extend_from_slice(b"{\"step\":\"import\",\"library\":\"");
            out.extend_from_slice(import.library().to_bytes());
            out.extend_from_slice(b"\",\"symbol\":\"");
            out.extend_from_slice(import.symbol().to_bytes());
            out.extend_from_slice(match why {
                Unbound::HostIsNotWindows(_) => {
                    b"\",\"why\":\"the host is not Windows\",\"ok\":false}\n".as_slice()
                }
                Unbound::NotFound => b"\",\"why\":\"not found\",\"ok\":false}\n".as_slice(),
            });
        }
    }
    {
        use std::io::Write as _;
        let _ = writeln!(
            out,
            "{{\"step\":\"imports\",\"total\":{total},\"missing\":{missing},\"ok\":{}}}",
            missing == 0
        );
    }
    let stdout = Fd::stdout();
    File::borrow(&stdout).write_all(&out).is_ok() && missing == 0
}

#[unsafe(no_mangle)]
pub extern "C" fn main(argc: c_int, argv: *const *const c_char) -> c_int {
    let invalid_hook = bun_core::host::init().err();
    // SAFETY: `argv` is the vector of the C runtime: `argc` pointers to NUL-terminated strings that live
    // as long as the process.
    let all: Vec<&'static [u8]> = (0..argc.max(0) as usize)
        .map(|index| unsafe { core::ffi::CStr::from_ptr(*argv.add(index)).to_bytes() })
        .collect();
    bun_core::output::stdio::init();
    if let Some(invalid) = invalid_hook {
        error(&[
            b"bun_loop_slice: BUN_PORTABLE_HOST_OS is not linux, darwin or win32: ",
            invalid.0,
            b"\n",
        ]);
        return 2;
    }
    let Some((program, arguments)) = all.split_first() else {
        return 2;
    };
    let code = match arguments {
        [b"--imports"] => {
            if print_imports() {
                0
            } else {
                1
            }
        }
        _ if bun_core::host::is_windows() => program_windows::run(program, arguments),
        _ => program_posix::run(program, arguments),
    };
    if code == 2 {
        error(&[b"usage: bun_loop_slice | --imports\n"]);
    }
    Bun__onExit();
    code
}
