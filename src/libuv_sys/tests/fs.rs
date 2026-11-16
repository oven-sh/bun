//! For Miri, which calls the functions of [`fake`] in place of libuv's.
#![cfg(all(windows, miri))]

use core::cell::RefCell;

use bun_core::{ZStr, zstr};
use bun_libuv_sys::fs::{self, Request};
use bun_libuv_sys::{Loop, ReturnCodeI64, StartResult, UV_EINVAL, uv_buf_t};

/// Works on another thread, which starts inside the call.
mod fake {
    use core::cell::{Cell, RefCell};
    use core::ffi::{c_char, c_int, c_uint, c_void};
    use core::mem::MaybeUninit;
    use std::sync::Mutex;
    use std::thread::JoinHandle;

    use bun_libuv_sys::{Loop, UV_EINVAL, fs_t, uv_buf_t, uv_file, uv_fs_cb, uv_statfs_t};

    thread_local! {
        static PENDING: RefCell<Vec<(JoinHandle<()>, *mut fs_t)>> = const { RefCell::new(Vec::new()) };
        pub(super) static REFUSE: Cell<bool> = const { Cell::new(false) };
        pub(super) static FAIL: Cell<bool> = const { Cell::new(false) };
    }
    pub(super) static WRITTEN: Mutex<Vec<u8>> = Mutex::new(Vec::new());

    struct AssertSend<T>(T);
    // SAFETY: test stub; `run` joins the thread before it calls back.
    unsafe impl<T> Send for AssertSend<T> {}

    /// Two fields of `fs_t`, of which `ptr` is private.
    #[repr(C)]
    struct Results {
        result: i64,
        ptr: *mut c_void,
    }

    fn results(req: *mut fs_t) -> *mut Results {
        req.wrapping_byte_add(core::mem::offset_of!(fs_t, result))
            .cast()
    }

    /// Leaves an allocation for `uv_fs_req_cleanup`, and a pointer into `req`, as libuv's `bufs` is.
    fn start(
        req: *mut fs_t,
        cb: uv_fs_cb,
        work: impl FnOnce(*mut uv_statfs_t) -> i64 + 'static,
    ) -> c_int {
        let owned = Box::into_raw(Box::<uv_statfs_t>::new_uninit()).cast::<uv_statfs_t>();
        // SAFETY: test stub; `fs` passes a live request.
        unsafe { ((*req).cb, (*req).data, (*results(req)).ptr) = (cb, req.cast(), owned.cast()) };
        if REFUSE.take() {
            return UV_EINVAL;
        }
        let (fails, job) = (FAIL.take(), AssertSend((req, owned, work)));
        let thread = std::thread::spawn(move || {
            let (req, owned, work) = { job }.0;
            let result = if fails { UV_EINVAL.into() } else { work(owned) };
            // SAFETY: test stub; `fs` passes a live request.
            unsafe { (*results(req)).result = result };
        });
        PENDING.with_borrow_mut(|pending| pending.push((thread, req)));
        0
    }

    /// Until no request is left.
    pub(super) fn run() {
        while let Some((thread, req)) = PENDING.with_borrow_mut(Vec::pop) {
            thread.join().unwrap();
            // SAFETY: test stub; `fs` passes a live request.
            unsafe { (*req).cb.unwrap()(req) };
        }
    }

    /// libuv refuses an empty array, and mishandles an offset below -1.
    fn copy_bufs(bufs: *const uv_buf_t, nbufs: c_uint, offset: i64) -> Vec<uv_buf_t> {
        assert!(nbufs > 0 && offset >= -1);
        // SAFETY: test stub; `fs` passes an array of `nbufs` elements.
        unsafe { core::slice::from_raw_parts(bufs, nbufs as usize) }.to_vec()
    }

