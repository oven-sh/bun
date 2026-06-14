use std::cell::Cell;
use std::ptr::{addr_of, addr_of_mut};

struct Wrapper {
    ctx: *mut ProxyTunnel,
    write: fn(*mut ProxyTunnel, &[u8]),
    on_close: fn(*mut ProxyTunnel),
}

impl Wrapper {
    fn write_data(&mut self, data: &[u8]) {
        // Mirrors SSLWrapper::write_data -> handle_traffic -> handle_writing,
        // which synchronously invokes handlers.write(ctx, encrypted_bytes).
        (self.write)(self.ctx, data);
        // And the same method can also close on error / shutdown paths.
        (self.on_close)(self.ctx);
    }
}

struct ProxyTunnel {
    wrapper: Option<Wrapper>,
    write_buffer: Vec<u8>,
    ref_count: Cell<u32>,
    socket: u32,
}

impl ProxyTunnel {
    fn wrapper_mut<'a>(this: *mut Self) -> Option<&'a mut Wrapper> {
        unsafe { (*addr_of_mut!((*this).wrapper)).as_mut() }
    }

    fn write_buffer_of<'a>(this: *mut Self) -> &'a mut Vec<u8> {
        unsafe { &mut *addr_of_mut!((*this).write_buffer) }
    }

    fn ref_count_of<'a>(this: *mut Self) -> &'a Cell<u32> {
        unsafe { &*addr_of!((*this).ref_count) }
    }

    fn socket_of<'a>(this: *mut Self) -> &'a mut u32 {
        unsafe { &mut *addr_of_mut!((*this).socket) }
    }

    fn write_raw(this: *mut Self, data: &[u8]) {
        if let Some(wrapper) = Self::wrapper_mut(this) {
            wrapper.write_data(data);
        }
    }

    fn write(&mut self, data: &[u8]) {
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.write_data(data);
        }
    }

    fn on_write(this: *mut Self, data: &[u8]) {
        // Mirrors ProxyTunnel::write_encrypted: no whole-struct &mut, only
        // disjoint-field raw projections. Valid on the raw-owner path, but not
        // while write(&mut self)'s whole-struct receiver tag is protected.
        Self::write_buffer_of(this).extend_from_slice(data);
        *Self::socket_of(this) = 11;
    }

    fn on_close(this: *mut Self) {
        Self::ref_count_of(this).set(Self::ref_count_of(this).get() + 1);
    }
}

fn main() {
    let mut tunnel = Box::new(ProxyTunnel {
        wrapper: None,
        write_buffer: Vec::new(),
        ref_count: Cell::new(1),
        socket: 0,
    });
    let raw = &mut *tunnel as *mut ProxyTunnel;
    unsafe {
        (*raw).wrapper = Some(Wrapper {
            ctx: raw,
            write: ProxyTunnel::on_write,
            on_close: ProxyTunnel::on_close,
        });
    }

    if std::env::args().any(|arg| arg == "--good") {
        ProxyTunnel::write_raw(raw, b"hello");
    } else {
        tunnel.write(b"hello");
    }
}
