// Central async_hooks state: createHook() arrays + execution async ids, shared
// by nextTick, timers, AsyncResource, crypto.randomBytes. Array and `state`
// identities must stay stable (consumers capture once); no promise events yet.
const initHooks = [];
const beforeHooks = [];
const afterHooks = [];
const destroyHooks = [];

// Root frame: executionAsyncId 1, triggerAsyncId 0 (matches node).
// `tracking` flips (one-way) on first async_hooks API use; until then no ids
// are assigned so apps that never touch async_hooks pay only these checks.
const state = { exec: 1, trigger: 0, tracking: false };

let nextAsyncId = 1;
function newAsyncId() {
  return ++nextAsyncId;
}

const { reportUncaughtException } = require("internal/shared");
const setTimerHookDispatch = $newCppFunction("NodeAsyncHooks.cpp", "jsSetAsyncHooksTimerDispatch", 1);
// Intrinsics, immune to user patching of queueMicrotask/Promise.prototype.then.
const PromisePrototypeThen = $Promise.prototype.$then;
const resolvedPromise = Promise.$resolve();

// node: a throwing hook is a fatal error (print + exit(1)), never surfaced to
// the code that triggered the emit. console is a user-mutable global, so
// shield the print; exit regardless.
function fatalHookError(err) {
  try {
    console.error(typeof err?.stack === "string" ? err.stack : err);
  } catch {}
  process.exit(1);
}

// Snapshot before iterating: enable()/disable() from inside a hook must not
// affect the in-flight emit (node stages such mutations until it completes).
function emitInit(asyncId, type, triggerAsyncId, resource) {
  const hooks = initHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    try {
      hooks[i](asyncId, type, triggerAsyncId, resource);
    } catch (err) {
      fatalHookError(err);
    }
  }
}

function emitBefore(asyncId) {
  const hooks = beforeHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    try {
      hooks[i](asyncId);
    } catch (err) {
      fatalHookError(err);
    }
  }
}

function emitAfter(asyncId) {
  const hooks = afterHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    try {
      hooks[i](asyncId);
    } catch (err) {
      fatalHookError(err);
    }
  }
}

// Destroy events queue and drain on a microtask (node uses a native
// SetImmediate): async, before the next macrotask, no hook events for the
// drain itself. Ids appended by a destroy hook run in the same pass.
const destroyQueue: any[] = [];
let destroyScheduled = false;

function drainDestroyQueue() {
  for (let i = 0; i < destroyQueue.length; i++) {
    const entry = destroyQueue[i];
    let asyncId;
    if (typeof entry === "number") {
      asyncId = entry;
    } else {
      // Deferred timer decision: fires only once the timer reports itself
      // destroyed (completed or cleared), so refresh()/active intervals skip.
      if (entry.rec.destroyed || !entry.timer._destroyed) continue;
      entry.rec.destroyed = true;
      asyncId = entry.rec.asyncId;
    }
    if (destroyHooks.length === 0) continue;
    const hooks = destroyHooks.slice();
    for (let j = 0; j < hooks.length; j++) {
      try {
        hooks[j](asyncId);
      } catch (err) {
        fatalHookError(err);
      }
    }
  }
  destroyQueue.length = 0;
  destroyScheduled = false;
}

function queueDestroy(entry) {
  destroyQueue.push(entry);
  if (!destroyScheduled) {
    destroyScheduled = true;
    PromisePrototypeThen.$call(resolvedPromise, drainDestroyQueue);
  }
}

function enableTracking() {
  if (!state.tracking) {
    state.tracking = true;
    // Native timers start reporting schedule/fire/clear through
    // timerHookDispatch from this point on.
    setTimerHookDispatch(timerHookDispatch);
  }
}

// Native timer dispatch (NodeTimers.cpp schedule/clear, NodeTimerObject.cpp
// fire), called only while tracking is enabled. ops: 1 init Immediate,
// 2 init Timeout, 3 init interval, 4 before, 5 after, 6 cleared.
const timerRecords = new WeakMap();
// prevExec/prevTrigger pairs; a stack (not per-record slots) so nested fires
// (e.g. fake timers advancing inside a callback) stay balanced.
const timerIdStack = [];

function timerHookDispatch(op, timer) {
  // Nothing may escape to the C++ caller (it would skip the timer callback or
  // unbalance timerIdStack); bookkeeping failures are fatal like hook throws.
  try {
    dispatchTimerEvent(op, timer);
  } catch (err) {
    fatalHookError(err);
  }
}

function dispatchTimerEvent(op, timer) {
  switch (op) {
    case 1:
    case 2:
    case 3: {
      const asyncId = newAsyncId();
      // No interval flag needed: destroy is deferred until the timer reports
      // `_destroyed` (see drainDestroyQueue), which active intervals never do.
      const rec = { asyncId, triggerAsyncId: state.exec, destroyed: false };
      timerRecords.set(timer, rec);
      if (initHooks.length !== 0) {
        emitInit(asyncId, op === 1 ? "Immediate" : "Timeout", rec.triggerAsyncId, timer);
      }
      break;
    }
    case 4: {
      const rec = timerRecords.get(timer);
      if (rec === undefined) return;
      timerIdStack.push(state.exec, state.trigger);
      state.exec = rec.asyncId;
      state.trigger = rec.triggerAsyncId;
      if (beforeHooks.length !== 0) emitBefore(rec.asyncId);
      break;
    }
    case 5: {
      const rec = timerRecords.get(timer);
      if (rec === undefined) return;
      if (afterHooks.length !== 0) emitAfter(rec.asyncId);
      state.trigger = timerIdStack.pop();
      state.exec = timerIdStack.pop();
      if (destroyHooks.length !== 0 && !rec.destroyed) queueDestroy({ rec, timer });
      break;
    }
    case 6: {
      const rec = timerRecords.get(timer);
      if (rec === undefined || rec.destroyed) return;
      if (destroyHooks.length !== 0) queueDestroy({ rec, timer });
      break;
    }
  }
}

// Wrap a callback to run as async resource `asyncId`: before/after +
// execution ids around the call, destroy queued after. A throw takes the
// uncaught path while the resource's id is still current (node parity).
function wrapCallbackWithIds(asyncId, triggerAsyncId, callback) {
  return function wrapped() {
    const prevExec = state.exec;
    const prevTrigger = state.trigger;
    state.exec = asyncId;
    state.trigger = triggerAsyncId;
    if (beforeHooks.length !== 0) emitBefore(asyncId);
    try {
      return callback.$apply(this, arguments);
    } catch (err) {
      reportUncaughtException(err);
    } finally {
      if (afterHooks.length !== 0) emitAfter(asyncId);
      state.exec = prevExec;
      state.trigger = prevTrigger;
      if (destroyHooks.length !== 0) queueDestroy(asyncId);
    }
  };
}

// Request-style resource (e.g. crypto.randomBytes): allocate an id and emit
// init now, then wrap the callback for the fire.
function wrapRequestCallback(type, callback) {
  const asyncId = newAsyncId();
  const triggerAsyncId = state.exec;
  if (initHooks.length !== 0) emitInit(asyncId, type, triggerAsyncId, {});
  return wrapCallbackWithIds(asyncId, triggerAsyncId, callback);
}

export default {
  initHooks,
  beforeHooks,
  afterHooks,
  destroyHooks,
  state,
  newAsyncId,
  emitInit,
  emitBefore,
  emitAfter,
  queueDestroy,
  enableTracking,
  wrapCallbackWithIds,
  wrapRequestCallback,
};
