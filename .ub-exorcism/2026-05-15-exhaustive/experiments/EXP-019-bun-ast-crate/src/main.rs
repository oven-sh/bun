use core::cell::Cell;

fn main() {
    // Direct Bun-crate witness for EXP-019.
    //
    // `StoreSlice<T>` has unbounded `Send`/`Sync` impls in Bun's source. Safe
    // code can therefore copy a `StoreSlice<Cell<_>>` into two threads and
    // obtain shared `&[Cell<_>]` views that race on the same `Cell`.
    let backing = [Cell::new(0_u32)];
    let a = bun_ast::StoreSlice::new(&backing);
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
