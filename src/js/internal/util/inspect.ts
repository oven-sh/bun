// @ts-check
// **TODO: delete this file**
// It is too much JavaScript. We should just fix the native implementation.
//
// This code is an adaptation of the Node.js internal implementation, mostly
// from the file lib/internal/util/inspect.js, which does not have the Joyent
// copyright header. The maintainers of this package will not assert copyright
// over this code, but will assign ownership to the Node.js contributors, with
// the same license as specified in the Node.js codebase; the portion adapted
// here should all be plain MIT license.
//
// Node.js is licensed for use as follows:
//
// Copyright Node.js contributors. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

let BufferModule;

const primordials = require("internal/primordials");
const {
  MapPrototypeGetSize,
  SafeMap,
  SafeSet,
  SetPrototypeGetSize,
  TypedArrayPrototypeGetLength,
  TypedArrayPrototypeGetSymbolToStringTag,
} = primordials;

const ArrayFrom = Array.from;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeFlat = Array.prototype.flat;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeMap = Array.prototype.map;
const ArrayPrototypePop = Array.prototype.pop;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypeSort = Array.prototype.sort;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const BigIntPrototypeValueOf = BigInt.prototype.valueOf;
const BooleanPrototypeValueOf = Boolean.prototype.valueOf;
const DatePrototypeGetTime = Date.prototype.getTime;
const DatePrototypeToISOString = Date.prototype.toISOString;
const DatePrototypeToString = Date.prototype.toString;
const ErrorPrototypeToString = Error.prototype.toString;
const FunctionPrototypeBind = Function.prototype.bind;
const FunctionPrototypeToString = Function.prototype.toString;
const JSONStringify = JSON.stringify;
const MapPrototypeEntries = Map.prototype.entries;
const MapPrototypeValues = Map.prototype.values;
const MapPrototypeKeys = Map.prototype.keys;
const MathFloor = Math.floor;
const MathMax = Math.max;
const MathRound = Math.round;
const MathSqrt = Math.sqrt;
const MathTrunc = Math.trunc;
const NumberIsFinite = Number.isFinite;
const NumberIsNaN = Number.isNaN;
const NumberParseFloat = Number.parseFloat;
const NumberParseInt = Number.parseInt;
const NumberPrototypeToString = Number.prototype.toString;
const NumberPrototypeValueOf = Number.prototype.valueOf;
const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectPrototypePropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const ObjectPrototypeToString = Object.prototype.toString;
const ObjectSeal = Object.seal;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeExec = RegExp.prototype.exec;
const RegExpPrototypeSymbolReplace: (
  this: RegExp,
  string: string,
  replaceValue: string | ((substring: string, ...args: any[]) => string),
) => string = RegExp.prototype[Symbol.replace] as any;
const RegExpPrototypeSymbolSplit = RegExp.prototype[Symbol.split];
const RegExpPrototypeToString = RegExp.prototype.toString;
const SetPrototypeEntries = Set.prototype.entries;
const SetPrototypeValues = Set.prototype.values;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeMatch = String.prototype.match;
const StringPrototypeNormalize = String.prototype.normalize;
const StringPrototypePadEnd = String.prototype.padEnd;
const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeRepeat = String.prototype.repeat;
const StringPrototypeReplaceAll: (this: string, searchValue: string | RegExp, replaceValue: string) => string =
  String.prototype.replaceAll;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit: (this: string, separator: string, limit?: number) => string[] = String.prototype.split;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
const StringPrototypeValueOf = String.prototype.valueOf;
const SymbolPrototypeToString = Symbol.prototype.toString;
const SymbolPrototypeValueOf = Symbol.prototype.valueOf;
const SymbolIterator = Symbol.iterator;
const SymbolToStringTag = Symbol.toStringTag;

const customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");
const kPending = Symbol("kPending"); // state ID 0
const kFulfilled = Symbol("kFulfilled"); // state ID 1
const kRejected = Symbol("kRejected"); // state ID 2
const ALL_PROPERTIES = 0;
const ONLY_ENUMERABLE = 2;

/**
 * Fast path for {@link extractedSplitNewLines} for ASCII/Latin1 strings.
 * @returns `value` split on newlines (newline included at end), or `undefined`
 * if non-ascii UTF8/UTF16.
 *
 * Passing this a non-string will cause a panic.
 *
 * @type {(value: string) => string[] | undefined}
 */
const extractedSplitNewLinesFastPathStringsOnly = $newRustFunction(
  "node_util_binding.rs",
  "extractedSplitNewLinesFastPathStringsOnly",
  1,
);

const isAsyncFunction = (v: unknown): boolean =>
  typeof v === "function" && StringPrototypeStartsWith.$call(FunctionPrototypeToString.$call(v), "async");
const generatorFunctionRegExp = /^(async\s+)?function *\*/;
const isGeneratorFunction = (v: unknown): boolean =>
  typeof v === "function" && StringPrototypeMatch.$call(FunctionPrototypeToString.$call(v), generatorFunctionRegExp) !== null;

const {
  //! The native versions of the commented out functions are currently buggy, so we use the polyfills above for now.
  //isAsyncFunction,
  //isGeneratorFunction,
  isAnyArrayBuffer,
  isArrayBuffer,
  isArgumentsObject,
  isBigIntObject,
  isBooleanObject,
  isBoxedPrimitive,
  isDataView,
  isExternal,
  isMapIterator,
  isModuleNamespaceObject,
  isNativeError,
  isNumberObject,
  isSetIterator,
  isStringObject,
  isWeakMap,
  isWeakSet,
  isDate,
} = require("node:util/types");

function assert(p: unknown, message?: string): void {
  if (!p) throw new (require("internal/errors").AssertionError)(message);
}

const { kValidateObjectAllowArray } = require("internal/validators");
const validateObject: typeof import("internal/validators").default.validateObject =
  require("internal/validators").validateObject;

const SymbolToPrimitive = Symbol.toPrimitive;

const ObjectConstructor = Object;
const ArrayConstructor = Array;
const FunctionConstructor = Function;
const MapConstructor = Map;
const SetConstructor = Set;
const ArrayBufferConstructor = ArrayBuffer;
const ObjectPrototype: object = Object.prototype;
const ArrayPrototype: object = Array.prototype;
const FunctionPrototype: object = Function.prototype;
const MapPrototype: object = Map.prototype;
const SetPrototype: object = Set.prototype;
const ArrayBufferPrototype: object = ArrayBuffer.prototype;

// Node.js computes this from `globalThis` at bootstrap, before any host globals
// (Buffer, URL, ...) are installed. Bun's globalThis already has them when this
// module loads, so hardcode the names Node observes instead of scraping.
// prettier-ignore
const builtInObjects = new SafeSet([
  "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array",
  "BigUint64Array", "Boolean", "DataView", "Date", "Error", "EvalError",
  "FinalizationRegistry", "Float32Array", "Float64Array", "Function", "Infinity",
  "Int16Array", "Int32Array", "Int8Array", "Intl", "Iterator", "JSON", "Map",
  "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError",
  "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol", "SyntaxError",
  "TypeError", "URIError", "Uint16Array", "Uint32Array", "Uint8Array",
  "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet",
]);

// https://tc39.es/ecma262/#sec-IsHTMLDDA-internal-slot
const isUndetectableObject = (v: unknown): boolean => typeof v === "undefined" && v !== undefined;

// This is used for detecting stack overflows during inspection.
// It will probably never need to be changed, but it's here just in case JSC does change the message.
const ERROR_STACK_OVERFLOW_MSG = "Maximum call stack size exceeded.";

// These options must stay in sync with `getUserOptions`. So if any option will
// be added or removed, `getUserOptions` must also be updated accordingly.
const inspectDefaultOptions: Record<string, unknown> = {
  showHidden: false,
  depth: 2,
  colors: false,
  customInspect: true,
  showProxy: false,
  maxArrayLength: 100,
  maxStringLength: 10000,
  breakLength: 80,
  compact: 3,
  sorted: false,
  getters: false,
  numericSeparator: false,
};
ObjectSeal(inspectDefaultOptions);
const inspectReplDefaults: Record<string, unknown> = {
  ...inspectDefaultOptions,
  colors: Bun.enableANSIColors,
  showProxy: true,
};
ObjectSeal(inspectReplDefaults);

const kObjectType = 0;
const kArrayType = 1;
const kArrayExtrasType = 2;

