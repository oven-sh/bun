// Uncurried "primordials" shims for Node.js sources ported into Bun (node:repl and the internal/readline stack).
const { SafeSet, SafeStringIterator, SafeArrayIterator } = require("internal/primordials");

type Replacement = string | Parameters<typeof String.prototype.replace>[1];

const ArrayFromFn: (this: unknown, items: Iterable<unknown> | ArrayLike<unknown>) => unknown[] = Array.from;
const ArrayPrototypeAtFn = Array.prototype.at;
const ArrayPrototypeFilterFn = Array.prototype.filter;
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
const JSONStringifyFn: (this: JSON, value: unknown, replacer?: null, space?: string | number) => string =
  JSON.stringify;
const MathMaxFn = Math.max;
const PromiseRejectFn = Promise.reject;
const PromiseRaceFn: (this: PromiseConstructor, values: Iterable<unknown>) => Promise<unknown> = Promise.race;
const RegExpPrototypeExecFn = RegExp.prototype.exec;
const RegExpPrototypeSymbolReplaceFn = RegExp.prototype[Symbol.replace] as (
  this: RegExp,
  string: string,
  replacement: Replacement,
) => string;
const RegExpPrototypeSymbolSplitFn = RegExp.prototype[Symbol.split];
const StringPrototypeCharAtFn = String.prototype.charAt;
const StringPrototypeCharCodeAtFn = String.prototype.charCodeAt;
const StringPrototypeCodePointAtFn = String.prototype.codePointAt;
const StringPrototypeEndsWithFn = String.prototype.endsWith;
const StringPrototypeIncludesFn = String.prototype.includes;
const StringPrototypeIndexOfFn = String.prototype.indexOf;
const StringPrototypeLastIndexOfFn = String.prototype.lastIndexOf;
const StringPrototypeRepeatFn = String.prototype.repeat;
const StringPrototypeReplaceAllFn = String.prototype.replaceAll as (
  this: string,
  searchValue: string | RegExp,
  replacement: Replacement,
) => string;
const StringPrototypeSliceFn = String.prototype.slice;
const StringPrototypeSplitFn: (this: string, separator: string | RegExp, limit?: number) => string[] =
  String.prototype.split;
const StringPrototypeStartsWithFn = String.prototype.startsWith;
const StringPrototypeToLocaleLowerCaseFn = String.prototype.toLocaleLowerCase;
const StringPrototypeToLowerCaseFn = String.prototype.toLowerCase;
const StringPrototypeTrimFn = String.prototype.trim;
const StringPrototypeTrimStartFn = String.prototype.trimStart;

