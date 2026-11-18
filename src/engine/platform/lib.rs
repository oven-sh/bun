//! What the engine asks of the operating system: clocks, the size of the machine, stacks and other threads.

#[cfg(any(target_os = "linux", target_os = "android"))]
mod cgroup;
pub mod clock;
pub mod machine;
mod stack;
pub mod suspend;

pub use bun_core::asan;
pub use stack::StackBounds;

/// To the standard error stream, in one piece.
#[cold]
pub fn log(message: core::fmt::Arguments<'_>) {
    let _ = bun_sys::File::borrow(&bun_sys::Fd::stderr()).write_all(message.to_string().as_bytes());
}
