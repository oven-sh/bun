#![allow(invalid_reference_casting)]

struct EventLoop {
    entered_event_loop_count: isize,
}

impl EventLoop {
    fn enter(&mut self) {
        self.entered_event_loop_count += 1;
    }

    unsafe fn enter_scope(loop_: *mut EventLoop) -> Guard {
        unsafe { (*loop_).enter() };
        Guard { loop_ }
    }
}

struct Guard {
    loop_: *mut EventLoop,
}

impl Drop for Guard {
    fn drop(&mut self) {
        unsafe {
            (*self.loop_).entered_event_loop_count -= 1;
        }
    }
}

struct CopyFileWindowsShape<'a> {
    event_loop: &'a EventLoop,
}

impl CopyFileWindowsShape<'_> {
    fn resolve_promise(&mut self) {
        let _guard =
            unsafe { EventLoop::enter_scope(self.event_loop as *const EventLoop as *mut EventLoop) };
    }
}

fn main() {
    let loop_ = EventLoop {
        entered_event_loop_count: 0,
    };
    let mut copy = CopyFileWindowsShape { event_loop: &loop_ };
    copy.resolve_promise();
}
