// Hardcoded module "node:v8"

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented, kEmptyObject } = require("internal/shared");
const {
  getValidatedFsPath,
  validateBoolean,
  validateInt32,
  validateInteger,
  validateNumber,
  validateObject,
  validateOneOf,
  validateString,
} = require("internal/validators");
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
function getHeapSnapshot(options) {
  validateHeapSnapshotOptions(options);
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
// Buffer-bearing payloads are framed as MAGIC + version + SSV([value, buffers])
// so deserialize can restore Buffer prototypes (JSC's serializer has no
// host-object hook; see internal/serialization_buffers). The magic's leading
// 0xFF cannot collide with bare SSV output, whose first byte is the small
// little-endian format version. Buffer-free payloads stay bare SSV, so older
// readers keep working for them.
const kBufferEnvelopeMagic = [0xff, 0x42, 0x55, 0x4e, 0x01]; // 0xFF "BUN" v1

function hasBufferEnvelopeMagic(view) {
  if (view.byteLength < kBufferEnvelopeMagic.length) return false;
  for (let i = 0; i < kBufferEnvelopeMagic.length; i++) {
    if (view[i] !== kBufferEnvelopeMagic[i]) return false;
  }
  return true;
}

function deserialize(value) {
  const view = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  if (hasBufferEnvelopeMagic(view)) {
    const envelope = jsc.deserialize(view.subarray(kBufferEnvelopeMagic.length));
    return require("internal/serialization_buffers").restoreBuffers(envelope);
  }
  return jsc.deserialize(value);
}
// Bun does not run V8's coverage collector, so there is never a pending
// coverage profile to flush or stop. Node's bindings are also no-ops when
// coverage was never started, so these succeed silently.
function takeCoverage() {}
function stopCoverage() {}
function serialize(arg1) {
  const tagged = require("internal/serialization_buffers").tagBuffers(arg1);
  if (tagged === null) {
    return jsc.serialize(arg1, { binaryType: "nodebuffer" });
  }
  const payload = jsc.serialize(tagged, { binaryType: "nodebuffer" });
  const framed = Buffer.allocUnsafe(kBufferEnvelopeMagic.length + payload.byteLength);
  for (let i = 0; i < kBufferEnvelopeMagic.length; i++) framed[i] = kBufferEnvelopeMagic[i];
  payload.copy(framed, kBufferEnvelopeMagic.length);
  return framed;
}

// Node's DiagnosticFilename:
// `Heap.<yyyymmdd>.<hhmmss>.<pid>.<threadId>.<seq>.heapsnapshot` in local time,
// with a zero-padded three-digit sequence number that starts at 001.
// https://github.com/nodejs/node/blob/v26.3.0/src/util.cc#L318-L347
let heapSnapshotSeq = 0;
function getDefaultHeapSnapshotPath() {
  const date = new Date();

  const worker_threads = require("node:worker_threads");
  const thread_id = worker_threads.threadId;

  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const MM = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");
  const seq = (++heapSnapshotSeq).toString().padStart(3, "0");

  return `Heap.${yyyy}${mm}${dd}.${hh}${MM}${ss}.${process.pid}.${thread_id}.${seq}.heapsnapshot`;
}

// node's getHeapSnapshotOptions (lib/internal/heap_utils.js). The two flags
// only change what V8 puts in the snapshot; Bun's generator has no equivalent
// switches, so they are validated and then ignored.
function validateHeapSnapshotOptions(options) {
  validateObject(options ?? kEmptyObject, "options");
  if (options == null) return;
  const { exposeInternals = false, exposeNumericValues = false } = options;
  validateBoolean(exposeInternals, "options.exposeInternals");
  validateBoolean(exposeNumericValues, "options.exposeNumericValues");
}

let fs;

function writeHeapSnapshot(path, options) {
  if (path !== undefined) {
    path = getValidatedFsPath(path, "path");
  }
  validateHeapSnapshotOptions(options);
  if (path === undefined) {
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
const cppStartCpuProfile = $newCppFunction("BunCPUProfiler.cpp", "jsFunction_startCpuProfile", 1) as (
  samplingIntervalMicros: number,
) => void;
const cppStopCpuProfile = $newCppFunction("BunCPUProfiler.cpp", "jsFunction_stopCpuProfile", 0) as () => string;
const cppTakeSamplingHeapProfile = $newCppFunction(
  "BunHeapProfiler.cpp",
  "jsFunction_takeSamplingHeapProfile",
  0,
) as () => string;

const kMicrosPerMilli = 1_000;
const kMaxSamplingIntervalMs = 0x7fffffff / kMicrosPerMilli;
const kMaxSamplesUnlimited = 0xffff_ffff;

// node's normalizeCpuProfileOptions (lib/internal/v8/cpu_profiler.js).
// `maxBufferSize` is validated and dropped: JSC's sampling profiler has no
// sample cap to configure.
function normalizeCpuProfileOptions(options = kEmptyObject) {
  validateObject(options, "options");
  const { sampleInterval, maxBufferSize } = options;

  let samplingIntervalMicros = 0;
  if (sampleInterval !== undefined) {
    validateNumber(sampleInterval, "options.sampleInterval", 0, kMaxSamplingIntervalMs);
    samplingIntervalMicros = Math.floor(sampleInterval * kMicrosPerMilli);
    if (sampleInterval > 0 && samplingIntervalMicros === 0) {
      samplingIntervalMicros = 1;
    }
  }
  if (maxBufferSize !== undefined) {
    validateNumber(maxBufferSize, "options.maxBufferSize", 1, kMaxSamplesUnlimited);
  }
  return samplingIntervalMicros;
}

// node's normalizeHeapProfileOptions (lib/internal/v8/heap_profile.js). Every
// option only tunes V8's allocation sampler, which JSC does not have, so they
// are validated and then dropped.
function normalizeHeapProfileOptions(options = kEmptyObject) {
  validateObject(options, "options");
  const {
    sampleInterval = 512 * 1024,
    stackDepth = 16,
    forceGC = false,
    includeObjectsCollectedByMajorGC = false,
    includeObjectsCollectedByMinorGC = false,
  } = options;

  validateInteger(sampleInterval, "options.sampleInterval", 1);
  validateInt32(stackDepth, "options.stackDepth", 0);
  validateBoolean(forceGC, "options.forceGC");
  validateBoolean(includeObjectsCollectedByMajorGC, "options.includeObjectsCollectedByMajorGC");
  validateBoolean(includeObjectsCollectedByMinorGC, "options.includeObjectsCollectedByMinorGC");
}

// JSC has one VM-wide sampling profiler and one heap, so at most one profile
// of each kind can be in flight; V8 allows several concurrent CPU profiles.
let cpuProfileRunning = false;
let heapProfileRunning = false;

class SyncCPUProfileHandle {
  #stopped = false;

  stop() {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    cpuProfileRunning = false;
    return cppStopCpuProfile();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

class SyncHeapProfileHandle {
  #stopped = false;

  stop() {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    heapProfileRunning = false;
    return cppTakeSamplingHeapProfile();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

function startCpuProfile(options) {
  const samplingIntervalMicros = normalizeCpuProfileOptions(options);
  if (cpuProfileRunning) {
    throw $ERR_CPU_PROFILE_TOO_MANY("There are too many CPU profiles");
  }
  cpuProfileRunning = true;
  cppStartCpuProfile(samplingIntervalMicros);
  return new SyncCPUProfileHandle();
}

function startHeapProfile(options) {
  normalizeHeapProfileOptions(options);
  if (heapProfileRunning) {
    throw $ERR_HEAP_PROFILE_HAVE_BEEN_STARTED("Heap profile has been started");
  }
  heapProfileRunning = true;
  return new SyncHeapProfileHandle();
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
  startCpuProfile,
  startHeapProfile,
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
  startCpuProfile,
  startHeapProfile,
  Deserializer,
  Serializer,
  DefaultDeserializer,
  DefaultSerializer,
  GCProfiler,
  DefaultDeserializer,
  DefaultSerializer,
);
