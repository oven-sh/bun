//! What a process gives up before it gets to see anything that is not trusted. It keeps memory, threads, time and the
//! descriptors that it has or is sent.

#[cfg_attr(target_os = "linux", path = "sandbox/linux.rs")]
#[cfg_attr(target_os = "macos", path = "sandbox/macos.rs")]
mod system;

pub use system::{enter, prepare};