const strEscapeSequencesRegExp =
  /[\x00-\x1f\x27\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const strEscapeSequencesReplacer =
  /[\x00-\x1f\x27\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const strEscapeSequencesRegExpSingle =
  /[\x00-\x1f\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const strEscapeSequencesReplacerSingle =
  /[\x00-\x1f\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const extractedNewLineRe = /(?<=\n)/;
const extractedSplitNewLines = (value: string): string[] =>
  extractedSplitNewLinesFastPathStringsOnly(value) || RegExpPrototypeSymbolSplit.$call(extractedNewLineRe, value);

const keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const numberRegExp = /^(0|[1-9][0-9]*)$/;

const errorPrefixRegExp = /^Error: /;
const coreModuleRegExp = /^ {4}at (?:[^/\\(]+ \(|)node:(.+):\d+:\d+\)?$/;
const nodeModulesRegExp = /[/\\]node_modules[/\\](.+?)(?=[/\\])/g;

const classRegExp = /^(\s+[^(]*?)\s*{/;
const stripCommentsRegExp = /(\/\/.*?\n)|(\/\*(.|\n)*?\*\/)/g;

const kMinLineLength = 16;

// Constants to map the iterator state.
const kWeak = 0;
const kIterator = 1;
const kMapEntries = 2;

// Escaped control characters (plus the single quote and the backslash). Use
// empty strings to fill up unused entries.
const meta: string[] = [
  "\\x00",
  "\\x01",
  "\\x02",
  "\\x03",
  "\\x04",
  "\\x05",
  "\\x06",
  "\\x07", // x07
  "\\b",
  "\\t",
  "\\n",
  "\\x0B",
  "\\f",
  "\\r",
  "\\x0E",
  "\\x0F", // x0F
  "\\x10",
  "\\x11",
  "\\x12",
  "\\x13",
  "\\x14",
  "\\x15",
  "\\x16",
  "\\x17", // x17
  "\\x18",
  "\\x19",
  "\\x1A",
  "\\x1B",
  "\\x1C",
  "\\x1D",
  "\\x1E",
  "\\x1F", // x1F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\'",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "", // x2F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "", // x3F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "", // x4F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\\\",
  "",
  "",
  "", // x5F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "", // x6F
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\x7F", // x7F
  "\\x80",
  "\\x81",
  "\\x82",
  "\\x83",
  "\\x84",
  "\\x85",
  "\\x86",
  "\\x87", // x87
  "\\x88",
  "\\x89",
  "\\x8A",
  "\\x8B",
  "\\x8C",
  "\\x8D",
  "\\x8E",
  "\\x8F", // x8F
  "\\x90",
  "\\x91",
  "\\x92",
  "\\x93",
  "\\x94",
  "\\x95",
  "\\x96",
  "\\x97", // x97
  "\\x98",
  "\\x99",
  "\\x9A",
  "\\x9B",
  "\\x9C",
  "\\x9D",
  "\\x9E",
  "\\x9F", // x9F
];

interface Context {
  budget: number[] | undefined;
  indentationLvl: number;
  seen: unknown[] | undefined;
  currentDepth: number;
  stylize: unknown;
  showHidden: unknown;
  depth: unknown;
  colors: unknown;
  customInspect: unknown;
  showProxy: unknown;
  maxArrayLength: unknown;
  maxStringLength: unknown;
  breakLength: unknown;
  compact: unknown;
  sorted: unknown;
  getters: unknown;
  numericSeparator: unknown;
  userOptions: unknown;
  circular: Map<unknown, number> | undefined;
  seenRefs: Set<number> | undefined;
  isPlain: boolean;
  userContext: Record<string, any> | undefined;
}

function getUserContext(ctx: Context): Record<string, any> {
  let object = ctx.userContext;
  if (object === undefined) {
    const created: Record<string, any> = {
      budget: {},
      indentationLvl: 0,
      seen: [],
      currentDepth: 0,
      stylize: undefined,
      showHidden: undefined,
      depth: undefined,
      colors: undefined,
      customInspect: undefined,
      showProxy: undefined,
      maxArrayLength: undefined,
      maxStringLength: undefined,
      breakLength: undefined,
      compact: undefined,
      sorted: undefined,
      getters: undefined,
      numericSeparator: undefined,
    };
    object = ctx.userContext = created;
  }
  const budget = ctx.budget;
  if (budget !== undefined) {
    for (let i = 0; i < budget.length; i++) {
      if (budget[i]) object.budget[i] = budget[i];
    }
  }
  object.indentationLvl = ctx.indentationLvl;
  const seen = ctx.seen;
  object.seen.length = 0;
  if (seen !== undefined) {
    for (let i = 0; i < seen.length; i++) object.seen[i] = seen[i];
  }
  object.currentDepth = ctx.currentDepth;
  object.stylize = ctx.stylize;
  object.showHidden = ctx.showHidden;
  object.depth = ctx.depth;
  object.colors = ctx.colors;
  object.customInspect = ctx.customInspect;
  object.showProxy = ctx.showProxy;
  object.maxArrayLength = ctx.maxArrayLength;
  object.maxStringLength = ctx.maxStringLength;
  object.breakLength = ctx.breakLength;
  object.compact = ctx.compact;
  object.sorted = ctx.sorted;
  object.getters = ctx.getters;
  object.numericSeparator = ctx.numericSeparator;
  if (ctx.userOptions !== undefined) object.userOptions = ctx.userOptions;
  if (ctx.circular !== undefined) object.circular = ctx.circular;
  if (ctx.seenRefs !== undefined) object.seenRefs = ctx.seenRefs;
  return object;
}

function stylizeByUser(ctx: Context, str: unknown, styleType: string): unknown {
  const object = getUserContext(ctx);
  const result = (ctx.stylize as any).$call(object, str, styleType);
  if (typeof object.indentationLvl === "number") ctx.indentationLvl = object.indentationLvl;
  if (typeof object.currentDepth === "number") ctx.currentDepth = object.currentDepth;
  ctx.stylize = object.stylize;
  ctx.isPlain = object.stylize === stylizeNoColor;
  ctx.showHidden = object.showHidden;
  ctx.depth = object.depth;
  ctx.colors = object.colors;
  ctx.customInspect = object.customInspect;
  ctx.showProxy = object.showProxy;
  ctx.maxArrayLength = object.maxArrayLength;
  ctx.maxStringLength = object.maxStringLength;
  ctx.breakLength = object.breakLength;
  ctx.compact = object.compact;
  ctx.sorted = object.sorted;
  ctx.getters = object.getters;
  ctx.numericSeparator = object.numericSeparator;
  return result;
}

function stylize(ctx: Context, str: unknown, styleType: string): unknown {
  if (ctx.isPlain) return str;
  if (ctx.stylize === stylizeWithColor) return stylizeWithColor(str, styleType);
  return stylizeByUser(ctx, str, styleType);
}

let withoutLineBreak = "";
let outputWithoutLineBreak: unknown[] | undefined;

function isWithoutLineBreak(str: unknown): boolean {
  return typeof str === "string" && str === withoutLineBreak;
}

function getUserOptions(ctx: Context, isCrossContext: boolean): Record<string, unknown> {
  const ret: Record<string, unknown> = {
    stylize: ctx.stylize,
    showHidden: ctx.showHidden,
    depth: ctx.depth,
    colors: ctx.colors,
    customInspect: ctx.customInspect,
    showProxy: ctx.showProxy,
    maxArrayLength: ctx.maxArrayLength,
    maxStringLength: ctx.maxStringLength,
    breakLength: ctx.breakLength,
    compact: ctx.compact,
    sorted: ctx.sorted,
    getters: ctx.getters,
    numericSeparator: ctx.numericSeparator,
    ...(ctx.userOptions as any),
  };

  // Typically, the target value will be an instance of `Object`. If that is
  // *not* the case, the object may come from another vm.Context, and we want
  // to avoid passing it objects from this Context in that case, so we remove
  // the prototype from the returned object itself + the `stylize()` function,
  // and remove all other non-primitives, including non-primitive user options.
  if (isCrossContext) {
    ObjectSetPrototypeOf(ret, null);
    for (const key of ObjectKeys(ret)) {
      if ((typeof ret[key] === "object" || typeof ret[key] === "function") && ret[key] !== null) {
        delete ret[key];
      }
    }
    ret.stylize = ObjectSetPrototypeOf((value, flavour) => {
      let stylized: unknown;
      try {
        stylized = `${stylize(ctx, value, flavour)}`;
      } catch {
        // Continue regardless of error.
      }

      if (typeof stylized !== "string") return value;
      // `stylized` is a string as it should be, which is safe to pass along.
      return stylized;
    }, null);
  }

  return ret;
}

/**
 * Echos the value of any input. Tries to print the value out
 * in the best way possible given the different types.
 * @param {any} value The value to print out.
 * @param {object} opts Optional options object that alters the output.
 */
/* Legacy: value, showHidden, depth, colors */
function inspect(value?: unknown, opts?: unknown, legacyDepth: unknown = undefined, legacyColors: unknown = undefined): any {
  if (
    opts === undefined &&
    ((typeof value !== "object" && typeof value !== "function") || value === null) &&
    legacyDepth === undefined &&
    legacyColors === undefined &&
    !inspectDefaultOptions.colors &&
    !isUndetectableObject(value)
  ) {
    if (typeof value === "number") return numberToString(value, inspectDefaultOptions.numericSeparator);
    if (typeof value === "string") {
      const maxStringLength = inspectDefaultOptions.maxStringLength;
      const result = formatString(
        stylizeNoColor,
        value,
        maxStringLength === null ? Infinity : maxStringLength,
        inspectDefaultOptions.compact,
        inspectDefaultOptions.breakLength,
        0,
      );
      withoutLineBreak = "";
      return result;
    }
    if (typeof value === "bigint") return bigIntToString(value, inspectDefaultOptions.numericSeparator);
    if (typeof value === "symbol") return SymbolPrototypeToString.$call(value);
    return `${value}`;
  }
  // Default options
  const ctx: Context = {
    budget: undefined,
    indentationLvl: 0,
    seen: undefined,
    currentDepth: 0,
    stylize: stylizeNoColor,
    showHidden: inspectDefaultOptions.showHidden,
    depth: inspectDefaultOptions.depth,
    colors: inspectDefaultOptions.colors,
    customInspect: inspectDefaultOptions.customInspect,
    showProxy: inspectDefaultOptions.showProxy,
    maxArrayLength: inspectDefaultOptions.maxArrayLength,
    maxStringLength: inspectDefaultOptions.maxStringLength,
    breakLength: inspectDefaultOptions.breakLength,
    compact: inspectDefaultOptions.compact,
    sorted: inspectDefaultOptions.sorted,
    getters: inspectDefaultOptions.getters,
    numericSeparator: inspectDefaultOptions.numericSeparator,
    userOptions: undefined,
    circular: undefined,
    seenRefs: undefined,
    isPlain: true,
    userContext: undefined,
  };
  // Legacy...
  if (legacyDepth !== undefined) {
    ctx.depth = legacyDepth;
  }
  if (legacyColors !== undefined) {
    ctx.colors = legacyColors;
  }
  // Set user-specified options
  if (typeof opts === "boolean") {
    ctx.showHidden = opts;
  } else if (opts) {
    setUserOptions(ctx, opts);
  }
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  ctx.isPlain = ctx.stylize === stylizeNoColor;
  if (ctx.maxArrayLength === null) ctx.maxArrayLength = Infinity;
  if (ctx.maxStringLength === null) ctx.maxStringLength = Infinity;
  const result = formatValue(ctx, value, 0);
  withoutLineBreak = "";
  outputWithoutLineBreak = undefined;
  return result;
}

function setUserOptions(ctx: Context, opts: any): void {
  const optKeys = ObjectKeys(opts);
  for (let i = 0; i < optKeys.length; ++i) {
    // TODO(BridgeAR): Find a solution what to do about stylize. Either make
    // this function public or add a new API with a similar or better
    // functionality.
    switch (optKeys[i]) {
      case "depth":
        ctx.depth = opts.depth;
        break;
      case "colors":
        ctx.colors = opts.colors;
        break;
      case "compact":
        ctx.compact = opts.compact;
        break;
      case "breakLength":
        ctx.breakLength = opts.breakLength;
        break;
      case "showHidden":
        ctx.showHidden = opts.showHidden;
        break;
      case "customInspect":
        ctx.customInspect = opts.customInspect;
        break;
      case "showProxy":
        ctx.showProxy = opts.showProxy;
        break;
      case "maxArrayLength":
        ctx.maxArrayLength = opts.maxArrayLength;
        break;
      case "maxStringLength":
        ctx.maxStringLength = opts.maxStringLength;
        break;
      case "sorted":
        ctx.sorted = opts.sorted;
        break;
      case "getters":
        ctx.getters = opts.getters;
        break;
      case "numericSeparator":
        ctx.numericSeparator = opts.numericSeparator;
        break;
      case "stylize":
        ctx.stylize = opts.stylize;
        break;
      default:
        // This is required to pass through the actual user input.
        if (ctx.userOptions === undefined) ctx.userOptions = opts;
    }
  }
}
const inspectAsObject: any = inspect;
inspectAsObject.custom = customInspectSymbol;

const defaultOptionsDescriptor: Record<string, unknown> = {
  __proto__: null,
  get() {
    return inspectDefaultOptions;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectDefaultOptions, options);
  },
};
ObjectDefineProperty(inspect, "defaultOptions", defaultOptionsDescriptor);
const replDefaultsDescriptor: Record<string, unknown> = {
  __proto__: null,
  get() {
    return inspectReplDefaults;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectReplDefaults, options);
  },
  // node:repl re-defines this property with its own writer-backed accessor
  // (see REPLServer constructor); keep it configurable so that works.
  configurable: true,
};
ObjectDefineProperty(inspect, "replDefaults", replDefaultsDescriptor);

// Set Graphics Rendition https://en.wikipedia.org/wiki/ANSI_escape_code#graphics
// Each color consists of an array with the color code as first entry and the
// reset code as second entry.
const defaultFG = 39;
const defaultBG = 49;
const colors: Record<string, any> = {
  __proto__: null,
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22], // Alias: faint
  italic: [3, 23],
  underline: [4, 24],
  blink: [5, 25],
  // Swap foreground and background colors
  inverse: [7, 27], // Alias: swapcolors, swapColors
  hidden: [8, 28], // Alias: conceal
  strikethrough: [9, 29], // Alias: strikeThrough, crossedout, crossedOut
  doubleunderline: [21, 24], // Alias: doubleUnderline
  black: [30, defaultFG],
  red: [31, defaultFG],
  green: [32, defaultFG],
  yellow: [33, defaultFG],
  blue: [34, defaultFG],
  magenta: [35, defaultFG],
  cyan: [36, defaultFG],
  white: [37, defaultFG],
  bgBlack: [40, defaultBG],
  bgRed: [41, defaultBG],
  bgGreen: [42, defaultBG],
  bgYellow: [43, defaultBG],
  bgBlue: [44, defaultBG],
  bgMagenta: [45, defaultBG],
  bgCyan: [46, defaultBG],
  bgWhite: [47, defaultBG],
  framed: [51, 54],
  overlined: [53, 55],
  gray: [90, defaultFG], // Alias: grey, blackBright
  redBright: [91, defaultFG],
  greenBright: [92, defaultFG],
  yellowBright: [93, defaultFG],
  blueBright: [94, defaultFG],
  magentaBright: [95, defaultFG],
  cyanBright: [96, defaultFG],
  whiteBright: [97, defaultFG],
  bgGray: [100, defaultBG], // Alias: bgGrey, bgBlackBright
  bgRedBright: [101, defaultBG],
  bgGreenBright: [102, defaultBG],
  bgYellowBright: [103, defaultBG],
  bgBlueBright: [104, defaultBG],
  bgMagentaBright: [105, defaultBG],
  bgCyanBright: [106, defaultBG],
  bgWhiteBright: [107, defaultBG],
};
inspectAsObject.colors = colors;

function defineColorAlias(target: string, alias: string): void {
  const descriptor: Record<string, unknown> = {
    __proto__: null,
    get(this: any) {
      return this[target];
    },
    set(this: any, value) {
      this[target] = value;
    },
    configurable: true,
    enumerable: false,
  };
  ObjectDefineProperty(colors, alias, descriptor);
}

defineColorAlias("gray", "grey");
defineColorAlias("gray", "blackBright");
defineColorAlias("bgGray", "bgGrey");
defineColorAlias("bgGray", "bgBlackBright");
defineColorAlias("dim", "faint");
defineColorAlias("strikethrough", "crossedout");
defineColorAlias("strikethrough", "strikeThrough");
defineColorAlias("strikethrough", "crossedOut");
defineColorAlias("hidden", "conceal");
defineColorAlias("inverse", "swapColors");
defineColorAlias("inverse", "swapcolors");
defineColorAlias("doubleunderline", "doubleUnderline");

// TODO(BridgeAR): Add function style support for more complex styles.
// Don't use 'blue' not visible on cmd.exe
const styles: Record<string, any> = {
  __proto__: null,
  special: "cyan",
  number: "yellow",
  bigint: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  symbol: "green",
  date: "magenta",
  // "name": intentionally not styling
  regexp: highlightRegExp,
  module: "underline",
};
inspectAsObject.styles = styles;

// Define the palette for RegExp group depth highlighting. Can be changed by users.
const highlightRegExpAsObject: any = highlightRegExp;
highlightRegExpAsObject.colors = ["green", "red", "yellow", "cyan", "magenta"];

const highlightRegExpColors: string[] = ["green", "red", "yellow", "cyan", "magenta"];

function addQuotes(str: string, quotes: number): string {
  if (quotes === -1) {
    return `"${str}"`;
  }
  if (quotes === -2) {
    return `\`${str}\``;
  }
  return `'${str}'`;
}

function escapeFn(str: string): string {
  const charCode = StringPrototypeCharCodeAt.$call(str, 0);
  return meta.length > charCode ? meta[charCode] : `\\u${NumberPrototypeToString.$call(charCode, 16)}`;
}

// Escape control characters, single quotes and the backslash.
// This is similar to JSON stringify escaping.
function isPlainString(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const point = StringPrototypeCharCodeAt.$call(str, i);
    if (point < 32 || point === 39 || point === 92 || (point > 126 && (point < 160 || (point >= 0xd800 && point <= 0xdfff)))) {
      return false;
    }
  }
  return true;
}

function isIdentifier(str: string): boolean {
  const length = str.length;
  if (length === 0) return false;
  for (let i = 0; i < length; i++) {
    const point = StringPrototypeCharCodeAt.$call(str, i);
    if (
      !(
        (point >= 97 && point <= 122) ||
        (point >= 65 && point <= 90) ||
        point === 95 ||
        (point >= 48 && point <= 57 && i !== 0)
      )
    ) {
      return false;
    }
  }
  return true;
}

function strEscape(str: string): string {
  if (str.length < 64 && isPlainString(str)) return `'${str}'`;

  let escapeTest = strEscapeSequencesRegExp;
  let escapeReplace = strEscapeSequencesReplacer;
  let singleQuote = 39;

  // Check for double quotes. If not present, do not escape single quotes and
  // instead wrap the text in double quotes. If double quotes exist, check for
  // backticks. If they do not exist, use those as fallback instead of the
  // double quotes.
  if (StringPrototypeIncludes.$call(str, "'")) {
    // This invalidates the charCode and therefore can not be matched for
    // anymore.
    if (!StringPrototypeIncludes.$call(str, '"')) {
      singleQuote = -1;
    } else if (!StringPrototypeIncludes.$call(str, "`") && !StringPrototypeIncludes.$call(str, "${")) {
      singleQuote = -2;
    }
    if (singleQuote !== 39) {
      escapeTest = strEscapeSequencesRegExpSingle;
      escapeReplace = strEscapeSequencesReplacerSingle;
    }
  }

  // Some magic numbers that worked out fine while benchmarking with v8 6.0
  if (str.length < 5000 && RegExpPrototypeExec.$call(escapeTest, str) === null) return addQuotes(str, singleQuote);
  if (str.length > 100) {
    str = RegExpPrototypeSymbolReplace.$call(escapeReplace, str, escapeFn);
    return addQuotes(str, singleQuote);
  }

  let result = "";
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const point = StringPrototypeCharCodeAt.$call(str, i);
    if (point === singleQuote || point === 92 || point < 32 || (point > 126 && point < 160)) {
      if (last === i) {
        result += meta[point];
      } else {
        result += `${StringPrototypeSlice.$call(str, last, i)}${meta[point]}`;
      }
      last = i + 1;
    } else if (point >= 0xd800 && point <= 0xdfff) {
      if (point <= 0xdbff && i + 1 < str.length) {
        const point = StringPrototypeCharCodeAt.$call(str, i + 1);
        if (point >= 0xdc00 && point <= 0xdfff) {
          i++;
          continue;
        }
      }
      result += `${StringPrototypeSlice.$call(str, last, i)}\\u${NumberPrototypeToString.$call(point, 16)}`;
      last = i + 1;
    }
  }

  if (last !== str.length) {
    result += StringPrototypeSlice.$call(str, last);
  }
  return addQuotes(result, singleQuote);
}

function highlightRegExp(regexpString) {
  const length: any = regexpString.length;
  let out = "";
  let i = 0;
  let depth = 0;
  let inClass = false;

  // Verify palette and update cache if user changed colors
  const paletteNames: any = highlightRegExpAsObject.colors?.length > 0 ? highlightRegExpAsObject.colors : highlightRegExpColors;

  const palette: string[][] = [];
  for (const name of paletteNames) {
    const color = inspectAsObject.colors[name];
    if (color) palette.push([`\u001b[${color[0]}m`, `\u001b[${color[1]}m`]);
  }

  function writeGroup(start, end, decreaseDepth = 1): void {
    let seq = "";
    i++;
    // Only checking for the closing delimiter is a fast heuristic for regular
    // expressions without the u or v flag. A safer check would verify that the
    // read characters are all alphanumeric.
    while (i < length && regexpString[i] !== end) {
      seq += regexpString[i++];
    }
    if (i < length) {
      depth -= decreaseDepth;
      write(start);
      writeDepth(seq, 1, 1);
      write(end);
      depth += decreaseDepth;
    } else {
      // The group is not closed which would lead to mistakes in the output.
      // This is a workaround to prevent output from being corrupted.
      writeDepth(start, 1, -seq.length);
    }
  }

  function write(str): void {
    const idx = depth % palette.length;
    // Safeguard against bugs in the implementation.
    const color = palette[idx] ?? palette[0];
    out += color[0] + str + color[1];
  }

  function writeDepth(str, incDepth: number, incI: number): void {
    depth += incDepth;
    write(str);
    depth -= incDepth;
    i += incI;
  }

  // Opening '/'
  write("/");
  depth++;
  i = 1;

  // Parse pattern until next unescaped '/'
  while (i < length) {
    const ch = regexpString[i];

    if (inClass) {
      if (ch === "\\") {
        let seq = "\\";
        i++;
        if (i < length) {
          seq += regexpString[i++];
          const next = seq[1];
          if (next === "u" && regexpString[i] === "{") {
            writeGroup(`${seq}{`, "}", 0);
            continue;
          } else if ((next === "p" || next === "P") && regexpString[i] === "{") {
            writeGroup(`${seq}{`, "}", 0);
            continue;
          } else if (seq[1] === "x") {
            seq += regexpString.slice(i, i + 2);
            i += 2;
          }
        }
        write(seq);
      } else if (ch === "]") {
        depth--;
        write("]");
        i++;
        inClass = false;
      } else if (ch === "-" && regexpString[i - 1] !== "[" && i + 1 < length && regexpString[i + 1] !== "]") {
        writeDepth("-", 1, 1);
      } else {
        write(ch);
        i++;
      }
    } else if (ch === "[") {
      // Enter class
      write("[");
      depth++;
      i++;
      inClass = true;
    } else if (ch === "(") {
      write("(");
      depth++;
      i++;
      if (i < length && regexpString[i] === "?") {
        // Assertions and named groups
        i++;
        const a = i < length ? regexpString[i] : "";
        if (a === ":" || a === "=" || a === "!") {
          writeDepth(`?${a}`, -1, 1);
        } else {
          const b = i + 1 < length ? regexpString[i + 1] : "";
          if (a === "<" && (b === "=" || b === "!")) {
            writeDepth(`?<${b}`, -1, 2);
          } else if (a === "<") {
            // Named capture: write '?<name>' as a single colored token
            i++; // consume '<'
            const start = i;
            while (i < length && regexpString[i] !== ">") {
              i++;
            }
            const name = regexpString.slice(start, i);
            if (i < length && regexpString[i] === ">") {
              depth--;
              write("?<");
              writeDepth(name, 1, 0);
              write(">");
              depth++;
              i++;
            } else {
              writeDepth("?<", -1, 0);
              write(name);
            }
          } else {
            write("?");
          }
        }
      }
    } else if (ch === ")") {
      depth--;
      write(")");
      i++;
    } else if (ch === "\\") {
      let seq = "\\";
      i++;
      if (i < length) {
        seq += regexpString[i++];
        const next = seq[1];
        if (i < length) {
          if (next === "u" && regexpString[i] === "{") {
            writeGroup(`${seq}{`, "}", 0);
            continue;
          } else if (next === "x") {
            seq += regexpString.slice(i, i + 2);
            i += 2;
          } else if (next >= "0" && next <= "9") {
            while (i < length && regexpString[i] >= "0" && regexpString[i] <= "9") {
              seq += regexpString[i++];
            }
          } else if (next === "k" && regexpString[i] === "<") {
            writeGroup(`${seq}<`, ">");
            continue;
          } else if ((next === "p" || next === "P") && regexpString[i] === "{") {
            // Unicode properties
            writeGroup(`${seq}{`, "}", 0);
            continue;
          }
        }
      }
      writeDepth(seq, 1, 0);
    } else if (ch === "|" || ch === "+" || ch === "*" || ch === "?" || ch === "," || ch === "^" || ch === "$") {
      writeDepth(ch, 3, 1);
    } else if (ch === "{") {
      i++;
      let digits = "";
      while (i < length && regexpString[i] >= "0" && regexpString[i] <= "9") {
        digits += regexpString[i++];
      }
      if (digits) {
        write("{");
        depth++;
        writeDepth(digits, 1, 0);
      }
      if (i < length) {
        if (regexpString[i] === ",") {
          if (!digits) {
            write("{");
            depth++;
          }
          write(",");
          i++;
        } else if (!digits) {
          depth += 1;
          write("{");
          depth -= 1;
          continue;
        }
      }
      let digits2 = "";
      while (i < length && regexpString[i] >= "0" && regexpString[i] <= "9") {
        digits2 += regexpString[i++];
      }
      if (digits2) {
        writeDepth(digits2, 1, 0);
      }
      if (i < length && regexpString[i] === "}") {
        depth--;
        write("}");
        i++;
      }
      if (i < length && regexpString[i] === "?") {
        writeDepth("?", 3, 1);
      }
    } else if (ch === ".") {
      writeDepth(ch, 2, 1);
    } else if (ch === "/") {
      // Stop at closing delimiter (unescaped, outside of character class)
      break;
    } else {
      writeDepth(ch, 1, 1);
    }
  }

  // Closing delimiter and flags
  writeDepth("/", -1, 1);
  if (i < length) {
    write(regexpString.slice(i));
  }
  return out;
}

function stylizeWithColor(str, styleType) {
  const style = inspectAsObject.styles[styleType];
  if (style !== undefined) {
    // Checked first: a function style (regexp) would otherwise be stringified
    // into a property key on every lookup.
    if (typeof style === "function") return style(str);
    const color = inspectAsObject.colors[style];
    if (color !== undefined) return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
  }
  return str;
}

function stylizeNoColor(str) {
  return str;
}

function isInstanceof(object: unknown, proto: any): boolean {
  try {
    return object instanceof proto;
  } catch {
    return false;
  }
}

// Special-case for some builtin prototypes in case their `constructor` property has been tampered.
function getWellKnownPrototypeName(obj: unknown): string | undefined {
  if (obj === ObjectPrototype) return "Object";
  if (obj === ArrayPrototype) return "Array";
  if (obj === FunctionPrototype) return "Function";
  if (obj === MapPrototype) return "Map";
  if (obj === SetPrototype) return "Set";
  if (obj === ArrayBufferPrototype) return "ArrayBuffer";
  return undefined;
}

function getWellKnownConstructor(name: string): any {
  switch (name) {
    case "Object":
      return ObjectConstructor;
    case "Array":
      return ArrayConstructor;
    case "Function":
      return FunctionConstructor;
    case "Map":
      return MapConstructor;
    case "Set":
      return SetConstructor;
    default:
      return ArrayBufferConstructor;
  }
}

function getConstructorName(obj: any, ctx: Context, recurseTimes: number, protoProps: unknown[] | undefined): string | null {
  let firstProto: any;
  const tmp = obj;
  while (obj || isUndetectableObject(obj)) {
    const name = getWellKnownPrototypeName(obj);
    if (name !== undefined) {
      if (tmp instanceof getWellKnownConstructor(name)) {
        if (protoProps !== undefined && firstProto !== obj) {
          addPrototypeProperties(ctx, tmp, firstProto || tmp, recurseTimes, protoProps);
        }
        return name;
      }
    }
    const descriptor =
      $isProxyObject(obj) || ObjectHasOwn(obj, "constructor")
        ? ObjectGetOwnPropertyDescriptor(obj, "constructor")
        : undefined;
    const descriptorValue: unknown = descriptor !== undefined ? descriptor.value : undefined;
    if (typeof descriptorValue === "function") {
      const descriptorValueName: unknown = descriptorValue.name;
      if (descriptorValueName !== "" && isInstanceof(tmp, descriptorValue)) {
        if (protoProps !== undefined && (firstProto !== obj || !builtInObjects.has(descriptorValueName))) {
          addPrototypeProperties(ctx, tmp, firstProto || tmp, recurseTimes, protoProps);
        }
        return String(descriptorValueName);
      }
    }

    obj = ObjectGetPrototypeOf(obj);
    if (firstProto === undefined) {
      firstProto = obj;
    }
  }

  if (firstProto === null) {
    return null;
  }

  const res = internalGetConstructorName(tmp);

  if (isBeyondDepth(ctx, recurseTimes)) {
    return `${res} <Complex prototype>`;
  }

  const protoConstr = getConstructorName(firstProto, ctx, recurseTimes + 1, protoProps);

  if (protoConstr === null) {
    return `${res} <${inspect(firstProto, {
      ...getUserContext(ctx),
      customInspect: false,
      depth: -1,
    })}>`;
  }

  return `${res} <${protoConstr}>`;
}

function pushSeen(ctx: Context, value: unknown): void {
  const seen = ctx.seen;
  if (seen === undefined) ctx.seen = [value];
  else ArrayPrototypePush.$call(seen, value);
}

function addToBudget(ctx: Context, length: number): number {
  let budget = ctx.budget;
  if (budget === undefined) budget = ctx.budget = [0, 0, 0, 0, 0, 0, 0, 0];
  const indentationLvl = ctx.indentationLvl;
  const newLength = (budget[indentationLvl] || 0) + length;
  budget[indentationLvl] = newLength;
  return newLength;
}

function isBeyondDepth(ctx: Context, recurseTimes: number): boolean {
  const depth = ctx.depth;
  return typeof depth === "number" ? recurseTimes > depth : recurseTimes > (depth as any) && depth !== null;
}

// This function has the side effect of adding prototype properties to the
// `output` argument (which is an array). This is intended to highlight user
// defined prototype properties.
function addPrototypeProperties(ctx: Context, main: any, obj: any, recurseTimes: number, output: unknown[]): void {
  let depth = 0;
  let keys: any;
  let keySet: any;
  do {
    if (depth !== 0 || main === obj) {
      obj = ObjectGetPrototypeOf(obj);
      // Stop as soon as a null prototype is encountered.
      if (obj === null) {
        return;
      }
      // Stop as soon as a built-in object type is detected.
      const descriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
      if (
        descriptor !== undefined &&
        typeof descriptor.value === "function" &&
        builtInObjects.has(descriptor.value.name)
      ) {
        return;
      }
    }

    if (depth === 0) {
      keySet = new SafeSet();
    } else {
      ArrayPrototypeForEach.$call(keys, key => keySet.add(key));
    }
    // Get all own property names and symbols.
    keys = ReflectOwnKeys(obj);
    pushSeen(ctx, main);
    for (const key of keys) {
      // Ignore the `constructor` property and keys that exist on layers above.
      if (key === "constructor" || ObjectHasOwn(main, key) || (depth !== 0 && keySet.has(key))) {
        continue;
      }
      const desc: any = ObjectGetOwnPropertyDescriptor(obj, key);
      if (typeof desc.value === "function") {
        continue;
      }
      const value = formatProperty(ctx, obj, recurseTimes, key, kObjectType, desc, main);
      if (ctx.colors) {
        // Faint!
        ArrayPrototypePush.$call(output, `\u001b[2m${value}\u001b[22m`);
      } else {
        ArrayPrototypePush.$call(output, value);
      }
    }
    ArrayPrototypePop.$call(ctx.seen!);
    // Limit the inspection to up to three prototype layers. Using `recurseTimes`
    // is not a good choice here, because it's as if the properties are declared
    // on the current object from the users perspective.
  } while (++depth !== 3);
}

function getPrefix(constructor: string | null, tag: string, fallback: unknown, size = ""): string {
  if (constructor === null) {
    if (tag !== "" && fallback !== tag) {
      return `[${fallback}${size}: null prototype] [${tag}] `;
    }
    return `[${fallback}${size}: null prototype] `;
  }

  if (tag !== "" && constructor !== tag) {
    return `${constructor}${size} [${tag}] `;
  }
  return `${constructor}${size} `;
}

// Look up the keys of the object.
function getKeys(value: any, showHidden: unknown): PropertyKey[] {
  let keys: PropertyKey[];
  const symbols = ObjectGetOwnPropertySymbols(value);
  if (showHidden) {
    keys = ObjectGetOwnPropertyNames(value);
    if (symbols.length !== 0) ArrayPrototypePush.$apply(keys, symbols);
  } else {
    // This might throw if `value` is a Module Namespace Object from an
    // unevaluated module, but we don't want to perform the actual type
    // check because it's expensive.
    // TODO(devsnek): track https://github.com/tc39/ecma262/issues/1209
    // and modify this logic as needed.
    try {
      keys = ObjectKeys(value);
    } catch (err: any) {
      assert(isNativeError(err) && err.name === "ReferenceError" && isModuleNamespaceObject(value));
      keys = ObjectGetOwnPropertyNames(value);
    }
    if (symbols.length !== 0) {
      const filter = (key: symbol): boolean => ObjectPrototypePropertyIsEnumerable.$call(value, key);
      ArrayPrototypePush.$apply(keys, ArrayPrototypeFilter.$call(symbols, filter));
    }
  }
  return keys;
}

function getCtxStyle(value: unknown, constructor: string | null, tag: string): string {
  let fallback: unknown = "";
  if (constructor === null) {
    fallback = internalGetConstructorName(value);
    if (fallback === tag) {
      fallback = "Object";
    }
  }
  return getPrefix(constructor, tag, fallback);
}

function formatProxy(ctx: Context, proxy: unknown[], recurseTimes: number): unknown {
  if (isBeyondDepth(ctx, recurseTimes)) {
    return stylize(ctx, "Proxy [Array]", "special");
  }
  recurseTimes += 1;
  ctx.indentationLvl += 2;
  const res = [formatValue(ctx, proxy[0], recurseTimes), formatValue(ctx, proxy[1], recurseTimes)];
  ctx.indentationLvl -= 2;
  return reduceToSingleString(ctx, res, "", ["Proxy [", "]"], kArrayExtrasType, recurseTimes);
}

// Note: using `formatValue` directly requires the indentation level to be
// corrected by setting `ctx.indentationLvL += diff` and then to decrease the
// value afterwards again.
function formatValue(ctx: Context, value: any, recurseTimes: number, typedArray?: unknown): unknown {
  // Primitive types cannot have properties.
  if (typeof value !== "object" && typeof value !== "function" && !isUndetectableObject(value)) {
    return formatPrimitive(ctx.stylize, value, ctx);
  }
  if (value === null) {
    if (ctx.isPlain) return (withoutLineBreak = "null");
    return stylize(ctx, "null", "null");
  }

  // Memorize the context for custom inspection on proxies.
  const context = value;
  // Always check for proxies to prevent side effects and to prevent triggering
  // any proxy handlers.
  let proxy: any;
  const object: unknown = value;
  if ($isProxyObject(object)) {
    proxy = getProxyDetails(value, !!ctx.showProxy);
    if (proxy === null || proxy[0] === null) {
      return stylize(ctx, "<Revoked Proxy>", "special");
    }
    if (ctx.showProxy) {
      return formatProxy(ctx, proxy, recurseTimes);
    }
    value = proxy;
  }

  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it.
  if (ctx.customInspect) {
    const maybeCustom = value[customInspectSymbol];
    if (
      typeof maybeCustom === "function" &&
      // Filter out the util module, its inspect function is special.
      maybeCustom !== inspect &&
      // Also filter out any prototype objects using the circular check.
      Object.getOwnPropertyDescriptor(value, "constructor")?.value?.prototype !== value
    ) {
      // This makes sure the recurseTimes are reported as before while using
      // a counter internally.
      const depth = ctx.depth === null ? null : (ctx.depth as any) - recurseTimes;
      const isCrossContext = proxy !== undefined || !(context instanceof Object);
      const ret = maybeCustom.$call(context, depth, getUserOptions(ctx, isCrossContext), inspect);
      // If the custom inspection method returned `this`, don't go into infinite recursion.
      if (ret !== context) {
        if (typeof ret !== "string") {
          return formatValue(ctx, ret, recurseTimes);
        }
        return StringPrototypeReplaceAll.$call(ret, "\n", `\n${StringPrototypeRepeat.$call(" ", ctx.indentationLvl)}`);
      }
    }
  }

  // Using an array here is actually better for the average case than using
  // a Set. `seen` will only check for the depth and will never grow too large.
  const seen = ctx.seen;
  if (seen !== undefined) {
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] === value) return formatCircular(ctx, value);
    }
  }

  return formatRaw(ctx, value, recurseTimes, typedArray);
}

