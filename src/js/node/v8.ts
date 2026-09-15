// Hardcoded module "node:v8"

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const { validateString, validateOneOf } = require("internal/validators");
const { isDataView, isAnyArrayBuffer } = require("node:util/types");
const jsc: typeof import("bun:jsc") = require("bun:jsc");
const { isStringOneByteRepresentation, startGCProfiler, stopGCProfiler, discardGCProfiler } = $cpp(
  "NodeV8.cpp",
  "Bun::createNodeV8Binding",
);

const DateNow = Date.now;
const FunctionPrototypeCall = Function.prototype.call;
const uncurryThis = func => FunctionPrototypeCall.bind(func);
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const Uint8ArrayCtor = Uint8Array;
const BufferAllocUnsafe = Buffer.allocUnsafe;
const TypedArrayProto = Object.getPrototypeOf(Uint8ArrayCtor.prototype);
const TypedArrayPrototypeGetBuffer = uncurryThis(ObjectGetOwnPropertyDescriptor(TypedArrayProto, "buffer").get);
const TypedArrayPrototypeGetByteOffset = uncurryThis(ObjectGetOwnPropertyDescriptor(TypedArrayProto, "byteOffset").get);
const TypedArrayPrototypeGetByteLength = uncurryThis(ObjectGetOwnPropertyDescriptor(TypedArrayProto, "byteLength").get);
const TypedArrayPrototypeSet = uncurryThis(TypedArrayProto.set);
const DataViewPrototypeGetBuffer = uncurryThis(ObjectGetOwnPropertyDescriptor(DataView.prototype, "buffer").get);
const DataViewPrototypeGetByteOffset = uncurryThis(
  ObjectGetOwnPropertyDescriptor(DataView.prototype, "byteOffset").get,
);
const DataViewPrototypeGetByteLength = uncurryThis(
  ObjectGetOwnPropertyDescriptor(DataView.prototype, "byteLength").get,
);
const Uint8ArrayPrototypeSubarray = uncurryThis(Uint8ArrayCtor.prototype.subarray);

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
// JSC manages one undivided heap, so a record carries a single space instead
// of V8's thirteen, and counters JSC does not track are reported as 0 rather
// than invented.
function gcHeapSnapshot(used, capacity, external) {
  const available = capacity > used ? capacity - used : 0;
  return {
    heapStatistics: {
      totalHeapSize: capacity,
      totalHeapSizeExecutable: 0,
      totalPhysicalSize: capacity,
      totalAvailableSize: available,
      usedHeapSize: used,
      heapSizeLimit: 0,
      mallocedMemory: 0,
      peakMallocedMemory: 0,
      externalMemory: external,
      totalGlobalHandlesSize: 0,
      usedGlobalHandlesSize: 0,
    },
    heapSpaceStatistics: [
      {
        spaceName: "heap",
        spaceSize: capacity,
        spaceUsedSize: used,
        spaceAvailableSize: available,
        physicalSpaceSize: capacity,
      },
    ],
  };
}

const kGCProfilerSession = Symbol("kGCProfilerSession");
const kGCProfilerStartTime = Symbol("kGCProfilerStartTime");

// A profiler that is started and then dropped without stop() would otherwise
// leave its native session open for the life of the VM; the registry releases
// it when the wrapper is collected, matching node's BaseObject finalizer.
let gcProfilerRegistry: FinalizationRegistry<number> | undefined;

class GCProfiler {
  constructor() {
    this[kGCProfilerSession] = null;
    this[kGCProfilerStartTime] = 0;
  }

  start() {
    if (this[kGCProfilerSession] !== null) return;
    this[kGCProfilerStartTime] = DateNow();
    const id = startGCProfiler();
    this[kGCProfilerSession] = id;
    (gcProfilerRegistry ??= new FinalizationRegistry(discardGCProfiler)).register(this, id, this);
  }

