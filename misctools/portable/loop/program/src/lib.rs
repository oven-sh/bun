//! The steps of the loop slice: bun's event loop, its timers, its sockets, its pipes, its child processes
//! and its thread pool, used the way bun's runtime uses them, by a program that has none of bun's
//! JavaScript.
//!
//! Every step goes through bun's own crates (`bun_event_loop`, `bun_uws_sys`, `bun_io`, `bun_spawn`,
//! `bun_threading`), and which code answers is bun's choice for the OS: uSockets on epoll and bun's POSIX
//! pipes and `posix_spawn` on Linux, uSockets on libuv and bun's libuv pipes and `uv_spawn` on Windows.
//! The portable image holds this crate once for each OS, and `main` of the image picks.
//!
//! What `bun_runtime` gives the crates below it, and this program gives them instead, is in `hooks`.
//!
//! The output has no time, no process id, no port and no path, so one expected output serves every host.

use core::ffi::c_void;

use bun_event_loop::MiniEventLoop::MiniEventLoop;
// Its exports are what uSockets on epoll calls (`sys_epoll_pwait2`); `bun_runtime` holds it the same way.
use bun_platform as _;

mod child;
mod hooks;
mod json;
mod pool;
mod tcp;
mod timer;

use json::Report;

/// The loop of this thread, as `bun install` and `bun build` have it.
pub(crate) struct Loop {
    pub(crate) mini: *mut MiniEventLoop,
}

impl Loop {
    fn get() -> Loop {
        Loop {
            mini: bun_event_loop::MiniEventLoop::init_global(None, None),
        }
    }

    pub(crate) fn handle(&self) -> bun_event_loop::EventLoopHandle {
        bun_event_loop::EventLoopHandle::init_mini(self.mini)
    }

    pub(crate) fn uws(&self) -> *mut bun_uws_sys::Loop {
        // SAFETY: `mini` is the loop of this thread, which lives as long as the thread.
        unsafe { (*self.mini).loop_ptr() }
    }

    /// Runs the loop until `done` says so.
    pub(crate) fn run_until(&self, done: impl Fn() -> bool) {
        while !done() {
            // SAFETY: as above, and nothing here holds a reference into the loop over the call.
            unsafe { (*self.mini).tick_once(core::ptr::null_mut::<c_void>()) };
        }
    }
}

/// What `main` of the image calls: the arguments without the name of the program, and the name.
pub fn run(program: &'static [u8], arguments: &[&'static [u8]]) -> i32 {
    match arguments {
        [b"child", mode] => child::main_of_the_child(mode),
        [] => {
            let event_loop = Loop::get();
            let mut report = Report::new();
            let mut passed = true;
            passed &= timer::step(&mut report, &event_loop);
            passed &= tcp::steps(&mut report, &event_loop);
            passed &= pool::step(&mut report, &event_loop);
            passed &= child::steps(&mut report, &event_loop, program);
            #[cfg(windows)]
            {
                passed &= timer::step_of_usockets(&mut report, &event_loop);
            }
            if report.print() && passed { 0 } else { 1 }
        }
        _ => 2,
    }
}