function formatCircular(ctx: Context, value: unknown): unknown {
  let index: number | undefined = 1;
  if (ctx.circular === undefined) {
    const circular = new SafeMap();
    ctx.circular = circular;
    circular.set(value, index);
  } else {
    index = ctx.circular.get(value);
    if (index === undefined) {
      index = ctx.circular.size + 1;
      ctx.circular.set(value, index);
    }
  }
  return stylize(ctx, `[Circular *${index}]`, "special");
}

const kFormatEmpty = 0;
const kFormatArray = 1;
const kFormatSet = 2;
const kFormatMap = 3;
const kFormatTypedArray = 4;
const kFormatIterator = 5;
const kFormatArrayBuffer = 6;
const kFormatPromise = 7;
const kFormatWeakSet = 8;
const kFormatWeakMap = 9;
const kFormatWeakCollection = 10;
const kFormatNamespaceObject = 11;

function formatRaw(ctx: Context, value: any, recurseTimes: number, typedArray: unknown): unknown {
  let keys!: PropertyKey[];
  let protoProps: unknown[] | undefined;
  if (ctx.showHidden && (recurseTimes <= (ctx.depth as any) || ctx.depth === null)) {
    protoProps = [];
  }

  const constructor = getConstructorName(value, ctx, recurseTimes, protoProps);
  // Reset the variable to check for this later on.
  if (protoProps !== undefined && protoProps.length === 0) {
    protoProps = undefined;
  }

  let tag = "";
  const maybeTag: unknown = value[SymbolToStringTag];
  // Only list the tag in case it's non-enumerable / not an own property.
  // Otherwise we'd print this twice.
  if (
    typeof maybeTag === "string" &&
    maybeTag !== "" &&
    !(ctx.showHidden
      ? ObjectHasOwn(value, SymbolToStringTag)
      : ObjectPrototypePropertyIsEnumerable.$call(value, SymbolToStringTag))
  ) {
    tag = maybeTag;
  }
  let base: unknown = "";
  let formatter = kFormatEmpty;
  let bound: any;
  let boundSize: any;
  let braces!: string[];
  let extraKeys: string[] | undefined;
  let noIterator = true;
  let i = 0;
  const filter = ctx.showHidden ? ALL_PROPERTIES : ONLY_ENUMERABLE;

  let extrasType = kObjectType;
  const object: unknown = value;

  // Iterators and the rest are split to reduce checks.
  // We have to check all values in case the constructor is set to null.
  // Otherwise it would not possible to identify all types properly.
  if (SymbolIterator in value || constructor === null) {
    noIterator = false;
    if ($isJSArray(object)) {
      // Only set the constructor for non ordinary ("Array [...]") arrays.
      const prefix =
        constructor !== "Array" || tag !== "" ? getPrefix(constructor, tag, "Array", `(${value.length})`) : "";
      keys = getOwnNonIndexProperties(value, filter);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && protoProps === undefined) {
        return prefix === "" ? (withoutLineBreak = "[]") : `${braces[0]}]`;
      }
      extrasType = kArrayExtrasType;
      formatter = kFormatArray;
    } else if ($isSet(object)) {
      const size = SetPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Set", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter = kFormatSet;
      bound = constructor !== null ? value : SetPrototypeValues.$call(value);
      if (size === 0 && keys.length === 0 && protoProps === undefined) return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if ($isMap(object)) {
      const size = MapPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Map", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter = kFormatMap;
      bound = constructor !== null ? value : MapPrototypeEntries.$call(value);
      if (size === 0 && keys.length === 0 && protoProps === undefined) return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if ($isTypedArrayView(object)) {
      keys = getOwnNonIndexProperties(value, filter);
      bound = value;
      let fallback: unknown = "";
      if (constructor === null) {
        fallback = TypedArrayPrototypeGetSymbolToStringTag(value);
        // Reconstruct the array information.
        bound = new primordials[fallback as string](value);
      }
      const size = TypedArrayPrototypeGetLength(value);
      const prefix = getPrefix(constructor, tag, fallback, `(${size})`);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && !ctx.showHidden) return `${braces[0]}]`;
      // Special handle the value. The original value is required below. The
      // bound function is required to reconstruct missing information.
      formatter = kFormatTypedArray;
      boundSize = size;
      extrasType = kArrayExtrasType;

      if (ctx.showHidden) {
        extraKeys = ["BYTES_PER_ELEMENT", "length", "byteLength", "byteOffset", "buffer"];
        typedArray = true;
      }
    } else if (isMapIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Map", tag);
      formatter = kFormatIterator;
    } else if (isSetIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Set", tag);
      formatter = kFormatIterator;
    } else {
      noIterator = true;
    }
  }
  if (noIterator) {
    keys = getKeys(value, ctx.showHidden);
    braces = ["{", "}"];
    if (typeof value === "function") {
      base = getFunctionBase(ctx, value, constructor, tag);
      if (keys.length === 0 && protoProps === undefined) return stylize(ctx, base, "special");
    } else if (constructor === "Object") {
      if (isArgumentsObject(value)) {
        braces[0] = "[Arguments] {";
      } else if (tag !== "") {
        braces[0] = `${getPrefix(constructor, tag, "Object")}{`;
      }
      if (keys.length === 0 && protoProps === undefined) {
        return braces[0].length === 1 ? (withoutLineBreak = "{}") : `${braces[0]}}`;
      }
    } else if ($isRegExpObject(object)) {
      // Make RegExps say that they are RegExps
      base = RegExpPrototypeToString.$call(constructor !== null ? value : new RegExp(value));
      const prefix = getPrefix(constructor, tag, "RegExp");
      if (prefix !== "RegExp ") base = `${prefix}${base}`;
      if ((keys.length === 0 && protoProps === undefined) || isBeyondDepth(ctx, recurseTimes)) {
        return stylize(ctx, base, "regexp");
      }
    } else if (isDate(value)) {
      // Make dates with properties first say the date
      base = NumberIsNaN(DatePrototypeGetTime.$call(value)) ? DatePrototypeToString.$call(value) : DatePrototypeToISOString.$call(value);
      const prefix = getPrefix(constructor, tag, "Date");
      if (prefix !== "Date ") base = `${prefix}${base}`;
      if (keys.length === 0 && protoProps === undefined) {
        return stylize(ctx, base, "date");
      }
    } else if (isNativeError(value) || value instanceof Error) {
      base = formatError(value, constructor, tag, ctx, keys);
      if (keys.length === 0 && protoProps === undefined) return base;
    } else if (isAnyArrayBuffer(value)) {
      // Fast path for ArrayBuffer and SharedArrayBuffer.
      // Can't do the same for DataView because it has a non-primitive
      // .buffer property that we need to recurse for.
      const arrayType = isArrayBuffer(value) ? "ArrayBuffer" : "SharedArrayBuffer";
      const prefix = getPrefix(constructor, tag, arrayType);
      if (typedArray === undefined) {
        formatter = kFormatArrayBuffer;
      } else if (keys.length === 0 && protoProps === undefined) {
        return prefix + `{ [byteLength]: ${formatNumber(ctx.stylize, value.byteLength, false)} }`;
      }
      braces[0] = `${prefix}{`;
      extraKeys = ["byteLength"];
    } else if (isDataView(value)) {
      braces[0] = `${getPrefix(constructor, tag, "DataView")}{`;
      // .buffer goes last, it's not a primitive like the others.
      extraKeys = ["byteLength", "byteOffset", "buffer"];
    } else if ($isPromise(object)) {
      braces[0] = `${getPrefix(constructor, tag, "Promise")}{`;
      formatter = kFormatPromise;
    } else if (isWeakSet(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakSet")}{`;
      formatter = ctx.showHidden ? kFormatWeakSet : kFormatWeakCollection;
    } else if (isWeakMap(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakMap")}{`;
      formatter = ctx.showHidden ? kFormatWeakMap : kFormatWeakCollection;
    } else if (isModuleNamespaceObject(value)) {
      braces[0] = `${getPrefix(constructor, tag, "Module")}{`;
      // Special handle keys for namespace objects.
      formatter = kFormatNamespaceObject;
    } else if (isBoxedPrimitive(value)) {
      base = getBoxedBase(value, ctx, keys, constructor, tag);
      if (keys.length === 0 && protoProps === undefined) {
        return base;
      }
    } else {
      if (keys.length === 0 && protoProps === undefined) {
        if (isExternal(value)) {
          const address = "0"; //getExternalValue(value).toString(16);
          return stylize(ctx, `[External: ${address}]`, "special");
        }
        return `${getCtxStyle(value, constructor, tag)}{}`;
      }
      braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
    }
  }

  if (isBeyondDepth(ctx, recurseTimes)) {
    let constructorName = StringPrototypeSlice.$call(getCtxStyle(value, constructor, tag), 0, -1);
    if (constructor !== null) constructorName = `[${constructorName}]`;
    return stylize(ctx, constructorName, "special");
  }
  recurseTimes += 1;

  pushSeen(ctx, value);
  ctx.currentDepth = recurseTimes;
  let output: unknown[];
  let isSingleLine: boolean;
  const indentationLvl = ctx.indentationLvl;
  try {
    // JSC stack is too powerful it must be stopped manually
    if (ctx.currentDepth > 1000) throw new RangeError(ERROR_STACK_OVERFLOW_MSG);
    switch (formatter) {
      case kFormatEmpty:
        output = [];
        break;
      case kFormatArray:
        output = formatArray(ctx, value, recurseTimes);
        break;
      case kFormatSet:
        output = formatSet(bound, ctx, recurseTimes);
        break;
      case kFormatMap:
        output = formatMap(bound, ctx, recurseTimes);
        break;
      case kFormatTypedArray:
        output = formatTypedArray(bound, boundSize, ctx);
        break;
      case kFormatIterator:
        output = formatIterator(braces, ctx, value, recurseTimes);
        break;
      case kFormatArrayBuffer:
        output = formatArrayBuffer(ctx, value);
        break;
      case kFormatPromise:
        output = formatPromise(ctx, value, recurseTimes);
        break;
      case kFormatWeakSet:
        output = formatWeakSet(ctx, value, recurseTimes);
        break;
      case kFormatWeakMap:
        output = formatWeakMap(ctx, value, recurseTimes);
        break;
      case kFormatWeakCollection:
        output = formatWeakCollection(ctx);
        break;
      default:
        output = formatNamespaceObject(keys, ctx, value, recurseTimes);
    }
    isSingleLine =
      (formatter === kFormatEmpty || output === outputWithoutLineBreak) && extraKeys === undefined && protoProps === undefined;
    if (extraKeys !== undefined) {
      for (i = 0; i < extraKeys.length; i++) {
        let formatted: unknown;
        try {
          formatted = formatExtraProperties(ctx, value, recurseTimes, extraKeys[i], typedArray);
        } catch {
          const tempValue = { [extraKeys[i]]: value.buffer[extraKeys[i]] };
          formatted = formatExtraProperties(ctx, tempValue, recurseTimes, extraKeys[i], typedArray);
        }
        ArrayPrototypePush.$call(output, formatted);
      }
    }
    for (i = 0; i < keys.length; i++) {
      const property = formatProperty(ctx, value, recurseTimes, keys[i], extrasType);
      if (isSingleLine && !isWithoutLineBreak(property)) isSingleLine = false;
      ArrayPrototypePush.$call(output, property);
    }
    if (protoProps !== undefined) {
      ArrayPrototypePush.$apply(output, protoProps);
    }
  } catch (err: any) {
    if (err instanceof RangeError && err.message === ERROR_STACK_OVERFLOW_MSG) {
      const constructorName = StringPrototypeSlice.$call(getCtxStyle(value, constructor, tag), 0, -1);
      ArrayPrototypePop.$call(ctx.seen!);
      ctx.indentationLvl = indentationLvl;
      return stylize(ctx, 
        `[${constructorName}: Inspection interrupted prematurely. Maximum call stack size exceeded.]`,
        "special",
      );
    }
    throw new (require("internal/errors").AssertionError)("handleMaxCallStackSize assertion failed: " + String(err), true);
  }
  const circular = ctx.circular;
  if (circular !== undefined) {
    const index = circular.get(value);
    if (index !== undefined) {
      ctx.seenRefs ??= new Set();
      const SEEN = ctx.seenRefs.has(index);
      if (!SEEN) {
        ctx.seenRefs.add(index);
        const reference = stylize(ctx, `<ref *${index}>`, "special");
        // Add reference always to the very beginning of the output.
        if (ctx.compact !== true) {
          base = base === "" ? reference : `${reference} ${base}`;
        } else {
          braces[0] = `${reference} ${braces[0]}`;
        }
      } else {
        //! this is a non-standard behavior compared to Node's implementation
        //  it optimizes the output by also collapsing indirect circular references
        //  this is not known to cause any issues so far but this note is left here just in case
        const reference = stylize(ctx, `[Circular *${index}]`, "special");
        //ctx.seen.pop(); //? uncommenting this line would allow more accurate display semantics but causes a ~2x slowdown
        return reference;
      }
    }
  }
  ArrayPrototypePop.$call(ctx.seen!);

  const ctxSorted = ctx.sorted;
  if (ctxSorted) {
    const comparator: any = ctxSorted === true ? undefined : ctxSorted;
    if (extrasType === kObjectType) {
      ArrayPrototypeSort.$call(output, comparator);
    } else {
      const keysLength = keys.length;
      if (keysLength > 1) {
        const sorted: any[] = ArrayPrototypeSort.$call(ArrayPrototypeSlice.$call(output, output.length - keysLength), comparator);
        ArrayPrototypeUnshift.$call(sorted, output.length - keysLength, keysLength);
        ArrayPrototypeSplice.$apply(output, sorted as [number, number, ...unknown[]]);
      }
    }
  }

  const res = reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value, isSingleLine);
  const newLength = addToBudget(ctx, res.length);
  // If any indentationLvl exceeds this limit, limit further inspecting to the
  // minimum. Otherwise the recursive algorithm might continue inspecting the
  // object even though the maximum string size (~2 ** 28 on 32 bit systems and
  // ~2 ** 30 on 64 bit systems) exceeded. The actual output is not limited at
  // exactly 2 ** 27 but a bit higher. This depends on the object shape.
  // This limit also makes sure that huge objects don't block the event loop
  // significantly.
  if (newLength > 134217728) {
    ctx.depth = -1;
  }
  return res;
}

function getIteratorBraces(type: string, tag: string): string[] {
  if (tag !== `${type} Iterator`) {
    if (tag !== "") tag += "] [";
    tag += `${type} Iterator`;
  }
  return [`[${tag}] {`, "}"];
}

function getBoxedBase(value: any, ctx: Context, keys: PropertyKey[], constructor: string | null, tag: string): unknown {
  let fn: any;
  let type: string;
  if (isNumberObject(value)) {
    fn = NumberPrototypeValueOf;
    type = "Number";
  } else if (isStringObject(value)) {
    fn = StringPrototypeValueOf;
    type = "String";
    // For boxed Strings, we have to remove the 0-n indexed entries,
    // since they just noisy up the output and are redundant
    // Make boxed primitive Strings look like such
    keys.splice(0, value.length);
  } else if (isBooleanObject(value)) {
    fn = BooleanPrototypeValueOf;
    type = "Boolean";
  } else if (isBigIntObject(value)) {
    fn = BigIntPrototypeValueOf;
    type = "BigInt";
  } else {
    fn = SymbolPrototypeValueOf;
    type = "Symbol";
  }
  let base = `[${type}`;
  if (type !== constructor) {
    if (constructor === null) {
      base += " (null prototype)";
    } else {
      base += ` (${constructor})`;
    }
  }
  base += `: ${formatPrimitive(stylizeNoColor, fn.$call(value), ctx)}]`;
  if (tag !== "" && tag !== constructor) {
    base += ` [${tag}]`;
  }
  if (keys.length !== 0 || ctx.isPlain) return base;
  return stylize(ctx, base, StringPrototypeToLowerCase.$call(type));
}

function getClassBase(value: any, constructor: string | null, tag: string): string {
  const hasName = ObjectHasOwn(value, "name");
  const name = (hasName && value.name) || "(anonymous)";
  let base = `class ${name}`;
  if (constructor !== "Function" && constructor !== null) {
    base += ` [${constructor}]`;
  }
  if (tag !== "" && constructor !== tag) {
    base += ` [${tag}]`;
  }
  if (constructor !== null) {
    const superName = ObjectGetPrototypeOf(value).name;
    if (superName) {
      base += ` extends ${superName}`;
    }
  } else {
    base += " extends [null prototype]";
  }
  return `[${base}]`;
}

function getFunctionBase(ctx: Context, value: any, constructor: string | null, tag: string): string {
  const stringified = FunctionPrototypeToString.$call(value);
  if (StringPrototypeStartsWith.$call(stringified, "class") && stringified[stringified.length - 1] === "}") {
    const slice = StringPrototypeSlice.$call(stringified, 5, -1);
    const bracketIndex = StringPrototypeIndexOf.$call(slice, "{");
    if (
      bracketIndex !== -1 &&
      (!StringPrototypeIncludes.$call(StringPrototypeSlice.$call(slice, 0, bracketIndex), "(") ||
        // Slow path to guarantee that it's indeed a class.
        RegExpPrototypeExec.$call(classRegExp, RegExpPrototypeSymbolReplace.$call(stripCommentsRegExp, slice, undefined as any)) !== null)
    ) {
      return getClassBase(value, constructor, tag);
    }
  }
  let type = "Function";
  if (isGeneratorFunction(value)) {
    type = `Generator${type}`;
  }
  if (isAsyncFunction(value)) {
    type = `Async${type}`;
  }
  let base = `[${type}`;
  if (constructor === null) {
    base += " (null prototype)";
  }
  if (value.name === "") {
    base += " (anonymous)";
  } else {
    base += `: ${typeof value.name === "string" ? value.name : formatValue(ctx, value.name, NaN)}`;
  }
  base += "]";
  if (constructor !== type && constructor !== null) {
    base += ` ${constructor}`;
  }
  if (tag !== "" && constructor !== tag) {
    base += ` [${tag}]`;
  }
  return base;
}

function identicalSequenceRange(a: string[], b: string[]): { len: number; offset: number } {
  for (let i = 0; i < a.length - 3; i++) {
    // Find the first entry of b that matches the current entry of a.
    const pos = ArrayPrototypeIndexOf.$call(a[i] as any, undefined);
    if (pos !== -1) {
      const rest = b.length - pos;
      if (rest > 3) {
        let len = 1;
        const maxLen = $min(a.length - i, rest);
        // Count the number of consecutive entries.
        while (maxLen > len && a[i + len] === b[pos + len]) {
          len++;
        }
        if (len > 3) {
          return { len, offset: i };
        }
      }
    }
  }

  return { len: 0, offset: 0 };
}

function getStackString(error: any): string {
  return error.stack ? String(error.stack) : ErrorPrototypeToString.$call(error);
}

function getStackFrames(ctx: Context, err: any, stack: string): unknown[] | undefined {
  let cause: any;
  try {
    ({ cause } = err);
  } catch {
    // If 'cause' is a getter that throws, ignore it.
  }

  // Remove stack frames identical to frames in cause.
  if (cause != null && (isNativeError(cause) || cause instanceof Error)) {
    const frames: unknown[] = StringPrototypeSplit.$call(stack, "\n");
    const causeStack = getStackString(cause);
    const causeStackStart = StringPrototypeIndexOf.$call(causeStack, "\n    at");
    if (causeStackStart !== -1) {
      const causeFrames = StringPrototypeSplit.$call(StringPrototypeSlice.$call(causeStack, causeStackStart + 1), "\n");
      const { len, offset } = identicalSequenceRange(frames as string[], causeFrames);
      if (len > 0) {
        const skipped = len - 2;
        const msg = `    ... ${skipped} lines matching cause stack trace ...`;
        frames.splice(offset + 1, skipped, stylize(ctx, msg, "undefined"));
      }
    }
    return frames;
  }
  return undefined;
}

function improveStack(stack: string, constructor: string | null, name: string, tag: string): string {
  // A stack trace may contain arbitrary data. Only manipulate the output
  // for "regular errors" (errors that "look normal") for now.
  let len = name.length;

  if (
    constructor === null ||
    (StringPrototypeEndsWith.$call(name, "Error") &&
      StringPrototypeStartsWith.$call(stack, name) &&
      (stack.length === len || stack[len] === ":" || stack[len] === "\n"))
  ) {
    let fallback = "Error";
    if (constructor === null) {
      const start =
        RegExpPrototypeExec.$call(/^([A-Z][a-z_ A-Z0-9[\]()-]+)(?::|\n {4}at)/, stack) ||
        RegExpPrototypeExec.$call(/^([a-z_A-Z0-9-]*Error)$/, stack);
      fallback = start?.[1] || "";
      len = fallback.length;
      fallback ||= "Error";
    }
    const prefix = StringPrototypeSlice.$call(getPrefix(constructor, tag, fallback), 0, -1);
    if (name !== prefix) {
      if (StringPrototypeIncludes.$call(prefix, name)) {
        if (len === 0) {
          stack = `${prefix}: ${stack}`;
        } else {
          stack = `${prefix}${StringPrototypeSlice.$call(stack, len)}`;
        }
      } else {
        stack = `${prefix} [${name}]${StringPrototypeSlice.$call(stack, len)}`;
      }
    }
  }
  return stack;
}

function removeDuplicateErrorKeys(ctx: Context, keys: PropertyKey[], err: any, stack: string): void {
  if (!ctx.showHidden && keys.length !== 0) {
    for (const name of ["name", "message", "stack"]) {
      const index = ArrayPrototypeIndexOf.$call(keys, name);
      // Only hide the property in case it's part of the original stack
      if (index !== -1 && StringPrototypeIncludes.$call(stack, err[name])) {
        ArrayPrototypeSplice.$call(keys, index, 1);
      }
    }
  }
}

function markNodeModules(ctx: Context, line: string): string {
  let tempLine = "";
  let nodeModule: RegExpExecArray | null;
  let pos = 0;
  while ((nodeModule = nodeModulesRegExp.exec(line)) !== null) {
    // '/node_modules/'.length === 14
    tempLine += StringPrototypeSlice.$call(line, pos, nodeModule.index + 14);
    tempLine += stylize(ctx, nodeModule[1], "module");
    pos = nodeModule.index + nodeModule[0].length;
  }
  if (pos !== 0) {
    line = tempLine + StringPrototypeSlice.$call(line, pos);
  }
  return line;
}

function markCwd(ctx: Context, line: string, workingDirectory: string): string {
  let cwdStartPos = StringPrototypeIndexOf.$call(line, workingDirectory);
  let tempLine = "";
  let cwdLength = workingDirectory.length;
  if (cwdStartPos !== -1) {
    if (StringPrototypeSlice.$call(line, cwdStartPos - 7, cwdStartPos) === "file://") {
      cwdLength += 7;
      cwdStartPos -= 7;
    }
    const start = line[cwdStartPos - 1] === "(" ? cwdStartPos - 1 : cwdStartPos;
    const end = start !== cwdStartPos && StringPrototypeEndsWith.$call(line, ")") ? -1 : line.length;
    const workingDirectoryEndPos = cwdStartPos + cwdLength + 1;
    const cwdSlice = StringPrototypeSlice.$call(line, start, workingDirectoryEndPos);

    tempLine += StringPrototypeSlice.$call(line, 0, start);
    tempLine += stylize(ctx, cwdSlice, "undefined");
    tempLine += StringPrototypeSlice.$call(line, workingDirectoryEndPos, end);
    if (end === -1) {
      tempLine += stylize(ctx, ")", "undefined");
    }
  } else {
    tempLine += line;
  }
  return tempLine;
}

function safeGetCWD(): string | undefined {
  let workingDirectory: string;
  try {
    workingDirectory = process.cwd();
  } catch {
    return;
  }
  return workingDirectory;
}

function formatError(err: any, constructor: string | null, tag: string, ctx: Context, keys: PropertyKey[]): string {
  const name = err.name != null ? String(err.name) : "Error";
  let stack = getStackString(err);

  //! temp fix for Bun losing the error name from inherited errors + extraneous ": " with no message
  const prefix = `${name}${err.message ? ": " : ""}`;
  if (StringPrototypeStartsWith.$call(stack, "Error: ")) {
    stack = StringPrototypeIncludes.$call(prefix, "$")
      ? stack.replace(errorPrefixRegExp, prefix)
      : prefix + StringPrototypeSlice.$call(stack, 7);
  }

  removeDuplicateErrorKeys(ctx, keys, err, stack);

  if ("cause" in err && (keys.length === 0 || !ArrayPrototypeIncludes.$call(keys, "cause"))) {
    ArrayPrototypePush.$call(keys, "cause");
  }

  // Print errors aggregated into AggregateError
  if ($isJSArray(err.errors) && (keys.length === 0 || !ArrayPrototypeIncludes.$call(keys, "errors"))) {
    ArrayPrototypePush.$call(keys, "errors");
  }

  stack = improveStack(stack, constructor, name, tag);

  // Ignore the error message if it's contained in the stack.
  let pos: any = (err.message && StringPrototypeIndexOf.$call(stack, err.message)) || -1;
  if (pos !== -1) pos += err.message.length;
  // Wrap the error in brackets in case it has no stack trace.
  const stackStart = StringPrototypeIndexOf.$call(stack, "\n    at", pos);
  if (stackStart === -1) {
    stack = `[${stack}]`;
  } else {
    let newStack = StringPrototypeSlice.$call(stack, 0, stackStart);
    const stackFramePart = StringPrototypeSlice.$call(stack, stackStart + 1);
    const lines = getStackFrames(ctx, err, stackFramePart);
    if (ctx.colors) {
      // Highlight userland code and node modules.
      const workingDirectory = safeGetCWD();
      let esmWorkingDirectory: string | undefined;
      for (let line of (lines ?? StringPrototypeSplit.$call(stackFramePart, "\n")) as any[]) {
        const core = RegExpPrototypeExec.$call(coreModuleRegExp, line);
        if (
          core !== null &&
          (StringPrototypeStartsWith.$call(core[1], "internal/") ||
            ArrayPrototypeIncludes.$call(require("node:module").builtinModules, core[1]))
        ) {
          newStack += `\n${stylize(ctx, line, "undefined")}`;
        } else {
          newStack += "\n";

          line = markNodeModules(ctx, line);
          if (workingDirectory !== undefined) {
            let newLine = markCwd(ctx, line, workingDirectory);
            if (newLine === line) {
              esmWorkingDirectory ??= require("node:url").pathToFileURL(workingDirectory).href as string;
              newLine = markCwd(ctx, line, esmWorkingDirectory);
            }
            line = newLine;
          }

          newStack += line;
        }
      }
    } else {
      newStack += lines === undefined ? `\n${stackFramePart}` : `\n${ArrayPrototypeJoin.$call(lines, "\n")}`;
    }
    stack = newStack;
  }
  // The message and the stack have to be indented as well!
  const indentationLvl = ctx.indentationLvl;
  if (indentationLvl !== 0) {
    const indentation = StringPrototypeRepeat.$call(" ", indentationLvl);
    stack = StringPrototypeReplaceAll.$call(stack, "\n", `\n${indentation}`);
  }
  return stack;
}

const kSpaces = "                                                                                                                                ";

function padStart(str: string, maxLength: number): string {
  const count = maxLength - str.length;
  if (count <= 0) return str;
  if (count > 128) return StringPrototypePadStart.$call(str, maxLength, " ");
  return StringPrototypeSlice.$call(kSpaces, 0, count) + str;
}

function padEnd(str: string, maxLength: number): string {
  const count = maxLength - str.length;
  if (count <= 0) return str;
  if (count > 128) return StringPrototypePadEnd.$call(str, maxLength, " ");
  return str + StringPrototypeSlice.$call(kSpaces, 0, count);
}

function groupArrayElements(ctx: Context, output: unknown[], value: any): unknown[] {
  const maxArrayLength = ctx.maxArrayLength;
  const breakLength = ctx.breakLength;
  const compact = ctx.compact;
  if (typeof maxArrayLength !== "number" || typeof breakLength !== "number" || typeof compact !== "number") {
    return groupArrayElementsOfAnything(ctx, output, value);
  }
  let totalLength = 0;
  let maxLength = 0;
  let i = 0;
  let outputLength = output.length;
  if (maxArrayLength < output.length) {
    // This makes sure the "... n more items" part is not taken into account.
    outputLength--;
  }
  const separatorSpace = 2; // Add 1 for the space and 1 for the separator.
  const dataLen = new Array<number>(outputLength);
  const colors = ctx.colors;
  // Calculate the total length of all output entries and the individual max
  // entries length of all output entries. We have to remove colors first,
  // otherwise the length would not be calculated properly.
  for (; i < outputLength; i++) {
    const entry = output[i];
    if (typeof entry !== "string") return groupArrayElementsOfAnything(ctx, output, value);
    const len = getStringWidth(entry, colors);
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len) maxLength = len;
  }
  // Add two to `maxLength` as we add a single whitespace character plus a comma
  // in-between two entries.
  const actualMax = maxLength + separatorSpace;
  // Check if at least three entries fit next to each other and prevent grouping
  // of arrays that contains entries of very different length (i.e., if a single
  // entry is longer than 1/5 of all other entries combined). Otherwise the
  // space in-between small entries would be enormous.
  const indentationLvl = ctx.indentationLvl;
  if (actualMax * 3 + indentationLvl < breakLength && (totalLength / actualMax > 5 || maxLength <= 6)) {
    const approxCharHeights = 2.5;
    const averageBias = MathSqrt(actualMax - totalLength / output.length);
    const biasedMax = MathMax(actualMax - 3 - averageBias, 1);
    // Dynamically check how many columns seem possible.
    const columns = $min(
      $min(
        // Ideally a square should be drawn. We expect a character to be about 2.5
        // times as high as wide. This is the area formula to calculate a square
        // which contains n rectangles of size `actualMax * approxCharHeights`.
        // Divide that by `actualMax` to receive the correct number of columns.
        // The added bias increases the columns for short entries.
        MathRound(MathSqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
        // Do not exceed the breakLength.
        MathFloor((breakLength - indentationLvl) / actualMax),
      ),
      // Limit array grouping for small `compact` modes as the user requested
      // minimal grouping.
      // Limit the columns to a maximum of fifteen.
      $min(compact * 4, 15),
    );
    // Return with the original output if no grouping should happen.
    if (columns <= 1) {
      return output;
    }
    const tmp: unknown[] = [];
    const maxLineLength: number[] = [];
    for (let i = 0; i < columns; i++) {
      let lineMaxLength = 0;
      for (let j = i; j < outputLength; j += columns) {
        if (dataLen[j] > lineMaxLength) lineMaxLength = dataLen[j];
      }
      lineMaxLength += separatorSpace;
      maxLineLength[i] = lineMaxLength;
    }
    let isPadStart = true;
    if (value !== undefined) {
      for (let i = 0; i < output.length; i++) {
        if (typeof value[i] !== "number" && typeof value[i] !== "bigint") {
          isPadStart = false;
          break;
        }
      }
    }
    // Each iteration creates a single line of grouped entries.
    for (let i = 0; i < outputLength; i += columns) {
      // The last lines may contain less entries than columns.
      const max = $min(i + columns, outputLength);
      let str = "";
      let j = i;
      for (; j < max - 1; j++) {
        // Calculate extra color padding in case it's active. This has to be
        // done line by line as some lines might contain more colors than
        // others.
        const entry = output[j] as string;
        const padding = maxLineLength[j - i] + entry.length - dataLen[j];
        str += isPadStart ? padStart(`${entry}, `, padding) : padEnd(`${entry}, `, padding);
      }
      const entry = output[j] as string;
      if (isPadStart) {
        const padding = maxLineLength[j - i] + entry.length - dataLen[j] - separatorSpace;
        str += padStart(entry, padding);
      } else {
        str += entry;
      }
      ArrayPrototypePush.$call(tmp, str);
    }
    if (maxArrayLength < output.length) {
      ArrayPrototypePush.$call(tmp, output[outputLength]);
    }
    output = tmp;
  }
  return output;
}

function groupArrayElementsOfAnything(ctx: Context, output: any[], value: any): unknown[] {
  let totalLength = 0;
  let maxLength = 0;
  let i = 0;
  let outputLength = output.length;
  if ((ctx.maxArrayLength as any) < output.length) {
    // This makes sure the "... n more items" part is not taken into account.
    outputLength--;
  }
  const separatorSpace = 2; // Add 1 for the space and 1 for the separator.
  const dataLen = new Array<number>(outputLength);
  // Calculate the total length of all output entries and the individual max
  // entries length of all output entries. We have to remove colors first,
  // otherwise the length would not be calculated properly.
  for (; i < outputLength; i++) {
    const len = getStringWidth(output[i], ctx.colors);
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len) maxLength = len;
  }
  // Add two to `maxLength` as we add a single whitespace character plus a comma
  // in-between two entries.
  const actualMax = maxLength + separatorSpace;
  // Check if at least three entries fit next to each other and prevent grouping
  // of arrays that contains entries of very different length (i.e., if a single
  // entry is longer than 1/5 of all other entries combined). Otherwise the
  // space in-between small entries would be enormous.
  const indentationLvl = ctx.indentationLvl;
  const breakLength: any = ctx.breakLength;
  if (actualMax * 3 + indentationLvl < breakLength && (totalLength / actualMax > 5 || maxLength <= 6)) {
    const approxCharHeights = 2.5;
    const averageBias = MathSqrt(actualMax - totalLength / output.length);
    const biasedMax = MathMax(actualMax - 3 - averageBias, 1);
    // Dynamically check how many columns seem possible.
    const columns = $min(
      $min(
      // Ideally a square should be drawn. We expect a character to be about 2.5
      // times as high as wide. This is the area formula to calculate a square
      // which contains n rectangles of size `actualMax * approxCharHeights`.
      // Divide that by `actualMax` to receive the correct number of columns.
      // The added bias increases the columns for short entries.
      MathRound(MathSqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
      // Do not exceed the breakLength.
      MathFloor((breakLength - indentationLvl) / actualMax),
      ),
      // Limit array grouping for small `compact` modes as the user requested
      // minimal grouping.
      // Limit the columns to a maximum of fifteen.
      $min((ctx.compact as any) * 4, 15),
    );
    // Return with the original output if no grouping should happen.
    if (columns <= 1) {
      return output;
    }
    const tmp: unknown[] = [];
    const maxLineLength: number[] = [];
    for (let i = 0; i < columns; i++) {
      let lineMaxLength = 0;
      for (let j = i; j < output.length; j += columns) {
        if (dataLen[j] > lineMaxLength) lineMaxLength = dataLen[j];
      }
      lineMaxLength += separatorSpace;
      maxLineLength[i] = lineMaxLength;
    }
    let padStart = true;
    if (value !== undefined) {
      for (let i = 0; i < output.length; i++) {
        if (typeof value[i] !== "number" && typeof value[i] !== "bigint") {
          padStart = false;
          break;
        }
      }
    }
    // Each iteration creates a single line of grouped entries.
    for (let i = 0; i < outputLength; i += columns) {
      // The last lines may contain less entries than columns.
      const max = $min(i + columns, outputLength);
      let str = "";
      let j = i;
      for (; j < max - 1; j++) {
        // Calculate extra color padding in case it's active. This has to be
        // done line by line as some lines might contain more colors than
        // others.
        const padding = maxLineLength[j - i] + output[j].length - dataLen[j];
        const entry = `${output[j]}, `;
        str += padStart ? StringPrototypePadStart.$call(entry, padding, " ") : StringPrototypePadEnd.$call(entry, padding, " ");
      }
      if (padStart) {
        const padding = maxLineLength[j - i] + output[j].length - dataLen[j] - separatorSpace;
        str += StringPrototypePadStart.$call(output[j], padding, " ");
      } else {
        str += output[j];
      }
      ArrayPrototypePush.$call(tmp, str);
    }
    if ((ctx.maxArrayLength as any) < output.length) {
      ArrayPrototypePush.$call(tmp, output[outputLength]);
    }
    output = tmp;
  }
  return output;
}

function addNumericSeparator(integerString: string): string {
  let result = "";
  let i = integerString.length;
  const start = integerString[0] === "-" ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    result = `_${StringPrototypeSlice.$call(integerString, i - 3, i)}${result}`;
  }
  return i === integerString.length ? integerString : `${StringPrototypeSlice.$call(integerString, 0, i)}${result}`;
}

