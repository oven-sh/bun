#[derive(Default)]
struct LinkerContextModel {
    counter: usize,
}

fn main() {
    let mut ctx = LinkerContextModel::default();
    let ptr = core::ptr::addr_of_mut!(ctx);

    // Mirrors two worker callbacks that each derive
    // `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };`
    // from the same raw parent pointer, then overlap.
    let a: &mut LinkerContextModel = unsafe { &mut *ptr };
    let b: &mut LinkerContextModel = unsafe { &mut *ptr };

    a.counter += 1;
    b.counter += 2;

    // Keep the value live so Miri cannot trivially erase the accesses.
    std::hint::black_box(ctx.counter);
}
