struct EventLoop {
    queued: usize,
}

impl EventLoop {
    fn enqueue_task(&mut self) {
        self.queued += 1;
    }
}

struct VirtualMachine {
    event_loop: *mut EventLoop,
}

impl VirtualMachine {
    fn new() -> Self {
        let event_loop = Box::into_raw(Box::new(EventLoop { queued: 0 }));
        Self { event_loop }
    }

    fn event_loop_ptr(&self) -> *mut EventLoop {
        self.event_loop
    }
}

struct WindowsNamedPipeContext {
    vm: &'static VirtualMachine,
}

impl WindowsNamedPipeContext {
    unsafe fn deinit_in_next_tick_fixed(&self) {
        let event_loop = self.vm.event_loop_ptr();
        unsafe { (*event_loop).enqueue_task() };
    }
}

fn main() {
    let vm_ptr = Box::into_raw(Box::new(VirtualMachine::new()));
    let vm: &'static VirtualMachine = unsafe { &*vm_ptr };
    let ctx = WindowsNamedPipeContext { vm };

    unsafe { ctx.deinit_in_next_tick_fixed() };

    unsafe { drop(Box::from_raw(vm.event_loop)) };
    unsafe { drop(Box::from_raw(vm_ptr)) };
}