function addNumericSeparatorEnd(integerString: string): string {
  let result = "";
  let i = 0;
  for (; i < integerString.length - 3; i += 3) {
    result += `${StringPrototypeSlice.$call(integerString, i, i + 3)}_`;
  }
  return i === 0 ? integerString : `${result}${StringPrototypeSlice.$call(integerString, i)}`;
}

const remainingText = (remaining: number): string => `... ${remaining} more item${remaining > 1 ? "s" : ""}`;

function numberToString(number: number, numericSeparator: unknown): string {
  if (!numericSeparator) {
    // Format -0 as '-0'. Checking `number === -0` won't distinguish 0 from -0.
    if (number === 0 && 1 / number < 0) {
      return "-0";
    }
    return `${number}`;
  }
  const integer = MathTrunc(number);
  const string = String(integer);
  if (integer === number) {
    if (!NumberIsFinite(number) || StringPrototypeIncludes.$call(string, "e")) {
      return string;
    }
    return addNumericSeparator(string);
  }
  if (NumberIsNaN(number)) {
    return string;
  }
  return `${addNumericSeparator(string)}.${addNumericSeparatorEnd(StringPrototypeSlice.$call(String(number), string.length + 1))}`;
}

function notANumberToString(number: any, numericSeparator: unknown): string {
  if (!numericSeparator) {
    return `${number}`;
  }
  const integer = MathTrunc(number);
  const string = String(integer);
  if (integer === number) {
    if (!NumberIsFinite(number) || StringPrototypeIncludes.$call(string, "e")) {
      return string;
    }
    return addNumericSeparator(string);
  }
  if (NumberIsNaN(number)) {
    return string;
  }
  return `${addNumericSeparator(string)}.${addNumericSeparatorEnd(StringPrototypeSlice.$call(String(number), string.length + 1))}`;
}

