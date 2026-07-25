// Uncurried "primordials" shims for Node.js sources ported into Bun
// (node:repl and the internal/readline stack). Each helper captures its
// intrinsic once at module load and invokes it through the tamper-proof
// `$call`/`$apply` intrinsics, so replacing a prototype method (e.g.
// `Array.prototype.push = ...`) after this module loads does not affect the
// ported code. Safe* containers re-export the real makeSafe()-wrapped
// implementations from internal/primordials so there is one definition per
// name. Weaker than Node only in that capture happens at (lazy) module load
// rather than realm bootstrap; SafePromiseRace additionally wraps its input in
// a SafeArrayIterator because spec Promise.race reads
// Array.prototype[Symbol.iterator] at CALL time.
const { SafeMap, SafeSet, SafeWeakSet, SafeStringIterator, SafeArrayIterator } = require("internal/primordials");

const ArrayFromFn = Array.from;
const ArrayPrototypeAtFn = Array.prototype.at;
const ArrayPrototypeConcatFn = Array.prototype.concat;
const ArrayPrototypeFilterFn = Array.prototype.filter;
const ArrayPrototypeFindFn = Array.prototype.find;
const ArrayPrototypeFindLastIndexFn = Array.prototype.findLastIndex;
const ArrayPrototypeFlatFn = Array.prototype.flat;
const ArrayPrototypeForEachFn = Array.prototype.forEach;
const ArrayPrototypeIncludesFn = Array.prototype.includes;
const ArrayPrototypeIndexOfFn = Array.prototype.indexOf;
const ArrayPrototypeJoinFn = Array.prototype.join;
const ArrayPrototypeMapFn = Array.prototype.map;
const ArrayPrototypePopFn = Array.prototype.pop;
const ArrayPrototypePushFn = Array.prototype.push;
const ArrayPrototypeReverseFn = Array.prototype.reverse;
const ArrayPrototypeShiftFn = Array.prototype.shift;
const ArrayPrototypeSliceFn = Array.prototype.slice;
const ArrayPrototypeSomeFn = Array.prototype.some;
const ArrayPrototypeSortFn = Array.prototype.sort;
const ArrayPrototypeSpliceFn = Array.prototype.splice;
const ArrayPrototypeToSortedFn = Array.prototype.toSorted;
const ArrayPrototypeUnshiftFn = Array.prototype.unshift;
const DateNowFn = Date.now;
const FunctionPrototypeBindFn = Function.prototype.bind;
const JSONStringifyFn = JSON.stringify;
const MathMaxFn = Math.max;
const PromisePrototypeThenFn = Promise.prototype.then;
const PromiseRejectFn = Promise.reject;
const PromiseResolveFn = Promise.resolve;
const PromiseRaceFn = Promise.race;
const RegExpPrototypeExecFn = RegExp.prototype.exec;
const RegExpPrototypeSymbolReplaceFn = RegExp.prototype[Symbol.replace];
const RegExpPrototypeSymbolSplitFn = RegExp.prototype[Symbol.split];
const StringPrototypeCharAtFn = String.prototype.charAt;
const StringPrototypeCharCodeAtFn = String.prototype.charCodeAt;
const StringPrototypeCodePointAtFn = String.prototype.codePointAt;
const StringPrototypeEndsWithFn = String.prototype.endsWith;
const StringPrototypeIncludesFn = String.prototype.includes;
const StringPrototypeIndexOfFn = String.prototype.indexOf;
const StringPrototypeLastIndexOfFn = String.prototype.lastIndexOf;
const StringPrototypeRepeatFn = String.prototype.repeat;
const StringPrototypeReplaceFn = String.prototype.replace;
const StringPrototypeReplaceAllFn = String.prototype.replaceAll;
const StringPrototypeSliceFn = String.prototype.slice;
const StringPrototypeSplitFn = String.prototype.split;
const StringPrototypeStartsWithFn = String.prototype.startsWith;
const StringPrototypeToLocaleLowerCaseFn = String.prototype.toLocaleLowerCase;
const StringPrototypeToLowerCaseFn = String.prototype.toLowerCase;
const StringPrototypeTrimFn = String.prototype.trim;
const StringPrototypeTrimStartFn = String.prototype.trimStart;

