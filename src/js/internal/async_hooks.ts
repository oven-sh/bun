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
};
