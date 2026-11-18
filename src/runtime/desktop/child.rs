//! The start of a process that an app has made for a part of its work: `--bun-desktop-child=<role> <UI library>`.

use core::ffi::{CStr, c_char};
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use bun_core::{getenv_z, zstr};
use bun_removable_features::{Feature, is_removed};
use bun_standalone_graph::Graph;

use super::protocol::{EXIT_WITHOUT_SANDBOX, SOCKET_TO_PARENT, Ui};

static LIBRARY_FOR_PAGES: OnceLock<&'static [u8]> = OnceLock::new();
static RUNS_PROGRAM: AtomicBool = AtomicBool::new(false);
static HAS_GPU: AtomicBool = AtomicBool::new(false);

pub(super) fn library() -> Option<&'static [u8]> {
    LIBRARY_FOR_PAGES.get().copied()
}

pub(crate) fn has_pages() -> bool {
    LIBRARY_FOR_PAGES.get().is_some()
}

/// The parts of it that pages load.
pub(super) fn runs_program() -> bool {
    RUNS_PROGRAM.load(Ordering::Relaxed)
}

fn is_from_parent(socket: i32) -> bool {
    bun_sys::net::is_from_parent(bun_sys::Fd::from_native(socket))
}

/// Whoever can start a program gets no more than a sandbox out of it.
///
/// # Safety
/// Nothing else has looked at the environment.
unsafe fn drop_options_in_environment() {
    unsafe extern "C" {
        static environ: *mut *mut c_char;
    }
    let harmless: [&[u8]; 4] = [b"TZ=", b"LANG=", b"LANGUAGE=", b"LC_"];
    // SAFETY: it ends with null, and gets no longer.
    unsafe {
        let (mut from, mut to) = (environ, environ);
        while !(*from).is_null() {
            let entry = CStr::from_ptr(*from).to_bytes();
            if harmless.iter().any(|it| entry.starts_with(it)) {
                *to = *from;
                to = to.add(1);
            }
            from = from.add(1);
        }
        *to = core::ptr::null_mut();
    }
}

pub(super) fn is_supported() -> bool {
    match Graph::is_in_executable() {
        true => cfg!(target_os = "linux") && Graph::is_desktop_program(),
        false => cfg!(any(target_os = "linux", target_os = "macos")),
    }
}

fn is_being_tested() -> bool {
    let names = [
        zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING"),
        zstr!("BUN_DESKTOP_PAGE_PROCESSES"),
    ];
    names.into_iter().all(|it| getenv_z(it).is_some())
}

/// # Safety
/// `arguments` are those of `main`.
pub(super) unsafe fn recognize(arguments: &[*const c_char]) {
    // SAFETY: they last as long as the process.
    unsafe {
        if let [_, mode, library, ..] = *arguments
            && let Some(role) =
                (CStr::from_ptr(mode).to_bytes()).strip_prefix(b"--bun-desktop-child=")
            && (!Graph::is_in_executable() || (is_supported() && is_being_tested()))
        {
            #[cfg(target_os = "linux")]
            {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as usize);
                if libc::syscall(libc::SYS_close_range, SOCKET_TO_PARENT + 1, !0u32, 0u32) != 0 {
                    (SOCKET_TO_PARENT + 1..libc::getdtablesize())
                        .for_each(|it| _ = libc::close(it));
                }
            }
            HAS_GPU.store(role == b"gpu", Ordering::Relaxed);
            match role {
                _ if !is_from_parent(SOCKET_TO_PARENT) => libc::_exit(1),
                b"page" | b"compiled-page" | b"gpu" if Graph::is_in_executable() => {
                    RUNS_PROGRAM.store(role == b"compiled-page", Ordering::Relaxed);
                    if role != b"gpu" {
                        drop_options_in_environment();
                    }
                    match bun_standalone_graph::desktop::library_in_bundle() {
                        Some(own) => _ = LIBRARY_FOR_PAGES.set(own.leak()),
                        None => libc::_exit(1),
                    }
                }
                b"page" | b"compiled-page" | b"gpu" => {
                    _ = LIBRARY_FOR_PAGES.set(CStr::from_ptr(library).to_bytes())
                }
                _ => libc::_exit(1),
            }
        }
    }
}

fn is_sandbox_wanted() -> bool {
    Graph::is_in_executable() || !bun_core::argv().iter().any(|it| it == b"--no-sandbox")
}

/// While there is only one thread.
pub(super) fn prepare() {
    if HAS_GPU.load(Ordering::Relaxed) {
        if let Some(Ok(opened)) = library().map(super::Library::open) {
            (opened.ui.become_gpu_process)(is_sandbox_wanted());
        }
        // SAFETY: nothing has been started.
        unsafe { libc::_exit(1) }
    }
    if let Some(path) = library().filter(|_| is_sandbox_wanted())
        && let Ok(opened) = super::Library::open(path)
    {
        (opened.ui.prepare_sandbox)();
    }
}

/// Once all that is needed from files has been read.
pub(super) fn seal(ui: &Ui) {
    unsafe extern "C" {
        safe fn Bun__Desktop__readWhatPagesNeed();
    }
    Bun__Desktop__readWhatPagesNeed();
    let generates_code =
        bun_jsc::compiled_program::compiled_program().is_none() && !is_removed(Feature::Jit);
    if is_sandbox_wanted() && !(ui.enter_sandbox)(generates_code) {
        // SAFETY: nothing has been started.
        unsafe { libc::_exit(EXIT_WITHOUT_SANDBOX) }
    }
}

/// In place of the entry point.
pub(crate) fn enter() {
    unsafe extern "Rust" {
        safe fn __bun_desktop_enter_page_process();
    }
    __bun_desktop_enter_page_process();
}
