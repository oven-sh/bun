use std::cell::Cell;

fn main() {
    // Direct Bun-crate witness for EXP-098.
    //
    // `AtomicCell<T>` is `Send + Sync` for all `T: Copy`, but `new()` and
    // `into_inner()` do not require `T: Atom`. A safe caller can therefore use
    // `AtomicCell<&Cell<_>>` as a Send wrapper and move a non-Sync shared
    // reference to another thread.
    let cell = Cell::new(0_u32);
    let wrapper = bun_core::AtomicCell::new(&cell);

    std::thread::scope(|scope| {
        scope.spawn(move || {
            let remote_ref = wrapper.into_inner();
            for _ in 0..1024 {
                remote_ref.set(remote_ref.get().wrapping_add(1));
            }
        });

        for _ in 0..1024 {
            cell.set(cell.get().wrapping_add(1));
        }
    });
}
