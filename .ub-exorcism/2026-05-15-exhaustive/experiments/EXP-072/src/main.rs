use std::mem::MaybeUninit;
use std::num::NonZeroU32;

struct NeedsDrop(NonZeroU32);

impl Drop for NeedsDrop {
    fn drop(&mut self) {
        let _ = self.0.get();
    }
}

struct MiniHive<T, const CAP: usize> {
    buffer: [MaybeUninit<T>; CAP],
    used: [bool; CAP],
}

impl<T, const CAP: usize> MiniHive<T, CAP> {
    fn new() -> Self {
        Self {
            buffer: [const { MaybeUninit::uninit() }; CAP],
            used: [false; CAP],
        }
    }

    fn get(&mut self) -> Option<*mut T> {
        for index in 0..CAP {
            if !self.used[index] {
                self.used[index] = true;
                return Some(self.buffer[index].as_mut_ptr());
            }
        }
        None
    }

    unsafe fn put(&mut self, value: *mut T) -> bool {
        let start = self.buffer.as_ptr().cast::<T>() as usize;
        let index = (value as usize - start) / size_of::<T>();
        assert!(index < CAP);
        assert!(self.used[index]);

        // Mirrors Bun's HiveArray::put: caller promises `value` is a fully
        // initialized T in a claimed slot. Here the legacy get() API let us
        // violate that contract by returning before ptr::write.
        unsafe { value.drop_in_place() };
        self.used[index] = false;
        true
    }
}

fn claim_then_fail_to_initialize(hive: &mut MiniHive<NeedsDrop, 1>) -> *mut NeedsDrop {
    let slot = hive.get().expect("one inline slot");
    // The legacy API exposes a claimed-but-uninitialized *mut T. Any fallible
    // work here can return before ptr::write, leaving the slot marked used.
    slot
}

fn main() {
    let mut hive = MiniHive::<NeedsDrop, 1>::new();
    let slot = claim_then_fail_to_initialize(&mut hive);

    // Later cleanup sees a used slot and drops it as initialized T.
    unsafe {
        hive.put(slot);
    }
}

