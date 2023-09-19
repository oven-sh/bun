// @ts-check
// Hardcoded module "node:util"
const types = require("node:util/types");
const { parseArgs } = require("@pkgjs/parseargs");
const SafeMap = Map;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeCharAt = String.prototype.charAt;
const ObjectDefineProperty = Object.defineProperty;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const FunctionPrototypeCall = Function.prototype.call;
const ArrayIsArray = Array.isArray;
const SymbolIterator = Symbol.iterator;
const NOT_HTTP_TOKEN_CODE_POINT = /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/g;
const NOT_HTTP_QUOTED_STRING_CODE_POINT = /[^\t\u0020-~\u0080-\u00FF]/g;
const START_ENDING_WHITESPACE = /[\r\n\t ]*$/;
const END_BEGINNING_WHITESPACE = /[^\r\n\t ]|$/;

var cjs_exports = {};

function isBufferInterface({ copy, fill, readUint8 }) {
  return typeof copy === "function" && typeof fill === "function" && typeof readUint8 === "function";
}

function isBuffer(value) {
  return (
    Buffer.isBuffer(value) ||
    // incase it ends up as a browserify buffer
    (typeof value === "object" && isBufferInterface(value || {}))
  );
}

function isFunction(value) {
  return typeof value === "function";
}

const deepEquals = Bun.deepEquals;
const isDeepStrictEqual = (a, b) => deepEquals(a, b, true);
var getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
var formatRegExp = /%[sdjfoc%]/g;
// This function is nowhere near what Node.js does but it is close enough of a shim.
function formatWithOptions(inspectOptions, f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 1; i < arguments.length; i++) {
      objects.push(inspect(arguments[i], inspectOptions));
    }
    return objects.join(" ");
  }
  var i = 2;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function (x2) {
    if (x2 === "%%") return "%";
    if (i >= len) return x2;
    switch (x2) {
      case "%s":
        return String(args[i++]);
      case "%f":
        return Number(args[i++]);
      case "%d":
        return Math.round(Number(args[i++]));
      case "%j":
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return "[Circular]";
        }
      case "%o":
        return inspect(args[i++], { showHidden: true, showProxy: true, ...inspectOptions });
      case "%O":
        return inspect(args[i++], { showHidden: true, showProxy: true, ...inspectOptions });
      default:
        return x2;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += " " + x;
    } else {
      str += " " + inspect(x, inspectOptions);
    }
  }
  return str;
}
function format(...args) {
  return formatWithOptions({}, ...args);
}

function deprecate(fn, msg, code) {
  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        var err = new Error(msg);
        if (code) err.code = code;
        throw err;
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }
  return deprecated;
}

