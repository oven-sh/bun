// Hardcoded module "node:v8"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const jsc: typeof import("bun:jsc") = require("bun:jsc");

function notimpl(message) {
  throwNotImplemented("node:v8 " + message);
}

class Deserializer {
  constructor() {
    notimpl("Deserializer");
  }
}
class Serializer {
  constructor() {
    notimpl("Serializer");
  }
}
class DefaultDeserializer extends Deserializer {}
class DefaultSerializer extends Serializer {}
class GCProfiler {
  constructor() {
    notimpl("GCProfiler");
  }
}

function cachedDataVersionTag() {
  notimpl("cachedDataVersionTag");
}
function getHeapSnapshot() {
  notimpl("getHeapSnapshot");
}
function getHeapStatistics() {
  const stats = jsc.heapStats();
  // this is not very correct
  return {
    total_heap_size: stats.heapCapacity,
    total_heap_size_executable: 0,
    total_physical_size: stats.heapSize,
    total_available_size: Infinity,
    used_heap_size: stats.heapSize,
    heap_size_limit: Infinity,
    malloced_memory: stats.heapSize,
    peak_malloced_memory: Infinity,
    does_zap_garbage: 0,
    number_of_native_contexts: Infinity,
    number_of_detached_contexts: Infinity,
    total_global_handles_size: Infinity,
    used_global_handles_size: Infinity,
    external_memory: Infinity,
  };
}
function getHeapSpaceStatistics() {
  notimpl("getHeapSpaceStatistics");
}
function getHeapCodeStatistics() {
  notimpl("getHeapCodeStatistics");
}
function setFlagsFromString() {
  notimpl("setFlagsFromString");
}
function deserialize(value) {
  return jsc.deserialize(value);
}
function takeCoverage() {
  notimpl("takeCoverage");
}
function stopCoverage() {
  notimpl("stopCoverage");
}
function serialize(arg1) {
  return jsc.serialize(arg1, { binaryType: "nodebuffer" });
}
function writeHeapSnapshot() {
  notimpl("writeHeapSnapshot");
}
function setHeapSnapshotNearHeapLimit() {
  notimpl("setHeapSnapshotNearHeapLimit");
}
const promiseHooks = {
    createHook: () => {
      notimpl("createHook");
    },
    onInit: () => {
      notimpl("onInit");
    },
    onBefore: () => {
      notimpl("onBefore");
    },
    onAfter: () => {
      notimpl("onAfter");
    },
    onSettled: () => {
      notimpl("onSettled");
    },
  },
  startupSnapshot = {
    addDeserializeCallback: () => notimpl("addDeserializeCallback"),
    addSerializeCallback: () => notimpl("addSerializeCallback"),
    setDeserializeMainFunction: () => notimpl("setDeserializeMainFunction"),
    isBuildingSnapshot: () => notimpl("isBuildingSnapshot"),
  };

export default {
  cachedDataVersionTag,
  getHeapSnapshot,
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapCodeStatistics,
  setFlagsFromString,
  deserialize,
  takeCoverage,
  stopCoverage,
  serialize,
  writeHeapSnapshot,
  setHeapSnapshotNearHeapLimit,
  promiseHooks,
  startupSnapshot,
  Deserializer,
  Serializer,
};

hideFromStack(
  notimpl,
  cachedDataVersionTag,
  getHeapSnapshot,
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapCodeStatistics,
  setFlagsFromString,
  deserialize,
  takeCoverage,
  stopCoverage,
  serialize,
  writeHeapSnapshot,
  setHeapSnapshotNearHeapLimit,
  Deserializer,
  Serializer,
  DefaultDeserializer,
  DefaultSerializer,
  GCProfiler,
);
