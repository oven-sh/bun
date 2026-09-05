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
const kUnrefFlag = Symbol("kActiveHandleUnrefFlag");

const head: any = {};
head[kPrev] = head;
head[kNext] = head;

class FSReqCallback {}
class GetAddrInfoReqWrap {}
class GetNameInfoReqWrap {}
const pendingRequestWraps = new Map();

function noteRequestStart(wrap, kind) {
  pendingRequestWraps.$set(wrap, kind);
  return wrap;
}

function noteRequestEnd(wrap) {
  pendingRequestWraps.$delete(wrap);
}

function registerHandle(handle, kind, unrefFlag) {
  handle[kUnrefFlag] = unrefFlag;
  if (handle[kKind] != null) {
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
