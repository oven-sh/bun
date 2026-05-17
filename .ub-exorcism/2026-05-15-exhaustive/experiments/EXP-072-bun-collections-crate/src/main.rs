use core::num::NonZeroU32;

use bun_collections::hive_array::HiveArray;

struct NeedsDrop(NonZeroU32);

impl Drop for NeedsDrop {
    fn drop(&mut self) {
        std::hint::black_box(self.0.get());
    }
}

fn main() {
    let mut hive = HiveArray::<NeedsDrop, 1>::init();
    #[allow(deprecated)]
    let ptr = hive.get().expect("one free slot");

    unsafe {
        hive.put(ptr);
    }
}
