// Minimal port of node's lib/internal/async_hooks.js surface for
// --expose-internals consumers (vendored node tests). Bun's createHook is a
// stub whose callbacks never fire; what CAN be tracked honestly is whether
// any hook is currently enabled, which is all enabledHooksExist() reports.
let activeHooks = 0;

// Native resource constructors that can emit `init` (currently MessageChannel,
// src/jsc/bindings/webcore/MessagePort.cpp) read this count off the global
// object, so with no hook enabled they pay a single load instead of reaching
// into JS. Publishing the same `activeHooks` value keeps one source of truth.
const publishActiveHookCount = $cpp("MessagePort.cpp", "Bun::createAsyncHooksActiveCountBinding");

// Called from MessageChannel::create (src/jsc/bindings/webcore/MessagePort.cpp)
// once per port, and only while the count published above is non-zero. node's
// MessagePort is an AsyncWrap, so both ends of a channel emit a MESSAGEPORT
// `init` with the port itself as the resource (src/node_messaging.cc). There is
// no JS construction site to hook: `new MessageChannel()` is entirely native.
//
// Merge note: PR #35383 replaces this module's hook bookkeeping (it deletes
// `internal/async_hooks_tick` and its `tickInitHooks` array). Only the body
// below needs rewiring onto that API — the native caller and the gate stay as
// they are:
//   if (!state.active) return;
//   emitInit(newAsyncId(), "MESSAGEPORT", getDefaultTriggerAsyncId(), port);
// and the count published above moves into that branch's `activate()` latch.
function emitMessagePortInit(port: object) {
  const { tickInitHooks, newAsyncId } = require("internal/async_hooks_tick");
  const count = tickInitHooks.length;
  if (count === 0) return;
  const asyncId = newAsyncId();
  // Snapshot: enable()/disable() from inside a hook must not affect the
  // in-flight dispatch (node stages such mutations in tmp_array).
  const snapshot = $newArrayWithSize<Function>(count);
  for (let i = 0; i < count; i++) snapshot[i] = tickInitHooks[i];
  for (let i = 0; i < count; i++) {
    try {
      snapshot[i](asyncId, "MESSAGEPORT", 0, port);
    } catch (err) {
      // node: a throwing init hook is fatal (fatalError: print + exit 1) and is
      // never surfaced to whoever constructed the resource. console is
      // user-mutable, so shield the print.
      try {
        console.error(typeof (err as Error)?.stack === "string" ? (err as Error).stack : err);
      } catch {}
      process.exit(1);
    }
  }
}

function enabledHooksExist() {
  return activeHooks > 0;
}

function markHookEnabled() {
  activeHooks += 1;
  publishActiveHookCount(activeHooks);
}

function markHookDisabled() {
  if (activeHooks > 0) activeHooks -= 1;
  publishActiveHookCount(activeHooks);
}

export default {
  enabledHooksExist,
  markHookEnabled,
  markHookDisabled,
  emitMessagePortInit,
};
