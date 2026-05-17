use std::hint::black_box;
use std::ptr;

#[derive(Default)]
struct Wrapper {
    flags: u8,
}

unsafe trait LaunderedSelf: Sized {
    fn r<'a>(this: *mut Self) -> &'a mut Self {
        assert!(!this.is_null());
        unsafe { &mut *this }
    }
}

unsafe impl LaunderedSelf for Wrapper {}

impl Wrapper {
    fn direct_bad(&mut self) {
        let this: *mut Self = black_box(ptr::from_mut(self));
        // Mirrors bun_ptr::LaunderedSelf::r(this) while the original &mut self
        // receiver remains live. There is no callback here; this tests the
        // primitive claim that black_box removes the receiver protector.
        <Self as LaunderedSelf>::r(this).flags = 1;
    }

    fn callback_bad(&mut self) {
        let this: *mut Self = black_box(ptr::from_mut(self));
        self.dispatch(|| unsafe {
            // Mirrors synchronous callback re-entry materializing a fresh &mut Self.
            (*this).flags = 2;
        });
        let _ = <Self as LaunderedSelf>::r(this).flags;
    }

    fn dispatch(&mut self, f: impl FnOnce()) {
        self.flags = 3;
        f();
    }
}

fn direct_bad() {
    let mut w = Wrapper::default();
    w.direct_bad();
}

fn callback_bad() {
    let mut w = Wrapper::default();
    w.callback_bad();
}

fn raw_good() {
    let mut w = Box::new(Wrapper::default());
    let this = std::ptr::NonNull::from(&mut *w);
    unsafe { this.as_ptr().as_mut().unwrap().flags = 4 };
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("direct-bad") => direct_bad(),
        Some("callback-bad") => callback_bad(),
        Some("raw-good") => raw_good(),
        other => panic!("usage: direct-bad|callback-bad|raw-good, got {other:?}"),
    }
}
