#![allow(invalid_reference_casting)]

use core::ptr;

#[derive(Default)]
struct EventLoop {
    queued: usize,
}

impl EventLoop {
    fn enqueue_task(&mut self) {
        self.queued += 1;
    }
}

#[derive(Default)]
struct VirtualMachine {
    event_loop: EventLoop,
}

impl VirtualMachine {
    fn enqueue_task(&mut self) {
        self.event_loop.enqueue_task();
    }
}

struct WindowsNamedPipeContext {
    vm: &'static VirtualMachine,
}

impl WindowsNamedPipeContext {
    unsafe fn deinit_in_next_tick_like_source(&self) {
        let vm = ptr::from_ref::<VirtualMachine>(self.vm).cast_mut();
        unsafe { (*vm).enqueue_task() };
    }
}

fn main() {
    let vm: &'static VirtualMachine = Box::leak(Box::new(VirtualMachine::default()));
    let ctx = WindowsNamedPipeContext { vm };

    unsafe { ctx.deinit_in_next_tick_like_source() };
}

