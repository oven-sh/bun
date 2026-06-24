use core::mem::MaybeUninit;

#[repr(transparent)]
struct PathBuffer([u8; 4]);

#[repr(transparent)]
struct WPathBuffer([u16; 4]);

type DepthBuf = [u32; 4];

fn path_buffer_uninit() -> PathBuffer {
    // Mirrors src/bun_core/util.rs:997-1003.
    unsafe { MaybeUninit::uninit().assume_init() }
}

fn wpath_buffer_uninit() -> WPathBuffer {
    // Mirrors src/bun_core/util.rs:1045-1050.
    unsafe { MaybeUninit::uninit().assume_init() }
}

fn depth_buf_uninit() -> DepthBuf {
    // Mirrors src/install/lockfile/Tree.rs:87-91.
    unsafe { MaybeUninit::uninit().assume_init() }
}

fn main() {
    let path = path_buffer_uninit();
    let wide = wpath_buffer_uninit();
    let depth = depth_buf_uninit();

    // If Miri ever allowed construction but only rejected reads, these reads make
    // the invalid initialized-value assumption observable.
    std::hint::black_box(path.0[0]);
    std::hint::black_box(wide.0[0]);
    std::hint::black_box(depth[0]);
}