var debugs = {};
var debugEnvRegex = /^$/;
if (process.env.NODE_DEBUG) {
  debugEnv = process.env.NODE_DEBUG;
  debugEnv = debugEnv
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/,/g, "$|^")
    .toUpperCase();
  debugEnvRegex = new RegExp("^" + debugEnv + "$", "i");
}
var debugEnv;
function debuglog(set) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      debugs[set] = function () {
        var msg = format.apply(cjs_exports, arguments);
        console.error("%s %d: %s", set, pid, msg);
      };
    } else {
      debugs[set] = function () {};
    }
  }
  return debugs[set];
}
var kInspectCustom = Symbol.for("nodejs.util.inspect.custom");
function inspect(obj, opts) {
  var ctx = {
    seen: [],
    stylize: stylizeNoColor,
  };
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    ctx.showHidden = opts;
  } else if (opts) {
    _extend(ctx, opts);
  }
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
inspect.colors = {
  bold: [1, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  white: [37, 39],
  grey: [90, 39],
  black: [30, 39],
  blue: [34, 39],
  cyan: [36, 39],
  green: [32, 39],
  magenta: [35, 39],
  red: [31, 39],
  yellow: [33, 39],
};
inspect.styles = {
  special: "cyan",
  number: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  date: "magenta",
  regexp: "red",
};
inspect.custom = kInspectCustom;
// JS polyfill doesnt support all these options
inspect.defaultOptions = {
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
function stylizeWithColor(str, styleType) {
  const style = inspect.styles[styleType];
  if (style !== undefined) {
    const color = inspect.colors[style];
    if (color !== undefined) return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
  }
  return str;
}
function stylizeNoColor(str, styleType) {
  return str;
}
function arrayToHash(array) {
  var hash = {};
  array.forEach(function (val, idx) {
    hash[val] = true;
  });
  return hash;
}
function formatValue(ctx, value, recurseTimes) {
  if (ctx.customInspect && value) {
    const customInspect = value[kInspectCustom];
    if (isFunction(customInspect)) {
      var ret = customInspect.call(value, recurseTimes, ctx, inspect);
      if (!isString(ret)) {
        ret = formatValue(ctx, ret, recurseTimes);
      }
      return ret;
    }
  }
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }
  var keys = Object.keys(value).concat(Object.getOwnPropertySymbols(value));
  var visibleKeys = arrayToHash(keys);
  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }
  if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
    return formatError(value);
  }
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ": " + value.name : "";
      return ctx.stylize("[Function" + name + "]", "special");
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), "date");
    }
    if (isError(value)) {
      return formatError(value);
    }
  }
  var base = "",
    array = false,
    braces = ["{", "}"];
  if ($isArray(value)) {
    array = true;
    braces = ["[", "]"];
  }
  if (isFunction(value)) {
    var n = value.name ? ": " + value.name : "";
    base = " [Function" + n + "]";
  }
  if (isRegExp(value)) {
    base = " " + RegExp.prototype.toString.call(value);
  }
  if (isDate(value)) {
    base = " " + Date.prototype.toUTCString.call(value);
  }
  if (isError(value)) {
    base = " " + formatError(value);
  }
  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }
  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    } else {
      return ctx.stylize("[Object]", "special");
    }
  }
  ctx.seen.push(value);
  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function (key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }
  ctx.seen.pop();
  return reduceToSingleString(output, base, braces);
}
function formatPrimitive(ctx, value) {
  if (isUndefined(value)) return ctx.stylize("undefined", "undefined");
  if (isString(value)) {
    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
    return ctx.stylize(simple, "string");
  }
  if (isNumber(value)) return ctx.stylize("" + value, "number");
  if (isBoolean(value)) return ctx.stylize("" + value, "boolean");
  if (isNull(value)) return ctx.stylize("null", "null");
}
function formatError(value) {
  return "[" + Error.prototype.toString.call(value) + "]";
}
function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true));
    } else {
      output.push("");
    }
  }
  keys.forEach(function (key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true));
    }
  });
  return output;
}
function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || {
    value: value[key],
  };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize("[Getter/Setter]", "special");
    } else {
      str = ctx.stylize("[Getter]", "special");
    }
  } else {
    if (desc.set) {
      str = ctx.stylize("[Setter]", "special");
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = "[" + (typeof key === "symbol" ? key.description : key) + "]";
  }
  if (typeof key === "symbol") {
    name = "[" + ctx.stylize(`Symbol(${key.description})`, "string") + "]";
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf("\n") > -1) {
        if (array) {
          str = str
            .split("\n")
            .map(function (line) {
              return "  " + line;
            })
            .join("\n")
            .substr(2);
        } else {
          str =
            "\n" +
            str
              .split("\n")
              .map(function (line) {
                return "   " + line;
              })
              .join("\n");
        }
      }
    } else {
      str = ctx.stylize("[Circular]", "special");
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify("" + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, "name");
    } else {
      name = name
        .replace(/'/g, "\\'")
        .replace(/\\"/g, '"')
        .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, "string");
    }
  }
  return name + ": " + str;
}
function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function (prev, cur) {
    numLinesEst++;
    if (cur.indexOf("\n") >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
  }, 0);
  if (length > 60) {
    return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
  }
  return braces[0] + base + " " + output.join(", ") + " " + braces[1];
}

function isBoolean(arg) {
  return typeof arg === "boolean";
}

function isNull(arg) {
  return arg === null;
}

function isNullOrUndefined(arg) {
  return arg == null;
}

function isNumber(arg) {
  return typeof arg === "number";
}

function isString(arg) {
  return typeof arg === "string";
}

