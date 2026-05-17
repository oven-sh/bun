use std::cell::UnsafeCell;

#[derive(Default)]
struct InternalMsgHolderShape {
    seq: u32,
    messages: Vec<u32>,
}

struct RacyCellShape<T>(UnsafeCell<T>);
unsafe impl<T> Sync for RacyCellShape<T> {}

impl<T> RacyCellShape<T> {
    const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }

    fn get(&self) -> *mut T {
        self.0.get()
    }
}

static CHILD_SINGLETON: RacyCellShape<Option<InternalMsgHolderShape>> =
    RacyCellShape::new(None);

fn child_singleton<'a>() -> &'a mut InternalMsgHolderShape {
    unsafe {
        (*CHILD_SINGLETON.get()).get_or_insert_with(InternalMsgHolderShape::default)
    }
}

fn reenter_via_global_owner() {
    // Mirrors a JS callback re-entering through node_cluster_binding::child_singleton():
    // the fresh &mut is derived from a process-static raw owner while flush(&mut self)
    // is still on the stack.
    let holder = child_singleton();
    holder.seq = holder.seq.wrapping_add(10);
}

impl InternalMsgHolderShape {
    fn dispatch_unsafe(&mut self, message: u32) {
        self.seq = self.seq.wrapping_add(message);
        reenter_via_global_owner();
    }

    fn flush(&mut self) {
        let this: *mut Self = std::hint::black_box(std::ptr::from_mut(self));
        let messages = core::mem::take(unsafe { &mut (*this).messages });
        for message in messages {
            unsafe { &mut *this }.dispatch_unsafe(message);
        }
    }
}

fn main() {
    let holder = child_singleton();
    holder.seq = 0;
    holder.messages = vec![1, 2];
    holder.flush();
    std::hint::black_box(child_singleton().seq);
}
