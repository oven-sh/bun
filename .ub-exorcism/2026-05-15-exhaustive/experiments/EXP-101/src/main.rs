use std::cell::Cell;
use std::ptr::{addr_of, addr_of_mut};

struct Wrapper {
    ctx: *mut ProxyTunnel,
    on_close: fn(*mut ProxyTunnel),
}

impl Wrapper {
    fn shutdown(&mut self) {
        (self.on_close)(self.ctx);
    }
}

struct ProxyTunnel {
    wrapper: Option<Wrapper>,
    ref_count: Cell<u32>,
    socket: u32,
}

impl ProxyTunnel {
    fn wrapper_mut<'a>(this: *mut Self) -> Option<&'a mut Wrapper> {
        unsafe { (*addr_of_mut!((*this).wrapper)).as_mut() }
    }

    fn ref_count_of<'a>(this: *mut Self) -> &'a Cell<u32> {
        unsafe { &*addr_of!((*this).ref_count) }
    }

    fn socket_of<'a>(this: *mut Self) -> &'a mut u32 {
        unsafe { &mut *addr_of_mut!((*this).socket) }
    }

    fn close_raw(this: *mut Self) {
        if let Some(wrapper) = Self::wrapper_mut(this) {
            wrapper.shutdown();
        }
    }

    fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.shutdown();
        }
    }

    fn on_close(this: *mut Self) {
        // Mirrors ProxyTunnel callbacks: no whole-struct `&mut ProxyTunnel`,
        // only disjoint-field raw projections. This is sound under `close_raw`,
        // but conflicts with `shutdown(&mut self)`'s protected receiver tag.
        Self::ref_count_of(this).set(Self::ref_count_of(this).get() + 1);
        *Self::socket_of(this) = 7;
    }
}

fn main() {
    let mut tunnel = Box::new(ProxyTunnel {
        wrapper: None,
        ref_count: Cell::new(1),
        socket: 0,
    });
    let raw = &mut *tunnel as *mut ProxyTunnel;
    unsafe {
        (*raw).wrapper = Some(Wrapper {
            ctx: raw,
            on_close: ProxyTunnel::on_close,
        });
    }

    if std::env::args().any(|arg| arg == "--good") {
        ProxyTunnel::close_raw(raw);
    } else {
        tunnel.shutdown();
    }
}
