use core::cell::Cell;
use core::ptr::NonNull;

#[repr(C)]
struct StoreSlice<T> {
    ptr: NonNull<T>,
    len: u32,
}

impl<T> Copy for StoreSlice<T> {}
impl<T> Clone for StoreSlice<T> {
    fn clone(&self) -> Self {
        *self
    }
}

unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}

impl<T> StoreSlice<T> {
    fn new(s: &[T]) -> Self {
        match NonNull::new(s.as_ptr().cast_mut()) {
            Some(ptr) => StoreSlice {
                ptr,
                len: s.len() as u32,
            },
            None => StoreSlice {
                ptr: NonNull::dangling(),
                len: 0,
            },
        }
    }

    fn slice<'a>(self) -> &'a [T] {
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
}

fn main() {
    let cell = Cell::new(0_u32);
    let backing = [cell];
    let a = StoreSlice::new(&backing);
    let b = a;

    std::thread::scope(|scope| {
        scope.spawn(move || {
            for i in 0..100 {
                a.slice()[0].set(i);
            }
        });
        scope.spawn(move || {
            for i in 100..200 {
                b.slice()[0].set(i);
            }
        });
    });
}
