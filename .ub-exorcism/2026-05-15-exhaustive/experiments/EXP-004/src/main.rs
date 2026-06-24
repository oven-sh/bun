// EXP-004: webcore/encoding.rs Vec<u8>->Vec<u16> allocator-layout mismatch on dealloc (UB-RT-001)
// Mirror of src/runtime/webcore/encoding.rs:303-310 in Bun.

fn main() {
    // Allocate as Vec<u8> with capacity 6 (align=1, size=6).
    let mut v8: Vec<u8> = Vec::with_capacity(6);
    // Manually push to make len match cap so we have a stable layout.
    for i in 0..6u8 {
        v8.push(i);
    }
    let cap = v8.capacity(); // = 6
    let ptr = v8.as_mut_ptr() as *mut u16;
    std::mem::forget(v8);

    // Reinterpret as Vec<u16>: same byte capacity but align changes from 1 to 2.
    let v16: Vec<u16> = unsafe { Vec::from_raw_parts(ptr, 0, cap / 2) };
    drop(v16); // UB: dealloc(size=6, align=2) on alloc made with align=1.
}
