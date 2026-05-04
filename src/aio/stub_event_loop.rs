#[repr(C)]
pub struct Loop {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

#[repr(C)]
pub struct KeepAlive {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

#[repr(C)]
pub struct FilePoll {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/aio/stub_event_loop.zig (3 lines)
//   confidence: high
//   todos:      0
//   notes:      opaque FFI handle stubs (Nomicon pattern); !Send + !Sync + !Unpin
// ──────────────────────────────────────────────────────────────────────────
