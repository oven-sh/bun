// Minimal port of node's lib/internal/async_hooks.js surface for
// --expose-internals consumers (vendored node tests). Bun's createHook is
// partially implemented (full init/before/after/destroy for timers, init for
// TickObject); what is tracked here is only whether any hook is currently
// enabled, which is all enabledHooksExist() reports.
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

export default {
  enabledHooksExist,
  markHookEnabled,
  markHookDisabled,
};
