//! What `common` and `i18n` cannot do without `unsafe`: calls of the C library and Windows, and the linked data.

pub(crate) mod file;
pub(crate) mod host;
#[cfg(unix)]
mod host_unix;
#[cfg(windows)]
mod host_windows;
pub(crate) mod package;
pub(crate) mod ptr;
