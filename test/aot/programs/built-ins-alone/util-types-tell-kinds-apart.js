import { types } from "node:util";
console.log(types.isNativeError(new RangeError()), types.isNativeError({}), types.isMapIterator(new Map().keys()), types.isSetIterator(new Set().values()), types.isMapIterator([].values()), types.isPromise(Promise.resolve()), types.isDate(new Date(0)), types.isRegExp(/a/), types.isTypedArray(new Uint8Array()), types.isProxy(new Proxy({}, {})));
