//! EXP-032: loom model of `WebWorker` `Cell<*mut WebWorker>` / `Cell<*mut VirtualMachine>`
//! fields touched cross-thread via `live_workers::HEAD`.
//!
//! Source under model: `src/jsc/web_worker.rs:127-128 (live_next/live_prev),
//! 145 (vm), 246-326 (register/unregister), 332-388 (terminate_all_and_wait)`.
//!
//! Hypothesis: `WebWorker` has `Cell<*mut WebWorker>` fields and is `!Sync`
//! by auto-trait. `terminate_all_and_wait` walks the intrusive list under
//! `live_workers::MUTEX` and forms `&WebWorker` via `ParentRef::from(nn)`
//! — i.e. forms a shared reference on a non-owner thread. The SAFETY claim:
//! `MUTEX` serialises every read/write of those Cells, so all accesses are
//! totally ordered.
//!
//! Model:
//!   - `WebWorker { live_next: UnsafeCell<*mut WebWorker>, vm: UnsafeCell<*mut VM>,
//!     requested_terminate: AtomicBool }`.
//!   - `HEAD: AtomicCell<*mut WebWorker>` modeled as AtomicUsize.
//!   - `MUTEX` modeled as `loom::sync::Mutex<()>`.
//!   - 2 spawn threads call `register(worker)` (lock, set live_next, store HEAD).
//!   - 1 terminate-all-sweep thread walks HEAD under MUTEX, reading live_next
//!     and writing requested_terminate.
//!
//! If MUTEX really serialises every Cell access (the claim), loom's
//! UnsafeCell permit tracking will not report a concurrent access. If the
//! claim is false — e.g. terminate_all_and_wait reads a Cell outside the
//! mutex, or a spawn thread writes outside the mutex — loom will catch it.

#![cfg(loom)]

use loom::cell::UnsafeCell;
use loom::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use loom::sync::{Arc, Mutex};
use loom::thread;

struct VirtualMachine {
    // Stand-in for *mut VM contents — irrelevant to the race shape, but we
    // give it a field so loom's permit tracking has something to ground on.
    cookie: AtomicUsize,
}

struct WebWorker {
    // Cell<*mut WebWorker> in production. Loom UnsafeCell to track accesses.
    live_next: UnsafeCell<*mut WebWorker>,
    live_prev: UnsafeCell<*mut WebWorker>,
    // Cell<*mut VirtualMachine> in production.
    vm: UnsafeCell<*mut VirtualMachine>,
    requested_terminate: AtomicBool,
}

unsafe impl Send for WebWorker {}
// Production `unsafe impl Sync for WebWorker {}` is exactly the contested
// claim. Mirror it here so the cross-thread accesses compile.
unsafe impl Sync for WebWorker {}

struct LiveWorkers {
    mutex: Mutex<()>,
    head: AtomicUsize, // *mut WebWorker cast to usize
}

impl LiveWorkers {
    fn new() -> Self {
        Self {
            mutex: Mutex::new(()),
            head: AtomicUsize::new(0),
        }
    }

    fn register(&self, worker: *mut WebWorker) {
        let _g = self.mutex.lock().unwrap();
        let head = self.head.load(Ordering::Relaxed) as *mut WebWorker;
        // SAFETY: MUTEX held; the worker is uniquely owned by the spawn caller
        // until it's published into HEAD.
        unsafe {
            (*worker).live_prev.with_mut(|p| *p = core::ptr::null_mut());
            (*worker).live_next.with_mut(|p| *p = head);
            if !head.is_null() {
                (*head).live_prev.with_mut(|p| *p = worker);
            }
        }
        self.head.store(worker as usize, Ordering::Relaxed);
    }

    fn unregister(&self, worker: *mut WebWorker) {
        let _g = self.mutex.lock().unwrap();
        unsafe {
            let prev = (*worker).live_prev.with(|p| *p);
            let next = (*worker).live_next.with(|p| *p);
            if !prev.is_null() {
                (*prev).live_next.with_mut(|p| *p = next);
            } else {
                self.head.store(next as usize, Ordering::Relaxed);
            }
            if !next.is_null() {
                (*next).live_prev.with_mut(|p| *p = prev);
            }
            (*worker).live_prev.with_mut(|p| *p = core::ptr::null_mut());
            (*worker).live_next.with_mut(|p| *p = core::ptr::null_mut());
        }
    }

    // Mirror of `terminate_all_and_wait` body's sweep. Walks the list under
    // MUTEX, reads live_next via `Cell::get`, writes requested_terminate.
    fn terminate_sweep(&self) {
        let _g = self.mutex.lock().unwrap();
        let mut it = self.head.load(Ordering::Relaxed) as *mut WebWorker;
        while !it.is_null() {
            // SAFETY: MUTEX held; node remains valid while registered.
            let next = unsafe { (*it).live_next.with(|p| *p) };
            // Read vm via Cell::get (mirrors `w.vm_ptr()` at web_worker.rs:360).
            let vm = unsafe { (*it).vm.with(|p| *p) };
            unsafe { (*it).requested_terminate.swap(true, Ordering::Release) };
            // Touch VM if non-null, simulating `notify_need_termination`.
            if !vm.is_null() {
                unsafe { (*vm).cookie.fetch_add(1, Ordering::Relaxed) };
            }
            it = next;
        }
    }
}

unsafe impl Sync for LiveWorkers {}
unsafe impl Send for LiveWorkers {}

