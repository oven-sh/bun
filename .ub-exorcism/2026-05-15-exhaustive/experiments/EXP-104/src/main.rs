use std::env;
use std::ptr::NonNull;

struct Wrapper {
    ctx: *mut WindowsNamedPipe,
    write: fn(*mut WindowsNamedPipe, &[u8]),
    close: fn(*mut WindowsNamedPipe),
}

impl Wrapper {
    fn flush(&mut self) {
        (self.write)(self.ctx, b"tls-record");
    }

    fn receive_data(&mut self, data: &[u8]) {
        if data == b"close" {
            (self.close)(self.ctx);
        } else {
            (self.write)(self.ctx, data);
        }
    }
}

struct WindowsNamedPipe {
    wrapper: Option<Wrapper>,
    wrapper_busy: bool,
    closed: bool,
    writer: Vec<u8>,
}

impl WindowsNamedPipe {
    fn init() -> NonNull<Self> {
        let raw = Box::into_raw(Box::new(Self {
            wrapper: None,
            wrapper_busy: false,
            closed: false,
            writer: Vec::new(),
        }));
        unsafe {
            (*raw).wrapper = Some(Wrapper {
                ctx: raw,
                write: Self::ssl_write,
                close: Self::ssl_on_close,
            });
            NonNull::new_unchecked(raw)
        }
    }

    fn wrapper_ptr(&mut self) -> Option<*mut Wrapper> {
        self.wrapper.as_mut().map(core::ptr::from_mut)
    }

    fn ssl_write(this: *mut Self, data: &[u8]) {
        // Mirrors WindowsNamedPipe::ssl_write -> internal_write: the callback
        // materializes a whole-struct &mut Self while the caller is inside an
        // SSLWrapper-driving &mut self method.
        let this = unsafe { &mut *this };
        this.writer.extend_from_slice(data);
    }

    fn ssl_on_close(this: *mut Self) {
        // Mirrors ssl_on_close -> on_close -> release_resources. WRAPPER_BUSY
        // defers dropping wrapper, but still writes disjoint fields through a
        // whole-struct &mut Self.
        let this = unsafe { &mut *this };
        this.closed = true;
        if !this.wrapper_busy {
            this.wrapper = None;
        }
    }

    fn flush_bad(&mut self) {
        // Mirrors #[uws_callback] pub fn flush(&mut self): the generated thunk
        // has already materialized a protected &mut Self receiver. Capturing a
        // raw pointer to self.wrapper does not end that receiver protector.
        if let Some(w) = self.wrapper_ptr() {
            let was_busy = self.wrapper_busy;
            self.wrapper_busy = true;
            unsafe { (*w).flush() };
            if !was_busy {
                self.wrapper_busy = false;
                if self.closed {
                    self.wrapper = None;
                }
            }
        }
    }

    fn receive_bad(&mut self, data: &[u8]) {
        // Mirrors on_read/on_internal_receive_data after the input buffer has
        // been detached: the data slice is independent, but the receiver is
        // still &mut Self.
        if let Some(w) = self.wrapper_ptr() {
            let was_busy = self.wrapper_busy;
            self.wrapper_busy = true;
            unsafe { (*w).receive_data(data) };
            if !was_busy {
                self.wrapper_busy = false;
                if self.closed {
                    self.wrapper = None;
                }
            }
        }
    }

    unsafe fn flush_good(this: NonNull<Self>) {
        // Raw-owner control: no protected whole-struct receiver is created
        // before entering the callback-capable wrapper operation.
        let this = this.as_ptr();
        let wrapper = core::ptr::addr_of_mut!((*this).wrapper);
        if let Some(w) = (*wrapper).as_mut() {
            let was_busy = (*this).wrapper_busy;
            (*this).wrapper_busy = true;
            w.flush();
            if !was_busy {
                (*this).wrapper_busy = false;
                if (*this).closed {
                    (*this).wrapper = None;
                }
            }
        }
    }

    unsafe fn receive_good(this: NonNull<Self>, data: &[u8]) {
        let this = this.as_ptr();
        let wrapper = core::ptr::addr_of_mut!((*this).wrapper);
        if let Some(w) = (*wrapper).as_mut() {
            let was_busy = (*this).wrapper_busy;
            (*this).wrapper_busy = true;
            w.receive_data(data);
            if !was_busy {
                (*this).wrapper_busy = false;
                if (*this).closed {
                    (*this).wrapper = None;
                }
            }
        }
    }
}

fn main() {
    let mode = env::args().nth(1).unwrap_or_else(|| "flush-bad".to_string());
    let pipe = WindowsNamedPipe::init();
    unsafe {
        match mode.as_str() {
            "flush-bad" => (*pipe.as_ptr()).flush_bad(),
            "receive-bad" => (*pipe.as_ptr()).receive_bad(b"close"),
            "flush-good" => WindowsNamedPipe::flush_good(pipe),
            "receive-good" => WindowsNamedPipe::receive_good(pipe, b"close"),
            other => panic!("unknown mode: {other}"),
        }
        drop(Box::from_raw(pipe.as_ptr()));
    }
}
