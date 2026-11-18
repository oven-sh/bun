//! AppKit only runs on the main thread, so everything else moves to another one.
//!
//! Native addons take JavaScript's thread for the main thread. They run on the latter while the former waits, and the
//! other way around for the Node-API functions that they call.

#[cfg(unix)]
use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use super::{LIBRARY, Library};

type Function = unsafe extern "C" fn(*mut c_void);
pub(super) type Door = unsafe extern "C" fn(Function, *mut c_void);

#[unsafe(export_name = "Bun__isMainThreadLent")]
static IS_LENT: AtomicBool = AtomicBool::new(false);
/// What the main thread opens without waiting for JavaScript to ask.
static KNOWN_LIBRARY: OnceLock<Option<Library>> = OnceLock::new();

#[cfg(unix)]
#[derive(Clone, Copy, PartialEq)]
enum Role {
    Other,
    Main,
    JavaScript,
}

#[cfg(unix)]
#[thread_local]
static ROLE: Cell<Role> = Cell::new(Role::Other);

pub(super) fn is_lent() -> bool {
    IS_LENT.load(Ordering::Relaxed)
}

fn library() -> Option<&'static Library> {
    KNOWN_LIBRARY.wait().as_ref().or_else(|| LIBRARY.get())
}

#[unsafe(no_mangle)]
extern "C" fn Bun__isOnLentMainThread() -> bool {
    #[cfg(unix)]
    return ROLE.get() == Role::Main;
    #[cfg(not(unix))]
    false
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__enterLentMainThread(function: Function, context: *mut c_void) {
    #[cfg(unix)]
    if ROLE.get() == Role::JavaScript
        && let Some(library) = library()
    {
        // SAFETY: the caller's contract, and this thread waits.
        return unsafe { (library.call_on_main_thread)(function, context) };
    }
    // SAFETY: the caller's contract.
    unsafe { function(context) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__leaveLentMainThread(function: Function, context: *mut c_void) {
    let library = library().expect("it runs the main thread");
    // SAFETY: as above.
    unsafe { (library.call_on_javascript_thread)(function, context) }
}

fn call_through<R, F: FnOnce() -> R>(door: Door, function: F) -> R {
    unsafe extern "C" fn call<R, F: FnOnce() -> R>(context: *mut c_void) {
        // SAFETY: the tuple below, whose owner waits.
        let (function, result) = unsafe { &mut *context.cast::<(Option<F>, Option<R>)>() };
        *result = function.take().map(|function| function());
    }
    let mut context = (Some(function), None);
    // SAFETY: matching types.
    unsafe { door(call::<R, F>, (&raw mut context).cast()) };
    context.1.expect("it was called")
}

#[inline]
pub(crate) fn is_current() -> bool {
    is_lent() && Bun__isOnLentMainThread()
}

/// For code of an addon.
#[inline]
pub(crate) fn enter<R>(function: impl FnOnce() -> R) -> R {
    if is_lent() {
        return call_through(Bun__enterLentMainThread, function);
    }
    function()
}

#[cold]
#[inline(never)]
pub(crate) fn leave<R>(function: impl FnOnce() -> R) -> R {
    call_through(Bun__leaveLentMainThread, function)
}

#[cfg(unix)]
fn shows_nothing() -> bool {
    use bun_core::env_var;
    #[cfg(target_os = "macos")]
    if env_var::BUN_INTERNAL_WEBVIEW_HOST::get().is_some() {
        return true;
    }
    env_var::feature_flag::BUN_BE_BUN::get().unwrap_or(false)
        || env_var::BUN_DESKTOP_UTILITY_PROCESS::get().is_some()
        || env_var::ELECTRON_RUN_AS_NODE::get().is_some()
}

/// As root, so before anything looks at the environment. Does not return if it is.
#[cfg(unix)]
#[inline(never)]
pub(crate) fn install_update_if_asked(arguments: &[*const core::ffi::c_char]) {
    unsafe extern "C" {
        fn Bun__Desktop__installUpdate(
            directory: *const core::ffi::c_char,
            app: *const core::ffi::c_char,
        ) -> bool;
    }
    // SAFETY: those of `main`.
    unsafe {
        if let [_, mode, directory, app] = *arguments
            && core::ffi::CStr::from_ptr(mode) == c"--bun-desktop-install-update"
            && bun_standalone_graph::Graph::is_desktop_program()
        {
            libc::_exit(i32::from(!Bun__Desktop__installUpdate(directory, app)));
        }
    }
}

/// Does not return if it is.
#[cfg(unix)]
#[inline(never)]
pub(crate) fn lend_if_needed(run: fn() -> !) {
    use bun_core::env_var;
    // What the main thread has.
    const STACK_SIZE: usize = 18 << 20;
    let is_asked_for = match env_var::BUN_DESKTOP_THREADS::get() {
        Some(b"main") => true,
        Some(b"2") if cfg!(target_os = "macos") => true,
        None if cfg!(target_os = "macos") => false,
        _ => return,
    };
    let path = if bun_standalone_graph::Graph::is_desktop_program() {
        let Some(path) = bun_standalone_graph::desktop::library_in_bundle() else {
            return;
        };
        Some(path)
    } else if is_asked_for && !bun_standalone_graph::Graph::is_in_executable() {
        env_var::BUN_DESKTOP_LIBRARY
            .get_not_empty()
            .map(<[u8]>::to_vec)
    } else {
        return;
    };
    if shows_nothing() {
        return;
    }
    IS_LENT.store(true, Ordering::Relaxed);
    let thread = std::thread::Builder::new()
        .stack_size(STACK_SIZE)
        .spawn(move || {
            #[cfg(target_os = "macos")]
            // SAFETY: it has no preconditions.
            unsafe {
                libc::pthread_set_qos_class_self_np(
                    libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE,
                    0,
                )
            };
            ROLE.set(Role::JavaScript);
            bun_core::output::Source::configure_thread_no_js();
            bun_core::current_work::ensure_signal_stack();
            run()
        });
    if thread.is_err() {
        return IS_LENT.store(false, Ordering::Relaxed);
    }
    ROLE.set(Role::Main);
    let opened = path.and_then(|path| Library::open(&path).ok());
    let known = KNOWN_LIBRARY.get_or_init(|| opened);
    (known.as_ref().unwrap_or_else(|| LIBRARY.wait()).run)()
}
