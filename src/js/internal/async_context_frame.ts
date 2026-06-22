// Minimal port of node's lib/internal/async_context_frame.js surface for
// --expose-internals consumers (vendored node tests).
//
// Bun tracks async context natively in the engine (AsyncLocalStorage rides
// JSC's async context), so context propagation is always enabled. Frame
// objects, however, are never materialized — current() has nothing to
// expose and returns undefined. This diverges from node, where enabled
// implies current() is non-null inside a frame; tests relying on that
// coupling (rather than on enabled/falsiness checks) will not pass.
const AsyncContextFrame = {
  enabled: true,
  current() {
    return undefined;
  },
};

export default AsyncContextFrame;
