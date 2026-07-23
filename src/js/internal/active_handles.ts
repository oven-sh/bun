// Node v26.3.0 parity (lib/internal/process/per_thread.js, env.cc handle wrap
// queue): live node:net handle registry plus assembly for process._getActiveHandles(),
// process._getActiveRequests() and process.getActiveResourcesInfo(). Intrusive
// doubly-linked list keyed by symbols: register/unregister add no GC cells.

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

// Request wraps, named like node's so ecosystem constructor-name filtering
// works on process._getActiveRequests(). fs requests are count-derived from
// the native pool, so instances are created on demand; dns lookups register
// live wraps at dispatch and drop them at settle.
class FSReqCallback {}
class GetAddrInfoReqWrap {}
class GetNameInfoReqWrap {}
const pendingRequestWraps = new Set();

function noteRequestStart(wrap) {
  pendingRequestWraps.add(wrap);
  return wrap;
}

function noteRequestEnd(wrap) {
  pendingRequestWraps.delete(wrap);
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
      out.push(pushKind ? h[kKind] : h);
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
    // Bun's fs callback API wraps the promise API in native code, so node's
    // FSReqCallback/FSReqPromise split is not recoverable here: every pending
    // fs request reports as FSReqCallback.
    resources.push("FSReqCallback");
  }
  for (const wrap of pendingRequestWraps) {
    resources.push(wrap.constructor.name);
  }
  forEachActive(resources, true);
  for (let i = 0, n = getActiveTimeoutCount(); i < n; i++) {
    resources.push("Timeout");
  }
  for (let i = 0, n = getActiveImmediateCount(); i < n; i++) {
    resources.push("Immediate");
  }
  return resources;
}

function getActiveRequests() {
  // One entry per in-flight async request. fs requests complete through a
  // native promise with no user-visible wrap, so each fs entry is a fresh
  // FSReqCallback instance; dns entries are the live wraps registered at
  // dispatch.
  const requests: unknown[] = [];
  for (let i = 0, n = getPendingFsRequestCount(); i < n; i++) {
    requests.push(new FSReqCallback());
  }
  for (const wrap of pendingRequestWraps) {
    requests.push(wrap);
  }
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
