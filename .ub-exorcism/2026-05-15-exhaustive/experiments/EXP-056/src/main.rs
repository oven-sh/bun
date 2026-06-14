use std::cell::Cell;

struct NodeHTTPResponseShape {
    ref_count: Cell<u32>,
    payload: Vec<u8>,
}

impl NodeHTTPResponseShape {
    #[inline(always)]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref(self).cast_mut()
    }

    fn deinit(&self) {
        // Mirrors Bun's NodeHTTPResponse::deinit zero-ref path:
        // self: &Self -> as_ctx_ptr() -> heap::take/Box::from_raw -> drop.
        // The pointer is derived from shared/read-only provenance.
        unsafe {
            drop(Box::from_raw(self.as_ctx_ptr()));
        }
    }

    fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            self.deinit();
        }
    }
}

fn main() {
    let raw = Box::into_raw(Box::new(NodeHTTPResponseShape {
        ref_count: Cell::new(1),
        payload: vec![1, 2, 3, 4],
    }));

    // Source-faithful entry shape: Bun commonly recovers &NodeHTTPResponse from
    // a raw callback/JS payload pointer, then the zero deref path frees from
    // that shared receiver.
    let shared: &NodeHTTPResponseShape = unsafe { &*raw };
    shared.deref();
}