function formatNumber(fn: any, number: unknown, numericSeparator: unknown): unknown {
  if (typeof number !== "number") return fn(notANumberToString(number, numericSeparator), "number");
  const string = numberToString(number, numericSeparator);
  return fn === stylizeNoColor ? (withoutLineBreak = string) : fn(string, "number");
}

function bigIntToString(bigint: unknown, numericSeparator: unknown): string {
  const string = String(bigint);
  if (!numericSeparator) {
    return `${string}n`;
  }
  return `${addNumericSeparator(string)}n`;
}

function formatBigInt(fn: any, bigint: unknown, numericSeparator: unknown): unknown {
  const string = bigIntToString(bigint, numericSeparator);
  return fn === stylizeNoColor && typeof bigint === "bigint" ? (withoutLineBreak = string) : fn(string, "bigint");
}

function formatPrimitive(fn: any, value: unknown, ctx: Context): unknown {
  if (typeof value === "string") {
    return formatString(fn, value, ctx.maxStringLength, ctx.compact, ctx.breakLength, ctx.indentationLvl);
  }
  if (typeof value === "number") return formatNumber(fn, value, ctx.numericSeparator);
  if (typeof value === "bigint") return formatBigInt(fn, value, ctx.numericSeparator);
  if (typeof value === "boolean") {
    return fn === stylizeNoColor ? (withoutLineBreak = value ? "true" : "false") : fn(`${value}`, "boolean");
  }
  if (typeof value === "undefined") {
    return fn === stylizeNoColor ? (withoutLineBreak = "undefined") : fn("undefined", "undefined");
  }
  // es6 symbol primitive
  return fn(SymbolPrototypeToString.$call(value as any), "symbol");
}

