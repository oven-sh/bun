// Primordial-style helpers used by the `node inspect` CLI port under
// internal/debugger/. The debugger CLI runs in its own process and never
// evaluates user code (the debuggee is a separate child process), so these do
// not need to be tamper-proof — they only exist so the files ported from
// Node's lib/internal/debugger/* can stay close to upstream.

const SafePromiseAllReturnArrayLike = (values, mapFn?) => {
  return Promise.all(mapFn ? Array.from(values, mapFn) : values);
};

export default {
  // Plain global constructors that upstream pulls from primordials. They must
  // be present here because the ported files destructure them — a missing key
  // would shadow the real global with `undefined`.
  Array,
  Date,
  Number,
  Promise,
  Proxy,
  String,
  Symbol,
  // The real Array.from (not a wrapper): ported code calls it with an explicit
  // `this` (e.g. FunctionPrototypeCall(ArrayFrom, Backtrace, ...)) to construct
  // Array subclasses.
  ArrayFrom: Array.from,
  ArrayIsArray: Array.isArray,
  ArrayPrototypeFilter: (arr, fn) => arr.filter(fn),
  ArrayPrototypeFind: (arr, fn) => arr.find(fn),
  ArrayPrototypeForEach: (arr, fn) => arr.forEach(fn),
  ArrayPrototypeIncludes: (arr, value) => arr.includes(value),
  ArrayPrototypeIndexOf: (arr, value) => arr.indexOf(value),
  ArrayPrototypeJoin: (arr, sep) => arr.join(sep),
  ArrayPrototypeMap: (arr, fn) => arr.map(fn),
  ArrayPrototypePop: arr => arr.pop(),
  ArrayPrototypePush: (arr, ...values) => arr.push(...values),
  ArrayPrototypePushApply: (arr, values) => arr.push(...values),
  ArrayPrototypeShift: arr => arr.shift(),
  ArrayPrototypeSlice: (arr, start?, end?) => arr.slice(start, end),
  ArrayPrototypeSome: (arr, fn) => arr.some(fn),
  ArrayPrototypeSplice: (arr, start, deleteCount, ...items) => arr.splice(start, deleteCount, ...items),
  ErrorCaptureStackTrace: Error.captureStackTrace,
  FunctionPrototypeBind: (fn, thisArg, ...args) => fn.bind(thisArg, ...args),
  FunctionPrototypeCall: (fn, thisArg, ...args) => fn.$call(thisArg, ...args),
  JSONParse: JSON.parse,
  JSONStringify: JSON.stringify,
  MathMax: Math.max,
  NumberIsNaN: Number.isNaN,
  NumberParseInt: Number.parseInt,
  ObjectAssign: Object.assign,
  ObjectDefineProperty: Object.defineProperty,
  ObjectEntries: Object.entries,
  ObjectKeys: Object.keys,
  ObjectValues: Object.values,
  PromisePrototypeThen: (promise, onFulfilled, onRejected?) => promise.then(onFulfilled, onRejected),
  PromiseResolve: value => Promise.resolve(value),
  PromiseWithResolvers: () => Promise.withResolvers(),
  ReflectGetOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
  ReflectOwnKeys: Reflect.ownKeys,
  RegExpPrototypeExec: (re, str) => re.exec(str),
  RegExpPrototypeSymbolSplit: (re, str, limit?) => String(str).split(re, limit),
  SafeMap: Map,
  SafeSet: Set,
  SafePromiseAllReturnArrayLike,
  SafePromiseAllReturnVoid: async (values, mapFn?) => {
    await SafePromiseAllReturnArrayLike(values, mapFn);
  },
  SideEffectFreeRegExpPrototypeSymbolReplace: (re, str, replacement) => str.replace(re, replacement),
  StringFromCharCode: String.fromCharCode,
  StringPrototypeEndsWith: (str, search, end?) => str.endsWith(search, end),
  StringPrototypeIncludes: (str, search) => str.includes(search),
  StringPrototypeRepeat: (str, count) => str.repeat(count),
  StringPrototypeReplaceAll: (str, search, replacement) => str.replaceAll(search, replacement),
  StringPrototypeSlice: (str, start?, end?) => str.slice(start, end),
  StringPrototypeSplit: (str, sep, limit?) => str.split(sep, limit),
  StringPrototypeStartsWith: (str, search, start?) => str.startsWith(search, start),
  StringPrototypeToUpperCase: str => str.toUpperCase(),
  StringPrototypeTrim: str => str.trim(),
};
