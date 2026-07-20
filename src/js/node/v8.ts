// Hardcoded module "node:v8"

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const { validateString, validateOneOf } = require("internal/validators");
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

// Node derives this tag from the V8 version, command-line flags, and CPU
// features; Bun mirrors that with its own version plus the flags recorded by
// setFlagsFromString, so the tag is stable until the flags change.
let versionTagFlags = "";
let versionTag: number | undefined;
function cachedDataVersionTag() {
  versionTag ??= Bun.hash.crc32(`bun ${Bun.version}-${Bun.revision}${versionTagFlags}`);
  return versionTag;
}
var HeapSnapshotReadable_;
function getHeapSnapshot() {
  if (!HeapSnapshotReadable_) {
    const Readable = require("node:stream").Readable;
    class HeapSnapshotReadable extends Readable {
      constructor() {
        super();
        this.push(Bun.generateHeapSnapshot("v8"));
        this.push(null);
      }
    }
    HeapSnapshotReadable_ = HeapSnapshotReadable;
  }

  return new HeapSnapshotReadable_();
}

let totalmem_ = -1;

function totalmem() {
  if (totalmem_ === -1) {
    totalmem_ = require("node:os").totalmem();
  }
  return totalmem_;
}

function getHeapStatistics() {
  const stats = jsc.heapStats();
  const memory = jsc.memoryUsage();

  // These numbers need to be plausible, even if incorrect
  // From npm's codebase:
  //
  // > static #heapLimit = Math.floor(getHeapStatistics().heap_size_limit)
  //
  return {
    total_heap_size: stats.heapSize,
    total_heap_size_executable: stats.heapSize >> 1,
    total_physical_size: memory.peak,
    total_available_size: totalmem() - stats.heapSize,
    used_heap_size: stats.heapSize,
    total_allocated_bytes: stats.heapCapacity,
    heap_size_limit: Math.min(memory.peak * 10, totalmem()),
    malloced_memory: stats.heapSize,
    peak_malloced_memory: memory.peak,

    // -- Copied from Node:
    does_zap_garbage: 0,
    number_of_native_contexts: stats.globalObjectCount,
    number_of_detached_contexts: 0,
    total_global_handles_size: 8192,
    used_global_handles_size: 2208,
    // ---- End of copied from Node

    external_memory: stats.extraMemorySize,
  };
}
// V8 divides its heap into fixed spaces; JSC manages one undivided heap, so
// the JSC totals are reported under "old_space" and the other V8 space names
// exist for shape compatibility.
const kHeapSpaces = [
  "read_only_space",
  "new_space",
  "old_space",
  "code_space",
  "shared_space",
  "trusted_space",
  "new_large_object_space",
  "large_object_space",
  "code_large_object_space",
  "shared_large_object_space",
  "shared_trusted_space",
  "shared_trusted_large_object_space",
  "trusted_large_object_space",
];
function getHeapSpaceStatistics() {
  const stats = jsc.heapStats();
  const spaces = [];
  for (let i = 0; i < kHeapSpaces.length; i++) {
    const space_name = kHeapSpaces[i];
    const isHeap = space_name === "old_space";
    const used = isHeap ? stats.heapSize : 0;
    const size = isHeap ? stats.heapCapacity : 0;
    $arrayPush(spaces, {
      space_name,
      space_size: size,
      space_used_size: used,
      space_available_size: size > used ? size - used : 0,
      physical_space_size: size,
    });
  }
  return spaces;
}
// JSC does not expose a per-category code size breakdown; report zeros rather
// than invented numbers, like node does for counters V8 is not tracking
// (e.g. cpu_profiler_metadata_size).
function getHeapCodeStatistics() {
  return {
    code_and_metadata_size: 0,
    bytecode_and_metadata_size: 0,
    external_script_source_size: 0,
    cpu_profiler_metadata_size: 0,
  };
}
function setFlagsFromString(flags) {
  validateString(flags, "flags");
  // V8 flags have no JSC equivalent; record them so cachedDataVersionTag
  // changes like node's does, and otherwise ignore them.
  versionTagFlags += ` ${flags}`;
  versionTag = undefined;
}
// Bun has no cppgc (Oilpan) C++ heap, so the statistics are always empty;
// this matches node's shape with nothing allocated through cppgc.
function getCppHeapStatistics(type = "detailed") {
  validateOneOf(type, "type", ["brief", "detailed"]);
  return {
    committed_size_bytes: 0,
    resident_size_bytes: 0,
    used_size_bytes: 0,
    space_statistics: [],
    type_names: [],
    detail_level: type,
  };
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

function getDefaultHeapSnapshotPath() {
  const date = new Date();

  const worker_threads = require("node:worker_threads");
  const thread_id = worker_threads.threadId;

  const yyyy = date.getFullYear();
  const mm = date.getMonth().toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const MM = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");

  // 'Heap-${yyyymmdd}-${hhmmss}-${pid}-${thread_id}.heapsnapshot'
  return `Heap-${yyyy}${mm}${dd}-${hh}${MM}${ss}-${process.pid}-${thread_id}.heapsnapshot`;
}

let fs;

function writeHeapSnapshot(path, _options) {
  if (path !== undefined) {
    if (typeof path !== "string") {
      throw $ERR_INVALID_ARG_TYPE("path", "string", path);
    }

    if (!path) {
      throw $ERR_INVALID_ARG_VALUE("path", path, "must be a non-empty string");
    }
  } else {
    path = getDefaultHeapSnapshotPath();
  }

  if (!fs) {
    fs = require("node:fs");
  }
  fs.writeFileSync(path, Bun.generateHeapSnapshot("v8"), "utf-8");

  return path;
}
function setHeapSnapshotNearHeapLimit() {
  notimpl("setHeapSnapshotNearHeapLimit");
}
function throwNotBuildingSnapshot() {
  throw $ERR_NOT_BUILDING_SNAPSHOT("Operation cannot be invoked when not building startup snapshot");
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
    addDeserializeCallback: throwNotBuildingSnapshot,
    addSerializeCallback: throwNotBuildingSnapshot,
    setDeserializeMainFunction: throwNotBuildingSnapshot,
    // Bun never builds a V8 startup snapshot, so this is always false, matching
    // Node's behavior during normal execution.
    isBuildingSnapshot: () => false,
  };

export default {
  cachedDataVersionTag,
  getHeapSnapshot,
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapCodeStatistics,
  getCppHeapStatistics,
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
  DefaultDeserializer,
  DefaultSerializer,
};

hideFromStack(
  notimpl,
  throwNotBuildingSnapshot,
  cachedDataVersionTag,
  getHeapSnapshot,
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapCodeStatistics,
  getCppHeapStatistics,
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
  DefaultDeserializer,
  DefaultSerializer,
);