function formatString(
  fn: any,
  value: string,
  maxStringLength: any,
  compact: unknown,
  breakLength: unknown,
  indentationLvl: number,
): unknown {
  let trailer = "";
  let valueLength = value.length;
  if (valueLength > maxStringLength) {
    const remaining = valueLength - maxStringLength;
    value = StringPrototypeSlice.$call(value, 0, maxStringLength);
    valueLength = value.length;
    trailer = `... ${remaining} more character${remaining > 1 ? "s" : ""}`;
  }
  if (
    compact !== true &&
    // We do not support handling unicode characters width with
    // the readline getStringWidth function as there are
    // performance implications.
    valueLength > kMinLineLength &&
    valueLength > (breakLength as any) - indentationLvl - 4
  ) {
    return (
      ArrayPrototypeJoin.$call(
        ArrayPrototypeMap.$call(extractedSplitNewLines(value), line => fn(strEscape(line), "string")),
        ` +\n${StringPrototypeRepeat.$call(" ", indentationLvl + 2)}`,
      ) + trailer
    );
  }
  const escaped = strEscape(value);
  if (fn === stylizeNoColor) return (withoutLineBreak = trailer === "" ? escaped : escaped + trailer);
  return fn(escaped, "string") + trailer;
}

function formatNamespaceObject(keys: PropertyKey[], ctx: Context, value: any, recurseTimes: number): unknown[] {
  const output = new Array<any>(keys.length);
  for (let i = 0; i < keys.length; i++) {
    try {
      output[i] = formatProperty(ctx, value, recurseTimes, keys[i], kObjectType);
    } catch (err: any) {
      assert(isNativeError(err) && err.name === "ReferenceError");
      // Use the existing functionality. This makes sure the indentation and
      // line breaks are always correct. Otherwise it is very difficult to keep
      // this aligned, even though this is a hacky way of dealing with this.
      const tmp: Record<PropertyKey, unknown> = { [keys[i]]: "" };
      output[i] = formatProperty(ctx, tmp, recurseTimes, keys[i], kObjectType);
      const pos = StringPrototypeLastIndexOf.$call(output[i], " ");
      // We have to find the last whitespace and have to replace that value as
      // it will be visualized as a regular string.
      output[i] = StringPrototypeSlice.$call(output[i], 0, pos + 1) + stylize(ctx, "<uninitialized>", "special");
    }
  }
  // Reset the keys to an empty array. This prevents duplicated inspection.
  keys.length = 0;
  return output;
}

// The array is sparse and/or has extra keys
function formatSpecialArray(ctx: Context, value: any, recurseTimes: number, maxLength: number, output: unknown[], i: number): unknown[] {
  const keys = ObjectKeys(value);
  let index = i;
  for (; i < keys.length && output.length < maxLength; i++) {
    const key = keys[i];
    const tmp = +key;
    // Arrays can only have up to 2^32 - 1 entries
    if (tmp > 4294967294) {
      break;
    }
    if (`${index}` !== key) {
      if (RegExpPrototypeExec.$call(numberRegExp, key) === null) {
        break;
      }
      const emptyItems = tmp - index;
      const ending = emptyItems > 1 ? "s" : "";
      const message = `<${emptyItems} empty item${ending}>`;
      ArrayPrototypePush.$call(output, stylize(ctx, message, "undefined"));
      index = tmp;
      if (output.length === maxLength) {
        break;
      }
    }
    ArrayPrototypePush.$call(output, formatProperty(ctx, value, recurseTimes, key, kArrayType));
    index++;
  }
  const remaining = value.length - index;
  if (output.length !== maxLength) {
    if (remaining > 0) {
      const ending = remaining > 1 ? "s" : "";
      const message = `<${remaining} empty item${ending}>`;
      ArrayPrototypePush.$call(output, stylize(ctx, message, "undefined"));
    }
  } else if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  return output;
}

function hexSlice(buf: Uint8Array, start: number, end: number): string {
  return ArrayPrototypeJoin.$call(
    ArrayPrototypeMap.$call(buf.slice(start, end) as any, (x: number) => ("00" + x.toString(16)).slice(-2)),
    "",
  );
}