function isSymbol(arg) {
  return typeof arg === "symbol";
}
function isUndefined(arg) {
  return arg === void 0;
}
var isRegExp = types.isRegExp;
function isObject(arg) {
  return typeof arg === "object" && arg !== null;
}
var isDate = types.isDate;
var isError = types.isNativeError;
function isPrimitive(arg) {
  return (
    arg === null ||
    typeof arg === "boolean" ||
    typeof arg === "number" ||
    typeof arg === "string" ||
    typeof arg === "symbol" ||
    typeof arg === "undefined"
  );
}
function pad(n) {
  return n < 10 ? "0" + n.toString(10) : n.toString(10);
}
var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
  return [d.getDate(), months[d.getMonth()], time].join(" ");
}
var log = function log() {
  console.log("%s - %s", timestamp(), format.apply(cjs_exports, arguments));
};
var inherits = function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true,
    },
  });
};
var _extend = function (origin, add) {
  if (!add || !isObject(add)) return origin;
  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
var kCustomPromisifiedSymbol = Symbol.for("util.promisify.custom");
var promisify = function promisify(original) {
  if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');
  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    if (typeof fn !== "function") {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    return fn;
  }
  function fn() {
    var promiseResolve, promiseReject;
    var promise = new Promise(function (resolve, reject) {
      promiseResolve = resolve;
      promiseReject = reject;
    });
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    args.push(function (err, value) {
      if (err) {
        promiseReject(err);
      } else {
        promiseResolve(value);
      }
    });
    try {
      original.apply(this, args);
    } catch (err) {
      promiseReject(err);
    }
    return promise;
  }
  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  if (kCustomPromisifiedSymbol)
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  return Object.defineProperties(fn, getOwnPropertyDescriptors(original));
};
promisify.custom = kCustomPromisifiedSymbol;
function callbackifyOnRejected(reason, cb) {
  if (!reason) {
    var newReason = new Error("Promise was rejected with a falsy value");
    newReason.reason = reason;
    newReason.code = "ERR_FALSY_VALUE_REJECTION";
    reason = newReason;
  }
  return cb(reason);
}
function callbackify(original) {
  if (typeof original !== "function") {
    throw new TypeError('The "original" argument must be of type Function');
  }
  function callbackified() {
    var args = Array.prototype.slice.call(arguments);
    var maybeCb = args.pop();
    if (typeof maybeCb !== "function") {
      throw new TypeError("The last argument must be of type Function");
    }
    var self = this;
    var cb = function () {
      return maybeCb.apply(self, arguments);
    };
    original.apply(this, args).then(
      function (ret) {
        process.nextTick(cb, null, ret);
      },
      function (rej) {
        process.nextTick(callbackifyOnRejected, rej, cb);
      },
    );
  }
  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified, getOwnPropertyDescriptors(original));
  return callbackified;
}
var toUSVString = input => {
  return (input + "").toWellFormed();
};

const SafeStringPrototypeSearch = (str, regexp) => {
  regexp.lastIndex = 0;
  const match = RegExpPrototypeExec.call(regexp, str);
  return match ? match.index : -1;
};

const EQUALS_SEMICOLON_OR_END = /[;=]|$/;
const QUOTED_VALUE_PATTERN = /^(?:([\\]$)|[\\][\s\S]|[^"])*(?:(")|$)/u;

function removeBackslashes(str) {
  let ret = "";
  // We stop at str.length - 1 because we want to look ahead one character.
  let i;
  for (i = 0; i < str.length - 1; i++) {
    const c = str[i];
    if (c === "\\") {
      i++;
      ret += str[i];
    } else {
      ret += c;
    }
  }
  // We add the last character if we didn't skip to it.
  if (i === str.length - 1) {
    ret += str[i];
  }
  return ret;
}

function toASCIILower(str) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    result += char >= "A" && char <= "Z" ? StringPrototypeToLowerCase.call(char) : char;
  }
  return result;
}

const SOLIDUS = "/";
const SEMICOLON = ";";

function parseTypeAndSubtype(str) {
  // Skip only HTTP whitespace from start
  let position = SafeStringPrototypeSearch(str, END_BEGINNING_WHITESPACE);
  // read until '/'
  const typeEnd = StringPrototypeIndexOf.call(str, SOLIDUS, position);
  const trimmedType =
    typeEnd === -1 ? StringPrototypeSlice(str, position) : StringPrototypeSlice.$call(str, position, typeEnd);
  const invalidTypeIndex = SafeStringPrototypeSearch(trimmedType, NOT_HTTP_TOKEN_CODE_POINT);
  if (trimmedType === "" || invalidTypeIndex !== -1 || typeEnd === -1) {
    const msg = invalidTypeIndex !== -1 ? ` at ${invalidTypeIndex}` : "";
    throw new Error(`The MIME syntax for a type in "${str}" is invalid ${msg}`);
  }
  // skip type and '/'
  position = typeEnd + 1;
  const type = toASCIILower(trimmedType);
  // read until ';'
  const subtypeEnd = StringPrototypeIndexOf.call(str, SEMICOLON, position);
  const rawSubtype =
    subtypeEnd === -1 ? StringPrototypeSlice(str, position) : StringPrototypeSlice.$call(str, position, subtypeEnd);
  position += rawSubtype.length;
  if (subtypeEnd !== -1) {
    // skip ';'
    position += 1;
  }
  const trimmedSubtype = StringPrototypeSlice.$call(
    rawSubtype,
    0,
    SafeStringPrototypeSearch(rawSubtype, START_ENDING_WHITESPACE),
  );
  const invalidSubtypeIndex = SafeStringPrototypeSearch(trimmedSubtype, NOT_HTTP_TOKEN_CODE_POINT);
  if (trimmedSubtype === "" || invalidSubtypeIndex !== -1) {
    const msg = invalidSubtypeIndex !== -1 ? ` at ${invalidSubtypeIndex}` : "";
    throw new Error(`The MIME syntax for a subtype in "${str}" is invalid ${msg}`);
  }
  const subtype = toASCIILower(trimmedSubtype);
  return {
    __proto__: null,
    type,
    subtype,
    parametersStringIndex: position,
  };
}

