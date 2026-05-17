#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HandleKind {
    Impl,
}

#[derive(Copy, Clone)]
pub struct Handle {
    pub kind: HandleKind,
    pub owner: *mut (),
}

impl Handle {
    pub unsafe fn new<T: ?Sized>(kind: HandleKind, owner: *mut T) -> Self {
        Self {
            kind,
            owner: owner.cast::<()>(),
        }
    }

    pub fn read_byte(&self) -> u8 {
        match self.kind {
            HandleKind::Impl => unsafe { read_byte_impl(self.owner) },
        }
    }
}

unsafe fn read_byte_impl(owner: *mut ()) -> u8 {
    unsafe { *(owner.cast::<u8>()) }
}

fn main() {
    // Safe code bypasses `unsafe fn new` because the handle fields are public.
    let forged = Handle {
        kind: HandleKind::Impl,
        owner: core::ptr::null_mut(),
    };
    std::hint::black_box(forged.read_byte());
}