function formatArrayBuffer(ctx: Context, value: any): unknown[] {
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(value);
  } catch {
    return [stylize(ctx, "(detached)", "special")];
  }
  let str = StringPrototypeTrim.$call(
    RegExpPrototypeSymbolReplace.$call(/(.{2})/g, hexSlice(buffer, 0, $min(ctx.maxArrayLength as any, buffer.length)), "$1 "),
  );
  const remaining = buffer.length - (ctx.maxArrayLength as any);
  if (remaining > 0) str += ` ... ${remaining} more byte${remaining > 1 ? "s" : ""}`;
  return [`${stylize(ctx, "[Uint8Contents]", "special")}: <${str}>`];
}

function formatArray(ctx: Context, value: any, recurseTimes: number): unknown[] {
  const valLen: number = value.length;
  const len = $min(MathMax(0, ctx.maxArrayLength as any), valLen);

  const remaining = valLen - len;
  const output: unknown[] = [];
  let isSingleLine = true;
  for (let i = 0; i < len; i++) {
    // Special handle sparse arrays.
    const desc = ObjectGetOwnPropertyDescriptor(value, i);
    if (desc === undefined) {
      return formatSpecialArray(ctx, value, recurseTimes, len, output, i);
    }
    const property = formatProperty(ctx, value, recurseTimes, i, kArrayType, desc);
    if (isSingleLine && !isWithoutLineBreak(property)) isSingleLine = false;
    ArrayPrototypePush.$call(output, property);
  }
  if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  if (isSingleLine) outputWithoutLineBreak = output;
  return output;
}

function formatTypedArray(value: any, length: any, ctx: Context): unknown[] {
  if (Buffer.isBuffer(value)) {
    BufferModule ??= require("node:buffer");
    const INSPECT_MAX_BYTES = $requireMap.$get("buffer")?.exports.INSPECT_MAX_BYTES ?? BufferModule.INSPECT_MAX_BYTES;
    ctx.maxArrayLength = $min(ctx.maxArrayLength as any, INSPECT_MAX_BYTES);
  }
  const maxLength = $min(MathMax(0, ctx.maxArrayLength as any), length);
  const remaining = value.length - maxLength;
  const output = new Array<unknown>(maxLength);
  const isNumber = value.length > 0 && typeof value[0] === "number";
  for (let i = 0; i < maxLength; ++i) {
    output[i] = isNumber
      ? formatNumber(ctx.stylize, value[i], ctx.numericSeparator)
      : formatBigInt(ctx.stylize, value[i], ctx.numericSeparator);
  }
  if (remaining > 0) {
    output[maxLength] = remainingText(remaining);
  }
  return output;
}

