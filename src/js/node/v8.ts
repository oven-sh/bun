// Hardcoded module "node:v8"

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const { validateString } = require("internal/validators");
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

let maxOldSpaceSize_ = -1;

// --max-old-space-size is enforced (the process aborts when a full GC cannot
// keep the heap under it), so report it like V8 does. Last occurrence wins.
function maxOldSpaceSizeBytes() {
  if (maxOldSpaceSize_ === -1) {
    let megabytes = 0;
    const execArgv = process.execArgv;
    for (let i = 0; i < execArgv.length; i++) {
      const arg = execArgv[i];
      let value: string | undefined;
      if (arg.startsWith("--max-old-space-size=") || arg.startsWith("--max_old_space_size=")) {
        value = arg.slice("--max-old-space-size=".length);
      } else if (arg === "--max-old-space-size" || arg === "--max_old_space_size") {
        value = execArgv[i + 1];
      }
      if (value !== undefined) {
        // 0 is a valid value meaning "no limit", so it must reset an
        // earlier positive value like the native parser does.
        const parsed = Number.parseInt(value, 10);
        if (parsed >= 0) megabytes = parsed;
      }
    }
    maxOldSpaceSize_ = megabytes * 1024 * 1024;
  }
  return maxOldSpaceSize_;
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
    heap_size_limit: maxOldSpaceSizeBytes() || Math.min(memory.peak * 10, totalmem()),
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
function getHeapSpaceStatistics() {
  notimpl("getHeapSpaceStatistics");
}
function getHeapCodeStatistics() {
  notimpl("getHeapCodeStatistics");
}
function setFlagsFromString(flags) {
  // Validate before reporting the gap: node rejects a non-string argument
  // regardless of whether the flag itself can be applied.
  validateString(flags, "flags");
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
  DefaultDeserializer,
  DefaultSerializer,
);
