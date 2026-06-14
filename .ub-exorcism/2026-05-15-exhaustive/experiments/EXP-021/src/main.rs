use core::ptr::NonNull;

// Minimal mirror of src/ast/nodes.rs:322-397. The important current-source
// shape is: safe constructor from &[T], lifetime-free raw pointer storage, and
// safe reborrow with caller-chosen lifetime.
#[repr(C)]
#[derive(Copy, Clone)]
struct StoreSlice<T> {
    ptr: NonNull<T>,
    len: u32,
}

impl<T> StoreSlice<T> {
    fn new(s: &[T]) -> Self {
        StoreSlice {
            ptr: NonNull::new(s.as_ptr().cast_mut()).unwrap_or_else(NonNull::dangling),
            len: s.len() as u32,
        }
    }

    fn slice<'a>(self) -> &'a [T] {
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
}

fn make_dangling() -> StoreSlice<u8> {
    let v = vec![42_u8];
    StoreSlice::new(&v)
}

fn main() {
    let s = make_dangling();
    let leaked: &'static [u8] = s.slice();
    // Miri should report a read through a dangling pointer: the Vec allocation
    // was freed at the end of make_dangling().
    println!("{}", leaked[0]);
}

