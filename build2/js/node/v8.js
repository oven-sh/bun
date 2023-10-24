(function (){"use strict";// build2/tmp/node/v8.ts
var notimpl = function(message) {
  throwNotImplemented("node:v8 " + message);
};
var cachedDataVersionTag = function() {
  notimpl("cachedDataVersionTag");
};
var getHeapSnapshot = function() {
  notimpl("getHeapSnapshot");
};
var getHeapStatistics = function() {
  const stats = jsc.heapStats();
  return {
    total_heap_size: stats.heapCapacity,
    total_heap_size_executable: 0,
    total_physical_size: stats.heapSize,
    total_available_size: @Infinity,
    used_heap_size: stats.heapSize,
    heap_size_limit: @Infinity,
    malloced_memory: stats.heapSize,
    peak_malloced_memory: @Infinity,
    does_zap_garbage: 0,
    number_of_native_contexts: @Infinity,
    number_of_detached_contexts: @Infinity,
    total_global_handles_size: @Infinity,
    used_global_handles_size: @Infinity,
    external_memory: @Infinity
  };
};
var getHeapSpaceStatistics = function() {
  notimpl("getHeapSpaceStatistics");
};
var getHeapCodeStatistics = function() {
  notimpl("getHeapCodeStatistics");
};
var setFlagsFromString = function() {
  notimpl("setFlagsFromString");
};
var deserialize = function(value) {
  return jsc.deserialize(value);
};
var takeCoverage = function() {
  notimpl("takeCoverage");
};
var stopCoverage = function() {
  notimpl("stopCoverage");
};
var serialize = function(arg1) {
  return jsc.serialize(arg1, { binaryType: "nodebuffer" });
};
var writeHeapSnapshot = function() {
  notimpl("writeHeapSnapshot");
};
var setHeapSnapshotNearHeapLimit = function() {
  notimpl("setHeapSnapshotNearHeapLimit");
};
var $;
var { hideFromStack, throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
var jsc = @requireNativeModule("bun:jsc");

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

class DefaultDeserializer extends Deserializer {
  constructor() {
    super(...arguments);
  }
}

class DefaultSerializer extends Serializer {
  constructor() {
    super(...arguments);
  }
}

class GCProfiler {
  constructor() {
    notimpl("GCProfiler");
  }
}
var promiseHooks = {
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
  }
};
var startupSnapshot = {
  addDeserializeCallback: () => notimpl("addDeserializeCallback"),
  addSerializeCallback: () => notimpl("addSerializeCallback"),
  setDeserializeMainFunction: () => notimpl("setDeserializeMainFunction"),
  isBuildingSnapshot: () => notimpl("isBuildingSnapshot")
};
$ = {
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
  Serializer
};
hideFromStack(notimpl, cachedDataVersionTag, getHeapSnapshot, getHeapStatistics, getHeapSpaceStatistics, getHeapCodeStatistics, setFlagsFromString, deserialize, takeCoverage, stopCoverage, serialize, writeHeapSnapshot, setHeapSnapshotNearHeapLimit, Deserializer, Serializer, DefaultDeserializer, DefaultSerializer, GCProfiler);
return $})
