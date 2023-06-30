function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/v8.ts
var notimpl = function(message) {
  throwNotImplemented("node:v8 " + message);
}, cachedDataVersionTag = function() {
  notimpl("cachedDataVersionTag");
}, getHeapSnapshot = function() {
  notimpl("getHeapSnapshot");
}, getHeapStatistics = function() {
  notimpl("getHeapStatistics");
}, getHeapSpaceStatistics = function() {
  notimpl("getHeapSpaceStatistics");
}, getHeapCodeStatistics = function() {
  notimpl("getHeapCodeStatistics");
}, setFlagsFromString = function() {
  notimpl("setFlagsFromString");
}, deserialize = function() {
  notimpl("deserialize");
}, takeCoverage = function() {
  notimpl("takeCoverage");
}, stopCoverage = function() {
  notimpl("stopCoverage");
}, serialize = function() {
  notimpl("serialize");
}, writeHeapSnapshot = function() {
  notimpl("writeHeapSnapshot");
}, setHeapSnapshotNearHeapLimit = function() {
  notimpl("setHeapSnapshotNearHeapLimit");
};

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
}, startupSnapshot = {
  addDeserializeCallback: () => notimpl("addDeserializeCallback"),
  addSerializeCallback: () => notimpl("addSerializeCallback"),
  setDeserializeMainFunction: () => notimpl("setDeserializeMainFunction"),
  isBuildingSnapshot: () => notimpl("isBuildingSnapshot")
}, defaultObject = {
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
  [Symbol.for("CommonJS")]: 0
};
hideFromStack(notimpl, cachedDataVersionTag, getHeapSnapshot, getHeapStatistics, getHeapSpaceStatistics, getHeapCodeStatistics, setFlagsFromString, deserialize, takeCoverage, stopCoverage, serialize, writeHeapSnapshot, setHeapSnapshotNearHeapLimit, Deserializer, Serializer, DefaultDeserializer, DefaultSerializer, GCProfiler);
export {
  writeHeapSnapshot,
  takeCoverage,
  stopCoverage,
  startupSnapshot,
  setHeapSnapshotNearHeapLimit,
  setFlagsFromString,
  serialize,
  promiseHooks,
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapSnapshot,
  getHeapCodeStatistics,
  deserialize,
  defaultObject as default,
  cachedDataVersionTag,
  Serializer,
  GCProfiler,
  Deserializer,
  DefaultSerializer,
  DefaultDeserializer
};
