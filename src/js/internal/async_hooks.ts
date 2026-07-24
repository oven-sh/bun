// Port of the parts of node's lib/internal/async_hooks.js that Bun can honour.
//
// Bun tracks async ids for the resources it owns at the JS layer:
// process.nextTick (TickObject) and AsyncResource. Promises and native handles
// (sockets, fs requests, HTTP parsers) are NOT tracked, so `init`/`before`/
// `after`/`destroy` never fire for them and `promiseResolve` never fires at
// all.
//
// Everything here is behind `state.active`, a latch flipped the first time a
// hook is enabled or a caller asks for an async id. While it is false the
// instrumented paths do one boolean load and nothing else. It is never
// cleared: disabling a hook between a resource's `before` and `after` must not
// leave the id stack unbalanced.

const state = {
  active: false,
};

const fields = {
  init: 0,
  before: 0,
  after: 0,
  destroy: 0,
  promiseResolve: 0,
  totals: 0,
};

const activeHooks = {
  array: [] as any[],
  callDepth: 0,
  tmpArray: null as any[] | null,
  tmpFields: null as typeof fields | null,
};

let asyncIdCounter = 1;
let currentExecutionAsyncId = 1;
let currentTriggerAsyncId = 0;

// Saved [executionAsyncId, triggerAsyncId] pairs plus the resource owning each
// frame, unwound by popAsyncContext().
const savedIds: number[] = [];
const resourceStack: any[] = [];

const topLevelResource = {};

function newAsyncId() {
  return ++asyncIdCounter;
}

function executionAsyncId() {
  state.active = true;
  return currentExecutionAsyncId;
}

function triggerAsyncId() {
  state.active = true;
  return currentTriggerAsyncId;
}

function executionAsyncResource() {
  state.active = true;
  const { length } = resourceStack;
  if (length === 0) return topLevelResource;
  return resourceStack[length - 1];
}

function getDefaultTriggerAsyncId() {
  return currentExecutionAsyncId;
}

function pushAsyncContext(asyncId, triggerId, resource) {
  savedIds.push(currentExecutionAsyncId, currentTriggerAsyncId);
  resourceStack.push(resource);
  currentExecutionAsyncId = asyncId;
  currentTriggerAsyncId = triggerId;
}

function popAsyncContext() {
  if (savedIds.length === 0) return;
  currentTriggerAsyncId = savedIds.pop()!;
  currentExecutionAsyncId = savedIds.pop()!;
  resourceStack.pop();
}

// node's fatalError(): a throwing hook is not recoverable, it prints and exits
// with the generic user error code.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/async_hooks.js#L160
function fatalError(err) {
  try {
    // console is a user-mutable global; print through it but never let a
    // replacement stop the exit.
    console.error(typeof err?.stack === "string" ? err.stack : Bun.inspect(err));
  } catch {}
  process.exit(1);
}

function copyFields(destination, source) {
  destination.init = source.init;
  destination.before = source.before;
  destination.after = source.after;
  destination.destroy = source.destroy;
  destination.promiseResolve = source.promiseResolve;
  destination.totals = source.totals;
}

function getHookArrays() {
  if (activeHooks.callDepth === 0) return { array: activeHooks.array, fields };
  // A hook enabled/disabled from inside another hook must not reshape the set
  // being iterated; stage it and swap once the outermost emit finishes.
  if (activeHooks.tmpArray === null) {
    activeHooks.tmpArray = activeHooks.array.slice();
    activeHooks.tmpFields = { init: 0, before: 0, after: 0, destroy: 0, promiseResolve: 0, totals: 0 };
    copyFields(activeHooks.tmpFields, fields);
  }
  return { array: activeHooks.tmpArray, fields: activeHooks.tmpFields! };
}

function restoreActiveHooks() {
  activeHooks.array = activeHooks.tmpArray!;
  copyFields(fields, activeHooks.tmpFields!);
  activeHooks.tmpArray = null;
  activeHooks.tmpFields = null;
}

function emitHook(kind, asyncId) {
  activeHooks.callDepth++;
  try {
    const { array } = activeHooks;
    for (let i = 0; i < array.length; i++) {
      const hook = array[i][kind];
      if (hook !== undefined) hook(asyncId);
    }
  } catch (err) {
    fatalError(err);
  } finally {
    activeHooks.callDepth--;
  }
  if (activeHooks.callDepth === 0 && activeHooks.tmpArray !== null) restoreActiveHooks();
}

