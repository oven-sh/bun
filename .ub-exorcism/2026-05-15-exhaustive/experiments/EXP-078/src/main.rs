#![allow(dead_code)]

// Faithful model of src/bun_core/util.rs:111-119 and the Vec<T> impl at
// util.rs:294-301. The important property is that the trait method is safe and
// returns a typed &mut [T] immediately after Vec::set_len(n), before the caller
// has initialized the new elements.
trait ArrayLike {
    type Elem;

    fn ensure_unused_capacity(&mut self, additional: usize);
    fn append_assume_capacity(&mut self, elem: Self::Elem);
    fn set_len_and_slice(&mut self, n: usize) -> &mut [Self::Elem];
}

impl<T> ArrayLike for Vec<T> {
    type Elem = T;

    fn ensure_unused_capacity(&mut self, additional: usize) {
        self.reserve(additional);
    }

    fn append_assume_capacity(&mut self, elem: T) {
        self.push(elem);
    }

    fn set_len_and_slice(&mut self, n: usize) -> &mut [T] {
        assert!(self.capacity() >= n);
        unsafe { self.set_len(n) };
        self.as_mut_slice()
    }
}

fn main() {
    // `bool` has a small validity set, so reading the safe slice before the
    // intended memcpy phase gives Miri an unambiguous validity signal.
    let mut values: Vec<bool> = Vec::with_capacity(1);
    let live: &mut [bool] = values.set_len_and_slice(1);

    // This read is legal from the caller's point of view because the API is
    // safe and returns an ordinary &mut [bool]. It is UB because the bool was
    // never initialized.
    std::hint::black_box(live[0]);
}
