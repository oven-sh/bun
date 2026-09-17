// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled `init` hooks are pushed
// into `tickInitHooks` so the nextTick hot path pays only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// This bridge delivers TickObject `init`. Timer `init`/`destroy` events share
// the id generator below and are delivered from node/async_hooks.ts.
const tickInitHooks = [];
const allocateAsyncHooksId = $newRustFunction("runtime/timer/Timer.rs", "internal_bindings.new_async_hooks_id", 0);
let hookDispatchDepth = 0;
let pendingTickInitHooks;
let deferredHookMutations;

function mutableTickInitHooks() {
  if (hookDispatchDepth === 0) return tickInitHooks;
  if (pendingTickInitHooks === undefined) {
    pendingTickInitHooks = [];
    for (var i = 0, n = tickInitHooks.length; i < n; i++) $arrayPush(pendingTickInitHooks, tickInitHooks[i]);
  }
  return pendingTickInitHooks;
}

function removeFromArray(array, value) {
  for (var i = 0, n = array.length; i < n; i++) {
    if (array[i] !== value) continue;
    for (var j = i + 1; j < n; j++) array[j - 1] = array[j];
    array.length = n - 1;
    return;
  }
}

export default {
  tickInitHooks,
  addInitHook(hook) {
    $arrayPush(mutableTickInitHooks(), hook);
  },
  removeInitHook(hook) {
    removeFromArray(mutableTickInitHooks(), hook);
  },
  beginHookDispatch() {
    hookDispatchDepth++;
  },
  endHookDispatch() {
    if (--hookDispatchDepth !== 0) return;
    if (pendingTickInitHooks !== undefined) {
      tickInitHooks.length = 0;
      for (var i = 0, n = pendingTickInitHooks.length; i < n; i++) {
        $arrayPush(tickInitHooks, pendingTickInitHooks[i]);
      }
      pendingTickInitHooks = undefined;
    }
    const deferred = deferredHookMutations;
    deferredHookMutations = undefined;
    if (deferred !== undefined) {
      for (var i = 0, n = deferred.length; i < n; i++) deferred[i]();
    }
  },
  hookDispatchActive() {
    return hookDispatchDepth !== 0;
  },
  deferHookMutation(callback) {
    if (hookDispatchDepth === 0) {
      callback();
    } else if (deferredHookMutations === undefined) {
      deferredHookMutations = [callback];
    } else {
      $arrayPush(deferredHookMutations, callback);
    }
  },
  newAsyncId() {
    return allocateAsyncHooksId();
  },
};
