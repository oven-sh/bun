#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

#[cfg(target_os = "macos")] pub mod darwin_errno;
#[cfg(target_os = "macos")] pub use darwin_errno::{*, posix};
#[cfg(target_os = "freebsd")] pub mod freebsd_errno;
#[cfg(target_os = "freebsd")] pub use freebsd_errno::{*, posix};
#[cfg(target_os = "linux")] pub mod linux_errno;
#[cfg(target_os = "linux")] pub use linux_errno::{*, posix};
#[cfg(windows)] pub mod windows_errno;
#[cfg(windows)] pub use windows_errno::*;
