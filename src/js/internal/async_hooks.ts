// Minimal port of node's lib/internal/async_hooks.js surface for
// --expose-internals consumers (vendored node tests). Bun's createHook is a
// stub whose callbacks never fire; what CAN be tracked honestly is whether
// any hook is currently enabled, which is all enabledHooksExist() reports.
let activeHooks = 0;
// Mirrors node's async_hook_fields[kInit]: only hooks that supply an `init`
// callback and are currently enabled are counted.
let activeInitHooks = 0;

function enabledHooksExist() {
  return activeHooks > 0;
}

function initHooksExist() {
  return activeInitHooks > 0;
}

function markHookEnabled(hasInit: boolean) {
  activeHooks += 1;
  if (hasInit) activeInitHooks += 1;
}

function markHookDisabled(hasInit: boolean) {
  if (activeHooks > 0) activeHooks -= 1;
  if (hasInit && activeInitHooks > 0) activeInitHooks -= 1;
}

export default {
  enabledHooksExist,
  initHooksExist,
  markHookEnabled,
  markHookDisabled,
};