function formatSet(value: any, ctx: Context, recurseTimes: number): unknown[] {
  const length = value.size;
  const maxLength = $min(MathMax(0, ctx.maxArrayLength as any), length);
  const remaining = length - maxLength;
  const output: unknown[] = [];
  ctx.indentationLvl += 2;
  let i = 0;
  let isSingleLine = true;
  for (const v of value) {
    if (i >= maxLength) break;
    const str = formatValue(ctx, v, recurseTimes);
    if (isSingleLine && !isWithoutLineBreak(str)) isSingleLine = false;
    ArrayPrototypePush.$call(output, str);
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  if (isSingleLine) outputWithoutLineBreak = output;
  return output;
}

function formatMap(value: any, ctx: Context, recurseTimes: number): unknown[] {
  const length = value.size;
  const maxLength = $min(MathMax(0, ctx.maxArrayLength as any), length);
  const remaining = length - maxLength;
  const output: unknown[] = [];
  ctx.indentationLvl += 2;
  let i = 0;
  let isSingleLine = true;
  for (const entry of value) {
    const k = entry[0];
    const v = entry[1];
    if (i >= maxLength) break;
    const key = formatValue(ctx, k, recurseTimes);
    if (isSingleLine && !isWithoutLineBreak(key)) isSingleLine = false;
    const keyString = `${key}`;
    const str = formatValue(ctx, v, recurseTimes);
    if (isSingleLine && !isWithoutLineBreak(str)) isSingleLine = false;
    ArrayPrototypePush.$call(output, `${keyString} => ${str}`);
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  if (isSingleLine) outputWithoutLineBreak = output;
  return output;
}

function formatSetIterInner(ctx: Context, recurseTimes: number, entries: unknown[], state: number): unknown[] {
  const maxArrayLength = MathMax(ctx.maxArrayLength as any, 0);
  const maxLength = $min(maxArrayLength, entries.length);
  const output = new Array<unknown>(maxLength);
  ctx.indentationLvl += 2;
  for (let i = 0; i < maxLength; i++) {
    output[i] = formatValue(ctx, entries[i], recurseTimes);
  }
  ctx.indentationLvl -= 2;
  if (state === kWeak && !ctx.sorted) {
    // Sort all entries to have a halfway reliable output (if more entries than
    // retrieved ones exist, we can not reliably return the same output) if the
    // output is not sorted anyway.
    ArrayPrototypeSort.$call(output);
  }
  const remaining = entries.length - maxLength;
  if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  return output;
}

function formatMapIterInner(ctx: Context, recurseTimes: number, entries: unknown[], state: number): unknown[] {
  const maxArrayLength = MathMax(ctx.maxArrayLength as any, 0);
  // Entries exist as [key1, val1, key2, val2, ...]
  const len = entries.length / 2;
  const remaining = len - maxArrayLength;
  const maxLength = $min(maxArrayLength, len);
  const output = new Array<unknown>(maxLength);
  let i = 0;
  ctx.indentationLvl += 2;
  if (state === kWeak) {
    for (; i < maxLength; i++) {
      const pos = i * 2;
      output[i] = `${formatValue(ctx, entries[pos], recurseTimes)} => ${formatValue(
        ctx,
        entries[pos + 1],
        recurseTimes,
      )}`;
    }
    // Sort all entries to have a halfway reliable output (if more entries than
    // retrieved ones exist, we can not reliably return the same output) if the
    // output is not sorted anyway.
    if (!ctx.sorted) ArrayPrototypeSort.$call(output);
  } else {
    for (; i < maxLength; i++) {
      const pos = i * 2;
      const res = [formatValue(ctx, entries[pos], recurseTimes), formatValue(ctx, entries[pos + 1], recurseTimes)];
      output[i] = reduceToSingleString(ctx, res, "", ["[", "]"], kArrayExtrasType, recurseTimes);
    }
  }
  ctx.indentationLvl -= 2;
  if (remaining > 0) {
    ArrayPrototypePush.$call(output, remainingText(remaining));
  }
  return output;
}

function formatWeakCollection(ctx: Context): unknown[] {
  return [stylize(ctx, "<items unknown>", "special")];
}

function formatWeakSet(ctx: Context, value: unknown, recurseTimes: number): unknown[] {
  const entries = previewEntries(value);
  return formatSetIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatWeakMap(ctx: Context, value: unknown, recurseTimes: number): unknown[] {
  const entries = previewEntries(value);
  return formatMapIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatIterator(braces: string[], ctx: Context, value: unknown, recurseTimes: number): unknown[] {
  const preview = previewEntries(value, true);
  const entries = preview[0];
  const isKeyValue = preview[1];
  if (isKeyValue) {
    // TODO(bun): JSC can also differ between the keys and values iterator, maybe we should also distinguish those in the future?
    // Mark entry iterators as such.
    braces[0] = RegExpPrototypeSymbolReplace.$call(/ Iterator] {$/, braces[0], " Entries] {");
    return formatMapIterInner(ctx, recurseTimes, entries, kMapEntries);
  }

  return formatSetIterInner(ctx, recurseTimes, entries, kIterator);
}

function formatPromise(ctx: Context, value: any, recurseTimes: number): unknown[] {
  let output: unknown[];
  const details = getPromiseDetails(value);
  const state = details[0];
  const result = details[1];
  if (state === kPending) {
    output = [stylize(ctx, "<pending>", "special")];
  } else {
    ctx.indentationLvl += 2;
    const str = formatValue(ctx, result, recurseTimes);
    ctx.indentationLvl -= 2;
    output = [state === kRejected ? `${stylize(ctx, "<rejected>", "special")} ${str}` : str];
  }
  return output;
}

function formatExtraProperties(ctx: Context, value: any, recurseTimes: number, key: string, typedArray: unknown): string {
  ctx.indentationLvl += 2;
  const str = formatValue(ctx, value[key], recurseTimes, typedArray);
  ctx.indentationLvl -= 2;

  // These entries are mainly getters. Should they be formatted like getters?
  const name = stylize(ctx, `[${key}]`, "string");
  return `${name}: ${str}`;
}

function formatProperty(
  ctx: Context,
  value: any,
  recurseTimes: number,
  key: PropertyKey,
  type: number,
  desc?: any,
  original: any = value,
): unknown {
  let name: unknown, str: unknown;
  let extra = " ";
  let isSingleLine = false;
  desc ||= ObjectGetOwnPropertyDescriptor(value, key) || missingPropertyDescriptor(value, key);
  const descValue = desc.value;
  let descGet: any;
  if (descValue !== undefined) {
    const diff = ctx.compact !== true || type !== kObjectType ? 2 : 3;
    ctx.indentationLvl += diff;
    str = formatValue(ctx, descValue, recurseTimes);
    isSingleLine = isWithoutLineBreak(str);
    if (diff === 3 && (ctx.breakLength as any) < getStringWidth(str, ctx.colors)) {
      extra = `\n${StringPrototypeRepeat.$call(" ", ctx.indentationLvl)}`;
      isSingleLine = false;
    }
    ctx.indentationLvl -= diff;
  } else if ((descGet = desc.get) !== undefined) {
    const label = desc.set !== undefined ? "Getter/Setter" : "Getter";
    const s: any = ctx.stylize;
    const sp = "special";
    if (
      ctx.getters &&
      (ctx.getters === true ||
        (ctx.getters === "get" && desc.set === undefined) ||
        (ctx.getters === "set" && desc.set !== undefined))
    ) {
      try {
        const tmp = descGet.$call(original);
        ctx.indentationLvl += 2;
        if (tmp === null) {
          str = `${s(`[${label}:`, sp)} ${s("null", "null")}${s("]", sp)}`;
        } else if (typeof tmp === "object") {
          str = `${s(`[${label}]`, sp)} ${formatValue(ctx, tmp, recurseTimes)}`;
        } else {
          const primitive = formatPrimitive(s, tmp, ctx);
          str = `${s(`[${label}:`, sp)} ${primitive}${s("]", sp)}`;
        }
        ctx.indentationLvl -= 2;
      } catch (err: any) {
        const message = `<Inspection threw (${err.message})>`;
        str = `${s(`[${label}:`, sp)} ${message}${s("]", sp)}`;
      }
    } else {
      str = stylize(ctx, `[${label}]`, sp);
    }
  } else if (desc.set !== undefined) {
    str = stylize(ctx, "[Setter]", "special");
  } else if (ctx.isPlain) {
    str = withoutLineBreak = "undefined";
    isSingleLine = true;
  } else {
    str = stylize(ctx, "undefined", "undefined");
  }
  if (type === kArrayType) return str;
  if (typeof key === "symbol") {
    const tmp = RegExpPrototypeSymbolReplace.$call(strEscapeSequencesReplacer, SymbolPrototypeToString.$call(key), escapeFn);
    name = stylize(ctx, tmp, "symbol");
  } else if (typeof key === "string" ? isIdentifier(key) : RegExpPrototypeExec.$call(keyStrRegExp, key as any) !== null) {
    name = key === "__proto__" ? "['__proto__']" : stylize(ctx, key, "name");
  } else {
    name = stylize(ctx, strEscape(key as string), "string");
  }

  if (desc.enumerable === false) {
    name = `[${name}]`;
  }
  const property = `${name}:${extra}${str}`;
  if (isSingleLine && ctx.isPlain) withoutLineBreak = property;
  return property;
}

function missingPropertyDescriptor(value: any, key: PropertyKey): Record<string, unknown> {
  return { value: value[key], enumerable: true };
}

function isBelowBreakLength(ctx: Context, output: unknown[], start: unknown, base: unknown): boolean {
  // Each entry is separated by at least a comma. Thus, we start with a total
  // length of at least `output.length`. In addition, some cases have a
  // whitespace in-between each other that is added to the total as well.
  // TODO(BridgeAR): Add unicode support. Use the readline getStringWidth
  // function. Check the performance overhead and make it an opt-in in case it's
  // significant.
  const breakLength = ctx.breakLength;
  if (typeof start !== "number" || typeof breakLength !== "number" || ctx.colors) {
    return isBelowBreakLengthOfAnything(ctx, output, start, base);
  }
  let totalLength = output.length + start;
  if (totalLength + output.length > breakLength) return false;
  for (let i = 0; i < output.length; i++) {
    const entry = output[i];
    if (typeof entry !== "string") return isBelowBreakLengthOfAnything(ctx, output, start, base);
    totalLength += entry.length;
    if (totalLength > breakLength) {
      return false;
    }
  }
  // Do not line up properties on the same line if `base` contains line breaks.
  return base === "" || !StringPrototypeIncludes.$call(base as any, "\n");
}

function isBelowBreakLengthOfAnything(ctx: Context, output: any[], start: any, base: unknown): boolean {
  let totalLength = output.length + start;
  if (totalLength + output.length > (ctx.breakLength as any)) return false;
  for (let i = 0; i < output.length; i++) {
    if (ctx.colors) {
      totalLength += StringPrototypeReplaceAll.$call(output[i], /\u001B\[\d\d?m/g, "").length; // remove colors
    } else {
      totalLength += output[i].length;
    }
    if (totalLength > (ctx.breakLength as any)) {
      return false;
    }
  }
  return base === "" || !StringPrototypeIncludes.$call(base as any, "\n");
}

function joinOutput(output: unknown[], separator: string): string {
  const length = output.length;
  if (length === 0 || length > 16) return ArrayPrototypeJoin.$call(output, separator);
  let result = "";
  for (let i = 0; i < length; i++) {
    const entry = output[i];
    if (typeof entry !== "string") return ArrayPrototypeJoin.$call(output, separator);
    result = i === 0 ? entry : result + separator + entry;
  }
  return result;
}

function reduceToSingleString(
  ctx: Context,
  output: unknown[],
  base: unknown,
  braces: string[],
  extrasType: number,
  recurseTimes: number,
  value?: unknown,
  isSingleLine = false,
): string {
  const compact = ctx.compact;
  if (compact !== true) {
    if (typeof compact === "number" && compact >= 1) {
      // Memorize the original output length. In case the output is grouped,
      // prevent lining up the entries on a single line.
      const entries = output.length;
      // Group array elements together if the array contains at least six
      // separate entries.
      if (extrasType === kArrayExtrasType && entries > 6) {
        output = groupArrayElements(ctx, output, value);
      }
      // `ctx.currentDepth` is set to the most inner depth of the currently
      // inspected object part while `recurseTimes` is the actual current depth
      // that is inspected.
      //
      // Example:
      //
      // const a = { first: [ 1, 2, 3 ], second: { inner: [ 1, 2, 3 ] } }
      //
      // The deepest depth of `a` is 2 (a.second.inner) and `a.first` has a max
      // depth of 1.
      //
      // Consolidate all entries of the local most inner depth up to
      // `ctx.compact`, as long as the properties are smaller than
      // `ctx.breakLength`.
      let outputLength: number;
      if (ctx.currentDepth - recurseTimes < compact && entries === (outputLength = output.length)) {
        // Line up all entries on a single line in case the entries do not
        // exceed `breakLength`. Add 10 as constant to start next to all other
        // factors that may reduce `breakLength`.
        const start = outputLength + ctx.indentationLvl + braces[0].length + (base as any).length + 10;
        if (isBelowBreakLength(ctx, output, start, base)) {
          const joinedOutput = joinOutput(output, ", ");
          if (isSingleLine || !StringPrototypeIncludes.$call(joinedOutput, "\n")) {
            const res = `${base ? `${base} ` : ""}${braces[0]} ${joinedOutput}` + ` ${braces[1]}`;
            if (braces[0].length === 1 && typeof base === "string") withoutLineBreak = res;
            return res;
          }
        }
      }
    }
    // Line up each entry on an individual line.
    const indentation = `\n${StringPrototypeRepeat.$call(" ", ctx.indentationLvl)}`;
    return (
      `${base ? `${base} ` : ""}${braces[0]}${indentation}  ` +
      `${joinOutput(output, `,${indentation}  `)}${indentation}${braces[1]}`
    );
  }
  // Line up all entries on a single line in case the entries do not exceed
  // `breakLength`.
  if (isBelowBreakLength(ctx, output, 0, base)) {
    return `${braces[0]}${base ? ` ${base}` : ""} ${ArrayPrototypeJoin.$call(output, ", ")} ` + braces[1];
  }
  const indentation = StringPrototypeRepeat.$call(" ", ctx.indentationLvl);
  // If the opening "brace" is too large, like in the case of "Set {",
  // we need to force the first item to be on the next line or the
  // items will not line up correctly.
  const ln = base === "" && braces[0].length === 1 ? " " : `${base ? ` ${base}` : ""}\n${indentation}  `;
  // Line up each entry on an individual line.
  return `${braces[0]}${ln}${ArrayPrototypeJoin.$call(output, `,\n${indentation}  `)} ${braces[1]}`;
}

function hasBuiltInToString(value: any): boolean {
  // Prevent triggering proxy traps.
  const getFullProxy = false;
  const proxyTarget = getProxyDetails(value, getFullProxy);
  if (proxyTarget !== undefined) {
    if (proxyTarget === null) {
      return true;
    }
    return hasBuiltInToString(proxyTarget);
  }

  let hasOwnToString = true;
  let hasOwnToPrimitive = true;

  // Count objects without `toString` and `Symbol.toPrimitive` function as built-in.
  if (typeof value.toString !== "function") {
    if (typeof value[SymbolToPrimitive] !== "function") {
      return true;
    } else if (ObjectHasOwn(value, SymbolToPrimitive)) {
      return false;
    }
    hasOwnToString = false;
  } else if (ObjectHasOwn(value, "toString")) {
    return false;
  } else if (typeof value[SymbolToPrimitive] !== "function") {
    hasOwnToPrimitive = false;
  } else if (ObjectHasOwn(value, SymbolToPrimitive)) {
    return false;
  }

  // Find the object that has the `toString` property or `Symbol.toPrimitive` property
  // as own property in the prototype chain.
  let pointer = value;
  do {
    pointer = ObjectGetPrototypeOf(pointer);
  } while (
    !(hasOwnToString && ObjectPrototypeHasOwnProperty.$call(pointer, "toString")) &&
    !(hasOwnToPrimitive && ObjectPrototypeHasOwnProperty.$call(pointer, SymbolToPrimitive))
  );

  // Check closer if the object is a built-in.
  const descriptor = ObjectGetOwnPropertyDescriptor(pointer, "constructor");
  return (
    descriptor !== undefined && typeof descriptor.value === "function" && builtInObjects.has(descriptor.value.name)
  );
}

const firstErrorLine = (error: any): string => StringPrototypeSplit.$call(error.message, "\n", 1)[0];
let CIRCULAR_ERROR_MESSAGE: string | undefined;
function tryStringify(arg: unknown): string | undefined {
  try {
    return JSONStringify(arg);
  } catch (err: any) {
    // Populate the circular error message lazily
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        const a: Record<string, unknown> = {};
        a.a = a;
        JSONStringify(a);
      } catch (circularError) {
        CIRCULAR_ERROR_MESSAGE = firstErrorLine(circularError);
      }
    }
    if (err.name === "TypeError" && firstErrorLine(err) === CIRCULAR_ERROR_MESSAGE) {
      return "[Circular]";
    }
    throw err;
  }
}

function format(...args: unknown[]): string {
  if (args.length === 1) {
    const first = args[0];
    if (typeof first === "string") return first;
  }
  return formatWithOptionsInternal(undefined, args);
}

function formatWithOptions(inspectOptions: unknown, ...args: unknown[]): string {
  validateObject(inspectOptions, "inspectOptions", kValidateObjectAllowArray);
  return formatWithOptionsInternal(inspectOptions, args);
}

function formatNumberNoColor(number: number, options: any): string {
  return numberToString(number, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
}

function formatBigIntNoColor(bigint: bigint, options: any): string {
  return bigIntToString(bigint, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
}

function toAppendedString(value: unknown): string {
  return typeof value === "string" ? value : "" + (value as any);
}

function parseIntOfNumber(number: number): number {
  const abs = number < 0 ? -number : number;
  if (abs >= 1e-6 && abs < 1e21) return MathTrunc(number);
  return number === 0 ? 0 : NumberParseInt(number as any);
}

function formatWithOptionsInternal(inspectOptions: any, args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") {
    if (args.length === 1) {
      return first;
    }
    return formatWithFormatString(inspectOptions, first, args);
  }
  return appendArguments(inspectOptions, args, 0, "", "");
}

function formatWithFormatString(inspectOptions: any, first: string, args: unknown[]): string {
  let a = 0;
  let str = "";
  let tempStr: string;
  let lastPos = 0;
  const argsLength = args.length;
  const end = first.length - 1;

  for (let i = 0; i < end; i++) {
    while (StringPrototypeCharCodeAt.$call(first, i) !== 37 && ++i < end);
    if (i < end) {
      // '%'
      const nextChar = StringPrototypeCharCodeAt.$call(first, ++i);
      if (a + 1 !== argsLength) {
        switch (nextChar) {
          case 115: {
            // 's'
            const tempArg = args[++a];
            if (typeof tempArg === "string") {
              tempStr = tempArg;
            } else if (typeof tempArg === "number") {
              tempStr = formatNumberNoColor(tempArg, inspectOptions);
            } else if (typeof tempArg === "bigint") {
              tempStr = formatBigIntNoColor(tempArg, inspectOptions);
            } else if (typeof tempArg !== "object" || tempArg === null || !hasBuiltInToString(tempArg)) {
              tempStr = String(tempArg);
            } else {
              tempStr = toAppendedString(
                inspect(tempArg, {
                  ...inspectOptions,
                  compact: 3,
                  colors: false,
                  depth: 0,
                }),
              );
            }
            break;
          }
          case 106: {
            // 'j'
            const tempJSON = args[++a];
            if (typeof tempJSON === "number") {
              tempStr = NumberIsFinite(tempJSON) ? `${tempJSON}` : "null";
            } else {
              const json = tryStringify(tempJSON);
              tempStr = json === undefined ? "undefined" : json;
            }
            break;
          }
          case 100: {
            // 'd'
            const tempNum = args[++a];
            if (typeof tempNum === "number") {
              tempStr = formatNumberNoColor(tempNum, inspectOptions);
            } else if (typeof tempNum === "bigint") {
              tempStr = formatBigIntNoColor(tempNum, inspectOptions);
            } else if (typeof tempNum === "symbol") {
              tempStr = "NaN";
            } else {
              tempStr = formatNumberNoColor(Number(tempNum), inspectOptions);
            }
            break;
          }
          case 79: // 'O'
            tempStr = toAppendedString(inspect(args[++a], inspectOptions));
            break;
          case 111: // 'o'
            tempStr = toAppendedString(
              inspect(args[++a], {
                ...inspectOptions,
                showHidden: true,
                showProxy: true,
                depth: 4,
              }),
            );
            break;
          case 105: {
            // 'i'
            const tempInteger = args[++a];
            if (typeof tempInteger === "number") {
              tempStr = formatNumberNoColor(parseIntOfNumber(tempInteger), inspectOptions);
            } else if (typeof tempInteger === "bigint") {
              tempStr = formatBigIntNoColor(tempInteger, inspectOptions);
            } else if (typeof tempInteger === "symbol") {
              tempStr = "NaN";
            } else {
              tempStr = formatNumberNoColor(NumberParseInt(tempInteger as any), inspectOptions);
            }
            break;
          }
          case 102: {
            // 'f'
            const tempFloat = args[++a];
            if (typeof tempFloat === "number") {
              tempStr = formatNumberNoColor(tempFloat === 0 ? 0 : tempFloat, inspectOptions);
            } else if (typeof tempFloat === "symbol") {
              tempStr = "NaN";
            } else {
              tempStr = formatNumberNoColor(NumberParseFloat(tempFloat as any), inspectOptions);
            }
            break;
          }
          case 99: // 'c'
            a += 1;
            tempStr = "";
            break;
          case 37: // '%'
            str += StringPrototypeSlice.$call(first, lastPos, i);
            lastPos = i + 1;
            continue;
          default: // Any other character is not a correct placeholder
            continue;
        }
        if (lastPos !== i - 1) {
          str += StringPrototypeSlice.$call(first, lastPos, i - 1);
        }
        str += tempStr;
        lastPos = i + 1;
      } else if (nextChar === 37) {
        str += StringPrototypeSlice.$call(first, lastPos, i);
        lastPos = i + 1;
      }
    }
  }
  if (lastPos === 0) {
    return appendArguments(inspectOptions, args, 0, "", "");
  }
  if (lastPos < first.length) {
    str += StringPrototypeSlice.$call(first, lastPos);
  }
  return appendArguments(inspectOptions, args, a + 1, str, " ");
}

function appendArguments(inspectOptions: any, args: unknown[], a: number, str: string, join: string): string {
  while (a < args.length) {
    const value = args[a];
    str += join;
    str += typeof value !== "string" ? toAppendedString(inspect(value, inspectOptions)) : value;
    join = " ";
    a++;
  }
  return str;
}
function isPrintableASCII(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const point = StringPrototypeCharCodeAt.$call(str, i);
    if (point < 32 || point > 126) return false;
  }
  return true;
}

const internalGetStringWidth = $newCppFunction("stringWidth.cpp", "jsFunctionBunStringWidth", 1);
/**
 * Returns the number of columns required to display the given string.
 */
const kPerCodePointWidthOptions: Record<string, unknown> = { __proto__: null, perCodePoint: true, countAnsiEscapeCodes: true };

function getStringWidth(str: any, removeControlChars: unknown = true): number {
  if (typeof str === "string" && str.length <= 32 && isPrintableASCII(str)) return str.length;
  if (removeControlChars) str = stripVTControlCharacters(str);
  str = StringPrototypeNormalize.$call(str, "NFC");
  // node measures per code point, not grapheme clusters; ANSI was already stripped above.
  // https://github.com/nodejs/node/blob/main/src/node_i18n.cc (GetColumnWidth)
  return internalGetStringWidth(str, kPerCodePointWidthOptions);
}

// node's ansi matcher (from chalk/ansi-regex): only complete sequences are stripped —
// Bun.stripANSI also eats bare/invalid ESC/CSI prefixes, which node keeps.
// https://github.com/nodejs/node/blob/main/lib/internal/util/inspect.js
let ansi: RegExp | undefined;
function getAnsiRegExp(): RegExp {
  return (ansi ??= new RegExp(
    "[\\u001B\\u009B][[\\]()#;?]*" +
      "(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*" +
      "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?" +
      "(?:\\u0007|\\u001B\\u005C|\\u009C))" +
      "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?" +
      "[\\dA-PR-TZcf-nq-uy=><~]))",
    "g",
  ));
}

function stripVTControlCharacters(str: unknown): string {
  if (typeof str !== "string") throw $ERR_INVALID_ARG_TYPE("str", "string", str);
  // All ANSI escape sequences start with ESC (7-bit) or CSI (8-bit).
  if (StringPrototypeIndexOf.$call(str, "\u001B") === -1 && StringPrototypeIndexOf.$call(str, "\u009B") === -1) {
    return str;
  }
  return RegExpPrototypeSymbolReplace.$call(getAnsiRegExp(), str, "");
}

// utils
const getOwnNonIndexProperties = $newCppFunction("UtilInspect.cpp", "jsFunctionGetOwnNonIndexProperties", 2);
function getPromiseDetails(promise: any): unknown[] {
  const state = $peekPromiseStatus(promise);
  if (state !== 0) {
    return [state === 2 ? kRejected : kFulfilled, $peekPromiseSettledValue(promise)];
  }
  return [kPending, undefined];
}
function getProxyDetails(proxy: any, withHandler = true): any {
  const isProxy = $isProxyObject(proxy);
  if (!isProxy) return undefined;
  // @ts-ignore
  const handler = $getProxyInternalField(proxy, $proxyFieldHandler);
  // if handler is null, the proxy is revoked
  // @ts-ignore
  const target = handler === null ? null : $getProxyInternalField(proxy, $proxyFieldTarget);
  if (withHandler) return [target, handler];
  else return target;
}
function previewEntries(val: any, isIterator = false): any {
  if (isIterator) {
    // the Map or Set instance this iterator belongs to
    const iteratedObject = $getInternalField(val, 1 /*iteratorFieldIteratedObject*/);
    // for Maps: 0 = keys, 1 = values,      2 = entries
    // for Sets:           1 = keys|values, 2 = entries
    const kind = $getInternalField(val, 3 /*iteratorFieldKind*/);
    const isEntries = kind === 2;
    // TODO(bun): improve performance by not using Array.from and instead using the iterator directly to only get the first
    // few entries which will actually be displayed (this requires changing some logic in the call sites of this function)
    if ($isMap(iteratedObject)) {
      if (isEntries) return [ArrayPrototypeFlat.$call(ArrayFrom(iteratedObject)), true];
      else if (kind === 1) return [ArrayFrom(MapPrototypeValues.$call(iteratedObject)), false];
      else return [ArrayFrom(MapPrototypeKeys.$call(iteratedObject)), false];
    } else if ($isSet(iteratedObject)) {
      if (isEntries) return [ArrayPrototypeFlat.$call(ArrayFrom(SetPrototypeEntries.$call(iteratedObject))), true];
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
}
function internalGetConstructorName(val: any): any {
  if (!val || typeof val !== "object") throw new Error("Invalid object");
  const ctorName = val.constructor?.name;
  if (ctorName) return ctorName;
  const str = ObjectPrototypeToString.$call(val);
  const m = StringPrototypeMatch.$call(str, /^\[object ([^\]]+)\]/); // e.g. [object Boolean]
  return m ? m[1] : "Object";
}

export default {
  inspect,
  format,
  formatWithOptions,
  getStringWidth,
  stripVTControlCharacters,
};
