use std::hint::black_box;
use std::ptr;

struct Parent {
    writer: *mut Writer,
}

struct Writer {
    is_done: bool,
    parent: *mut Parent,
}

impl Parent {
    unsafe fn on_write_reenter(this: *mut Parent) {
        // Mirrors FileSink::on_write calling `writer.with_mut(|w| w.end()/close())`:
        // the parent has a canonical pointer to its intrusive writer and mints a
        // fresh `&mut Writer` during the writer's on_write_complete call.
        let writer: &mut Writer = unsafe { &mut *(*this).writer };
        writer.is_done = true;
    }
}

impl Writer {
    fn on_write_complete_bad(&mut self) {
        // Mirrors PipeWriter's R-2 pattern:
        //   let this = black_box(ptr::from_mut(self));
        //   Parent::on_write(Self::r(this).parent(), ...)
        //   black_box(this);
        //   Self::r(this).close()/process_send()/...
        let this: *mut Self = black_box(ptr::from_mut(self));
        let parent = unsafe { (*this).parent };
        unsafe { Parent::on_write_reenter(parent) };
        black_box(this);
        unsafe {
            (*this).is_done = false;
        }
    }

    fn on_write_complete_good(this: *mut Self) {
        // Raw-owner control: no `&mut self` call-frame receiver exists while the
        // parent callback mints a fresh `&mut Writer`.
        let this = black_box(this);
        let parent = unsafe { (*this).parent };
        unsafe { Parent::on_write_reenter(parent) };
        black_box(this);
        unsafe {
            (*this).is_done = false;
        }
    }
}

fn setup() -> *mut Writer {
    let writer = Box::into_raw(Box::new(Writer {
        is_done: false,
        parent: core::ptr::null_mut(),
    }));
    let parent = Box::into_raw(Box::new(Parent { writer }));
    unsafe {
        (*writer).parent = parent;
    }
    writer
}

fn bad() {
    let writer = setup();
    unsafe { (&mut *writer).on_write_complete_bad() };
}

fn good() {
    let writer = setup();
    Writer::on_write_complete_good(writer);
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("bad") => bad(),
        Some("good") => good(),
        other => panic!("usage: bad|good, got {other:?}"),
    }
}
