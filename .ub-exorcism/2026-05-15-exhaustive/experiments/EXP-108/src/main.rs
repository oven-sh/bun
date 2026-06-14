#[derive(Default)]
struct EventLoop {
    entered_event_loop_count: isize,
    reentered: bool,
}

impl EventLoop {
    fn enter(&mut self) {
        self.entered_event_loop_count += 1;
    }

    fn exit(&mut self) {
        self.entered_event_loop_count -= 1;
    }

    fn run_callback_bad(&mut self, callback: fn(*mut EventLoop), owner: *mut EventLoop) {
        let this: *mut Self = std::hint::black_box(std::ptr::from_mut(self));
        unsafe { (*this).enter() };
        callback(owner);
        let this: *mut Self = std::hint::black_box(this);
        unsafe { (*this).exit() };
    }

    unsafe fn run_callback_raw(this: *mut Self, callback: fn(*mut EventLoop)) {
        unsafe { (*this).enter() };
        callback(this);
        let this: *mut Self = std::hint::black_box(this);
        unsafe { (*this).exit() };
    }
}

fn js_reenters_event_loop(owner: *mut EventLoop) {
    let event_loop = unsafe { &mut *owner };
    event_loop.reentered = true;
    event_loop.enter();
    event_loop.exit();
}

fn bad_path() {
    let raw = Box::into_raw(Box::new(EventLoop::default()));
    unsafe {
        (*raw).run_callback_bad(js_reenters_event_loop, raw);
        drop(Box::from_raw(raw));
    }
}

fn good_path() {
    let raw = Box::into_raw(Box::new(EventLoop::default()));
    unsafe {
        EventLoop::run_callback_raw(raw, js_reenters_event_loop);
        drop(Box::from_raw(raw));
    }
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("good") => good_path(),
        _ => bad_path(),
    }
}
