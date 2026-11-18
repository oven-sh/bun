use core::mem::MaybeUninit;

use bun_windows_sys::{CONTEXT, CloseHandle, HANDLE};

use super::Registers;

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetCurrentThreadId() -> u32;
    safe fn OpenThread(access: u32, is_inherited: i32, id: u32) -> HANDLE;
    fn SuspendThread(thread: HANDLE) -> u32;
    fn ResumeThread(thread: HANDLE) -> u32;
    fn GetThreadContext(thread: HANDLE, context: &mut CONTEXT) -> i32;
}

const THREAD_SUSPEND_RESUME: u32 = 0x2;
const THREAD_GET_CONTEXT: u32 = 0x8;

#[cfg(target_arch = "x86_64")]
const CONTEXT_CONTROL_AND_INTEGER: u32 = 0x10_0003;
#[cfg(target_arch = "aarch64")]
const CONTEXT_CONTROL_AND_INTEGER: u32 = 0x40_0003;

fn registers_in(context: &CONTEXT) -> Registers {
    #[cfg(target_arch = "x86_64")]
    return Registers {
        program_counter: context.Rip as usize,
        stack_pointer: context.Rsp as usize,
        frame_pointer: context.Rbp as usize,
        bytecode_pointer: context.R12 as usize,
    };
    #[cfg(target_arch = "aarch64")]
    return Registers {
        program_counter: context.Pc as usize,
        stack_pointer: context.Sp as usize,
        frame_pointer: context.Fp as usize,
        bytecode_pointer: context.X[20] as usize,
        link_register: context.Lr as usize,
    };
}

pub(super) fn initialize() {}

pub(super) struct Thread(HANDLE);

// SAFETY: a handle is valid in the whole process.
unsafe impl Send for Thread {}
// SAFETY: as above.
unsafe impl Sync for Thread {}

impl Thread {
    pub(super) fn current() -> Thread {
        let access = THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT;
        Thread(OpenThread(access, 0, GetCurrentThreadId()))
    }

    /// # Safety
    /// The thread has not ended.
    pub(super) unsafe fn suspend(&self) -> Option<Registers> {
        let mut context = MaybeUninit::<CONTEXT>::zeroed();
        // SAFETY: the handle is open or null, for which the first call fails. Zero is a value of each field.
        unsafe {
            if SuspendThread(self.0) == u32::MAX {
                return None;
            }
            let context = context.assume_init_mut();
            context.ContextFlags = CONTEXT_CONTROL_AND_INTEGER;
            // The thread may run on until this has returned.
            if GetThreadContext(self.0, context) == 0 {
                ResumeThread(self.0);
                return None;
            }
            Some(registers_in(context))
        }
    }

    /// # Safety
    /// The thread is suspended.
    pub(super) unsafe fn resume(&self) {
        // SAFETY: the handle is open.
        unsafe { ResumeThread(self.0) };
    }
}

impl Drop for Thread {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: open, and not used again.
            unsafe { CloseHandle(self.0) };
        }
    }
}