export default {
  ArrayFrom: (...args) => ArrayFromFn.$apply(Array, args),
  ArrayIsArray: Array.isArray,
  ArrayPrototypeAt: (a, i) => ArrayPrototypeAtFn.$call(a, i),
  ArrayPrototypeConcat: (a, ...args) => ArrayPrototypeConcatFn.$apply(a, args),
  ArrayPrototypeFilter: (a, fn) => ArrayPrototypeFilterFn.$call(a, fn),
  ArrayPrototypeFind: (a, fn) => ArrayPrototypeFindFn.$call(a, fn),
  ArrayPrototypeFindLastIndex: (a, fn) => ArrayPrototypeFindLastIndexFn.$call(a, fn),
  ArrayPrototypeFlat: (a, d) => ArrayPrototypeFlatFn.$call(a, d),
  ArrayPrototypeForEach: (a, fn) => ArrayPrototypeForEachFn.$call(a, fn),
  ArrayPrototypeIncludes: (a, v, i) => ArrayPrototypeIncludesFn.$call(a, v, i),
  ArrayPrototypeIndexOf: (a, v, i) => ArrayPrototypeIndexOfFn.$call(a, v, i),
  ArrayPrototypeJoin: (a, s) => ArrayPrototypeJoinFn.$call(a, s),
  ArrayPrototypeMap: (a, fn) => ArrayPrototypeMapFn.$call(a, fn),
  ArrayPrototypePop: a => ArrayPrototypePopFn.$call(a),
  ArrayPrototypePush: (a, ...items) => ArrayPrototypePushFn.$apply(a, items),
  ArrayPrototypePushApply: (a, items) => ArrayPrototypePushFn.$apply(a, items),
  ArrayPrototypeReverse: a => ArrayPrototypeReverseFn.$call(a),
  ArrayPrototypeShift: a => ArrayPrototypeShiftFn.$call(a),
  ArrayPrototypeSlice: (a, b, e) => ArrayPrototypeSliceFn.$call(a, b, e),
  ArrayPrototypeSome: (a, fn) => ArrayPrototypeSomeFn.$call(a, fn),
  ArrayPrototypeSort: (a, fn) => ArrayPrototypeSortFn.$call(a, fn),
  ArrayPrototypeSplice: (a, ...args) => ArrayPrototypeSpliceFn.$apply(a, args),
  ArrayPrototypeToSorted: (a, fn) => ArrayPrototypeToSortedFn.$call(a, fn),
  ArrayPrototypeUnshift: (a, ...items) => ArrayPrototypeUnshiftFn.$apply(a, items),
  Boolean,
  DateNow: () => DateNowFn.$call(Date),
  Error,
  FunctionPrototype: function () {},
  FunctionPrototypeBind: (fn, thisArg, ...args) => {
    ArrayPrototypeUnshiftFn.$call(args, thisArg);
    return FunctionPrototypeBindFn.$apply(fn, args);
  },
  FunctionPrototypeCall: (fn, thisArg, ...args) => fn.$apply(thisArg, args),
  JSONStringify: (...args) => JSONStringifyFn.$apply(JSON, args),
  MathCeil: Math.ceil,
  MathFloor: Math.floor,
  MathMax: Math.max,
  MathMaxApply: args => MathMaxFn.$apply(Math, args),
  MathMin: Math.min,
  Number,
  NumberIsFinite: Number.isFinite,
  NumberIsNaN: Number.isNaN,
  NumberParseFloat: Number.parseFloat,
  NumberParseInt: Number.parseInt,
  ObjectAssign: Object.assign,
  ObjectCreate: Object.create,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectEntries: Object.entries,
  ObjectFreeze: Object.freeze,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectKeys: Object.keys,
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  Promise,
  PromisePrototypeThen: (p, onFulfilled, onRejected) => PromisePrototypeThenFn.$call(p, onFulfilled, onRejected),
  PromiseReject: v => PromiseRejectFn.$call(Promise, v),
  PromiseResolve: v => PromiseResolveFn.$call(Promise, v),
  ReflectApply: (fn, thisArg, args) => fn.$apply(thisArg, args),
  RegExp,
  RegExpPrototypeExec: (re, s) => RegExpPrototypeExecFn.$call(re, s),
  RegExpPrototypeSymbolReplace: (re, s, replacement) => RegExpPrototypeSymbolReplaceFn.$call(re, s, replacement),
  RegExpPrototypeSymbolSplit: (re, s, limit) => RegExpPrototypeSymbolSplitFn.$call(re, s, limit),
  SafePromiseRace: promises => PromiseRaceFn.$call(Promise, new SafeArrayIterator(promises)),
  SafeSet,
  SafeMap,
  SafeWeakSet,
  SafeStringIterator,
  StringFromCharCode: String.fromCharCode,
  StringPrototypeCharAt: (s, i) => StringPrototypeCharAtFn.$call(s, i),
  StringPrototypeCharCodeAt: (s, i) => StringPrototypeCharCodeAtFn.$call(s, i),
  StringPrototypeCodePointAt: (s, i) => StringPrototypeCodePointAtFn.$call(s, i),
  StringPrototypeEndsWith: (s, v, e) => StringPrototypeEndsWithFn.$call(s, v, e),
  StringPrototypeIncludes: (s, v, i) => StringPrototypeIncludesFn.$call(s, v, i),
  StringPrototypeIndexOf: (s, v, i) => StringPrototypeIndexOfFn.$call(s, v, i),
  StringPrototypeLastIndexOf: (s, v, i) => StringPrototypeLastIndexOfFn.$call(s, v, i),
  StringPrototypeRepeat: (s, n) => StringPrototypeRepeatFn.$call(s, n),
  StringPrototypeReplace: (s, a, b) => StringPrototypeReplaceFn.$call(s, a, b),
  StringPrototypeReplaceAll: (s, a, b) => StringPrototypeReplaceAllFn.$call(s, a, b),
  StringPrototypeSlice: (s, b, e) => StringPrototypeSliceFn.$call(s, b, e),
  StringPrototypeSplit: (s, sep, limit) => StringPrototypeSplitFn.$call(s, sep, limit),
  StringPrototypeStartsWith: (s, v, i) => StringPrototypeStartsWithFn.$call(s, v, i),
  StringPrototypeToLocaleLowerCase: s => StringPrototypeToLocaleLowerCaseFn.$call(s),
  StringPrototypeToLowerCase: s => StringPrototypeToLowerCaseFn.$call(s),
  StringPrototypeTrim: s => StringPrototypeTrimFn.$call(s),
  StringPrototypeTrimStart: s => StringPrototypeTrimStartFn.$call(s),
  Symbol,
  SymbolAsyncIterator: Symbol.asyncIterator,
  SymbolDispose: Symbol.dispose,
  SyntaxError,
  globalThis,
};
