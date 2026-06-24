//! EXP-041 — Mirror of WebSocketServerContext::active_connections_saturating_{add,sub}
//!
//! Production shape (src/runtime/server/WebSocketServerContext.rs:79-96):
//!
//!     pub fn active_connections_saturating_add(&self, n: usize) {
//!         // TODO: convert to Cell<usize>
//!         let p = core::ptr::addr_of!(self.active_connections).cast_mut();
//!         unsafe { *p = (*p).saturating_add(n); }
//!     }
//!
//! The hypothesis is that `&self` + projection to `self.active_connections`
//! installs a SharedReadOnly tag on the field's child borrow tree (Tree
//! Borrows), and the subsequent write through the cast_mut'd raw pointer is
//! UB regardless of whether the JS heap is single-threaded.
//!
//! We also model the sibling cluster pattern
//!
//!     fn as_mut_ptr(&self) -> *mut Self { (self as *const Self).cast_mut() }
//!
//! by adding `Ctx::as_mut_ptr(&self)` and writing through it. The cast itself
//! is benign; the write is the UB.

struct Ctx {
    active_connections: usize,
    misc: u32,
}

impl Ctx {
    /// Direct mirror of `active_connections_saturating_add`.
    fn add(&self, n: usize) {
        let p = core::ptr::addr_of!(self.active_connections).cast_mut();
        unsafe {
            *p = (*p).saturating_add(n);
        }
    }

    /// Direct mirror of `active_connections_saturating_sub`.
    #[allow(dead_code)]
    fn sub(&self, n: usize) {
        let p = core::ptr::addr_of!(self.active_connections).cast_mut();
        unsafe {
            *p = (*p).saturating_sub(n);
        }
    }

    /// Mirror of the 10-site sibling cluster pattern
    /// `fn as_mut_ptr(&self) -> *mut Self { (self as *const Self).cast_mut() }`.
    #[allow(dead_code)]
    fn as_mut_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    /// Demonstrate the as_mut_ptr write site. Returns nothing — only the
    /// write through the SharedReadOnly-tagged raw pointer matters.
    #[allow(dead_code)]
    fn bump_misc_via_as_mut_ptr(&self) {
        let p = self.as_mut_ptr();
        unsafe {
            (*p).misc = (*p).misc.wrapping_add(1);
        }
    }
}

fn main() {
    let ctx = Ctx {
        active_connections: 0,
        misc: 0,
    };
    ctx.add(1);
    ctx.add(2);
    // Exercise the as_mut_ptr cluster shape too.
    ctx.bump_misc_via_as_mut_ptr();
    core::hint::black_box((ctx.active_connections, ctx.misc));
}
