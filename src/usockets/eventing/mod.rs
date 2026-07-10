#[cfg(target_os = "linux")]
mod epoll;
#[cfg(target_os = "linux")]
pub use epoll::*;

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
mod kqueue;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
pub use kqueue::*;

#[cfg(target_os = "windows")]
mod libuv;
#[cfg(target_os = "windows")]
pub use libuv::*;
