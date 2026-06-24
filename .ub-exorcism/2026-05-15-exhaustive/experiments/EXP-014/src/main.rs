#![deny(unsafe_op_in_unsafe_fn)]

use core::ptr::NonNull;

/// Minimal mirror of `multi_array_list::Slice<T>`'s relevant shape:
/// a Copy raw-pointer view whose `items_mut(&mut self)` materializes a mutable
/// slice to the pointed-at column.
#[derive(Copy, Clone)]
struct Slice {
    ptr: NonNull<u32>,
    len: usize,
}

impl Slice {
    fn items_mut(&mut self) -> &mut [u32] {
        unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len) }
    }
}

fn main() {
    let mut backing = [1u32, 2, 3, 4];
    let slice = Slice {
        ptr: NonNull::from(&mut backing[0]),
        len: backing.len(),
    };

    let mut a = slice;
    let mut b = slice;

    let left = a.items_mut();
    let right = b.items_mut();

    left[0] = 10;
    right[0] = 20;
    core::hint::black_box((left[0], right[0]));
}
