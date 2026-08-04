// Minimal port of https://github.com/nodejs/node/blob/main/lib/internal/async_hooks.js
// for --expose-internals consumers. Bun's createHook callbacks never fire; only
// enabledHooksExist() is accurate.
let activeHooks = 0;

// Mirrors `activeHooks` onto ZigGlobalObject so native `init` emitters
// (MessageChannel) gate on a single load when no hook is enabled.
const publishActiveHookCount = $cpp("MessagePort.cpp", "Bun::createAsyncHooksActiveCountBinding");

// Called from MessageChannel::create once per port while a hook is enabled.
// https://github.com/nodejs/node/blob/main/src/node_messaging.cc (MessagePort is an AsyncWrap).
// Merge note: PR #35383 replaces tickInitHooks; rewire the body onto its emitInit().
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