  stop() {
    const session = this[kGCProfilerSession];
    if (session === null) return undefined;
    this[kGCProfilerSession] = null;
    gcProfilerRegistry!.unregister(this);

    const events = stopGCProfiler(session);
    const statistics = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      $arrayPush(statistics, {
        // A JavaScriptCore eden collection only scans newly allocated objects,
        // and a full collection sweeps the whole heap, so they line up with
        // V8's minor and major collection types.
        gcType: event.isFullCollection ? "MarkSweepCompact" : "Scavenge",
        cost: event.cost,
        beforeGC: gcHeapSnapshot(event.usedBefore, event.capacityBefore, event.externalBefore),
        afterGC: gcHeapSnapshot(event.usedAfter, event.capacityAfter, event.externalAfter),
      });
    }

    return {
      version: 1,
      startTime: this[kGCProfilerStartTime],
      endTime: DateNow(),
      statistics,
    };
  }

  [Symbol.dispose]() {
    this.stop();
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
// Buffer-bearing payloads are framed as MAGIC + version + SSV([value, buffers]) so deserialize
// can restore Buffer prototypes (see internal/serialization_buffers). Leading 0xFF cannot collide
// with bare SSV output; Buffer-free payloads stay bare SSV so older readers keep working.
const kBufferEnvelopeMagic = [0xff, 0x42, 0x55, 0x4e, 0x01]; // 0xFF "BUN" v1

function hasBufferEnvelopeMagic(view) {
  // In-bounds integer-indexed reads on a typed array never consult the
  // prototype chain, so the indexing is tamper-proof as-is.
  if (TypedArrayPrototypeGetByteLength(view) < kBufferEnvelopeMagic.length) return false;
  for (let i = 0; i < kBufferEnvelopeMagic.length; i++) {
    if (view[i] !== kBufferEnvelopeMagic[i]) return false;
  }
  return true;
}

function deserialize(value) {
  let view;
  if ($isTypedArrayView(value)) {
    view = new Uint8ArrayCtor(
      TypedArrayPrototypeGetBuffer(value),
      TypedArrayPrototypeGetByteOffset(value),
      TypedArrayPrototypeGetByteLength(value),
    );
  } else if (isDataView(value)) {
    // $isTypedArrayView excludes DataView, whose accessors live on its own
    // prototype rather than %TypedArray%.prototype.
    view = new Uint8ArrayCtor(
      DataViewPrototypeGetBuffer(value),
      DataViewPrototypeGetByteOffset(value),
      DataViewPrototypeGetByteLength(value),
    );
  } else if (isAnyArrayBuffer(value)) {
    view = new Uint8ArrayCtor(value);
  } else {
    // Let jsc.deserialize validate and reject non-buffer input itself.
    return jsc.deserialize(value);
  }
  if (hasBufferEnvelopeMagic(view)) {
    const envelope = jsc.deserialize(Uint8ArrayPrototypeSubarray(view, kBufferEnvelopeMagic.length));
    return require("internal/serialization_buffers").restoreBuffers(envelope);
  }
  return jsc.deserialize(value);
}
function takeCoverage() {
  notimpl("takeCoverage");
}
function stopCoverage() {
  notimpl("stopCoverage");
}
function serialize(arg1) {
  const tagged = require("internal/serialization_buffers").tagBuffers(arg1);
  if (tagged === null) {
    return jsc.serialize(arg1, { binaryType: "nodebuffer" });
  }
  const payload = jsc.serialize(tagged, { binaryType: "nodebuffer" });
  const framed = BufferAllocUnsafe(kBufferEnvelopeMagic.length + TypedArrayPrototypeGetByteLength(payload));
  for (let i = 0; i < kBufferEnvelopeMagic.length; i++) framed[i] = kBufferEnvelopeMagic[i];
  TypedArrayPrototypeSet(framed, payload, kBufferEnvelopeMagic.length);
  return framed;
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
    path = require("internal/validators").getValidatedFsPath(path);
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
  GCProfiler,
  isStringOneByteRepresentation,
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
);
