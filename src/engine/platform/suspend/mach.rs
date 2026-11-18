use core::ffi::c_int;
use core::mem::MaybeUninit;

use libc::mach_port_t;

use super::Registers;

unsafe extern "C" {
    safe fn thread_suspend(thread: mach_port_t) -> c_int;
    safe fn thread_resume(thread: mach_port_t) -> c_int;
    fn thread_get_state(
        thread: mach_port_t,
        flavor: c_int,
        state: *mut u32,
        count: &mut u32,
    ) -> c_int;
}

#[cfg(target_arch = "x86_64")]
type State = libc::__darwin_x86_thread_state64;
#[cfg(target_arch = "x86_64")]
const FLAVOR: c_int = 4;

#[cfg(target_arch = "aarch64")]
type State = libc::__darwin_arm_thread_state64;
#[cfg(target_arch = "aarch64")]
const FLAVOR: c_int = 6;

fn registers_in(state: &State) -> Registers {
    #[cfg(target_arch = "x86_64")]
    return Registers {
        program_counter: state.__rip as usize,
        stack_pointer: state.__rsp as usize,
        frame_pointer: state.__rbp as usize,
        bytecode_pointer: state.__r12 as usize,
    };
    #[cfg(target_arch = "aarch64")]
    return Registers {
        program_counter: state.__pc as usize,
        stack_pointer: state.__sp as usize,
        frame_pointer: state.__fp as usize,
        bytecode_pointer: state.__x[20] as usize,
        link_register: state.__lr as usize,
    };
}

pub(super) fn initialize() {}

pub(super) struct Thread(mach_port_t);

impl Thread {
    pub(super) fn current() -> Thread {
        // SAFETY: a question about the current thread.
        Thread(unsafe { libc::pthread_mach_thread_np(libc::pthread_self()) })
    }

    /// # Safety
    /// The thread has not ended.
    pub(super) unsafe fn suspend(&self) -> Option<Registers> {
        if thread_suspend(self.0) != libc::KERN_SUCCESS {
            return None;
        }
        let mut state = MaybeUninit::<State>::uninit();
        let mut count = (size_of::<State>() / size_of::<u32>()) as u32;
        // SAFETY: room for that many words, all of which are written unless it fails.
        unsafe {
            let result = thread_get_state(self.0, FLAVOR, state.as_mut_ptr().cast(), &mut count);
            if result != libc::KERN_SUCCESS {
                thread_resume(self.0);
                return None;
            }
            Some(registers_in(state.assume_init_ref()))
        }
    }

    /// # Safety
    /// The thread is suspended.
    pub(super) unsafe fn resume(&self) {
        thread_resume(self.0);
    }
}
