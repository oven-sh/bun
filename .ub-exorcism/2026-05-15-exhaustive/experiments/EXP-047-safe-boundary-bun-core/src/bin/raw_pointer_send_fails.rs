use std::cell::Cell;

fn main() {
    let rc: &'static bun_core::RacyCell<Cell<u32>> =
        Box::leak(Box::new(bun_core::RacyCell::new(Cell::new(0))));

    let raw = rc.get();

    // This is the point where a purely safe exploit attempt runs out of road:
    // raw pointers are not Send, and safe Rust cannot turn raw into &Cell<u32>.
    std::thread::spawn(move || {
        let _raw = raw;
    })
    .join()
    .unwrap();
}
