// Bridge between createHook() and process.nextTick: enabled `init` hooks live in `tickInitHooks` so the
// hot path pays only an array-length check. Array identity is stable (push/splice only) — nextTick captures it once.
// Only TickObject and WORKER `init` events are delivered; other resource types are unimplemented.
const tickInitHooks = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
};
