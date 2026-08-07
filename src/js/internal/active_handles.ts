// Handle registry for process._getActiveHandles()/_getActiveRequests()/getActiveResourcesInfo().
// Node ref: https://github.com/nodejs/node/blob/main/lib/internal/process/per_thread.js
// and https://github.com/nodejs/node/blob/main/src/env.cc (handle_wrap_queue).

const getActiveTimeoutCount = $newRustFunction("runtime/timer/Timer.rs", "internal_bindings.getActiveTimeoutCount", 0);
const getActiveImmediateCount = $newRustFunction(
  "runtime/timer/Timer.rs",
  "internal_bindings.getActiveImmediateCount",
  0,
);
const getPendingFsRequestCount = $newRustFunction("node_fs_binding.rs", "getPendingRequestCount", 0);

const kPrev = Symbol("kActiveHandlePrev");
const kNext = Symbol("kActiveHandleNext");
const kKind = Symbol("kActiveHandleKind");
// The handle's own unref-marker key (net.ts's kUserUnrefed symbol for
// sockets, "_unref" for servers): truthy after unref(), so unref'd handles
// drop out of both APIs and ref() re-includes them, as in node.
const kUnrefFlag = Symbol("kActiveHandleUnrefFlag");

const head: any = {};
head[kPrev] = head;
head[kNext] = head;

// Named to match Node's wraps so constructor-name filtering on _getActiveRequests() works.
// fs entries are count-derived (no live wrap); dns entries register the live wrap at dispatch.
class FSReqCallback {}
class GetAddrInfoReqWrap {}
class GetNameInfoReqWrap {}
// wrap -> kind string. The kind is captured here, at registration, because the
// wraps are exposed via _getActiveRequests(): reading wrap.constructor.name at
// inspection time would run user tampering (a replaced constructor, a getter).
const pendingRequestWraps = new Map();

function noteRequestStart(wrap) {
  pendingRequestWraps.$set(wrap, wrap.constructor.name);
  return wrap;
}

function noteRequestEnd(wrap) {
  pendingRequestWraps.$delete(wrap);
}

function registerHandle(handle, kind, unrefFlag) {
  handle[kUnrefFlag] = unrefFlag;
  if (handle[kKind] != null) {
    // Already linked (e.g. kReinitializeHandle swapping the native handle).
    handle[kKind] = kind;
    return;
  }
  handle[kKind] = kind;
  handle[kPrev] = head[kPrev];
  handle[kNext] = head;
  head[kPrev][kNext] = handle;
  head[kPrev] = handle;
}

function unregisterHandle(handle) {
  if (handle == null || handle[kKind] == null) return;
  handle[kKind] = null;
  handle[kPrev][kNext] = handle[kNext];
  handle[kNext][kPrev] = handle[kPrev];
  handle[kPrev] = null;
  handle[kNext] = null;
}

// Walks the list, unlinking any handle whose native handle is gone — a missed
// unregister self-heals instead of pinning the dead socket forever.
function forEachActive(out, pushKind) {
  for (let h = head[kNext]; h !== head; ) {
    const next = h[kNext];
    if (h._handle == null) {
      unregisterHandle(h);
    } else if (!h[h[kUnrefFlag]]) {
      $arrayPush(out, pushKind ? h[kKind] : h);
    }
    h = next;
  }
  return out;
}

function getActiveHandles() {
  return forEachActive([], false);
}

function getActiveResourcesInfo() {
  // Node orders requests before handles before timers. Every async fs request
  // is 'FSReqCallback': Bun's fs callback API wraps the promise API, so node's
  // FSReqCallback/FSReqPromise split does not exist here.
  const resources: string[] = [];
  for (let i = 0, n = getPendingFsRequestCount(); i < n; i++) {
    $arrayPush(resources, "FSReqCallback");
  }
  pendingRequestWraps.$forEach(kind => {
    $arrayPush(resources, kind);
  });
  forEachActive(resources, true);
  for (let i = 0, n = getActiveTimeoutCount(); i < n; i++) {
    $arrayPush(resources, "Timeout");
  }
  for (let i = 0, n = getActiveImmediateCount(); i < n; i++) {
    $arrayPush(resources, "Immediate");
  }
  return resources;
}

function getActiveRequests() {
  // fs requests have no user-visible wrap (native promise), so each fs entry is a
  // fresh FSReqCallback instance; dns entries are the live wraps registered at dispatch.
  const requests: unknown[] = [];
  for (let i = 0, n = getPendingFsRequestCount(); i < n; i++) {
    $arrayPush(requests, new FSReqCallback());
  }
  pendingRequestWraps.$forEach((_kind, wrap) => {
    $arrayPush(requests, wrap);
  });
  return requests;
}

export default {
  registerHandle,
  unregisterHandle,
  noteRequestStart,
  noteRequestEnd,
  GetAddrInfoReqWrap,
  GetNameInfoReqWrap,
  getActiveHandles,
  getActiveRequests,
  getActiveResourcesInfo,
};
