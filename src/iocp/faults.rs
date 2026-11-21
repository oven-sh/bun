//! System calls that fail on demand. Their entries in the import table of the test program are replaced.

use core::cell::RefCell;
use core::ffi::{CStr, c_char, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_windows_sys::Win32Error;

/// In the environment of a run for which ntdll has none.
pub(crate) const NO_WAIT_PACKETS: &str = "BUN_IOCP_TEST_NO_WAIT_PACKETS";

type Plan = Box<dyn FnMut(&[usize]) -> Option<usize>>;

thread_local! {
    static PLANS: RefCell<Vec<(Call, Plan)>> = const { RefCell::new(Vec::new()) };
}

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn SetLastError(error: u32);
    fn VirtualProtect(address: *mut c_void, size: usize, new: u32, old: &mut u32) -> i32;
}

#[must_use]
pub(crate) struct Intercepted(Call);

impl Drop for Intercepted {
    fn drop(&mut self) {
        PLANS.with_borrow_mut(|plans| plans.retain(|(call, _)| *call != self.0));
    }
}

/// `plan` gets the arguments of the calls of this thread, and returns the result of those that are not made.
pub(crate) fn intercept(
    call: Call,
    plan: impl FnMut(&[usize]) -> Option<usize> + 'static,
) -> Intercepted {
    PLANS.with_borrow_mut(|plans| plans.push((call, Box::new(plan))));
    Intercepted(call)
}

pub(crate) fn fail(call: Call, mut times: usize, result: usize) -> Intercepted {
    intercept(call, move |_| {
        times = times.checked_sub(1)?;
        Some(result)
    })
}

fn planned(call: Call, args: &[usize]) -> Option<usize> {
    let result = PLANS.try_with(|plans| {
        let mut plans = plans.try_borrow_mut().ok()?;
        let (_, plan) = plans.iter_mut().find(|(it, _)| *it == call)?;
        plan(args)
    });
    let result = result.ok()??;
    SetLastError(Win32Error::NOT_ENOUGH_MEMORY.0.into());
    Some(result)
}

macro_rules! word {
    ($arg:ident) => {
        usize
    };
}

/// The address of the stand-in, and where it looks for that of the function.
macro_rules! stand_in {
    ($name:ident($($arg:ident)*) $result:expr) => {{
        static REAL: AtomicUsize = AtomicUsize::new(0);
        extern "system" fn stand_in($($arg: usize),*) -> usize {
            let real = || {
                type Real = extern "system" fn($(word!($arg)),*) -> usize;
                // SAFETY: it takes as many arguments, each in a register or a slot of the stack.
                let real = unsafe { core::mem::transmute::<usize, Real>(REAL.load(Ordering::Relaxed)) };
                real($($arg),*)
            };
            $result(&[$($arg),*], real)
        }
        ((stand_in as *const ()).expose_provenance(), &REAL)
    }};
    ($name:ident($($arg:ident)*)) => {
        stand_in!($name($($arg)*) |args, real| planned(Call::$name, args).unwrap_or_else(real))
    };
}

macro_rules! replace_import {
    ($name:ident $($rest:tt)*) => {{
        unsafe extern "C" {
            #[link_name = concat!("__imp_", stringify!($name))]
            static mut ENTRY: usize;
        }
        const PAGE_READWRITE: u32 = 4;
        let (stand_in, real) = stand_in!($name $($rest)*);
        let entry = &raw mut ENTRY;
        // SAFETY: the loader has filled the entry, and there is no other thread yet.
        unsafe {
            VirtualProtect(entry.cast(), size_of::<usize>(), PAGE_READWRITE, &mut 0);
            real.store(entry.replace(stand_in), Ordering::Relaxed);
        }
    }};
}

macro_rules! calls {
    (
        imported { $($imported:ident $imported_args:tt)* }
        looked_up { $($looked_up:ident $looked_up_args:tt)* }
    ) => {
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub(crate) enum Call { $($imported,)* $($looked_up,)* }

        extern "C" fn install() {
            $(replace_import!($imported $imported_args);)*
            replace_import!(GetProcAddress(module name) look_up);
        }

        fn look_up(args: &[usize], real: impl FnOnce() -> usize) -> usize {
            let address = real();
            if args[1] <= u16::MAX.into() {
                return address;
            }
            // SAFETY: what is no ordinal is a name.
            let name = unsafe { CStr::from_ptr(core::ptr::with_exposed_provenance::<c_char>(args[1])) };
            $(if name.to_bytes() == stringify!($looked_up).as_bytes() {
                if std::env::var_os(NO_WAIT_PACKETS).is_some() {
                    return 0;
                }
                let (stand_in, real) = stand_in!($looked_up $looked_up_args);
                real.store(address, Ordering::Relaxed);
                return stand_in;
            })*
            address
        }
    };
}

calls! {
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
        SetFileCompletionNotificationModes(a b)
        SetWaitableTimer(a b c d e f)
        SwitchToThread()
        WSAIoctl(a b c d e f g h i)
    }
    looked_up {
        NtCreateWaitCompletionPacket(a b c)
        NtAssociateWaitCompletionPacket(a b c d e f g h)
        NtCancelWaitCompletionPacket(a b)
    }
}

#[used]
#[unsafe(link_section = ".CRT$XCU")]
static INSTALL: extern "C" fn() = install;