// Test 1: 1 register thread + 1 sweep thread, single worker.
// The minimal scenario where the sweep forms &WebWorker on a non-owner thread
// while register is also touching the Cell fields.
#[test]
fn loom_register_and_sweep_one_worker() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let live = Arc::new(LiveWorkers::new());

        // The worker itself must outlive both threads.
        let worker_box: Box<WebWorker> = Box::new(WebWorker {
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
        });
        let worker_ptr: *mut WebWorker = Box::into_raw(worker_box);

        // Convert pointer to usize for Send.
        let worker_addr = worker_ptr as usize;

        let live1 = Arc::clone(&live);
        let t_reg = thread::spawn(move || {
            live1.register(worker_addr as *mut WebWorker);
        });

        let live2 = Arc::clone(&live);
        let t_sweep = thread::spawn(move || {
            live2.terminate_sweep();
        });

        t_reg.join().unwrap();
        t_sweep.join().unwrap();

        // Cleanup: ensure unregister so the box's Cells are cleared.
        live.unregister(worker_ptr);
        unsafe {
            drop(Box::from_raw(worker_ptr));
        }
    });
}

// Test 2: 2 register threads racing with 1 sweep. The intrusive list has 2
// nodes mid-flight; we want to verify the sweep never sees a half-linked node.
#[test]
fn loom_two_registers_one_sweep() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(2);
    builder.check(|| {
        let live = Arc::new(LiveWorkers::new());

        let w1: *mut WebWorker = Box::into_raw(Box::new(WebWorker {
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
        }));
        let w2: *mut WebWorker = Box::into_raw(Box::new(WebWorker {
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
        }));
        let a1 = w1 as usize;
        let a2 = w2 as usize;

        let live1 = Arc::clone(&live);
        let r1 = thread::spawn(move || {
            live1.register(a1 as *mut WebWorker);
        });

        let live2 = Arc::clone(&live);
        let r2 = thread::spawn(move || {
            live2.register(a2 as *mut WebWorker);
        });

        let live3 = Arc::clone(&live);
        let s = thread::spawn(move || {
            live3.terminate_sweep();
        });

        r1.join().unwrap();
        r2.join().unwrap();
        s.join().unwrap();

        // Cleanup: unregister whatever's still on the list and drop the boxes.
        live.unregister(w1);
        live.unregister(w2);
        unsafe {
            drop(Box::from_raw(w1));
            drop(Box::from_raw(w2));
        }
    });
}

// Sanity test (negative control): if the sweep doesn't hold the mutex while
// reading the Cells, loom SHOULD catch a race against a concurrent register.
// Marked `#[ignore]` so the default run is clean.
#[test]
#[ignore]
fn loom_sanity_unsynchronized_sweep_should_race() {
    fn unsync_sweep(live: &LiveWorkers) {
        // DELIBERATELY no lock.
        let mut it = live.head.load(Ordering::Acquire) as *mut WebWorker;
        while !it.is_null() {
            let next = unsafe { (*it).live_next.with(|p| *p) };
            unsafe { (*it).requested_terminate.swap(true, Ordering::Release) };
            it = next;
        }
    }

    loom::model(|| {
        let live = Arc::new(LiveWorkers::new());
        let w: *mut WebWorker = Box::into_raw(Box::new(WebWorker {
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
        }));
        let w_addr = w as usize;

        let live1 = Arc::clone(&live);
        let r = thread::spawn(move || {
            live1.register(w_addr as *mut WebWorker);
        });
        let live2 = Arc::clone(&live);
        let s = thread::spawn(move || {
            unsync_sweep(&live2);
        });
        r.join().unwrap();
        s.join().unwrap();

        live.unregister(w);
        unsafe { drop(Box::from_raw(w)) };
    });
}

// Test 3: sweep reads `vm` Cell while a worker thread is publishing it.
// This mirrors the part of the SAFETY claim that's NOT the mutex — `vm` is
// touched by the sweep under `vm_lock`, but the WORKER thread writes it
// under `vm_lock` too. We model just that pair.
#[test]
fn loom_vm_publish_under_vm_lock() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(2);
    builder.check(|| {
        let vm_lock = Arc::new(Mutex::new(()));
        let worker: Box<WebWorker> = Box::new(WebWorker {
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
        });
        let w_ptr: *mut WebWorker = Box::into_raw(worker);
        let w_addr = w_ptr as usize;

        let vm_box: Box<VirtualMachine> = Box::new(VirtualMachine { cookie: AtomicUsize::new(0) });
        let vm_ptr: *mut VirtualMachine = Box::into_raw(vm_box);
        let vm_addr = vm_ptr as usize;

        let l1 = Arc::clone(&vm_lock);
        let worker_thread = thread::spawn(move || {
            // Publish vm under vm_lock.
            let _g = l1.lock().unwrap();
            unsafe {
                (*(w_addr as *mut WebWorker)).vm.with_mut(|p| *p = vm_addr as *mut VirtualMachine);
            }
        });

        let l2 = Arc::clone(&vm_lock);
        let sweep_thread = thread::spawn(move || {
            // Read vm under vm_lock (mirrors w.vm_ptr() at web_worker.rs:360).
            let _g = l2.lock().unwrap();
            let vm = unsafe { (*(w_addr as *mut WebWorker)).vm.with(|p| *p) };
            if !vm.is_null() {
                unsafe { (*vm).cookie.fetch_add(1, Ordering::Relaxed) };
            }
        });

        worker_thread.join().unwrap();
        sweep_thread.join().unwrap();

        unsafe {
            drop(Box::from_raw(w_ptr));
            drop(Box::from_raw(vm_ptr));
        }
    });
}
