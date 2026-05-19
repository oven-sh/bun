// EXP-040: `S3HttpSimpleTask::Drop` `assume_init_mut` trip-hazard.
//
// Mirrors `src/runtime/webcore/s3/simple_request.rs:476-495` (Drop) and 599-670 (new):
//
//   pub fn new(...) -> *mut Self {
//       let init = Self { http: MaybeUninit::uninit(), ... };
//       let ptr = bun_core::heap::into_raw(Box::new(init));
//       // ... init steps and argument evaluation that may panic; e.g. line 655:
//       //     task.headers.entries.clone().expect("OOM")
//       // line 652 starts `http.write(AsyncHTTP::init(...))`, but the write
//       // side effect occurs only after `AsyncHTTP::init` returns.
//       unsafe { (*ptr).http.write(AsyncHTTP::new(...)) };
//       ptr
//   }
//
//   impl Drop for S3HttpSimpleTask {
//       fn drop(&mut self) {
//           unsafe { self.http.assume_init_mut() }.clear_data(); // UNCONDITIONAL
//       }
//   }
//
// Today's saving grace is that `Box::into_raw` is called before the panic-prone
// init, so unwind can't reach Drop → leak, not UB.
//
// The trip-hazard fires the moment any reclaim path lands. We model the natural
// post-refactor state where a scopeguard reclaims the half-init task on unwind
// (legitimate future fix for the leak) and we witness Drop reading an uninit
// `AsyncHTTP` — `assume_init_mut().clear_data()` on never-written memory.

use core::mem::MaybeUninit;

struct AsyncHttp {
    body: Vec<u8>,
}

impl AsyncHttp {
    fn new() -> Self {
        Self { body: vec![1, 2, 3, 4] }
    }
    fn clear_data(&mut self) {
        // Mirrors AsyncHTTP::clear_data — touches self fields.
        self.body.clear();
        eprintln!("clear_data ran, body len = {}", self.body.len());
    }
}

struct S3HttpSimpleTask {
    http: MaybeUninit<AsyncHttp>,
}

impl Drop for S3HttpSimpleTask {
    fn drop(&mut self) {
        // Mirror of the real Drop: UNCONDITIONAL assume_init_mut() + clear_data().
        unsafe { self.http.assume_init_mut() }.clear_data();
        eprintln!("Drop ran");
    }
}

/// Future-state scopeguard: on unwind, reclaim the half-init task via
/// `Box::from_raw`, which runs `Drop for S3HttpSimpleTask`. (Today's code
/// does NOT do this — it just leaks. The whole point of this experiment is
/// to characterise the trip-hazard for the leak fix.)
struct ReclaimOnUnwind {
    task: *mut S3HttpSimpleTask,
}

impl Drop for ReclaimOnUnwind {
    fn drop(&mut self) {
        if std::thread::panicking() && !self.task.is_null() {
            eprintln!("scopeguard: reclaiming half-init task");
            unsafe { drop(Box::from_raw(self.task)) };
        }
    }
}

fn s3_new(panic_before_write: bool) -> *mut S3HttpSimpleTask {
    let init = S3HttpSimpleTask { http: MaybeUninit::uninit() };
    let ptr = Box::into_raw(Box::new(init));

    // Post-refactor reclaim scopeguard.
    let guard = ReclaimOnUnwind { task: ptr };

    if panic_before_write {
        // Simulate panic at line 655 (headers.entries.clone().expect("OOM"))
        // before the `MaybeUninit::write` side effect of the line-652 call.
        panic!("simulated OOM at headers.entries.clone()");
    }

    // Effect of the line-652 call after argument evaluation: write the http field.
    unsafe { (*ptr).http.write(AsyncHttp::new()) };

    // Disarm: full init succeeded; caller is now responsible for the task.
    core::mem::forget(guard);
    ptr
}

fn main() {
    let result = std::panic::catch_unwind(|| s3_new(true));
    assert!(result.is_err());
    eprintln!("caught panic; if Drop ran, assume_init_mut() touched uninit memory.");
}
