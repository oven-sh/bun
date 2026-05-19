use std::cell::RefCell;

struct Writer(u64);

struct Source {
    writer: Writer,
}

thread_local! {
    static SOURCE: RefCell<Source> = RefCell::new(Source { writer: Writer(0) });
}

fn source_writer_escape(project: fn(&mut Source) -> &mut Writer) -> &'static mut Writer {
    let p: *mut Writer = SOURCE.with_borrow_mut(|s| std::ptr::from_mut(project(s)));
    unsafe { &mut *p }
}

fn writer() -> &'static mut Writer {
    source_writer_escape(|s| &mut s.writer)
}

fn main() {
    let a = writer();
    let b = writer();

    a.0 = 1;
    b.0 = 2;
    a.0 = a.0.wrapping_add(b.0);
}