export default {
  ArrayFrom: <T extends unknown>(...args: [items: Iterable<T> | ArrayLike<T>]): T[] =>
    ArrayFromFn.$apply(Array, args) as T[],
  ArrayPrototypeAt: <T extends unknown>(a: T[], i: number): T | undefined => ArrayPrototypeAtFn.$call(a, i),
  ArrayPrototypeFilter: <T extends unknown>(a: T[], fn: (value: T, index: number, array: T[]) => unknown): T[] =>
    ArrayPrototypeFilterFn.$call(a, fn),
  ArrayPrototypeForEach: <T extends unknown>(a: T[], fn: (value: T, index: number, array: T[]) => void): void =>
    ArrayPrototypeForEachFn.$call(a, fn),
  ArrayPrototypeIncludes: <T extends unknown>(a: T[], v: T, i?: number): boolean =>
    ArrayPrototypeIncludesFn.$call(a, v, i),
  ArrayPrototypeIndexOf: <T extends unknown>(a: T[], v: T, i?: number): number =>
    ArrayPrototypeIndexOfFn.$call(a, v, i),
  ArrayPrototypeJoin: (a: unknown[], s?: string): string => ArrayPrototypeJoinFn.$call(a, s),
  ArrayPrototypeMap: <T extends unknown, U>(a: T[], fn: (value: T, index: number, array: T[]) => U): U[] =>
    ArrayPrototypeMapFn.$call(a, fn) as U[],
  ArrayPrototypePop: <T extends unknown>(a: T[]): T | undefined => ArrayPrototypePopFn.$call(a),
  ArrayPrototypePush: <T extends unknown>(a: T[], ...items: T[]): number => ArrayPrototypePushFn.$apply(a, items),
  ArrayPrototypePushApply: <T extends unknown>(a: T[], items: T[]): number => ArrayPrototypePushFn.$apply(a, items),
  ArrayPrototypeReverse: <T extends unknown>(a: T[]): T[] => ArrayPrototypeReverseFn.$call(a),
  ArrayPrototypeShift: <T extends unknown>(a: T[]): T | undefined => ArrayPrototypeShiftFn.$call(a),
  ArrayPrototypeSlice: <T extends unknown>(a: T[], b?: number, e?: number): T[] => ArrayPrototypeSliceFn.$call(a, b, e),
  ArrayPrototypeSome: <T extends unknown>(a: T[], fn: (value: T, index: number, array: T[]) => unknown): boolean =>
    ArrayPrototypeSomeFn.$call(a, fn),
  ArrayPrototypeSort: <T extends unknown>(a: T[], fn?: (a: T, b: T) => number): T[] =>
    ArrayPrototypeSortFn.$call(a, fn),
  ArrayPrototypeSplice: <T extends unknown>(
    a: T[],
    ...args: [start: number, deleteCount: number, ...items: T[]]
  ): T[] => ArrayPrototypeSpliceFn.$apply(a, args),
  ArrayPrototypeToSorted: <T extends unknown>(a: T[], fn?: (a: T, b: T) => number): T[] =>
    ArrayPrototypeToSortedFn.$call(a, fn),
  ArrayPrototypeUnshift: <T extends unknown>(a: T[], ...items: T[]): number => ArrayPrototypeUnshiftFn.$apply(a, items),
  Boolean,
  DateNow: () => DateNowFn.$call(Date),
  Error,
  FunctionPrototypeBind: <This extends unknown, Args extends unknown[], Result>(
    fn: (this: This, ...args: Args) => Result,
    thisArg: This,
    ...args: unknown[]
  ): ((...args: Args) => Result) => {
    ArrayPrototypeUnshiftFn.$call(args, thisArg);
    return FunctionPrototypeBindFn.$apply(fn, args as [thisArg: unknown, ...args: unknown[]]);
  },
  FunctionPrototypeCall: <This extends unknown, Args extends unknown[], Result>(
    fn: (this: This, ...args: Args) => Result,
    thisArg: This,
    ...args: Args
  ) => fn.$apply(thisArg, args),
  JSONStringify: (...args: [value: unknown, replacer?: null, space?: string | number]): string =>
    JSONStringifyFn.$apply(JSON, args),
  MathCeil: Math.ceil,
  MathFloor: Math.floor,
  MathMax: Math.max,
  MathMaxApply: (args: number[]) => MathMaxFn.$apply(Math, args),
  MathMin: Math.min,
  Number,
  NumberIsFinite: Number.isFinite,
  NumberIsNaN: Number.isNaN,
  NumberParseFloat: Number.parseFloat,
  NumberParseInt: Number.parseInt,
  ObjectAssign: Object.assign,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectKeys: Object.keys,
  Promise,
  PromiseReject: (v: unknown) => PromiseRejectFn.$call(Promise, v) as Promise<never>,
  ReflectApply: <This extends unknown, Args extends unknown[], Result>(
    fn: (this: This, ...args: Args) => Result,
    thisArg: This,
    args: Args,
  ) => fn.$apply(thisArg, args),
  RegExp,
  RegExpPrototypeExec: (re: RegExp, s: string) => RegExpPrototypeExecFn.$call(re, s),
  RegExpPrototypeSymbolReplace: (re: RegExp, s: string, replacement: Replacement) =>
    RegExpPrototypeSymbolReplaceFn.$call(re, s, replacement),
  RegExpPrototypeSymbolSplit: (re: RegExp, s: string, limit?: number) =>
    RegExpPrototypeSymbolSplitFn.$call(re, s, limit),
  SafePromiseRace: <T extends unknown>(promises: (T | PromiseLike<T>)[]): Promise<Awaited<T>> =>
    PromiseRaceFn.$call(Promise, new SafeArrayIterator(promises)) as Promise<Awaited<T>>,
  SafeSet,
  SafeStringIterator,
  StringFromCharCode: String.fromCharCode,
  StringPrototypeCharAt: (s: string, i: number) => StringPrototypeCharAtFn.$call(s, i),
  StringPrototypeCharCodeAt: (s: string, i?: number) => StringPrototypeCharCodeAtFn.$call(s, i!),
  StringPrototypeCodePointAt: (s: string, i?: number) => StringPrototypeCodePointAtFn.$call(s, i!),
  StringPrototypeEndsWith: (s: string, v: string, e?: number) => StringPrototypeEndsWithFn.$call(s, v, e),
  StringPrototypeIncludes: (s: string, v: string, i?: number) => StringPrototypeIncludesFn.$call(s, v, i),
  StringPrototypeIndexOf: (s: string, v: string, i?: number) => StringPrototypeIndexOfFn.$call(s, v, i),
  StringPrototypeLastIndexOf: (s: string, v: string, i?: number) => StringPrototypeLastIndexOfFn.$call(s, v, i),
  StringPrototypeRepeat: (s: string, n: number) => StringPrototypeRepeatFn.$call(s, n),
  StringPrototypeReplaceAll: (s: string, a: string | RegExp, b: Replacement) =>
    StringPrototypeReplaceAllFn.$call(s, a, b),
  StringPrototypeSlice: (s: string, b?: number, e?: number) => StringPrototypeSliceFn.$call(s, b, e),
  StringPrototypeSplit: (s: string, sep: string | RegExp, limit?: number) =>
    StringPrototypeSplitFn.$call(s, sep, limit),
  StringPrototypeStartsWith: (s: string, v: string, i?: number) => StringPrototypeStartsWithFn.$call(s, v, i),
  StringPrototypeToLocaleLowerCase: (s: string) => StringPrototypeToLocaleLowerCaseFn.$call(s),
  StringPrototypeToLowerCase: (s: string) => StringPrototypeToLowerCaseFn.$call(s),
  StringPrototypeTrim: (s: string) => StringPrototypeTrimFn.$call(s),
  StringPrototypeTrimStart: (s: string) => StringPrototypeTrimStartFn.$call(s),
  Symbol,
  SymbolAsyncIterator: Symbol.asyncIterator,
  SymbolDispose: Symbol.dispose,
  SyntaxError,
};
