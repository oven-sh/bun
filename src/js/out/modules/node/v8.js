// src/js/node/v8.js
var hideFromStack = function(fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
  }
};
var notimpl = function(message) {
  throw new TODO(message);
};
var cachedDataVersionTag = function() {
  notimpl("cachedDataVersionTag");
};
var getHeapSnapshot = function() {
  notimpl("getHeapSnapshot");
};
var getHeapStatistics = function() {
  notimpl("getHeapStatistics");
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
var deserialize = function() {
  notimpl("deserialize");
};
var takeCoverage = function() {
  notimpl("takeCoverage");
};
var stopCoverage = function() {
  notimpl("stopCoverage");
};
var serialize = function() {
  notimpl("serialize");
};
var writeHeapSnapshot = function() {
  notimpl("writeHeapSnapshot");
};
var setHeapSnapshotNearHeapLimit = function() {
  notimpl("setHeapSnapshotNearHeapLimit");
};

class TODO extends Error {
  constructor(messageName) {
    const message = messageName ? `node:v8 ${messageName} is not implemented yet in Bun. ` : `node:v8 is not implemented yet in Bun`;
    super(message);
    this.name = "TODO";
  }
}

class Deserializer {
  constructor() {
    notimpl();
  }
}

class Serializer {
  constructor() {
    notimpl();
  }
}

class DefaultDeserializer extends Deserializer {
}

class DefaultSerializer extends Serializer {
}

class GCProfiler {
  constructor() {
    notimpl();
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
var defaultObject = {
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
hideFromStack([
  TODO.prototype.constructor,
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
  GCProfiler
]);
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

//# debugId=91EB3A2C7A4BDC3764756e2164756e21
