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

const { pathToFileURL } = require("node:url");

const primordials = require("internal/primordials");
const {
  Array,
  ArrayFrom,
  ArrayIsArray,
  ArrayPrototypeFilter,
  ArrayPrototypeFlat,
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePop,
  ArrayPrototypePush,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  ArrayPrototypeSplice,
  ArrayPrototypeSort,
  ArrayPrototypeUnshift,
  BigIntPrototypeValueOf,
  BooleanPrototypeValueOf,
  DatePrototypeGetTime,
  DatePrototypeToISOString,
  DatePrototypeToString,
  ErrorCaptureStackTrace,
  ErrorPrototypeToString,
  FunctionPrototypeBind,
  FunctionPrototypeToString,
  JSONStringify,
  MapPrototypeGetSize,
  MapPrototypeEntries,
  MapPrototypeValues,
  MapPrototypeKeys,
  MathFloor,
  MathMax,
  MathMin,
  MathRound,
  MathSqrt,
  MathTrunc,
  Number,
  NumberIsFinite,
  NumberIsNaN,
  NumberParseFloat,
  NumberParseInt,
  NumberPrototypeToString,
  NumberPrototypeValueOf,
  Object,
  ObjectAssign,
  ObjectDefineProperty,
  ObjectEntries,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames,
  ObjectGetOwnPropertySymbols,
  ObjectGetPrototypeOf,
  ObjectIs,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  ObjectPrototypePropertyIsEnumerable,
  ObjectPrototypeToString,
  ObjectSeal,
  ObjectSetPrototypeOf,
  ReflectApply,
  ReflectOwnKeys,
  RegExp,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSplit,
  RegExpPrototypeTest,
  RegExpPrototypeToString,
  SafeMap,
  SafeSet,
  SetPrototypeEntries,
  SetPrototypeGetSize,
  SetPrototypeValues,
  String,
  StringPrototypeCharCodeAt,
  StringPrototypeCodePointAt,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeMatch,
  StringPrototypeNormalize,
  StringPrototypePadEnd,
  StringPrototypePadStart,
  StringPrototypeRepeat,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeEndsWith,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
  StringPrototypeValueOf,
  SymbolPrototypeToString,
  SymbolPrototypeValueOf,
  SymbolIterator,
  SymbolToStringTag,
  TypedArrayPrototypeGetLength,
  TypedArrayPrototypeGetSymbolToStringTag,
  Uint8Array,
} = primordials;

const customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");
const kPending = Symbol("kPending"); // state ID 0
const kFulfilled = Symbol("kFulfilled"); // state ID 1
const kRejected = Symbol("kRejected"); // state ID 2
const ALL_PROPERTIES = 0;
const ONLY_ENUMERABLE = 2;

const isAsyncFunction = v =>
  typeof v === "function" && StringPrototypeStartsWith(FunctionPrototypeToString(v), "async");
const isGeneratorFunction = v =>
  typeof v === "function" && StringPrototypeMatch(FunctionPrototypeToString(v), /^(async\s+)?function *\*/);

function vmSafeInstanceof(val, ctor) {
  if (val instanceof ctor) return true;
  // instanceof doesn't work across vm boundaries, so check the whole inheritance chain
  while (val) {
    if (typeof val !== "object") return false;
    if (ctor.name === internalGetConstructorName(val)) return true;
    val = ObjectGetPrototypeOf(val);
  }
  return false;
}
function checkBox(ctor) {
  return val => {
    if (!vmSafeInstanceof(val, ctor)) return false;
    try {
      ctor.prototype.valueOf.$call(val);
    } catch {
      return false;
    }
    return true;
  };
}
const isBigIntObject = checkBox(BigInt);
const isSymbolObject = checkBox(Symbol);

const {
  //! The native versions of the commented out functions are currently buggy, so we use the polyfills above for now.
  //isAsyncFunction,
  //isGeneratorFunction,
  isAnyArrayBuffer,
  isArrayBuffer,
  isArgumentsObject,
  isBoxedPrimitive: _native_isBoxedPrimitive,
  isDataView,
  isExternal,
  isMap,
  isMapIterator,
  isModuleNamespaceObject,
  isNativeError,
  isPromise,
  isSet,
  isSetIterator,
  isWeakMap,
  isWeakSet,
  isRegExp,
  isDate,
  isTypedArray,
  isStringObject,
  isNumberObject,
  isBooleanObject,
  //isBigIntObject,
} = require("node:util/types");

//! temp workaround to apply is{BigInt,Symbol}Object fix
const isBoxedPrimitive = val => isBigIntObject(val) || isSymbolObject(val) || _native_isBoxedPrimitive(val);

// We need this duplicate here to avoid a circular dependency between node:assert and node:util.
class AssertionError extends Error {
  constructor(message, isForced = false) {
    super(message);
    this.name = "AssertionError";
    this.code = "ERR_ASSERTION";
    this.operator = "==";
    this.generatedMessage = !isForced;
    this.actual = isForced && undefined;
    this.expected = !isForced || undefined;
  }
}
function assert(p, message) {
  if (!p) throw new AssertionError(message);
}