function escapeQuoteOrSolidus(str) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    result += char === '"' || char === "\\" ? `\\${char}` : char;
  }
  return result;
}

const encode = value => {
  if (value.length === 0) return '""';
  const encode = SafeStringPrototypeSearch(value, NOT_HTTP_TOKEN_CODE_POINT) !== -1;
  if (!encode) return value;
  const escaped = escapeQuoteOrSolidus(value);
  return `"${escaped}"`;
};

class MIMEParams {
  #data = new SafeMap();

  delete(name) {
    this.#data.delete(name);
  }

  get(name) {
    const data = this.#data;
    if (data.has(name)) {
      return data.get(name);
    }
    return null;
  }

  has(name) {
    this.#data.has(name);
  }

  set(name, value) {
    const data = this.#data;
    name = `${name}`;
    value = `${value}`;
    const invalidNameIndex = SafeStringPrototypeSearch(name, NOT_HTTP_TOKEN_CODE_POINT);
    if (name.length === 0 || invalidNameIndex !== -1) {
      const msg = invalidNameIndex !== -1 ? ` at ${invalidNameIndex}` : "";
      throw new Error(`The MIME syntax for a parameter name in "${name}" is invalid ${msg}`);
    }
    const invalidValueIndex = SafeStringPrototypeSearch(value, NOT_HTTP_QUOTED_STRING_CODE_POINT);
    if (invalidValueIndex !== -1) {
      const msg = invalidValueIndex !== -1 ? ` at ${invalidValueIndex}` : "";
      throw new Error(`The MIME syntax for a parameter value in "${value}" is invalid ${msg}`);
    }
    data.set(name, value);
  }

  *entries() {
    yield* this.#data.entries();
  }

  *keys() {
    yield* this.#data.keys();
  }

  *values() {
    yield* this.#data.values();
  }

  toString() {
    let ret = "";
    for (const { 0: key, 1: value } of this.#data) {
      const encoded = encode(value);
      // Ensure they are separated
      if (ret.length) ret += ";";
      ret += `${key}=${encoded}`;
    }
    return ret;
  }

  static parseParametersString(str, position, params) {
    const paramsMap = params.#data;
    const endOfSource =
      SafeStringPrototypeSearch(StringPrototypeSlice(str, position), START_ENDING_WHITESPACE) + position;
    while (position < endOfSource) {
      // Skip any whitespace before parameter
      position += SafeStringPrototypeSearch(StringPrototypeSlice(str, position), END_BEGINNING_WHITESPACE);
      // Read until ';' or '='
      const afterParameterName =
        SafeStringPrototypeSearch(StringPrototypeSlice.$call(str, position), EQUALS_SEMICOLON_OR_END) + position;
      const parameterString = toASCIILower(StringPrototypeSlice.$call(str, position, afterParameterName));
      position = afterParameterName;
      // If we found a terminating character
      if (position < endOfSource) {
        // Safe to use because we never do special actions for surrogate pairs
        const char = StringPrototypeCharAt.$call(str, position);
        // Skip the terminating character
        position += 1;
        // Ignore parameters without values
        if (char === ";") {
          continue;
        }
      }
      // If we are at end of the string, it cannot have a value
      if (position >= endOfSource) break;
      // Safe to use because we never do special actions for surrogate pairs
      const char = StringPrototypeCharAt.$call(str, position);
      let parameterValue = null;
      if (char === '"') {
        // Handle quoted-string form of values
        // skip '"'
        position += 1;
        // Find matching closing '"' or end of string
        //   use $1 to see if we terminated on unmatched '\'
        //   use $2 to see if we terminated on a matching '"'
        //   so we can skip the last char in either case
        const insideMatch = RegExpPrototypeExec.call(QUOTED_VALUE_PATTERN, StringPrototypeSlice(str, position));
        position += insideMatch[0].length;
        // Skip including last character if an unmatched '\' or '"' during
        // unescape
        const inside =
          insideMatch[1] || insideMatch[2] ? StringPrototypeSlice.$call(insideMatch[0], 0, -1) : insideMatch[0];
        // Unescape '\' quoted characters
        parameterValue = removeBackslashes(inside);
        // If we did have an unmatched '\' add it back to the end
        if (insideMatch[1]) parameterValue += "\\";
      } else {
        // Handle the normal parameter value form
        const valueEnd = StringPrototypeIndexOf(str, SEMICOLON, position);
        const rawValue =
          valueEnd === -1 ? StringPrototypeSlice(str, position) : StringPrototypeSlice.$call(str, position, valueEnd);
        position += rawValue.length;
        const trimmedValue = StringPrototypeSlice.$call(
          rawValue,
          0,
          SafeStringPrototypeSearch(rawValue, START_ENDING_WHITESPACE),
        );
        // Ignore parameters without values
        if (trimmedValue === "") continue;
        parameterValue = trimmedValue;
      }
      if (
        parameterString !== "" &&
        SafeStringPrototypeSearch(parameterString, NOT_HTTP_TOKEN_CODE_POINT) === -1 &&
        SafeStringPrototypeSearch(parameterValue, NOT_HTTP_QUOTED_STRING_CODE_POINT) === -1 &&
        params.has(parameterString) === false
      ) {
        paramsMap.set(parameterString, parameterValue);
      }
      position++;
    }
    return paramsMap;
  }
}

