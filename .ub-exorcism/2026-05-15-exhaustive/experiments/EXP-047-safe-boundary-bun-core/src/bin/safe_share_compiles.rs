use std::cell::Cell;

fn main() {
    let rc: &'static bun_core::RacyCell<Cell<u32>> =
        Box::leak(Box::new(bun_core::RacyCell::new(Cell::new(0))));

    // Because RacyCell has an unconditional Sync impl, safe code may share the
    // wrapper and call get(). That only produces an inert raw pointer; safe code
    // still cannot read or write the Cell through it.
    std::thread::spawn(move || {
        let _raw = rc.get();
    })
    .join()
    .unwrap();

    let tc: &'static bun_core::ThreadCell<Cell<u32>> =
        Box::leak(Box::new(bun_core::ThreadCell::new(Cell::new(0))));

    std::thread::spawn(move || {
        let _raw = tc.get_unchecked();
    })
    .join()
    .unwrap();
}
