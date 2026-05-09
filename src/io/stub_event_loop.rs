bun_opaque::opaque_ffi! {
    pub struct Loop;
    pub struct KeepAlive;
    pub struct FilePoll;
}

// ported from: src/aio/stub_event_loop.zig
