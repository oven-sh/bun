// Minimal port of node's lib/internal/async_hooks.js surface for
// --expose-internals consumers (vendored node tests). Bun's createHook is a
// stub whose callbacks never fire; what CAN be tracked honestly is whether
// any hook is currently enabled, which is all enabledHooksExist() reports.
let activeHooks = 0;

function enabledHooksExist() {
  return activeHooks > 0;
}

function markHookEnabled() {
  activeHooks += 1;
}

function markHookDisabled() {
  if (activeHooks > 0) activeHooks -= 1;
}

// Node keeps owner_symbol here; net.ts writes it onto a server handle and
// cluster/child.ts reads it back off that same handle, so both must share one key.
const owner_symbol = Symbol("owner_symbol");

export default {
  enabledHooksExist,
  markHookEnabled,
  markHookDisabled,
  symbols: { owner_symbol },
};