const codes = {}; // exported from errors.js
{
  // errors.js
  // Sorted by a rough estimate on most frequently used entries.
  const kTypes = [
    "string",
    "function",
    "number",
    "object",
    // Accept 'Function' and 'Object' as alternative to the lower cased version.
    "Function",
    "Object",
    "boolean",
    "bigint",
    "symbol",
  ];
  const classRegExp = /^([A-Z][a-z0-9]*)+$/;
  const messages = new SafeMap();
  const sym = "ERR_INVALID_ARG_TYPE";
  messages.set(sym, (name, expected, actual) => {
    assert(typeof name === "string", "'name' must be a string");
    if (!ArrayIsArray(expected)) expected = [expected];

    let msg = "The ";
    if (StringPrototypeEndsWith(name, " argument")) msg += `${name} `; // For cases like 'first argument'
    else msg += `"${name}" ${StringPrototypeIncludes(name, ".") ? "property" : "argument"} `;
    msg += "must be ";

    const types = [];
    const instances = [];
    const other = [];
    for (const value of expected) {
      assert(typeof value === "string", "All expected entries have to be of type string");
      if (ArrayPrototypeIncludes(kTypes, value)) ArrayPrototypePush(types, StringPrototypeToLowerCase(value));
      else if (RegExpPrototypeTest(classRegExp, value)) ArrayPrototypePush(instances, value);
      else {
        assert(value !== "object", 'The value "object" should be written as "Object"');
        ArrayPrototypePush(other, value);
      }
    }
    // Special handle `object` in case other instances are allowed to outline the differences between each other.
    if (instances.length > 0) {
      const pos = ArrayPrototypeIndexOf(types, "object");
      if (pos !== -1) {
        ArrayPrototypeSplice(types, pos, 1);
        ArrayPrototypePush(instances, "Object");
      }
    }
    if (types.length > 0) {
      if (types.length > 2) msg += `one of type ${ArrayPrototypeJoin(types, ", ")}, or ${ArrayPrototypePop(types)}`;
      else if (types.length === 2) msg += `one of type ${types[0]} or ${types[1]}`;
      else msg += `of type ${types[0]}`;
      if (instances.length > 0 || other.length > 0) msg += " or ";
    }
    if (instances.length > 0) {
      if (instances.length > 2)
        msg += `an instance of ${ArrayPrototypeJoin(instances, ", ")}, or ${ArrayPrototypePop(instances)}`;
      else msg += `an instance of ${instances[0]}` + (instances.length === 2 ? ` or ${instances[1]}` : "");
      if (other.length > 0) msg += " or ";
    }
    if (other.length > 0) {
      if (other.length > 2) {
        const last = ArrayPrototypePop(other);
        msg += `one of ${ArrayPrototypeJoin(other, ", ")}, or ${last}`;
      } else if (other.length === 2) {
        msg += `one of ${other[0]} or ${other[1]}`;
      } else {
        if (StringPrototypeToLowerCase(other[0]) !== other[0]) msg += "an ";
        msg += `${other[0]}`;
      }
    }

    if (actual == null) msg += `. Received ${actual}`;
    else if (typeof actual === "function" && actual.name) msg += `. Received function ${actual.name}`;
    else if (typeof actual === "object") {
      if (actual.constructor && actual.constructor.name) msg += `. Received an instance of ${actual.constructor.name}`;
      else msg += `. Received ${inspect(actual, { depth: -1 })}`;
    } else {
      let inspected = inspect(actual, { colors: false });
      if (inspected.length > 25) inspected = `${StringPrototypeSlice(inspected, 0, 25)}...`;
      msg += `. Received type ${typeof actual} (${inspected})`;
    }
    return msg;
  });
  codes[sym] = function NodeError(...args) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    const error = new TypeError();
    Error.stackTraceLimit = limit; // Reset the limit and setting the name property.

    const msg = messages.get(sym);
    assert(typeof msg === "function");
    assert(
      msg.length <= args.length, // Default options do not count.
      `Code: ${sym}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`,
    );
    const message = ReflectApply(msg, error, args);

    ObjectDefineProperty(error, "message", { value: message, enumerable: false, writable: true, configurable: true });
    ObjectDefineProperty(error, "toString", {
      value() {
        return `${this.name} [${sym}]: ${this.message}`;
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // addCodeToName + captureLargerStackTrace
    let err = error;
    const userStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    ErrorCaptureStackTrace(err);
    Error.stackTraceLimit = userStackTraceLimit; // Reset the limit
    err.name = `${TypeError.name} [${sym}]`; // Add the error code to the name to include it in the stack trace.
    err.stack; // Access the stack to generate the error message including the error code from the name.
    delete err.name; // Reset the name to the actual name.
    error.code = sym;
    return error;
  };
}
/**
 * @param {unknown} value
 * @param {string} name
 * @param {{ allowArray?: boolean, allowFunction?: boolean, nullable?: boolean }} [options] */
const validateObject = (value, name, allowArray = false) => {
  if (
    value === null ||
    (!allowArray && ArrayIsArray(value)) ||
    (typeof value !== "object" && typeof value !== "function")
  )
    throw new codes.ERR_INVALID_ARG_TYPE(name, "Object", value);
};

const builtInObjects = new SafeSet(
  ArrayPrototypeFilter(
    ObjectGetOwnPropertyNames(globalThis),
    e => RegExpPrototypeExec(/^[A-Z][a-zA-Z0-9]+$/, e) !== null,
  ),
);

// https://tc39.es/ecma262/#sec-IsHTMLDDA-internal-slot
const isUndetectableObject = v => typeof v === "undefined" && v !== undefined;

// This is used for detecting stack overflows during inspection.
// It will probably never need to be changed, but it's here just in case JSC does change the message.
const ERROR_STACK_OVERFLOW_MSG = "Maximum call stack size exceeded.";

// These options must stay in sync with `getUserOptions`. So if any option will
// be added or removed, `getUserOptions` must also be updated accordingly.
const inspectDefaultOptions = ObjectSeal({
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
});
const inspectReplDefaults = ObjectSeal({
  ...inspectDefaultOptions,
  colors: Bun.enableANSIColors,
  showProxy: true,
});

const kObjectType = 0;
const kArrayType = 1;
const kArrayExtrasType = 2;

// Work-arounds for Safari not implementing negative look-behinds.
// Remove all of this once Safari 16.4 is rolled out "enough".
let strEscapeSequencesRegExp,
  strEscapeSequencesReplacer,
  strEscapeSequencesRegExpSingle,
  strEscapeSequencesReplacerSingle,
  extractedSplitNewLines;
try {
  // Change from regex literals to RegExp constructors to avoid unrecoverable
  // syntax error at load time.
  strEscapeSequencesRegExp = new RegExp(
    "[\\x00-\\x1f\\x27\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
  );
  strEscapeSequencesReplacer = new RegExp(
    "[\x00-\\x1f\\x27\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
    "g",
  );
  strEscapeSequencesRegExpSingle = new RegExp(
    "[\\x00-\\x1f\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
  );
  strEscapeSequencesReplacerSingle = new RegExp(
    "[\\x00-\\x1f\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
    "g",
  );
  const extractedNewLineRe = new RegExp("(?<=\\n)");
  extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
  // CI doesn't run in an elderly runtime
} catch {
  // These are from a previous version of node,
  // see commit 76372607a6743cc75eae50ca58657c9e8a654428
  // dated 2021-12-06
  strEscapeSequencesRegExp = /[\x00-\x1f\x27\x5c\x7f-\x9f]/;
  strEscapeSequencesReplacer = /[\x00-\x1f\x27\x5c\x7f-\x9f]/g;
  strEscapeSequencesRegExpSingle = /[\x00-\x1f\x5c\x7f-\x9f]/;
  strEscapeSequencesReplacerSingle = /[\x00-\x1f\x5c\x7f-\x9f]/g;
  extractedSplitNewLines = value => {
    const lines = RegExpPrototypeSymbolSplit(/\n/, value);
    const last = ArrayPrototypePop(lines);
    const nlLines = ArrayPrototypeMap(lines, line => line + "\n");
    if (last !== "") {
      nlLines.push(last);
    }
    return nlLines;
  };
}

const keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const numberRegExp = /^(0|[1-9][0-9]*)$/;

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
const meta = [
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

function getUserOptions(ctx, isCrossContext) {
  const ret = {
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
    ...ctx.userOptions,
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
      let stylized;
      try {
        stylized = `${ctx.stylize(value, flavour)}`;
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
function inspect(value, opts) {
  // Default options
  const ctx = {
    budget: {},
    indentationLvl: 0,
    seen: [],
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
  };
  if (arguments.length > 1) {
    // Legacy...
    if (arguments.length > 2) {
      if (arguments[2] !== undefined) {
        ctx.depth = arguments[2];
      }
      if (arguments.length > 3 && arguments[3] !== undefined) {
        ctx.colors = arguments[3];
      }
    }
    // Set user-specified options
    if (typeof opts === "boolean") {
      ctx.showHidden = opts;
    } else if (opts) {
      const optKeys = ObjectKeys(opts);
      for (let i = 0; i < optKeys.length; ++i) {
        const key = optKeys[i];
        // TODO(BridgeAR): Find a solution what to do about stylize. Either make
        // this function public or add a new API with a similar or better functionality.
        if (ObjectPrototypeHasOwnProperty(inspectDefaultOptions, key) || key === "stylize") {
          ctx[key] = opts[key];
        } else if (ctx.userOptions === undefined) {
          // This is required to pass through the actual user input.
          ctx.userOptions = opts;
        }
      }
    }
  }
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  if (ctx.maxArrayLength === null) ctx.maxArrayLength = Infinity;
  if (ctx.maxStringLength === null) ctx.maxStringLength = Infinity;
  return formatValue(ctx, value, 0);
}
inspect.custom = customInspectSymbol;
ObjectDefineProperty(inspect, "defaultOptions", {
  __proto__: null,
  get() {
    return inspectDefaultOptions;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectDefaultOptions, options);
  },
});
ObjectDefineProperty(inspect, "replDefaults", {
  __proto__: null,
  get() {
    return inspectReplDefaults;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectReplDefaults, options);
  },
});

// Set Graphics Rendition https://en.wikipedia.org/wiki/ANSI_escape_code#graphics
// Each color consists of an array with the color code as first entry and the
// reset code as second entry.
const defaultFG = 39;
const defaultBG = 49;
inspect.colors = {
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

function defineColorAlias(target, alias) {
  ObjectDefineProperty(inspect.colors, alias, {
    __proto__: null,
    get() {
      return this[target];
    },
    set(value) {
      this[target] = value;
    },
    configurable: true,
    enumerable: false,
  });
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
inspect.styles = {
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
  // TODO(BridgeAR): Highlight regular expressions properly.
  regexp: "red",
  module: "underline",
};

function addQuotes(str, quotes) {
  if (quotes === -1) return `"${str}"`;
  if (quotes === -2) return `\`${str}\``;
  return `'${str}'`;
}

function escapeFn(str) {
  const charCode = StringPrototypeCharCodeAt(str);
  return meta.length > charCode ? meta[charCode] : `\\u${NumberPrototypeToString(charCode, 16)}`;
}

// Escape control characters, single quotes and the backslash.
// This is similar to JSON stringify escaping.
function strEscape(str) {
  let escapeTest = strEscapeSequencesRegExp;
  let escapeReplace = strEscapeSequencesReplacer;
  let singleQuote = 39;

  // Check for double quotes. If not present, do not escape single quotes and
  // instead wrap the text in double quotes. If double quotes exist, check for
  // backticks. If they do not exist, use those as fallback instead of the
  // double quotes.
  if (StringPrototypeIncludes(str, "'")) {
    // This invalidates the charCode and therefore can not be matched for
    // anymore.
    if (!StringPrototypeIncludes(str, '"')) {
      singleQuote = -1;
    } else if (!StringPrototypeIncludes(str, "`") && !StringPrototypeIncludes(str, "${")) {
      singleQuote = -2;
    }
    if (singleQuote !== 39) {
      escapeTest = strEscapeSequencesRegExpSingle;
      escapeReplace = strEscapeSequencesReplacerSingle;
    }
  }

  // Some magic numbers that worked out fine while benchmarking with v8 6.0
  if (str.length < 5000 && RegExpPrototypeExec(escapeTest, str) === null) return addQuotes(str, singleQuote);
  if (str.length > 100) {
    str = RegExpPrototypeSymbolReplace(escapeReplace, str, escapeFn);
    return addQuotes(str, singleQuote);
  }

  let result = "";
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const point = StringPrototypeCharCodeAt(str, i);
    if (point === singleQuote || point === 92 || point < 32 || (point > 126 && point < 160)) {
      if (last === i) {
        result += meta[point];
      } else {
        result += `${StringPrototypeSlice(str, last, i)}${meta[point]}`;
      }
      last = i + 1;
    } else if (point >= 0xd800 && point <= 0xdfff) {
      if (point <= 0xdbff && i + 1 < str.length) {
        const point = StringPrototypeCharCodeAt(str, i + 1);
        if (point >= 0xdc00 && point <= 0xdfff) {
          i++;
          continue;
        }
      }
      result += `${StringPrototypeSlice(str, last, i)}\\u${NumberPrototypeToString(point, 16)}`;
      last = i + 1;
    }
  }

  if (last !== str.length) {
    result += StringPrototypeSlice(str, last);
  }
  return addQuotes(result, singleQuote);
}

function stylizeWithColor(str, styleType) {
  const style = inspect.styles[styleType];
  if (style !== undefined) {
    const color = inspect.colors[style];
    if (color !== undefined) return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
  }
  return str;
}

function stylizeNoColor(str) {
  return str;
}

// Return a new empty array to push in the results of the default formatter.
function getEmptyFormatArray() {
  return [];
}

function isInstanceof(object, proto) {
  try {
    return object instanceof proto;
  } catch {
    return false;
  }
}

function getConstructorName(obj, ctx, recurseTimes, protoProps) {
  let firstProto;
  const tmp = obj;
  while (obj || isUndetectableObject(obj)) {
    const descriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
    if (
      descriptor !== undefined &&
      typeof descriptor.value === "function" &&
      descriptor.value.name !== "" &&
      isInstanceof(tmp, descriptor.value)
    ) {
      if (protoProps !== undefined && (firstProto !== obj || !builtInObjects.has(descriptor.value.name))) {
        addPrototypeProperties(ctx, tmp, firstProto || tmp, recurseTimes, protoProps);
      }
      return String(descriptor.value.name);
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

  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    return `${res} <Complex prototype>`;
  }

  const protoConstr = getConstructorName(firstProto, ctx, recurseTimes + 1, protoProps);

  if (protoConstr === null) {
    return `${res} <${inspect(firstProto, {
      ...ctx,
      customInspect: false,
      depth: -1,
    })}>`;
  }

  return `${res} <${protoConstr}>`;
}

// This function has the side effect of adding prototype properties to the
// `output` argument (which is an array). This is intended to highlight user
// defined prototype properties.
function addPrototypeProperties(ctx, main, obj, recurseTimes, output) {
  let depth = 0;
  let keys;
  let keySet;
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
      ArrayPrototypeForEach(keys, key => keySet.add(key));
    }
    // Get all own property names and symbols.
    keys = ReflectOwnKeys(obj);
    ArrayPrototypePush(ctx.seen, main);
    for (const key of keys) {
      // Ignore the `constructor` property and keys that exist on layers above.
      if (key === "constructor" || ObjectPrototypeHasOwnProperty(main, key) || (depth !== 0 && keySet.has(key))) {
        continue;
      }
      const desc = ObjectGetOwnPropertyDescriptor(obj, key);
      if (typeof desc.value === "function") {
        continue;
      }
      const value = formatProperty(ctx, obj, recurseTimes, key, kObjectType, desc, main);
      if (ctx.colors) {
        // Faint!
        ArrayPrototypePush(output, `\u001b[2m${value}\u001b[22m`);
      } else {
        ArrayPrototypePush(output, value);
      }
    }
    ArrayPrototypePop(ctx.seen);
    // Limit the inspection to up to three prototype layers. Using `recurseTimes`
    // is not a good choice here, because it's as if the properties are declared
    // on the current object from the users perspective.
  } while (++depth !== 3);
}

function getPrefix(constructor, tag, fallback, size = "") {
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
function getKeys(value, showHidden) {
  let keys;
  const symbols = ObjectGetOwnPropertySymbols(value);
  if (showHidden) {
    keys = ObjectGetOwnPropertyNames(value);
    if (symbols.length !== 0) ArrayPrototypePushApply(keys, symbols);
  } else {
    // This might throw if `value` is a Module Namespace Object from an
    // unevaluated module, but we don't want to perform the actual type
    // check because it's expensive.
    // TODO(devsnek): track https://github.com/tc39/ecma262/issues/1209
    // and modify this logic as needed.
    try {
      keys = ObjectKeys(value);
    } catch (err) {
      assert(isNativeError(err) && err.name === "ReferenceError" && isModuleNamespaceObject(value));
      keys = ObjectGetOwnPropertyNames(value);
    }
    if (symbols.length !== 0) {
      const filter = key => ObjectPrototypePropertyIsEnumerable(value, key);
      ArrayPrototypePushApply(keys, ArrayPrototypeFilter(symbols, filter));
    }
  }
  return keys;
}

function getCtxStyle(value, constructor, tag) {
  let fallback = "";
  if (constructor === null) {
    fallback = internalGetConstructorName(value);
    if (fallback === tag) {
      fallback = "Object";
    }
  }
  return getPrefix(constructor, tag, fallback);
}

function formatProxy(ctx, proxy, recurseTimes) {
  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    return ctx.stylize("Proxy [Array]", "special");
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
function formatValue(ctx, value, recurseTimes, typedArray) {
  // Primitive types cannot have properties.
  if (typeof value !== "object" && typeof value !== "function" && !isUndetectableObject(value)) {
    return formatPrimitive(ctx.stylize, value, ctx);
  }
  if (value === null) {
    return ctx.stylize("null", "null");
  }

  // Memorize the context for custom inspection on proxies.
  const context = value;
  // Always check for proxies to prevent side effects and to prevent triggering any proxy handlers.
  const proxy = getProxyDetails(value, !!ctx.showProxy);
  if (proxy !== undefined) {
    if (proxy === null || proxy[0] === null) {
      return ctx.stylize("<Revoked Proxy>", "special");
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
      !(value.constructor && value.constructor.prototype === value)
    ) {
      // This makes sure the recurseTimes are reported as before while using
      // a counter internally.
      const depth = ctx.depth === null ? null : ctx.depth - recurseTimes;
      const isCrossContext = proxy !== undefined || !(context instanceof Object);
      const ret = maybeCustom.$call(context, depth, getUserOptions(ctx, isCrossContext), inspect);
      // If the custom inspection method returned `this`, don't go into infinite recursion.
      if (ret !== context) {
        if (typeof ret !== "string") return formatValue(ctx, ret, recurseTimes);
        return StringPrototypeReplaceAll(ret, "\n", `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`);
      }
    }
  }

  // Using an array here is actually better for the average case than using
  // a Set. `seen` will only check for the depth and will never grow too large.
  if (ctx.seen.includes(value)) {
    let index = 1;
    if (ctx.circular === undefined) {
      ctx.circular = new SafeMap();
      ctx.circular.set(value, index);
    } else {
      index = ctx.circular.get(value);
      if (index === undefined) {
        index = ctx.circular.size + 1;
        ctx.circular.set(value, index);
      }
    }
    return ctx.stylize(`[Circular *${index}]`, "special");
  }

  return formatRaw(ctx, value, recurseTimes, typedArray);
}

function formatRaw(ctx, value, recurseTimes, typedArray) {
  let keys;
  let protoProps;
  if (ctx.showHidden && (recurseTimes <= ctx.depth || ctx.depth === null)) {
    protoProps = [];
  }

  const constructor = getConstructorName(value, ctx, recurseTimes, protoProps);
  // Reset the variable to check for this later on.
  if (protoProps !== undefined && protoProps.length === 0) {
    protoProps = undefined;
  }

  let tag = value[SymbolToStringTag];
  // Only list the tag in case it's non-enumerable / not an own property.
  // Otherwise we'd print this twice.
  if (
    typeof tag !== "string" ||
    (tag !== "" &&
      (ctx.showHidden ? ObjectPrototypeHasOwnProperty : ObjectPrototypePropertyIsEnumerable)(value, SymbolToStringTag))
  ) {
    tag = "";
  }
  let base = "";
  let formatter = getEmptyFormatArray;
  let braces;
  let noIterator = true;
  let i = 0;
  const filter = ctx.showHidden ? ALL_PROPERTIES : ONLY_ENUMERABLE;

  let extrasType = kObjectType;

  // Iterators and the rest are split to reduce checks.
  // We have to check all values in case the constructor is set to null.
  // Otherwise it would not possible to identify all types properly.
  if (SymbolIterator in value || constructor === null) {
    noIterator = false;
    if (ArrayIsArray(value)) {
      // Only set the constructor for non ordinary ("Array [...]") arrays.
      const prefix =
        constructor !== "Array" || tag !== "" ? getPrefix(constructor, tag, "Array", `(${value.length})`) : "";
      keys = getOwnNonIndexProperties(value, filter);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && protoProps === undefined) return `${braces[0]}]`;
      extrasType = kArrayExtrasType;
      formatter = formatArray;
    } else if (isSet(value)) {
      const size = SetPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Set", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter =
        constructor !== null
          ? FunctionPrototypeBind(formatSet, null, value)
          : FunctionPrototypeBind(formatSet, null, SetPrototypeValues(value));
      if (size === 0 && keys.length === 0 && protoProps === undefined) return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if (isMap(value)) {
      const size = MapPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Map", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter =
        constructor !== null
          ? FunctionPrototypeBind(formatMap, null, value)
          : FunctionPrototypeBind(formatMap, null, MapPrototypeEntries(value));
      if (size === 0 && keys.length === 0 && protoProps === undefined) return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if (isTypedArray(value)) {
      keys = getOwnNonIndexProperties(value, filter);
      let bound = value;
      let fallback = "";
      if (constructor === null) {
        fallback = TypedArrayPrototypeGetSymbolToStringTag(value);
        // Reconstruct the array information.
        bound = new primordials[fallback](value);
      }
      const size = TypedArrayPrototypeGetLength(value);
      const prefix = getPrefix(constructor, tag, fallback, `(${size})`);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && !ctx.showHidden) return `${braces[0]}]`;
      // Special handle the value. The original value is required below. The
      // bound function is required to reconstruct missing information.
      formatter = FunctionPrototypeBind(formatTypedArray, null, bound, size);
      extrasType = kArrayExtrasType;
    } else if (isMapIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Map", tag);
      // Add braces to the formatter parameters.
      formatter = FunctionPrototypeBind(formatIterator, null, braces);
    } else if (isSetIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Set", tag);
      // Add braces to the formatter parameters.
      formatter = FunctionPrototypeBind(formatIterator, null, braces);
    } else {
      noIterator = true;
    }
  }
  if (noIterator) {
    keys = getKeys(value, ctx.showHidden);
    braces = ["{", "}"];
    if (constructor === "Object") {
      if (isArgumentsObject(value)) {
        braces[0] = "[Arguments] {";
      } else if (tag !== "") {
        braces[0] = `${getPrefix(constructor, tag, "Object")}{`;
      }
      if (keys.length === 0 && protoProps === undefined) {
        return `${braces[0]}}`;
      }
    } else if (typeof value === "function") {
      base = getFunctionBase(value, constructor, tag);
      if (keys.length === 0 && protoProps === undefined) return ctx.stylize(base, "special");
    } else if (isRegExp(value)) {
      // Make RegExps say that they are RegExps
      base = RegExpPrototypeToString(constructor !== null ? value : new RegExp(value));
      const prefix = getPrefix(constructor, tag, "RegExp");
      if (prefix !== "RegExp ") base = `${prefix}${base}`;
      if ((keys.length === 0 && protoProps === undefined) || (recurseTimes > ctx.depth && ctx.depth !== null)) {
        return ctx.stylize(base, "regexp");
      }
    } else if (isDate(value)) {
      // Make dates with properties first say the date
      base = NumberIsNaN(DatePrototypeGetTime(value)) ? DatePrototypeToString(value) : DatePrototypeToISOString(value);
      const prefix = getPrefix(constructor, tag, "Date");
      if (prefix !== "Date ") base = `${prefix}${base}`;
      if (keys.length === 0 && protoProps === undefined) {
        return ctx.stylize(base, "date");
      }
    } else if (value instanceof Error) {
      base = formatError(value, constructor, tag, ctx, keys);
      if (keys.length === 0 && protoProps === undefined) return base;
    } else if (isAnyArrayBuffer(value)) {
      // Fast path for ArrayBuffer and SharedArrayBuffer.
      // Can't do the same for DataView because it has a non-primitive
      // .buffer property that we need to recurse for.
      const arrayType = isArrayBuffer(value) ? "ArrayBuffer" : "SharedArrayBuffer";
      const prefix = getPrefix(constructor, tag, arrayType);
      if (typedArray === undefined) {
        formatter = formatArrayBuffer;
      } else if (keys.length === 0 && protoProps === undefined) {
        return prefix + `{ byteLength: ${formatNumber(ctx.stylize, value.byteLength, false)} }`;
      }
      braces[0] = `${prefix}{`;
      ArrayPrototypeUnshift(keys, "byteLength");
    } else if (isDataView(value)) {
      braces[0] = `${getPrefix(constructor, tag, "DataView")}{`;
      // .buffer goes last, it's not a primitive like the others.
      ArrayPrototypeUnshift(keys, "byteLength", "byteOffset", "buffer");
    } else if (isPromise(value)) {
      braces[0] = `${getPrefix(constructor, tag, "Promise")}{`;
      formatter = formatPromise;
    } else if (isWeakSet(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakSet")}{`;
      formatter = ctx.showHidden ? formatWeakSet : formatWeakCollection;
    } else if (isWeakMap(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakMap")}{`;
      formatter = ctx.showHidden ? formatWeakMap : formatWeakCollection;
    } else if (isModuleNamespaceObject(value)) {
      braces[0] = `${getPrefix(constructor, tag, "Module")}{`;
      // Special handle keys for namespace objects.
      formatter = formatNamespaceObject.bind(null, keys);
    } else if (isBoxedPrimitive(value)) {
      base = getBoxedBase(value, ctx, keys, constructor, tag);
      if (keys.length === 0 && protoProps === undefined) {
        return base;
      }
    } else {
      if (keys.length === 0 && protoProps === undefined) {
        if (isExternal(value)) {
          const address = "0"; //getExternalValue(value).toString(16);
          return ctx.stylize(`[External: ${address}]`, "special");
        }
        return `${getCtxStyle(value, constructor, tag)}{}`;
      }
      braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
    }
  }

  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    let constructorName = StringPrototypeSlice(getCtxStyle(value, constructor, tag), 0, -1);
    if (constructor !== null) constructorName = `[${constructorName}]`;
    return ctx.stylize(constructorName, "special");
  }
  recurseTimes += 1;

  ctx.seen.push(value);
  ctx.currentDepth = recurseTimes;
  let output;
  const indentationLvl = ctx.indentationLvl;
  try {
    // JSC stack is too powerful it must be stopped manually
    if (ctx.currentDepth > 1000) throw new RangeError(ERROR_STACK_OVERFLOW_MSG);
    output = formatter(ctx, value, recurseTimes);
    for (i = 0; i < keys.length; i++) {
      ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, keys[i], extrasType));
    }
    if (protoProps !== undefined) {
      ArrayPrototypePushApply(output, protoProps);
    }
  } catch (err) {
    if (err instanceof RangeError && err.message === ERROR_STACK_OVERFLOW_MSG) {
      const constructorName = StringPrototypeSlice(getCtxStyle(value, constructor, tag), 0, -1);
      ctx.seen.pop();
      ctx.indentationLvl = indentationLvl;
      return ctx.stylize(
        `[${constructorName}: Inspection interrupted prematurely. Maximum call stack size exceeded.]`,
        "special",
      );
    }
    throw new AssertionError("handleMaxCallStackSize assertion failed: " + String(err), true);
  }
  if (ctx.circular !== undefined) {
    const index = ctx.circular.get(value);
    if (index !== undefined) {
      ctx.seenRefs ??= new Set();
      const SEEN = ctx.seenRefs.has(index);
      if (!SEEN) {
        ctx.seenRefs.add(index);
        const reference = ctx.stylize(`<ref *${index}>`, "special");
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
        const reference = ctx.stylize(`[Circular *${index}]`, "special");
        //ctx.seen.pop(); //? uncommenting this line would allow more accurate display semantics but causes a ~2x slowdown
        return reference;
      }
    }
  }
  ctx.seen.pop();

  if (ctx.sorted) {
    const comparator = ctx.sorted === true ? undefined : ctx.sorted;
    if (extrasType === kObjectType) {
      ArrayPrototypeSort(output, comparator);
    } else if (keys.length > 1) {
      const sorted = ArrayPrototypeSort(ArrayPrototypeSlice(output, output.length - keys.length), comparator);
      ArrayPrototypeUnshift(sorted, output, output.length - keys.length, keys.length);
      ReflectApply(ArrayPrototypeSplice, null, sorted);
    }
  }

  const res = reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value);
  const budget = ctx.budget[ctx.indentationLvl] || 0;
  const newLength = budget + res.length;
  ctx.budget[ctx.indentationLvl] = newLength;
  // If any indentationLvl exceeds this limit, limit further inspecting to the
  // minimum. Otherwise the recursive algorithm might continue inspecting the
  // object even though the maximum string size (~2 ** 28 on 32 bit systems and
  // ~2 ** 30 on 64 bit systems) exceeded. The actual output is not limited at
  // exactly 2 ** 27 but a bit higher. This depends on the object shape.
  // This limit also makes sure that huge objects don't block the event loop
  // significantly.
  if (newLength > 2 ** 27) {
    ctx.depth = -1;
  }
  return res;
}

function getIteratorBraces(type, tag) {
  if (tag !== `${type} Iterator`) {
    if (tag !== "") tag += "] [";
    tag += `${type} Iterator`;
  }
  return [`[${tag}] {`, "}"];
}

function getBoxedBase(value, ctx, keys, constructor, tag) {
  let fn;
  let type;
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
  base += `: ${formatPrimitive(stylizeNoColor, fn(value), ctx)}]`;
  if (tag !== "" && tag !== constructor) {
    base += ` [${tag}]`;
  }
  if (keys.length !== 0 || ctx.stylize === stylizeNoColor) return base;
  return ctx.stylize(base, StringPrototypeToLowerCase(type));
}

function getClassBase(value, constructor, tag) {
  const hasName = ObjectPrototypeHasOwnProperty(value, "name");
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

function getFunctionBase(value, constructor, tag) {
  const stringified = FunctionPrototypeToString(value);
  if (StringPrototypeStartsWith(stringified, "class") && StringPrototypeEndsWith(stringified, "}")) {
    const slice = StringPrototypeSlice(stringified, 5, -1);
    const bracketIndex = StringPrototypeIndexOf(slice, "{");
    if (
      bracketIndex !== -1 &&
      (!StringPrototypeIncludes(StringPrototypeSlice(slice, 0, bracketIndex), "(") ||
        // Slow path to guarantee that it's indeed a class.
        RegExpPrototypeExec(classRegExp, RegExpPrototypeSymbolReplace(stripCommentsRegExp, slice)) !== null)
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
    base += `: ${value.name}`;
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

function identicalSequenceRange(a, b) {
  for (let i = 0; i < a.length - 3; i++) {
    // Find the first entry of b that matches the current entry of a.
    const pos = b.indexOf(a[i]);
    if (pos !== -1) {
      const rest = b.length - pos;
      if (rest > 3) {
        let len = 1;
        const maxLen = MathMin(a.length - i, rest);
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

function getStackString(error) {
  return error.stack ? String(error.stack) : ErrorPrototypeToString(error);
}

function getStackFrames(ctx, err, stack) {
  const frames = StringPrototypeSplit(stack, "\n");

  let cause;
  try {
    ({ cause } = err);
  } catch {
    // If 'cause' is a getter that throws, ignore it.
  }

  // Remove stack frames identical to frames in cause.
  if (cause != null && cause instanceof Error) {
    const causeStack = getStackString(cause);
    const causeStackStart = StringPrototypeIndexOf(causeStack, "\n    at");
    if (causeStackStart !== -1) {
      const causeFrames = StringPrototypeSplit(StringPrototypeSlice(causeStack, causeStackStart + 1), "\n");
      const { len, offset } = identicalSequenceRange(frames, causeFrames);
      if (len > 0) {
        const skipped = len - 2;
        const msg = `    ... ${skipped} lines matching cause stack trace ...`;
        frames.splice(offset + 1, skipped, ctx.stylize(msg, "undefined"));
      }
    }
  }
  return frames;
}

function improveStack(stack, constructor, name, tag) {
  // A stack trace may contain arbitrary data. Only manipulate the output
  // for "regular errors" (errors that "look normal") for now.
  let len = name.length;

  if (
    constructor === null ||
    (StringPrototypeEndsWith(name, "Error") &&
      StringPrototypeStartsWith(stack, name) &&
      (stack.length === len || stack[len] === ":" || stack[len] === "\n"))
  ) {
    let fallback = "Error";
    if (constructor === null) {
      const start =
        RegExpPrototypeExec(/^([A-Z][a-z_ A-Z0-9[\]()-]+)(?::|\n {4}at)/, stack) ||
        RegExpPrototypeExec(/^([a-z_A-Z0-9-]*Error)$/, stack);
      fallback = (start && start[1]) || "";
      len = fallback.length;
      fallback = fallback || "Error";
    }
    const prefix = StringPrototypeSlice(getPrefix(constructor, tag, fallback), 0, -1);
    if (name !== prefix) {
      if (StringPrototypeIncludes(prefix, name)) {
        if (len === 0) {
          stack = `${prefix}: ${stack}`;
        } else {
          stack = `${prefix}${StringPrototypeSlice(stack, len)}`;
        }
      } else {
        stack = `${prefix} [${name}]${StringPrototypeSlice(stack, len)}`;
      }
    }
  }
  return stack;
}

function removeDuplicateErrorKeys(ctx, keys, err, stack) {
  if (!ctx.showHidden && keys.length !== 0) {
    for (const name of ["name", "message", "stack"]) {
      const index = ArrayPrototypeIndexOf(keys, name);
      // Only hide the property in case it's part of the original stack
      if (index !== -1 && StringPrototypeIncludes(stack, err[name])) {
        ArrayPrototypeSplice(keys, index, 1);
      }
    }
  }
}

function markNodeModules(ctx, line) {
  let tempLine = "";
  let nodeModule;
  let pos = 0;
  while ((nodeModule = nodeModulesRegExp.exec(line)) !== null) {
    // '/node_modules/'.length === 14
    tempLine += StringPrototypeSlice(line, pos, nodeModule.index + 14);
    tempLine += ctx.stylize(nodeModule[1], "module");
    pos = nodeModule.index + nodeModule[0].length;
  }
  if (pos !== 0) {
    line = tempLine + StringPrototypeSlice(line, pos);
  }
  return line;
}

function markCwd(ctx, line, workingDirectory) {
  let cwdStartPos = StringPrototypeIndexOf(line, workingDirectory);
  let tempLine = "";
  let cwdLength = workingDirectory.length;
  if (cwdStartPos !== -1) {
    if (StringPrototypeSlice(line, cwdStartPos - 7, cwdStartPos) === "file://") {
      cwdLength += 7;
      cwdStartPos -= 7;
    }
    const start = line[cwdStartPos - 1] === "(" ? cwdStartPos - 1 : cwdStartPos;
    const end = start !== cwdStartPos && StringPrototypeEndsWith(line, ")") ? -1 : line.length;
    const workingDirectoryEndPos = cwdStartPos + cwdLength + 1;
    const cwdSlice = StringPrototypeSlice(line, start, workingDirectoryEndPos);

    tempLine += StringPrototypeSlice(line, 0, start);
    tempLine += ctx.stylize(cwdSlice, "undefined");
    tempLine += StringPrototypeSlice(line, workingDirectoryEndPos, end);
    if (end === -1) {
      tempLine += ctx.stylize(")", "undefined");
    }
  } else {
    tempLine += line;
  }
  return tempLine;
}

function safeGetCWD() {
  let workingDirectory;
  try {
    workingDirectory = process.cwd();
  } catch {
    return;
  }
  return workingDirectory;
}

function formatError(err, constructor, tag, ctx, keys) {
  const name = err.name != null ? String(err.name) : "Error";
  let stack = getStackString(err);

  //! temp fix for Bun losing the error name from inherited errors + extraneous ": " with no message
  stack = stack.replace(/^Error: /, `${name}${err.message ? ": " : ""}`);

  removeDuplicateErrorKeys(ctx, keys, err, stack);

  if ("cause" in err && (keys.length === 0 || !ArrayPrototypeIncludes(keys, "cause"))) {
    ArrayPrototypePush(keys, "cause");
  }

  // Print errors aggregated into AggregateError
  if (ArrayIsArray(err.errors) && (keys.length === 0 || !ArrayPrototypeIncludes(keys, "errors"))) {
    ArrayPrototypePush(keys, "errors");
  }

  stack = improveStack(stack, constructor, name, tag);

  // Ignore the error message if it's contained in the stack.
  let pos = (err.message && StringPrototypeIndexOf(stack, err.message)) || -1;
  if (pos !== -1) pos += err.message.length;
  // Wrap the error in brackets in case it has no stack trace.
  const stackStart = StringPrototypeIndexOf(stack, "\n    at", pos);
  if (stackStart === -1) {
    stack = `[${stack}]`;
  } else {
    let newStack = StringPrototypeSlice(stack, 0, stackStart);
    const stackFramePart = StringPrototypeSlice(stack, stackStart + 1);
    const lines = getStackFrames(ctx, err, stackFramePart);
    if (ctx.colors) {
      // Highlight userland code and node modules.
      const workingDirectory = safeGetCWD();
      let esmWorkingDirectory;
      for (let line of lines) {
        const core = RegExpPrototypeExec(coreModuleRegExp, line);
        if (
          core !== null &&
          (StringPrototypeStartsWith(core[1], "internal/") ||
            ArrayPrototypeIncludes(require("node:module").builtinModules, core[1]))
        ) {
          newStack += `\n${ctx.stylize(line, "undefined")}`;
        } else {
          newStack += "\n";

          line = markNodeModules(ctx, line);
          if (workingDirectory !== undefined) {
            let newLine = markCwd(ctx, line, workingDirectory);
            if (newLine === line) {
              esmWorkingDirectory ??= pathToFileURL(workingDirectory);
              newLine = markCwd(ctx, line, esmWorkingDirectory);
            }
            line = newLine;
          }

          newStack += line;
        }
      }
    } else {
      newStack += `\n${ArrayPrototypeJoin(lines, "\n")}`;
    }
    stack = newStack;
  }
  // The message and the stack have to be indented as well!
  if (ctx.indentationLvl !== 0) {
    const indentation = StringPrototypeRepeat(" ", ctx.indentationLvl);
    stack = StringPrototypeReplaceAll(stack, "\n", `\n${indentation}`);
  }
  return stack;
}

function groupArrayElements(ctx, output, value) {
  let totalLength = 0;
  let maxLength = 0;
  let i = 0;
  let outputLength = output.length;
  if (ctx.maxArrayLength < output.length) {
    // This makes sure the "... n more items" part is not taken into account.
    outputLength--;
  }
  const separatorSpace = 2; // Add 1 for the space and 1 for the separator.
  const dataLen = new Array(outputLength);
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
  if (actualMax * 3 + ctx.indentationLvl < ctx.breakLength && (totalLength / actualMax > 5 || maxLength <= 6)) {
    const approxCharHeights = 2.5;
    const averageBias = MathSqrt(actualMax - totalLength / output.length);
    const biasedMax = MathMax(actualMax - 3 - averageBias, 1);
    // Dynamically check how many columns seem possible.
    const columns = MathMin(
      // Ideally a square should be drawn. We expect a character to be about 2.5
      // times as high as wide. This is the area formula to calculate a square
      // which contains n rectangles of size `actualMax * approxCharHeights`.
      // Divide that by `actualMax` to receive the correct number of columns.
      // The added bias increases the columns for short entries.
      MathRound(MathSqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
      // Do not exceed the breakLength.
      MathFloor((ctx.breakLength - ctx.indentationLvl) / actualMax),
      // Limit array grouping for small `compact` modes as the user requested
      // minimal grouping.
      ctx.compact * 4,
      // Limit the columns to a maximum of fifteen.
      15,
    );
    // Return with the original output if no grouping should happen.
    if (columns <= 1) {
      return output;
    }
    const tmp = [];
    const maxLineLength = [];
    for (let i = 0; i < columns; i++) {
      let lineMaxLength = 0;
      for (let j = i; j < output.length; j += columns) {
        if (dataLen[j] > lineMaxLength) lineMaxLength = dataLen[j];
      }
      lineMaxLength += separatorSpace;
      maxLineLength[i] = lineMaxLength;
    }
    let order = StringPrototypePadStart;
    if (value !== undefined) {
      for (let i = 0; i < output.length; i++) {
        if (typeof value[i] !== "number" && typeof value[i] !== "bigint") {
          order = StringPrototypePadEnd;
          break;
        }
      }
    }
    // Each iteration creates a single line of grouped entries.
    for (let i = 0; i < outputLength; i += columns) {
      // The last lines may contain less entries than columns.
      const max = MathMin(i + columns, outputLength);
      let str = "";
      let j = i;
      for (; j < max - 1; j++) {
        // Calculate extra color padding in case it's active. This has to be
        // done line by line as some lines might contain more colors than
        // others.
        const padding = maxLineLength[j - i] + output[j].length - dataLen[j];
        str += order(`${output[j]}, `, padding, " ");
      }
      if (order === StringPrototypePadStart) {
        const padding = maxLineLength[j - i] + output[j].length - dataLen[j] - separatorSpace;
        str += StringPrototypePadStart(output[j], padding, " ");
      } else {
        str += output[j];
      }
      ArrayPrototypePush(tmp, str);
    }
    if (ctx.maxArrayLength < output.length) {
      ArrayPrototypePush(tmp, output[outputLength]);
    }
    output = tmp;
  }
  return output;
}

function addNumericSeparator(integerString) {
  let result = "";
  let i = integerString.length;
  const start = StringPrototypeStartsWith(integerString, "-") ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    result = `_${StringPrototypeSlice(integerString, i - 3, i)}${result}`;
  }
  return i === integerString.length ? integerString : `${StringPrototypeSlice(integerString, 0, i)}${result}`;
}

function addNumericSeparatorEnd(integerString) {
  let result = "";
  let i = 0;
  for (; i < integerString.length - 3; i += 3) {
    result += `${StringPrototypeSlice(integerString, i, i + 3)}_`;
  }
  return i === 0 ? integerString : `${result}${StringPrototypeSlice(integerString, i)}`;
}

const remainingText = remaining => `... ${remaining} more item${remaining > 1 ? "s" : ""}`;

function formatNumber(fn, number, numericSeparator) {
  if (!numericSeparator) {
    // Format -0 as '-0'. Checking `number === -0` won't distinguish 0 from -0.
    if (ObjectIs(number, -0)) {
      return fn("-0", "number");
    }
    return fn(`${number}`, "number");
  }
  const integer = MathTrunc(number);
  const string = String(integer);
  if (integer === number) {
    if (!NumberIsFinite(number) || StringPrototypeIncludes(string, "e")) {
      return fn(string, "number");
    }
    return fn(`${addNumericSeparator(string)}`, "number");
  }
  if (NumberIsNaN(number)) {
    return fn(string, "number");
  }
  return fn(
    `${addNumericSeparator(string)}.${addNumericSeparatorEnd(StringPrototypeSlice(String(number), string.length + 1))}`,
    "number",
  );
}

function formatBigInt(fn, bigint, numericSeparator) {
  const string = String(bigint);
  if (!numericSeparator) {
    return fn(`${string}n`, "bigint");
  }
  return fn(`${addNumericSeparator(string)}n`, "bigint");
}

function formatPrimitive(fn, value, ctx) {
  if (typeof value === "string") {
    let trailer = "";
    if (value.length > ctx.maxStringLength) {
      const remaining = value.length - ctx.maxStringLength;
      value = StringPrototypeSlice(value, 0, ctx.maxStringLength);
      trailer = `... ${remaining} more character${remaining > 1 ? "s" : ""}`;
    }
    if (
      ctx.compact !== true &&
      // We do not support handling unicode characters width with
      // the readline getStringWidth function as there are performance implications.
      value.length > kMinLineLength &&
      value.length > ctx.breakLength - ctx.indentationLvl - 4
    ) {
      return (
        ArrayPrototypeJoin(
          ArrayPrototypeMap(extractedSplitNewLines(value), line => fn(strEscape(line), "string")),
          ` +\n${StringPrototypeRepeat(" ", ctx.indentationLvl + 2)}`,
        ) + trailer
      );
    }
    return fn(strEscape(value), "string") + trailer;
  }
  if (typeof value === "number") return formatNumber(fn, value, ctx.numericSeparator);
  if (typeof value === "bigint") return formatBigInt(fn, value, ctx.numericSeparator);
  if (typeof value === "boolean") return fn(`${value}`, "boolean");
  if (typeof value === "undefined") return fn("undefined", "undefined");
  // es6 symbol primitive
  return fn(SymbolPrototypeToString(value), "symbol");
}

function formatNamespaceObject(keys, ctx, value, recurseTimes) {
  const output = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    try {
      output[i] = formatProperty(ctx, value, recurseTimes, keys[i], kObjectType);
    } catch (err) {
      assert(isNativeError(err) && err.name === "ReferenceError");
      // Use the existing functionality. This makes sure the indentation and
      // line breaks are always correct. Otherwise it is very difficult to keep
      // this aligned, even though this is a hacky way of dealing with this.
      const tmp = { [keys[i]]: "" };
      output[i] = formatProperty(ctx, tmp, recurseTimes, keys[i], kObjectType);
      const pos = StringPrototypeLastIndexOf(output[i], " ");
      // We have to find the last whitespace and have to replace that value as
      // it will be visualized as a regular string.
      output[i] = StringPrototypeSlice(output[i], 0, pos + 1) + ctx.stylize("<uninitialized>", "special");
    }
  }
  // Reset the keys to an empty array. This prevents duplicated inspection.
  keys.length = 0;
  return output;
}

// The array is sparse and/or has extra keys
function formatSpecialArray(ctx, value, recurseTimes, maxLength, output, i) {
  const keys = ObjectKeys(value);
  let index = i;
  for (; i < keys.length && output.length < maxLength; i++) {
    const key = keys[i];
    const tmp = +key;
    // Arrays can only have up to 2^32 - 1 entries
    if (tmp > 2 ** 32 - 2) {
      break;
    }
    if (`${index}` !== key) {
      if (RegExpPrototypeExec(numberRegExp, key) === null) {
        break;
      }
      const emptyItems = tmp - index;
      const ending = emptyItems > 1 ? "s" : "";
      const message = `<${emptyItems} empty item${ending}>`;
      ArrayPrototypePush(output, ctx.stylize(message, "undefined"));
      index = tmp;
      if (output.length === maxLength) {
        break;
      }
    }
    ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, key, kArrayType));
    index++;
  }
  const remaining = value.length - index;
  if (output.length !== maxLength) {
    if (remaining > 0) {
      const ending = remaining > 1 ? "s" : "";
      const message = `<${remaining} empty item${ending}>`;
      ArrayPrototypePush(output, ctx.stylize(message, "undefined"));
    }
  } else if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
}

function hexSlice(buf, start = 0, end) {
  return ArrayPrototypeJoin(
    ArrayPrototypeMap(buf.slice(start, end), x => ("00" + x.toString(16)).slice(-2)),
    "",
  );
}

function formatArrayBuffer(ctx, value) {
  let buffer;
  try {
    buffer = new Uint8Array(value);
  } catch {
    return [ctx.stylize("(detached)", "special")];
  }
  let str = StringPrototypeTrim(
    RegExpPrototypeSymbolReplace(/(.{2})/g, hexSlice(buffer, 0, MathMin(ctx.maxArrayLength, buffer.length)), "$1 "),
  );
  const remaining = buffer.length - ctx.maxArrayLength;
  if (remaining > 0) str += ` ... ${remaining} more byte${remaining > 1 ? "s" : ""}`;
  return [`${ctx.stylize("[Uint8Contents]", "special")}: <${str}>`];
}

function formatArray(ctx, value, recurseTimes) {
  const valLen = value.length;
  const len = MathMin(MathMax(0, ctx.maxArrayLength), valLen);

  const remaining = valLen - len;
  const output = [];
  for (let i = 0; i < len; i++) {
    // Special handle sparse arrays.
    if (!ObjectPrototypeHasOwnProperty(value, i)) {
      return formatSpecialArray(ctx, value, recurseTimes, len, output, i);
    }
    ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, i, kArrayType));
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
}

function formatTypedArray(value, length, ctx, ignored, recurseTimes) {
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = value.length - maxLength;
  const output = new Array(maxLength);
  const elementFormatter = value.length > 0 && typeof value[0] === "number" ? formatNumber : formatBigInt;
  for (let i = 0; i < maxLength; ++i) {
    output[i] = elementFormatter(ctx.stylize, value[i], ctx.numericSeparator);
  }
  if (remaining > 0) {
    output[maxLength] = remainingText(remaining);
  }
  if (ctx.showHidden) {
    // .buffer goes last, it's not a primitive like the others.
    // All besides `BYTES_PER_ELEMENT` are actually getters.
    ctx.indentationLvl += 2;
    for (const key of ["BYTES_PER_ELEMENT", "length", "byteLength", "byteOffset", "buffer"]) {
      const str = formatValue(ctx, value[key], recurseTimes, true);
      ArrayPrototypePush(output, `[${key}]: ${str}`);
    }
    ctx.indentationLvl -= 2;
  }
  return output;
}

function formatSet(value, ctx, ignored, recurseTimes) {
  const length = value.size;
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = length - maxLength;
  const output = [];
  ctx.indentationLvl += 2;
  let i = 0;
  for (const v of value) {
    if (i >= maxLength) break;
    ArrayPrototypePush(output, formatValue(ctx, v, recurseTimes));
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  return output;
}

function formatMap(value, ctx, ignored, recurseTimes) {
  const length = value.size;
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = length - maxLength;
  const output = [];
  ctx.indentationLvl += 2;
  let i = 0;
  for (const { 0: k, 1: v } of value) {
    if (i >= maxLength) break;
    ArrayPrototypePush(output, `${formatValue(ctx, k, recurseTimes)} => ${formatValue(ctx, v, recurseTimes)}`);
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  return output;
}

function formatSetIterInner(ctx, recurseTimes, entries, state) {
  const maxArrayLength = MathMax(ctx.maxArrayLength, 0);
  const maxLength = MathMin(maxArrayLength, entries.length);
  const output = new Array(maxLength);
  ctx.indentationLvl += 2;
  for (let i = 0; i < maxLength; i++) {
    output[i] = formatValue(ctx, entries[i], recurseTimes);
  }
  ctx.indentationLvl -= 2;
  if (state === kWeak && !ctx.sorted) {
    // Sort all entries to have a halfway reliable output (if more entries than
    // retrieved ones exist, we can not reliably return the same output) if the
    // output is not sorted anyway.
    ArrayPrototypeSort(output);
  }
  const remaining = entries.length - maxLength;
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
}

function formatMapIterInner(ctx, recurseTimes, entries, state) {
  const maxArrayLength = MathMax(ctx.maxArrayLength, 0);
  // Entries exist as [key1, val1, key2, val2, ...]
  const len = entries.length / 2;
  const remaining = len - maxArrayLength;
  const maxLength = MathMin(maxArrayLength, len);
  const output = new Array(maxLength);
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
    if (!ctx.sorted) ArrayPrototypeSort(output);
  } else {
    for (; i < maxLength; i++) {
      const pos = i * 2;
      const res = [formatValue(ctx, entries[pos], recurseTimes), formatValue(ctx, entries[pos + 1], recurseTimes)];
      output[i] = reduceToSingleString(ctx, res, "", ["[", "]"], kArrayExtrasType, recurseTimes);
    }
  }
  ctx.indentationLvl -= 2;
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
}

function formatWeakCollection(ctx) {
  return [ctx.stylize("<items unknown>", "special")];
}

function formatWeakSet(ctx, value, recurseTimes) {
  const entries = previewEntries(value);
  return formatSetIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatWeakMap(ctx, value, recurseTimes) {
  const entries = previewEntries(value);
  return formatMapIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatIterator(braces, ctx, value, recurseTimes) {
  const { 0: entries, 1: isKeyValue } = previewEntries(value, true);
  if (isKeyValue) {
    // TODO(bun): JSC can also differ between the keys and values iterator, maybe we should also distinguish those in the future?
    // Mark entry iterators as such.
    braces[0] = RegExpPrototypeSymbolReplace(/ Iterator] {$/, braces[0], " Entries] {");
    return formatMapIterInner(ctx, recurseTimes, entries, kMapEntries);
  }

  return formatSetIterInner(ctx, recurseTimes, entries, kIterator);
}

function formatPromise(ctx, value, recurseTimes) {
  let output;
  const { 0: state, 1: result } = getPromiseDetails(value);
  if (state === kPending) {
    output = [ctx.stylize("<pending>", "special")];
  } else {
    ctx.indentationLvl += 2;
    const str = formatValue(ctx, result, recurseTimes);
    ctx.indentationLvl -= 2;
    output = [state === kRejected ? `${ctx.stylize("<rejected>", "special")} ${str}` : str];
  }
  return output;
}

function formatProperty(ctx, value, recurseTimes, key, type, desc, original = value) {
  let name, str;
  let extra = " ";
  desc ||= ObjectGetOwnPropertyDescriptor(value, key) || { value: value[key], enumerable: true };
  if (desc.value !== undefined) {
    const diff = ctx.compact !== true || type !== kObjectType ? 2 : 3;
    ctx.indentationLvl += diff;
    str = formatValue(ctx, desc.value, recurseTimes);
    if (diff === 3 && ctx.breakLength < getStringWidth(str, ctx.colors)) {
      extra = `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`;
    }
    ctx.indentationLvl -= diff;
  } else if (desc.get !== undefined) {
    const label = desc.set !== undefined ? "Getter/Setter" : "Getter";
    const s = ctx.stylize;
    const sp = "special";
    if (
      ctx.getters &&
      (ctx.getters === true ||
        (ctx.getters === "get" && desc.set === undefined) ||
        (ctx.getters === "set" && desc.set !== undefined))
    ) {
      try {
        const tmp = desc.get.$call(original);
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
      } catch (err) {
        const message = `<Inspection threw (${err.message})>`;
        str = `${s(`[${label}:`, sp)} ${message}${s("]", sp)}`;
      }
    } else {
      str = ctx.stylize(`[${label}]`, sp);
    }
  } else if (desc.set !== undefined) {
    str = ctx.stylize("[Setter]", "special");
  } else {
    str = ctx.stylize("undefined", "undefined");
  }
  if (type === kArrayType) return str;
  if (typeof key === "symbol") {
    const tmp = RegExpPrototypeSymbolReplace(strEscapeSequencesReplacer, SymbolPrototypeToString(key), escapeFn);
    name = `[${ctx.stylize(tmp, "symbol")}]`;
  } else if (key === "__proto__") {
    name = "['__proto__']";
  } else if (desc.enumerable === false) {
    const tmp = RegExpPrototypeSymbolReplace(strEscapeSequencesReplacer, key, escapeFn);
    name = `[${tmp}]`;
  } else if (RegExpPrototypeExec(keyStrRegExp, key) !== null) {
    name = ctx.stylize(key, "name");
  } else {
    name = ctx.stylize(strEscape(key), "string");
  }
  return `${name}:${extra}${str}`;
}

function isBelowBreakLength(ctx, output, start, base) {
  // Each entry is separated by at least a comma. Thus, we start with a total
  // length of at least `output.length`. In addition, some cases have a
  // whitespace in-between each other that is added to the total as well.
  // TODO(BridgeAR): Add unicode support. Use the readline getStringWidth
  // function. Check the performance overhead and make it an opt-in in case it's significant.
  let totalLength = output.length + start;
  if (totalLength + output.length > ctx.breakLength) return false;
  for (let i = 0; i < output.length; i++) {
    if (ctx.colors) {
      totalLength += StringPrototypeReplaceAll(output[i], /\u001B\[\d\d?m/g, "").length; // remove colors
    } else {
      totalLength += output[i].length;
    }
    if (totalLength > ctx.breakLength) {
      return false;
    }
  }
  // Do not line up properties on the same line if `base` contains line breaks.
  return base === "" || !StringPrototypeIncludes(base, "\n");
}

function reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value) {
  if (ctx.compact !== true) {
    if (typeof ctx.compact === "number" && ctx.compact >= 1) {
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
      if (ctx.currentDepth - recurseTimes < ctx.compact && entries === output.length) {
        // Line up all entries on a single line in case the entries do not
        // exceed `breakLength`. Add 10 as constant to start next to all other
        // factors that may reduce `breakLength`.
        const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
        if (isBelowBreakLength(ctx, output, start, base)) {
          const joinedOutput = ArrayPrototypeJoin(output, ", ");
          if (!StringPrototypeIncludes(joinedOutput, "\n")) {
            return `${base ? `${base} ` : ""}${braces[0]} ${joinedOutput}` + ` ${braces[1]}`;
          }
        }
      }
    }
    // Line up each entry on an individual line.
    const indentation = `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`;
    return (
      `${base ? `${base} ` : ""}${braces[0]}${indentation}  ` +
      `${ArrayPrototypeJoin(output, `,${indentation}  `)}${indentation}${braces[1]}`
    );
  }
  // Line up all entries on a single line in case the entries do not exceed
  // `breakLength`.
  if (isBelowBreakLength(ctx, output, 0, base)) {
    return `${braces[0]}${base ? ` ${base}` : ""} ${ArrayPrototypeJoin(output, ", ")} ` + braces[1];
  }
  const indentation = StringPrototypeRepeat(" ", ctx.indentationLvl);
  // If the opening "brace" is too large, like in the case of "Set {",
  // we need to force the first item to be on the next line or the
  // items will not line up correctly.
  const ln = base === "" && braces[0].length === 1 ? " " : `${base ? ` ${base}` : ""}\n${indentation}  `;
  // Line up each entry on an individual line.
  return `${braces[0]}${ln}${ArrayPrototypeJoin(output, `,\n${indentation}  `)} ${braces[1]}`;
}

function hasBuiltInToString(value) {
  // Prevent triggering proxy traps.
  const proxyTarget = getProxyDetails(value, false);
  if (proxyTarget !== undefined) {
    if (proxyTarget === null) return true;
    value = proxyTarget;
  }

  // Count objects that have no `toString` function as built-in.
  if (typeof value.toString !== "function") return true;

  // The object has a own `toString` property. Thus it's not not a built-in one.
  if (ObjectPrototypeHasOwnProperty(value, "toString")) return false;

  // Find the object that has the `toString` property as own property in the prototype chain.
  let pointer = value;
  do {
    pointer = ObjectGetPrototypeOf(pointer);
  } while (!ObjectPrototypeHasOwnProperty(pointer, "toString"));

  // Check closer if the object is a built-in.
  const descriptor = ObjectGetOwnPropertyDescriptor(pointer, "constructor");
  return (
    descriptor !== undefined && typeof descriptor.value === "function" && builtInObjects.has(descriptor.value.name)
  );
}

const firstErrorLine = error => StringPrototypeSplit(error.message, "\n", 1)[0];
let CIRCULAR_ERROR_MESSAGE;
function tryStringify(arg) {
  try {
    return JSONStringify(arg);
  } catch (err) {
    // Populate the circular error message lazily
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        const a = {};
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

function format(...args) {
  return formatWithOptionsInternal(undefined, args);
}

function formatWithOptions(inspectOptions, ...args) {
  validateObject(inspectOptions, "inspectOptions", { allowArray: true });
  return formatWithOptionsInternal(inspectOptions, args);
}

function formatNumberNoColor(number, options) {
  return formatNumber(stylizeNoColor, number, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
}

function formatBigIntNoColor(bigint, options) {
  return formatBigInt(stylizeNoColor, bigint, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
}

function formatWithOptionsInternal(inspectOptions, args) {
  const first = args[0];
  let a = 0;
  let str = "";
  let join = "";

  if (typeof first === "string") {
    if (args.length === 1) {
      return first;
    }
    let tempStr;
    let lastPos = 0;

    for (let i = 0; i < first.length - 1; i++) {
      if (StringPrototypeCharCodeAt(first, i) === 37) {
        // '%'
        const nextChar = StringPrototypeCharCodeAt(first, ++i);
        if (a + 1 !== args.length) {
          switch (nextChar) {
            case 115: {
              // 's'
              const tempArg = args[++a];
              if (typeof tempArg === "number") {
                tempStr = formatNumberNoColor(tempArg, inspectOptions);
              } else if (typeof tempArg === "bigint") {
                tempStr = formatBigIntNoColor(tempArg, inspectOptions);
              } else if (typeof tempArg !== "object" || tempArg === null || !hasBuiltInToString(tempArg)) {
                tempStr = String(tempArg);
              } else {
                tempStr = inspect(tempArg, {
                  ...inspectOptions,
                  compact: 3,
                  colors: false,
                  depth: 0,
                });
              }
              break;
            }
            case 106: // 'j'
              tempStr = tryStringify(args[++a]);
              break;
            case 100: {
              // 'd'
              const tempNum = args[++a];
              if (typeof tempNum === "bigint") {
                tempStr = formatBigIntNoColor(tempNum, inspectOptions);
              } else if (typeof tempNum === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(Number(tempNum), inspectOptions);
              }
              break;
            }
            case 79: // 'O'
              tempStr = inspect(args[++a], inspectOptions);
              break;
            case 111: // 'o'
              tempStr = inspect(args[++a], {
                ...inspectOptions,
                showHidden: true,
                showProxy: true,
                depth: 4,
              });
              break;
            case 105: {
              // 'i'
              const tempInteger = args[++a];
              if (typeof tempInteger === "bigint") {
                tempStr = formatBigIntNoColor(tempInteger, inspectOptions);
              } else if (typeof tempInteger === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(NumberParseInt(tempInteger), inspectOptions);
              }
              break;
            }
            case 102: {
              // 'f'
              const tempFloat = args[++a];
              if (typeof tempFloat === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(NumberParseFloat(tempFloat), inspectOptions);
              }
              break;
            }
            case 99: // 'c'
              a += 1;
              tempStr = "";
              break;
            case 37: // '%'
              str += StringPrototypeSlice(first, lastPos, i);
              lastPos = i + 1;
              continue;
            default: // Any other character is not a correct placeholder
              continue;
          }
          if (lastPos !== i - 1) {
            str += StringPrototypeSlice(first, lastPos, i - 1);
          }
          str += tempStr;
          lastPos = i + 1;
        } else if (nextChar === 37) {
          str += StringPrototypeSlice(first, lastPos, i);
          lastPos = i + 1;
        }
      }
    }
    if (lastPos !== 0) {
      a++;
      join = " ";
      if (lastPos < first.length) {
        str += StringPrototypeSlice(first, lastPos);
      }
    }
  }

  while (a < args.length) {
    const value = args[a];
    str += join;
    str += typeof value !== "string" ? inspect(value, inspectOptions) : value;
    join = " ";
    a++;
  }
  return str;
}

var internalGetStringWidth = $lazy("getStringWidth");
/**
 * Returns the number of columns required to display the given string.
 */
function getStringWidth(str, removeControlChars = true) {
  if (removeControlChars) str = stripVTControlCharacters(str);
  str = StringPrototypeNormalize(str, "NFC");
  return internalGetStringWidth(str);
}

// Regex used for ansi escape code splitting
// Adopted from https://github.com/chalk/ansi-regex/blob/HEAD/index.js
// License: MIT, authors: @sindresorhus, Qix-, arjunmehta and LitoMore
// Matches all ansi escape code sequences in a string
const ansiPattern =
  "[\\u001B\\u009B][[\\]()#;?]*" +
  "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*" +
  "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)" +
  "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
const ansi = new RegExp(ansiPattern, "g");
/** Remove all VT control characters. Use to estimate displayed string width. */
function stripVTControlCharacters(str) {
  if (typeof str !== "string") throw new codes.ERR_INVALID_ARG_TYPE("str", "string", str);
  return RegExpPrototypeSymbolReplace(ansi, str, "");
}

// utils
function getOwnNonIndexProperties(a, filter = ONLY_ENUMERABLE) {
  const desc = ObjectGetOwnPropertyDescriptors(a);
  const ret = [];
  for (const [k, v] of ObjectEntries(desc)) {
    if (!RegExpPrototypeTest(/^(0|[1-9][0-9]*)$/, k) || NumberParseInt(k, 10) >= 2 ** 32 - 1) {
      // Arrays are limited in size
      if (filter === ONLY_ENUMERABLE && !v.enumerable) continue;
      else ArrayPrototypePush(ret, k);
    }
  }
  for (const s of ObjectGetOwnPropertySymbols(a)) {
    const v = ObjectGetOwnPropertyDescriptor(a, s);
    if (filter === ONLY_ENUMERABLE && !v.enumerable) continue;
    ArrayPrototypePush(ret, s);
  }
  return ret;
}
function getPromiseDetails(promise) {
  const state = $getPromiseInternalField(promise, $promiseFieldFlags) & $promiseStateMask;
  if (state !== $promiseStatePending) {
    return [
      state === $promiseStateRejected ? kRejected : kFulfilled,
      $getPromiseInternalField(promise, $promiseFieldReactionsOrResult),
    ];
  }
  return [kPending, undefined];
}
function getProxyDetails(proxy, withHandler = true) {
  const isProxy = $isProxyObject(proxy);
  if (!isProxy) return undefined;
  const handler = $getProxyInternalField(proxy, $proxyFieldHandler);
  // if handler is null, the proxy is revoked
  const target = handler === null ? null : $getProxyInternalField(proxy, $proxyFieldTarget);
  if (withHandler) return [target, handler];
  else return target;
}
function previewEntries(val, isIterator = false) {
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
}
function internalGetConstructorName(val) {
  if (!val || typeof val !== "object") throw new Error("Invalid object");
  if (val.constructor?.name) return val.constructor.name;
  const str = ObjectPrototypeToString(val);
  const m = StringPrototypeMatch(str, /^\[object ([^\]]+)\]/); // e.g. [object Boolean]
  return m ? m[1] : "Object";
}

export default {
  inspect,
  format,
  formatWithOptions,
  stripVTControlCharacters,
  //! non-standard properties, should these be kept? (not currently exposed)
  //stylizeWithColor,
  //stylizeWithHTML(str, styleType) {
  //  const style = inspect.styles[styleType];
  //  if (style !== undefined) {
  //    return `<span style="color:${style};">${escapeHTML(str)}</span>`;
  //  }
  //  return escapeHTML(str);
  //},
};

// unused without `stylizeWithHTML`
/*const entities = {
  34: "&quot;",
  38: "&amp;",
  39: "&apos;",
  60: "&lt;",
  62: "&gt;",
  160: "&nbsp;",
};
function escapeHTML(str) {
  return str.replace(/[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00FF]/g, c => {
    const code = String(c.charCodeAt(0));
    const ent = entities[code];
    return ent || "&#" + code + ";";
  });
}*/