const MIMEParamsStringify = MIMEParams.prototype.toString;
ObjectDefineProperty(MIMEParams.prototype, SymbolIterator, {
  __proto__: null,
  configurable: true,
  value: MIMEParams.prototype.entries,
  writable: true,
});
ObjectDefineProperty(MIMEParams.prototype, "toJSON", {
  __proto__: null,
  configurable: true,
  value: MIMEParamsStringify,
  writable: true,
});

const { parseParametersString } = MIMEParams;
delete MIMEParams.parseParametersString;

class MIMEType {
  #type;
  #subtype;
  #parameters;
  constructor(string) {
    string = `${string}`;
    const data = parseTypeAndSubtype(string);
    this.#type = data.type;
    this.#subtype = data.subtype;
    this.#parameters = new MIMEParams();
    parseParametersString(string, data.parametersStringIndex, this.#parameters);
  }

  get type() {
    return this.#type;
  }

  set type(v) {
    v = `${v}`;
    const invalidTypeIndex = SafeStringPrototypeSearch(v, NOT_HTTP_TOKEN_CODE_POINT);
    if (v.length === 0 || invalidTypeIndex !== -1) {
      const msg = invalidTypeIndex !== -1 ? ` at ${invalidTypeIndex}` : "";
      throw new Error(`The MIME syntax for a type in "${v}" is invalid ${msg}`);
    }
    this.#type = toASCIILower(v);
  }

  get subtype() {
    return this.#subtype;
  }

  set subtype(v) {
    v = `${v}`;
    const invalidSubtypeIndex = SafeStringPrototypeSearch(v, NOT_HTTP_TOKEN_CODE_POINT);
    if (v.length === 0 || invalidSubtypeIndex !== -1) {
      const msg = invalidSubtypeIndex !== -1 ? ` at ${invalidSubtypeIndex}` : "";
      throw new Error(`The MIME syntax for a subtype in "${v}" is invalid ${msg}`);
    }
    this.#subtype = toASCIILower(v);
  }

  get essence() {
    return `${this.#type}/${this.#subtype}`;
  }

  get params() {
    return this.#parameters;
  }

  toString() {
    let ret = `${this.#type}/${this.#subtype}`;
    const paramStr = FunctionPrototypeCall(MIMEParamsStringify, this.#parameters);
    if (paramStr.length) ret += `;${paramStr}`;
    return ret;
  }
}
ObjectDefineProperty(MIMEType.prototype, "toJSON", {
  __proto__: null,
  configurable: true,
  value: MIMEType.prototype.toString,
  writable: true,
});

export default Object.assign(cjs_exports, {
  format,
  formatWithOptions,
  deprecate,
  debuglog,
  _extend,
  inspect,
  types,
  isArray: ArrayIsArray,
  isBoolean,
  isNull,
  isNullOrUndefined,
  isNumber,
  isString,
  isSymbol,
  isUndefined,
  isRegExp,
  isObject,
  isDate,
  isFunction,
  isError,
  isPrimitive,
  isBuffer,
  log,
  inherits,
  toUSVString,
  promisify,
  callbackify,
  isDeepStrictEqual,
  TextDecoder,
  TextEncoder,
  MIMEParams,
  MIMEType,
});
