#![allow(dead_code)]

// Mirrors src/runtime/bake/DevServer.rs:
// - try_define_deferred_request(&mut self) stores `dev: std::ptr::from_ref(self)`.
// - DeferredRequest::__free later does `(*self.dev.cast_mut()).deferred_request_pool.put(...)`.
//
// The key shape is a stored raw pointer derived from a shared reborrow of an
// `&mut DevServer`, then a later plain-field mutation through `.cast_mut()`.

struct DevServer {
    deferred_request_pool: usize,
}

struct DeferredRequest {
    dev: *const DevServer,
}

impl DevServer {
    fn define_deferred_request(&mut self) -> DeferredRequest {
        DeferredRequest {
            dev: core::ptr::from_ref(self),
        }
    }
}

impl DeferredRequest {
    fn free(&mut self) {
        unsafe {
            (*self.dev.cast_mut()).deferred_request_pool += 1;
        }
    }
}

fn main() {
    let mut dev = DevServer {
        deferred_request_pool: 0,
    };

    let mut deferred = dev.define_deferred_request();
    deferred.free();

    assert_eq!(dev.deferred_request_pool, 1);
}
