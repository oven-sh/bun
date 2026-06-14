#[derive(Default)]
struct PendingFrame {
    callback_live: bool,
}

#[derive(Default)]
struct Stream {
    data_frame_queue: Vec<PendingFrame>,
    reentered: bool,
}

struct Client {
    stream: *mut Stream,
}

impl Client {
    fn dispatch_write_callback(&self) {
        // Mirrors h2 host re-entry: JS callback can call writeStream, look the
        // same stream up from client.streams, and reach queue_frame again.
        let stream = unsafe { &mut *self.stream };
        stream.reentered = true;
        stream.data_frame_queue.push(PendingFrame {
            callback_live: false,
        });
    }
}

impl Stream {
    fn queue_frame_bad(&mut self, client: &Client) {
        let this: *mut Self = std::hint::black_box(std::ptr::from_mut(self));

        // Ensure the receiver borrow becomes Unique before the callback.
        unsafe {
            (*this).data_frame_queue.push(PendingFrame {
                callback_live: true,
            });
        }

        if unsafe { (*this).data_frame_queue.last() }
            .map(|frame| frame.callback_live)
            .unwrap_or(false)
        {
            std::hint::black_box(this);
            client.dispatch_write_callback();
            std::hint::black_box(this);
            unsafe {
                (*this).data_frame_queue.last_mut().unwrap().callback_live = false;
            }
        }
    }

    unsafe fn queue_frame_raw(this: *mut Self, client: &Client) {
        unsafe {
            (*this).data_frame_queue.push(PendingFrame {
                callback_live: true,
            });
        }

        if unsafe { (*this).data_frame_queue.last() }
            .map(|frame| frame.callback_live)
            .unwrap_or(false)
        {
            std::hint::black_box(this);
            client.dispatch_write_callback();
            std::hint::black_box(this);
            unsafe {
                (*this).data_frame_queue.last_mut().unwrap().callback_live = false;
            }
        }
    }
}

fn bad_path() {
    let raw = Box::into_raw(Box::new(Stream::default()));
    let client = Client { stream: raw };
    unsafe {
        (*raw).queue_frame_bad(&client);
        drop(Box::from_raw(raw));
    }
}

fn good_path() {
    let raw = Box::into_raw(Box::new(Stream::default()));
    let client = Client { stream: raw };
    unsafe {
        Stream::queue_frame_raw(raw, &client);
        drop(Box::from_raw(raw));
    }
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("good") => good_path(),
        _ => bad_path(),
    }
}
