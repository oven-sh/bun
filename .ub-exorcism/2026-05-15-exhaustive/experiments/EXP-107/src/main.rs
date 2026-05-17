use std::ffi::c_void;

#[derive(Clone, Copy)]
struct IsolationWatcher {
    ptr: *mut c_void,
    close: unsafe fn(*mut c_void),
}

#[derive(Default)]
struct RareData {
    fs_watchers_for_isolation: Vec<IsolationWatcher>,
}

impl RareData {
    fn add_fs_watcher_for_isolation(
        &mut self,
        watcher: *mut c_void,
        close: unsafe fn(*mut c_void),
    ) {
        self.fs_watchers_for_isolation.push(IsolationWatcher {
            ptr: watcher,
            close,
        });
    }

    fn close_all_watchers_for_isolation_bad(&mut self) {
        let this: *mut Self = std::hint::black_box(std::ptr::from_mut(self));
        loop {
            let Some(w) = (unsafe { &mut (*this).fs_watchers_for_isolation }).pop() else {
                break;
            };
            unsafe { (w.close)(w.ptr) };
            std::hint::black_box(this);
        }
    }

    unsafe fn close_all_watchers_for_isolation_raw(this: *mut Self) {
        loop {
            let Some(w) = (unsafe { &mut (*this).fs_watchers_for_isolation }).pop() else {
                break;
            };
            unsafe { (w.close)(w.ptr) };
            std::hint::black_box(this);
        }
    }
}

unsafe fn reenter_and_push(ctx: *mut c_void) {
    let rare = unsafe { &mut *(ctx.cast::<RareData>()) };
    rare.fs_watchers_for_isolation.push(IsolationWatcher {
        ptr: std::ptr::null_mut(),
        close: noop,
    });
}

unsafe fn noop(_: *mut c_void) {}

fn bad_path() {
    let raw = Box::into_raw(Box::new(RareData::default()));
    unsafe {
        (*raw).add_fs_watcher_for_isolation(raw.cast::<c_void>(), reenter_and_push);
        (*raw).close_all_watchers_for_isolation_bad();
        drop(Box::from_raw(raw));
    }
}

fn good_path() {
    let raw = Box::into_raw(Box::new(RareData::default()));
    unsafe {
        (*raw).add_fs_watcher_for_isolation(raw.cast::<c_void>(), reenter_and_push);
        RareData::close_all_watchers_for_isolation_raw(raw);
        drop(Box::from_raw(raw));
    }
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("good") => good_path(),
        _ => bad_path(),
    }
}
