//! Makes system calls fail on demand by replacing their entries in the test binary's import address table (IAT).

use core::cell::RefCell;
use core::ffi::{CStr, c_char, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_windows_sys::Win32Error;
use bun_windows_sys::kernel32::{PAGE_READWRITE, SetLastError};

/// If set, `GetProcAddress` does not find the wait completion packet functions.
pub(crate) const NO_WAIT_PACKETS_ENV: &str = "BUN_IOCP_TEST_NO_WAIT_PACKETS";

thread_local! {
    static INTERCEPTORS: RefCell<Vec<(Call, Box<dyn FnMut(&[usize]) -> Option<usize>>)>> =
        const { RefCell::new(Vec::new()) };
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn VirtualProtect(
        address: *mut c_void,
        size: usize,
        new_protect: u32,
        old_protect: &mut u32,
    ) -> i32;
}

#[must_use]
pub(crate) struct InterceptGuard(Call);

impl Drop for InterceptGuard {
    fn drop(&mut self) {
        INTERCEPTORS
            .with_borrow_mut(|interceptors| interceptors.retain(|(call, _)| *call != self.0));
    }
}

/// `interceptor` gets the arguments of each `call` on this thread. `Some` skips the call and becomes its result.
pub(crate) fn intercept(
    call: Call,
    interceptor: impl FnMut(&[usize]) -> Option<usize> + 'static,
) -> InterceptGuard {
    INTERCEPTORS.with_borrow_mut(|interceptors| interceptors.push((call, Box::new(interceptor))));
    InterceptGuard(call)
}

pub(crate) fn fail(call: Call, mut count: usize, result: usize) -> InterceptGuard {
    intercept(call, move |_| {
        count = count.checked_sub(1)?;
        Some(result)
    })
}

fn run_interceptor(call: Call, args: &[usize]) -> Option<usize> {
    let result = INTERCEPTORS.try_with(|interceptors| {
        let mut interceptors = interceptors.try_borrow_mut().ok()?;
        let (_, interceptor) = interceptors
            .iter_mut()
            .find(|(target, _)| *target == call)?;
        interceptor(args)
    });
    let result = result.ok()??;
    let error = match call {
        Call::SleepConditionVariableSRW => Win32Error::TIMEOUT,
        _ => Win32Error::NOT_ENOUGH_MEMORY,
    };
    SetLastError(error.0.into());
    Some(result)
}

macro_rules! arg_type {
    ($arg:ident) => {
        usize
    };
}

/// Evaluates to the hook's address and the static that must hold the original function's address.
macro_rules! define_hook {
    ($name:ident($($arg:ident)*) $handler:expr) => {{
        static ORIGINAL: AtomicUsize = AtomicUsize::new(0);
        extern "system" fn hook($($arg: usize),*) -> usize {
            let call_original = || {
                type OriginalFn = extern "system" fn($(arg_type!($arg)),*) -> usize;
                // SAFETY: the original takes the same number of arguments, each in one register or stack slot.
                let original = unsafe { core::mem::transmute::<usize, OriginalFn>(ORIGINAL.load(Ordering::Relaxed)) };
                original($($arg),*)
            };
            $handler(&[$($arg),*], call_original)
        }
        ((hook as *const ()).expose_provenance(), &ORIGINAL)
    }};
    ($name:ident($($arg:ident)*)) => {
        define_hook!($name($($arg)*) |args, call_original| run_interceptor(Call::$name, args).unwrap_or_else(call_original))
    };
}

macro_rules! replace_import {
    ($name:ident $($rest:tt)*) => {{
        unsafe extern "C" {
            #[link_name = concat!("__imp_", stringify!($name))]
            static mut IAT_ENTRY: usize;
        }
        let (hook, original) = define_hook!($name $($rest)*);
        let entry = &raw mut IAT_ENTRY;
        // SAFETY: the loader has filled the entry, and no other thread exists yet.
        unsafe {
            VirtualProtect(entry.cast(), size_of::<usize>(), PAGE_READWRITE, &mut 0);
            original.store(entry.replace(hook), Ordering::Relaxed);
        }
    }};
}

macro_rules! define_calls {
    (
        imported { $($imported:ident $imported_args:tt)* }
        dynamic { $($dynamic:ident $dynamic_args:tt)* }
    ) => {
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub(crate) enum Call { $($imported,)* $($dynamic,)* }

        extern "C" fn install_hooks() {
            $(replace_import!($imported $imported_args);)*
            replace_import!(GetProcAddress(module name) resolve_proc_address);
        }

        fn resolve_proc_address(args: &[usize], call_original: impl FnOnce() -> usize) -> usize {
            let address = call_original();
            if args[1] <= u16::MAX.into() {
                return address;
            }
            // SAFETY: `lpProcName` is not an ordinal, so it is a NUL-terminated name.
            let name = unsafe { CStr::from_ptr(core::ptr::with_exposed_provenance::<c_char>(args[1])) };
            $(if name.to_bytes() == stringify!($dynamic).as_bytes() {
                if std::env::var_os(NO_WAIT_PACKETS_ENV).is_some() {
                    return 0;
                }
                let (hook, original) = define_hook!($dynamic $dynamic_args);
                original.store(address, Ordering::Relaxed);
                return hook;
            })*
            address
        }
    };
}

define_calls! {
    imported {
        CreateEventW(a b c d)
        CreateIoCompletionPort(a b c d)
        CreateThread(a b c d e f)
        CreateWaitableTimerExW(a b c d)
        DuplicateHandle(a b c d e f g)
        NtCancelIoFileEx(a b c)
        NtCreateFile(a b c d e f g h i j k)
        NtDeviceIoControlFile(a b c d e f g h i j)
        NtRemoveIoCompletionEx(a b c d e f)
        NtSetIoCompletion(a b c d e)
        OpenThread(a b c)
        SetEvent(a)
        NtSetInformationThread(a b c d)
        NtQueryInformationThread(a b c d e)
        GetPriorityClass(a)
        GetThreadPriorityBoost(a b)
        SetFileCompletionNotificationModes(a b)
        SetWaitableTimer(a b c d e f)
        SleepConditionVariableSRW(a b c d)
        SwitchToThread()
        WSAIoctl(a b c d e f g h i)
    }
    dynamic {
        NtCreateWaitCompletionPacket(a b c)
        NtAssociateWaitCompletionPacket(a b c d e f g h)
        NtCancelWaitCompletionPacket(a b)
    }
}

/// The CRT runs this initializer before `main`.
#[used]
#[unsafe(link_section = ".CRT$XCU")]
static INSTALL_HOOKS: extern "C" fn() = install_hooks;