function emitInit(asyncId, type, triggerId, resource) {
  if (fields.init === 0) return;
  activeHooks.callDepth++;
  try {
    const { array } = activeHooks;
    for (let i = 0; i < array.length; i++) {
      const hook = array[i].init;
      if (hook !== undefined) hook(asyncId, type, triggerId, resource);
    }
  } catch (err) {
    fatalError(err);
  } finally {
    activeHooks.callDepth--;
  }
  if (activeHooks.callDepth === 0 && activeHooks.tmpArray !== null) restoreActiveHooks();
}

function emitBefore(asyncId, triggerId, resource) {
  pushAsyncContext(asyncId, triggerId, resource);
  if (fields.before !== 0) emitHook("before", asyncId);
}

function emitAfter(asyncId) {
  if (fields.after !== 0) emitHook("after", asyncId);
  popAsyncContext();
}

// node delivers destroy off a queue rather than inline, so tearing a resource
// down cannot re-enter user code at an arbitrary point.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/async_hooks.js#L533
const destroyQueue: number[] = [];
let destroyQueueScheduled = false;

function drainDestroyQueue() {
  destroyQueueScheduled = false;
  const ids = destroyQueue.slice();
  destroyQueue.length = 0;
  for (let i = 0; i < ids.length; i++) emitHook("destroy", ids[i]);
}

function emitDestroy(asyncId) {
  if (fields.destroy === 0 || !(asyncId > 0)) return;
  destroyQueue.push(asyncId);
  if (!destroyQueueScheduled) {
    destroyQueueScheduled = true;
    queueMicrotask(drainDestroyQueue);
  }
}

// Userland AsyncResources emit destroy when they are collected. The registry
// is only created once a destroy hook exists, so the common case allocates
// nothing.
let destroyRegistry: FinalizationRegistry<any> | undefined;

function onResourceCollected(held) {
  if (held.destroyed.destroyed) return;
  held.destroyed.destroyed = true;
  emitDestroy(held.asyncId);
}

function registerDestroyHook(resource, asyncId, destroyed) {
  destroyRegistry ??= new FinalizationRegistry(onResourceCollected);
  destroyRegistry.register(resource, { asyncId, destroyed }, resource);
}

function addHook(hook) {
  const { array, fields: hookFields } = getHookArrays();
  if (array.indexOf(hook) !== -1) return;
  const prevTotals = hookFields.totals;
  hookFields.totals = hookFields.init += hook.init !== undefined ? 1 : 0;
  hookFields.totals += hookFields.before += hook.before !== undefined ? 1 : 0;
  hookFields.totals += hookFields.after += hook.after !== undefined ? 1 : 0;
  hookFields.totals += hookFields.destroy += hook.destroy !== undefined ? 1 : 0;
  hookFields.totals += hookFields.promiseResolve += hook.promiseResolve !== undefined ? 1 : 0;
  array.push(hook);
  if (prevTotals === 0 && hookFields.totals > 0) state.active = true;
}

function removeHook(hook) {
  const { array, fields: hookFields } = getHookArrays();
  const index = array.indexOf(hook);
  if (index === -1) return;
  hookFields.totals = hookFields.init -= hook.init !== undefined ? 1 : 0;
  hookFields.totals += hookFields.before -= hook.before !== undefined ? 1 : 0;
  hookFields.totals += hookFields.after -= hook.after !== undefined ? 1 : 0;
  hookFields.totals += hookFields.destroy -= hook.destroy !== undefined ? 1 : 0;
  hookFields.totals += hookFields.promiseResolve -= hook.promiseResolve !== undefined ? 1 : 0;
  array.splice(index, 1);
}

function enabledHooksExist() {
  return activeHooks.array.length > 0;
}

function initHooksExist() {
  return fields.init > 0;
}

function destroyHooksExist() {
  return fields.destroy > 0;
}

export default {
  state,
  newAsyncId,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  getDefaultTriggerAsyncId,
  emitInit,
  emitBefore,
  emitAfter,
  emitDestroy,
  registerDestroyHook,
  addHook,
  removeHook,
  enabledHooksExist,
  initHooksExist,
  destroyHooksExist,
};
