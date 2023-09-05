const {
  ArrayFrom,
  ArrayPrototypeFlat,
  //MapPrototypeEntries,
  MapPrototypeValues,
  MapPrototypeKeys,
  SetPrototypeEntries,
  //SetPrototypeValues,
} = require("./primordials");

const { isWeakMap, isWeakSet } = require("node:util/types");

const ALL_PROPERTIES = 0;
const ONLY_ENUMERABLE = 2;
const kPending = Symbol("kPending"); // state ID 0
const kFulfilled = Symbol("kFulfilled"); // state ID 1
const kRejected = Symbol("kRejected"); // state ID 2

function getOwnNonIndexProperties(a, filter = ONLY_ENUMERABLE) {
  const desc = Object.getOwnPropertyDescriptors(a);
  const ret = [];
  for (const [k, v] of Object.entries(desc)) {
    if (!/^(0|[1-9][0-9]*)$/.test(k) || parseInt(k, 10) >= 2 ** 32 - 1) {
      // Arrays are limited in size
      if (filter === ONLY_ENUMERABLE && !v.enumerable) continue;
      ret.push(k);
    }
  }
  for (const s of Object.getOwnPropertySymbols(a)) {
    const v = Object.getOwnPropertyDescriptor(a, s);
    if (filter === ONLY_ENUMERABLE && !v.enumerable) continue;
    ret.push(s);
  }
  return ret;
}

export default {
  constants: {
    kPending,
    kRejected,
    ALL_PROPERTIES,
    ONLY_ENUMERABLE,
  },
  getOwnNonIndexProperties,
  getPromiseDetails(promise) {
    const state = $getPromiseInternalField(promise, $promiseFieldFlags) & $promiseStateMask;
    if (state !== $promiseStatePending) {
      return [
        state === $promiseStateRejected ? kRejected : kFulfilled,
        $getPromiseInternalField(promise, $promiseFieldReactionsOrResult),
      ];
    }
    return [kPending, undefined];
  },
  getProxyDetails(proxy, withHandler = true) {
    const isProxy = $isProxyObject(proxy);
    if (!isProxy) return undefined;
    const handler = $getProxyInternalField(proxy, $proxyFieldHandler);
    // if handler is null, the proxy is revoked
    const target = handler === null ? null : $getProxyInternalField(proxy, $proxyFieldTarget);
    if (withHandler) return [target, handler];
    else return target;
  },
  previewEntries(val, isIterator = false) {
    if (isIterator) {
      // the Map or Set instance this iterator belongs to
      const iteratedObject = $getInternalField(val, 1 /*iteratorFieldIteratedObject*/);
      // for Maps: 0 = keys, 1 = values,      2 = entries
      // for Sets:           1 = keys|values, 2 = entries
      const kind = $getInternalField(val, 2 /*iteratorFieldKind*/);
      const isEntries = kind === 2;
      // TODO(bun): improve performance by not using Array.from and instead using the iterator directly to only get the first
      // few entries which will actually be displayed (this requires changing some logic in the call sites of this function)
      if ($isMap(iteratedObject)) {
        if (isEntries) return [ArrayPrototypeFlat(ArrayFrom(iteratedObject)), true];
        else if (kind === 1) return [ArrayFrom(MapPrototypeValues(iteratedObject)), false];
        else return [ArrayFrom(MapPrototypeKeys(iteratedObject)), false];
      } else if ($isSet(iteratedObject)) {
        if (isEntries) return [ArrayPrototypeFlat(ArrayFrom(SetPrototypeEntries(iteratedObject))), true];
        else return [ArrayFrom(iteratedObject), false];
      }
      // TODO(bun): This function is currently only called for Map and Set iterators
      // perhaps we should add support for other iterators in the future? (e.g. ArrayIterator and StringIterator)
      else throw new Error("previewEntries(): Invalid iterator received");
    }
    // TODO(bun): are there any JSC APIs for viewing the contents of these in JS?
    if (isWeakMap(val)) return [];
    if (isWeakSet(val)) return [];
    else throw new Error("previewEntries(): Invalid object received");
  },
  getConstructorName(val) {
    if (!val || typeof val !== "object") {
      throw new Error("Invalid object");
    }
    if (val.constructor && val.constructor.name) {
      return val.constructor.name;
    }
    const str = Object.prototype.toString.call(val);
    // e.g. [object Boolean]
    const m = str.match(/^\[object ([^\]]+)\]/);
    if (m) {
      return m[1];
    }
    return "Object";
  },
};
