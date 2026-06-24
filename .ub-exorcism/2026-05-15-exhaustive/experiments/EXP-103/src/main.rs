use std::ptr::NonNull;

struct Tunnel {
    wrapper: Option<Wrapper>,
    write_buffer: Vec<u8>,
    ref_count: usize,
    closed: bool,
}

struct Wrapper {
    ctx: NonNull<Tunnel>,
}

struct RefScope {
    tunnel: NonNull<Tunnel>,
}

impl RefScope {
    fn new(tunnel: NonNull<Tunnel>) -> Self {
        unsafe {
            let count = Tunnel::ref_count_of(tunnel);
            *count = count.wrapping_add(1);
        }
        Self { tunnel }
    }
}

impl Drop for RefScope {
    fn drop(&mut self) {
        unsafe {
            let count = Tunnel::ref_count_of(self.tunnel);
            *count = count.wrapping_sub(1);
        }
    }
}

impl Wrapper {
    fn flush(&mut self) {
        write_encrypted(self.ctx, b"flushed");
        close_callback(self.ctx);
    }

    fn receive_data(&mut self, data: &[u8]) {
        write_encrypted(self.ctx, data);
        close_callback(self.ctx);
    }
}

impl Tunnel {
    fn new_raw() -> NonNull<Self> {
        let tunnel = Box::new(Self {
            wrapper: None,
            write_buffer: Vec::new(),
            ref_count: 1,
            closed: false,
        });
        let ctx = NonNull::new(Box::into_raw(tunnel)).unwrap();
        unsafe {
            (*ctx.as_ptr()).wrapper = Some(Wrapper { ctx });
        }
        ctx
    }

    fn on_writable(&mut self) {
        // Mirrors ProxyTunnel.rs:714-749: capture raw owner first, then perform
        // subsequent field accesses through raw projections before calling
        // wrapper.flush(), whose callbacks touch disjoint fields.
        let self_nn = NonNull::from(&mut *self);
        let _guard = RefScope::new(self_nn);
        {
            let write_buffer = unsafe { Self::write_buffer_of(self_nn) };
            write_buffer.extend_from_slice(b"socket-drain");
        }
        if let Some(wrapper) = unsafe { Self::wrapper_mut(self_nn) } {
            wrapper.flush();
        }
    }

    fn receive(&mut self, buf: &[u8]) {
        // Mirrors ProxyTunnel.rs:752-763: capture raw owner first, then call
        // SSLWrapper::receive_data through a wrapper-field projection.
        let self_nn = NonNull::from(&mut *self);
        let _guard = RefScope::new(self_nn);
        if let Some(wrapper) = unsafe { Self::wrapper_mut(self_nn) } {
            wrapper.receive_data(buf);
        }
    }

    fn on_writable_raw(this: NonNull<Self>) {
        let _guard = RefScope::new(this);
        {
            let write_buffer = unsafe { Self::write_buffer_of(this) };
            write_buffer.extend_from_slice(b"socket-drain");
        }
        if let Some(wrapper) = unsafe { Self::wrapper_mut(this) } {
            wrapper.flush();
        }
    }

    fn receive_raw(this: NonNull<Self>, buf: &[u8]) {
        let _guard = RefScope::new(this);
        if let Some(wrapper) = unsafe { Self::wrapper_mut(this) } {
            wrapper.receive_data(buf);
        }
    }

    unsafe fn wrapper_mut(this: NonNull<Self>) -> Option<&'static mut Wrapper> {
        unsafe { (*this.as_ptr()).wrapper.as_mut() }
    }

    unsafe fn write_buffer_of(this: NonNull<Self>) -> &'static mut Vec<u8> {
        unsafe { &mut (*this.as_ptr()).write_buffer }
    }

    unsafe fn ref_count_of(this: NonNull<Self>) -> &'static mut usize {
        unsafe { &mut (*this.as_ptr()).ref_count }
    }

    unsafe fn closed_of(this: NonNull<Self>) -> &'static mut bool {
        unsafe { &mut (*this.as_ptr()).closed }
    }
}

fn write_encrypted(ctx: NonNull<Tunnel>, data: &[u8]) {
    unsafe { Tunnel::write_buffer_of(ctx).extend_from_slice(data) };
}

fn close_callback(ctx: NonNull<Tunnel>) {
    unsafe { *Tunnel::closed_of(ctx) = true };
}

fn main() {
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "on-writable-bad".to_string());
    let tunnel = Tunnel::new_raw();

    match mode.as_str() {
        "on-writable-bad" => unsafe { (&mut *tunnel.as_ptr()).on_writable() },
        "receive-bad" => unsafe { (&mut *tunnel.as_ptr()).receive(b"incoming") },
        "on-writable-good" => Tunnel::on_writable_raw(tunnel),
        "receive-good" => Tunnel::receive_raw(tunnel, b"incoming"),
        other => panic!("unknown mode: {other}"),
    }
}
