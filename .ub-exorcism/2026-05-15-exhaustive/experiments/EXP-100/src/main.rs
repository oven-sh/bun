struct Wrapper {
    ctx: *mut UpgradedDuplex,
    on_close: fn(*mut UpgradedDuplex),
}

impl Wrapper {
    fn shutdown(&mut self) {
        (self.on_close)(self.ctx);
    }
}

struct UpgradedDuplex {
    wrapper: Option<Wrapper>,
    closed: bool,
}

impl UpgradedDuplex {
    fn on_close(this: *mut Self) {
        // Mirrors UpgradedDuplex.rs:135-146:
        // SSLWrapper callback ctx is `self as *mut Self`; callback materializes
        // `&mut UpgradedDuplex`, then teardown writes `self.wrapper = None`.
        let this = unsafe { &mut *this };
        this.closed = true;
        this.wrapper = None;
    }

    fn close(&mut self) {
        // Mirrors UpgradedDuplex.rs:378-382:
        // `if let Some(wrapper) = &mut self.wrapper { wrapper.shutdown(true) }`.
        // The `&mut Wrapper` receiver remains live during `shutdown`, whose
        // callback re-enters through ctx and creates `&mut UpgradedDuplex`.
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.shutdown();
        }
    }
}

fn main() {
    // Allocate first and keep the owning pointer stable. Initialize `wrapper`
    // through the raw owner before making the `close(&mut self)` call, so the
    // Miri signal below is the callback reborrow itself, not an artifact of
    // deriving a raw pointer before writing the `wrapper` field.
    let raw = Box::into_raw(Box::new(UpgradedDuplex {
        wrapper: None,
        closed: false,
    }));
    unsafe {
        (*raw).wrapper = Some(Wrapper {
            ctx: raw,
            on_close: UpgradedDuplex::on_close,
        });
        (*raw).close();
        drop(Box::from_raw(raw));
    }
}
