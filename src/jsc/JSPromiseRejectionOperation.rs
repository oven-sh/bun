#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum JSPromiseRejectionOperation {
    Reject = 0,
    Handle = 1,
}

// ported from: src/jsc/JSPromiseRejectionOperation.zig
