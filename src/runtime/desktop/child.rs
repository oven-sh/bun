//! The start of a process that an app has made for a part of its work: `--bun-desktop-child=<role> <UI library>`.

use core::ffi::{CStr, c_char};
use std::sync::OnceLock;

use super::protocol::SOCKET_TO_PARENT;

static LIBRARY_FOR_PAGES: OnceLock<&'static [u8]> = OnceLock::new();

pub(super) fn library() -> Option<&'static [u8]> {
    LIBRARY_FOR_PAGES.get().copied()
}

pub(crate) fn has_pages() -> bool {
    LIBRARY_FOR_PAGES.get().is_some()
}

fn is_from_parent(socket: i32) -> bool {
    bun_sys::net::is_from_parent(bun_sys::Fd::from_native(socket))
}

/// # Safety
/// `arguments` are those of `main`.
pub(super) unsafe fn recognize(arguments: &[*const c_char]) {
    // SAFETY: they last as long as the process.
    unsafe {
        if let [_, mode, library, ..] = *arguments
            && let Some(role) =
                (CStr::from_ptr(mode).to_bytes()).strip_prefix(b"--bun-desktop-child=")
            && !bun_standalone_graph::Graph::is_in_executable()
        {
            match role {
                _ if !is_from_parent(SOCKET_TO_PARENT) => libc::_exit(1),
                b"page" => _ = LIBRARY_FOR_PAGES.set(CStr::from_ptr(library).to_bytes()),
                _ => libc::_exit(1),
            }
        }
    }
}

/// In place of the entry point.
pub(crate) fn enter() {
    unsafe extern "Rust" {
        safe fn __bun_desktop_enter_page_process();
    }
    __bun_desktop_enter_page_process();
}