    macro_rules! fakes {
        ($(fn $name:ident($($arg:tt: $type:ty),*) = $work:expr;)*) => {$(
            #[unsafe(no_mangle)]
            extern "C" fn $name(_: *const Loop, req: *mut fs_t, $($arg: $type,)* cb: uv_fs_cb) -> c_int {
                start(req, cb, $work(req))
            }
        )*};
    }
    // SAFETY: test stubs; `fs` passes a live request and live buffers.
    fakes! {
        fn uv_fs_open(_: *const c_char, _: c_int, _: c_int) = |_| |_| 7;
        fn uv_fs_close(_: uv_file) = |_| |_| 0;
        fn uv_fs_chmod(_: *const c_char, _: c_int) = |_| |_| 0;
        fn uv_fs_copyfile(_: *const c_char, _: *const c_char, _: c_int) = |_| |_| 0;
        fn uv_fs_fstat(_: uv_file) = |req: *mut fs_t| move |_| {
            unsafe { (*req).statbuf.st_size = 5 };
            0
        };
        fn uv_fs_statfs(_: *const c_char) = |_| |statfs: *mut uv_statfs_t| {
            // All but `f_spare`.
            unsafe { statfs.cast::<[u64; 7]>().write([512; 7]) };
            0
        };
        fn uv_fs_read(_: uv_file, bufs: *const uv_buf_t, nbufs: c_uint, offset: i64) = |_| {
            let bufs = copy_bufs(bufs, nbufs, offset);
            move |_| bufs.iter().fold(0, |total, buf| {
                unsafe { buf.base.write_bytes(b'x', buf.len as usize) };
                total + i64::from(buf.len)
            })
        };
        fn uv_fs_write(_: uv_file, bufs: *const uv_buf_t, nbufs: c_uint, offset: i64) = |_| {
            let bufs = copy_bufs(bufs, nbufs, offset);
            move |_| bufs.iter().fold(0, |total, buf| {
                let bytes = unsafe { core::slice::from_raw_parts(buf.base, buf.len as usize) };
                WRITTEN.lock().unwrap().extend_from_slice(bytes);
                total + i64::from(buf.len)
            })
        };
    }

    #[unsafe(no_mangle)]
    extern "C" fn uv_fs_req_cleanup(req: *mut fs_t) {
        // SAFETY: test stub; `fs` passes a live request.
        unsafe {
            assert_eq!((*req).data, req.cast(), "moved");
            drop(Box::from_raw(
                (*results(req)).ptr.cast::<MaybeUninit<uv_statfs_t>>(),
            ));
        }
    }

    #[unsafe(no_mangle)]
    extern "C" fn uv_loop_init(_: *mut Loop) -> c_int {
        0
    }

    #[unsafe(no_mangle)]
    extern "C" fn uv_loop_close(_: *mut Loop) -> c_int {
        0
    }
}

#[derive(Default)]
struct Owner {
    inline: [u8; 3],
    req: Request,
    buffer: Vec<u8>,
}
bun_core::intrusive_field!(Owner, req: Request);
bun_core::intrusive_field!(Owner, buffer: Vec<u8>);

thread_local! {
    static DONE: RefCell<Vec<(Box<Owner>, i64)>> = const { RefCell::new(Vec::new()) };
}

fn done(owner: Box<Owner>, result: i64) {
    DONE.with_borrow_mut(|done| done.push((owner, result)));
}

fn then(owner: Box<Owner>, result: ReturnCodeI64) {
    done(owner, result.int());
}

