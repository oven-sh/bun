/// A value that does not alias any other thread ID.
/// See `Thread/Mutex/Recursive.zig` in the Zig standard library.
// TODO(port): `std.Thread.Id` is a platform-specific unsigned integer in Zig; Rust's
// `std::thread::ThreadId` is opaque and has no MAX. Phase B must pick/define a numeric
// `ThreadId` alias (likely in bun_threading) and expose `MAX` on it.
pub const INVALID: bun_threading::ThreadId = bun_threading::ThreadId::MAX;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/thread_id.zig (5 lines)
//   confidence: medium
//   todos:      1
//   notes:      needs a numeric ThreadId type with MAX; std::thread::ThreadId is opaque
// ──────────────────────────────────────────────────────────────────────────