/// What `then` got. Miri reports what leaks.
fn run(test: impl FnOnce(&'static Loop)) -> Vec<(Box<Owner>, i64)> {
    test(Loop::get());
    assert!(DONE.with_borrow(Vec::is_empty));
    fake::run();
    // SAFETY: `test` has returned.
    unsafe { Loop::close_thread_loop() };
    DONE.take()
}

const PATH: &ZStr = zstr!("path");

const CALLS: [fn(Box<Owner>, &Loop) -> StartResult<Box<Owner>>; 10] = [
    |owner, loop_| fs::open(owner, loop_, PATH, 0, 0, then),
    |owner, loop_| fs::close(owner, loop_, 7, then),
    |owner, loop_| fs::chmod(owner, loop_, PATH, 0, then),
    |owner, loop_| fs::copyfile(owner, loop_, PATH, PATH, 0, then),
    |owner, loop_| {
        fs::fstat(owner, loop_, 7, |owner, result| {
            let size = owner.req.statbuf().st_size as i64;
            done(owner, if result.int() < 0 { result.int() } else { size });
        })
    },
    |owner, loop_| {
        fs::statfs(owner, loop_, PATH, |owner, statfs| {
            done(
                owner,
                statfs.map_or_else(|rc| rc.int().into(), |statfs| statfs.f_bsize as i64),
            );
        })
    },
    |owner, loop_| fs::read(owner, loop_, 7, 4, -2, then),
    |owner, loop_| fs::write(owner, loop_, 7, |_| b"", -2, then),
    // SAFETY: names no bytes.
    |owner, loop_| unsafe { fs::writev(owner, loop_, 7, &[uv_buf_t::init(b"")], -2, then) },
    // SAFETY: names no bytes.
    |owner, loop_| unsafe { fs::readv(owner, loop_, 7, &[uv_buf_t::init(b"")], -2, then) },
];

fn results_of_every_call(before_each: fn()) -> Vec<i64> {
    let mut done = run(|loop_| {
        for (index, call) in CALLS.iter().enumerate() {
            let mut owner = Box::<Owner>::default();
            owner.inline[0] = index as u8;
            before_each();
            assert!(call(owner, loop_).is_ok());
        }
    });
    done.sort_by_key(|(owner, _)| owner.inline[0]);
    done.into_iter().map(|(_, result)| result).collect()
}

#[test]
fn then_gets_the_box_and_the_result() {
    assert_eq!(
        results_of_every_call(|| {}),
        [7, 0, 0, 0, 5, 512, 0, 0, 0, 0]
    );
}

#[test]
fn then_gets_the_box_and_the_error() {
    let results = results_of_every_call(|| fake::FAIL.set(true));
    assert_eq!(results, [i64::from(UV_EINVAL); CALLS.len()]);
}

#[test]
fn refusal_returns_the_box() {
    let done = run(|loop_| {
        let mut owner = Box::<Owner>::default();
        for (index, call) in CALLS.iter().enumerate() {
            owner.buffer.push(b'a');
            fake::REFUSE.set(true);
            let Err((refused, rc)) = call(owner, loop_) else {
                panic!("call {index} was not refused");
            };
            assert_eq!((refused.buffer.len(), rc.int()), (index + 1, UV_EINVAL));
            owner = refused;
        }
    });
    assert!(done.is_empty());
}

#[test]
fn read_appends_within_the_capacity() {
    for (max_len, fails, expected) in [
        (3, false, &b"abxxx"[..]),
        (usize::MAX, false, b"abxxxxxx"),
        (3, true, b"ab"),
    ] {
        let done = run(|loop_| {
            let mut owner = Box::<Owner>::default();
            owner.buffer.reserve_exact(8);
            owner.buffer.extend_from_slice(b"ab");
            fake::FAIL.set(fails);
            assert!(fs::read(owner, loop_, 7, max_len, -1, then).is_ok());
        });
        assert_eq!(done[0].0.buffer, expected);
    }
}

#[test]
fn request_can_be_moved_and_used_again_in_then() {
    fn write_buffer(owner: Box<Owner>, _: ReturnCodeI64) {
        let moved = Box::new(*owner);
        let started = fs::write(moved, Loop::get(), 7, |this| &this.buffer, -1, write_slices);
        assert!(started.is_ok());
    }
    fn write_slices(owner: Box<Owner>, _: ReturnCodeI64) {
        let bufs = [uv_buf_t::init(b"f"), uv_buf_t::init(b"gh")];
        // SAFETY: the bytes are static.
        assert!(unsafe { fs::writev(owner, Loop::get(), 7, &bufs, -1, then) }.is_ok());
    }

    let done = run(|loop_| {
        let owner = Box::new(Owner {
            inline: *b"abc",
            req: Request::default(),
            buffer: b"de".to_vec(),
        });
        assert!(fs::write(owner, loop_, 7, |this| &this.inline, -1, write_buffer).is_ok());
    });
    assert_eq!(done[0].1, 3);
    assert_eq!(*fake::WRITTEN.lock().unwrap(), b"abcdefgh");
}
