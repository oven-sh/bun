// src/js/node/readline.js
var stripVTControlCharacters = function(str) {
  validateString(str, "str");
  return RegExpPrototypeSymbolReplace.call(ansi, str, "");
};
var promisify = function(original) {
  validateFunction(original, "original");
  if (original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    validateFunction(fn, "util.promisify.custom");
    return ObjectDefineProperty(fn, kCustomPromisifiedSymbol, {
      __proto__: null,
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true
    });
  }
  var argumentNames = original[kCustomPromisifyArgsSymbol];
  function fn(...args) {
    return new Promise((resolve, reject) => {
      ArrayPrototypePush.call(args, (err, ...values) => {
        if (err) {
          return reject(err);
        }
        if (argumentNames !== undefined && values.length > 1) {
          var obj = {};
          for (var i2 = 0;i2 < argumentNames.length; i2++)
            obj[argumentNames[i2]] = values[i2];
          resolve(obj);
        } else {
          resolve(values[0]);
        }
      });
      ReflectApply(original, this, args);
    });
  }
  ObjectSetPrototypeOf(fn, ObjectGetPrototypeOf(original));
  ObjectDefineProperty(fn, kCustomPromisifiedSymbol, {
    __proto__: null,
    value: fn,
    enumerable: false,
    writable: false,
    configurable: true
  });
  var descriptors = ObjectGetOwnPropertyDescriptors(original);
  var propertiesValues = ObjectValues(descriptors);
  for (var i = 0;i < propertiesValues.length; i++) {
    ObjectSetPrototypeOf(propertiesValues[i], null);
  }
  return ObjectDefineProperties(fn, descriptors);
};
var getNodeErrorByName = function(typeName) {
  var base = errorBases[typeName];
  if (base) {
    return base;
  }
  if (!ObjectKeys(VALID_NODE_ERROR_BASES).includes(typeName)) {
    throw new Error("Invalid NodeError type");
  }
  var Base = VALID_NODE_ERROR_BASES[typeName];

  class NodeError extends Base {
    [kIsNodeError] = true;
    code;
    constructor(msg, opts) {
      super(msg, opts);
      this.code = opts?.code || "ERR_GENERIC";
    }
    toString() {
      return `${this.name} [${this.code}]: ${this.message}`;
    }
  }
  errorBases[typeName] = NodeError;
  return NodeError;
};
var validateFunction = function(value, name) {
  if (typeof value !== "function")
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
};
var validateAbortSignal = function(signal, name) {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};
var validateArray = function(value, name, minLength = 0) {
  if (!ArrayIsArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    var reason = `must be longer than ${minLength}`;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};
var validateString = function(value, name) {
  if (typeof value !== "string")
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
};
var validateBoolean = function(value, name) {
  if (typeof value !== "boolean")
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
};
var validateInteger = function(value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) {
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!NumberIsInteger(value))
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  if (value < min || value > max)
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
};
var validateUint32 = function(value, name, positive = false) {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!NumberIsInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  var min = positive ? 1 : 0;
  var max = 4294967295;
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
};
var CSI = function(strings, ...args) {
  var ret = `${kEscape}[`;
  for (var n = 0;n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length)
      ret += args[n];
  }
  return ret;
};
var charLengthLeft = function(str, i) {
  if (i <= 0)
    return 0;
  if (i > 1 && StringPrototypeCodePointAt.call(str, i - 2) >= kUTF16SurrogateThreshold || StringPrototypeCodePointAt.call(str, i - 1) >= kUTF16SurrogateThreshold) {
    return 2;
  }
  return 1;
};
var charLengthAt = function(str, i) {
  if (str.length <= i) {
    return 1;
  }
  return StringPrototypeCodePointAt.call(str, i) >= kUTF16SurrogateThreshold ? 2 : 1;
};
function* emitKeys(stream) {
  while (true) {
    var ch = yield;
    var s = ch;
    var escaped = false;
    var keySeq = null;
    var keyName;
    var keyCtrl2 = false;
    var keyMeta = false;
    var keyShift = false;
    if (ch === kEscape) {
      escaped = true;
      s += ch = yield;
      if (ch === kEscape) {
        s += ch = yield;
      }
    }
    if (escaped && (ch === "O" || ch === "[")) {
      var code = ch;
      var modifier = 0;
      if (ch === "O") {
        s += ch = yield;
        if (ch >= "0" && ch <= "9") {
          modifier = (ch >> 0) - 1;
          s += ch = yield;
        }
        code += ch;
      } else if (ch === "[") {
        s += ch = yield;
        if (ch === "[") {
          code += ch;
          s += ch = yield;
        }
        var cmdStart = s.length - 1;
        if (ch >= "0" && ch <= "9") {
          s += ch = yield;
          if (ch >= "0" && ch <= "9") {
            s += ch = yield;
          }
        }
        if (ch === ";") {
          s += ch = yield;
          if (ch >= "0" && ch <= "9") {
            s += yield;
          }
        }
        var cmd = StringPrototypeSlice.call(s, cmdStart);
        var match;
        if (match = RegExpPrototypeExec.call(/^(\d\d?)(;(\d))?([~^$])$/, cmd)) {
          code += match[1] + match[4];
          modifier = (match[3] || 1) - 1;
        } else if (match = RegExpPrototypeExec.call(/^((\d;)?(\d))?([A-Za-z])$/, cmd)) {
          code += match[4];
          modifier = (match[3] || 1) - 1;
        } else {
          code += cmd;
        }
      }
      keyCtrl2 = !!(modifier & 4);
      keyMeta = !!(modifier & 10);
      keyShift = !!(modifier & 1);
      keyCode = code;
      switch (code) {
        case "[P":
          keyName = "f1";
          break;
        case "[Q":
          keyName = "f2";
          break;
        case "[R":
          keyName = "f3";
          break;
        case "[S":
          keyName = "f4";
          break;
        case "OP":
          keyName = "f1";
          break;
        case "OQ":
          keyName = "f2";
          break;
        case "OR":
          keyName = "f3";
          break;
        case "OS":
          keyName = "f4";
          break;
        case "[11~":
          keyName = "f1";
          break;
        case "[12~":
          keyName = "f2";
          break;
        case "[13~":
          keyName = "f3";
          break;
        case "[14~":
          keyName = "f4";
          break;
        case "[[A":
          keyName = "f1";
          break;
        case "[[B":
          keyName = "f2";
          break;
        case "[[C":
          keyName = "f3";
          break;
        case "[[D":
          keyName = "f4";
          break;
        case "[[E":
          keyName = "f5";
          break;
        case "[15~":
          keyName = "f5";
          break;
        case "[17~":
          keyName = "f6";
          break;
        case "[18~":
          keyName = "f7";
          break;
        case "[19~":
          keyName = "f8";
          break;
        case "[20~":
          keyName = "f9";
          break;
        case "[21~":
          keyName = "f10";
          break;
        case "[23~":
          keyName = "f11";
          break;
        case "[24~":
          keyName = "f12";
          break;
        case "[A":
          keyName = "up";
          break;
        case "[B":
          keyName = "down";
          break;
        case "[C":
          keyName = "right";
          break;
        case "[D":
          keyName = "left";
          break;
        case "[E":
          keyName = "clear";
          break;
        case "[F":
          keyName = "end";
          break;
        case "[H":
          keyName = "home";
          break;
        case "OA":
          keyName = "up";
          break;
        case "OB":
          keyName = "down";
          break;
        case "OC":
          keyName = "right";
          break;
        case "OD":
          keyName = "left";
          break;
        case "OE":
          keyName = "clear";
          break;
        case "OF":
          keyName = "end";
          break;
        case "OH":
          keyName = "home";
          break;
        case "[1~":
          keyName = "home";
          break;
        case "[2~":
          keyName = "insert";
          break;
        case "[3~":
          keyName = "delete";
          break;
        case "[4~":
          keyName = "end";
          break;
        case "[5~":
          keyName = "pageup";
          break;
        case "[6~":
          keyName = "pagedown";
          break;
        case "[[5~":
          keyName = "pageup";
          break;
        case "[[6~":
          keyName = "pagedown";
          break;
        case "[7~":
          keyName = "home";
          break;
        case "[8~":
          keyName = "end";
          break;
        case "[a":
          keyName = "up";
          keyShift = true;
          break;
        case "[b":
          keyName = "down";
          keyShift = true;
          break;
        case "[c":
          keyName = "right";
          keyShift = true;
          break;
        case "[d":
          keyName = "left";
          keyShift = true;
          break;
        case "[e":
          keyName = "clear";
          keyShift = true;
          break;
        case "[2$":
          keyName = "insert";
          keyShift = true;
          break;
        case "[3$":
          keyName = "delete";
          keyShift = true;
          break;
        case "[5$":
          keyName = "pageup";
          keyShift = true;
          break;
        case "[6$":
          keyName = "pagedown";
          keyShift = true;
          break;
        case "[7$":
          keyName = "home";
          keyShift = true;
          break;
        case "[8$":
          keyName = "end";
          keyShift = true;
          break;
        case "Oa":
          keyName = "up";
          keyCtrl2 = true;
          break;
        case "Ob":
          keyName = "down";
          keyCtrl2 = true;
          break;
        case "Oc":
          keyName = "right";
          keyCtrl2 = true;
          break;
        case "Od":
          keyName = "left";
          keyCtrl2 = true;
          break;
        case "Oe":
          keyName = "clear";
          keyCtrl2 = true;
          break;
        case "[2^":
          keyName = "insert";
          keyCtrl2 = true;
          break;
        case "[3^":
          keyName = "delete";
          keyCtrl2 = true;
          break;
        case "[5^":
          keyName = "pageup";
          keyCtrl2 = true;
          break;
        case "[6^":
          keyName = "pagedown";
          keyCtrl2 = true;
          break;
        case "[7^":
          keyName = "home";
          keyCtrl2 = true;
          break;
        case "[8^":
          keyName = "end";
          keyCtrl2 = true;
          break;
        case "[Z":
          keyName = "tab";
          keyShift = true;
          break;
        default:
          keyName = "undefined";
          break;
      }
    } else if (ch === "\r") {
      keyName = "return";
      keyMeta = escaped;
    } else if (ch === "\n") {
      keyName = "enter";
      keyMeta = escaped;
    } else if (ch === "\t") {
      keyName = "tab";
      keyMeta = escaped;
    } else if (ch === "\b" || ch === "\x7F") {
      keyName = "backspace";
      keyMeta = escaped;
    } else if (ch === kEscape) {
      keyName = "escape";
      keyMeta = escaped;
    } else if (ch === " ") {
      keyName = "space";
      keyMeta = escaped;
    } else if (!escaped && ch <= "\x1A") {
      keyName = StringFromCharCode(StringPrototypeCharCodeAt.call(ch) + StringPrototypeCharCodeAt.call("a") - 1);
      keyCtrl2 = true;
    } else if (RegExpPrototypeExec.call(/^[0-9A-Za-z]$/, ch) !== null) {
      keyName = StringPrototypeToLowerCase.call(ch);
      keyShift = RegExpPrototypeExec.call(/^[A-Z]$/, ch) !== null;
      keyMeta = escaped;
    } else if (escaped) {
      keyName = ch.length ? undefined : "escape";
      keyMeta = true;
    }
    keySeq = s;
    if (s.length !== 0 && (keyName !== undefined || escaped)) {
      stream.emit("keypress", escaped ? undefined : s, {
        sequence: keySeq,
        name: keyName,
        ctrl: keyCtrl2,
        meta: keyMeta,
        shift: keyShift
      });
    } else if (charLengthAt(s, 0) === s.length) {
      stream.emit("keypress", s, {
        sequence: keySeq,
        name: keyName,
        ctrl: keyCtrl2,
        meta: keyMeta,
        shift: keyShift
      });
    }
  }
}
var commonPrefix = function(strings) {
  if (strings.length === 0) {
    return "";
  }
  if (strings.length === 1) {
    return strings[0];
  }
  var sorted = ArrayPrototypeSort.call(ArrayPrototypeSlice.call(strings));
  var min = sorted[0];
  var max = sorted[sorted.length - 1];
  for (var i = 0;i < min.length; i++) {
    if (min[i] !== max[i]) {
      return StringPrototypeSlice.call(min, 0, i);
    }
  }
  return min;
};
var cursorTo = function(stream, x, y, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }
  if (typeof y === "function") {
    callback = y;
    y = undefined;
  }
  if (NumberIsNaN(x))
    throw new ERR_INVALID_ARG_VALUE("x", x);
  if (NumberIsNaN(y))
    throw new ERR_INVALID_ARG_VALUE("y", y);
  if (stream == null || typeof x !== "number" && typeof y !== "number") {
    if (typeof callback === "function")
      process.nextTick(callback, null);
    return true;
  }
  if (typeof x !== "number")
    throw new ERR_INVALID_CURSOR_POS;
  var data = typeof y !== "number" ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
  return stream.write(data, callback);
};
var moveCursor = function(stream, dx, dy, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }
  if (stream == null || !(dx || dy)) {
    if (typeof callback === "function")
      process.nextTick(callback, null);
    return true;
  }
  var data = "";
  if (dx < 0) {
    data += CSI`${-dx}D`;
  } else if (dx > 0) {
    data += CSI`${dx}C`;
  }
  if (dy < 0) {
    data += CSI`${-dy}A`;
  } else if (dy > 0) {
    data += CSI`${dy}B`;
  }
  return stream.write(data, callback);
};
var clearLine = function(stream, dir, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }
  if (stream === null || stream === undefined) {
    if (typeof callback === "function")
      process.nextTick(callback, null);
    return true;
  }
  var type = dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
  return stream.write(type, callback);
};
var clearScreenDown = function(stream, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }
  if (stream === null || stream === undefined) {
    if (typeof callback === "function")
      process.nextTick(callback, null);
    return true;
  }
  return stream.write(kClearScreenDown, callback);
};
var emitKeypressEvents = function(stream, iface = {}) {
  if (stream[KEYPRESS_DECODER])
    return;
  stream[KEYPRESS_DECODER] = new StringDecoder("utf8");
  stream[ESCAPE_DECODER] = emitKeys(stream);
  stream[ESCAPE_DECODER].next();
  var triggerEscape = () => stream[ESCAPE_DECODER].next("");
  var { escapeCodeTimeout = ESCAPE_CODE_TIMEOUT } = iface;
  var timeoutId;
  function onData(input) {
    if (stream.listenerCount("keypress") > 0) {
      var string = stream[KEYPRESS_DECODER].write(input);
      if (string) {
        clearTimeout(timeoutId);
        iface[kSawKeyPress] = charLengthAt(string, 0) === string.length;
        iface.isCompletionEnabled = false;
        var length = 0;
        for (var character of new SafeStringIterator(string)) {
          length += character.length;
          if (length === string.length) {
            iface.isCompletionEnabled = true;
          }
          try {
            stream[ESCAPE_DECODER].next(character);
            if (length === string.length && character === kEscape) {
              timeoutId = setTimeout(triggerEscape, escapeCodeTimeout);
            }
          } catch (err) {
            stream[ESCAPE_DECODER] = emitKeys(stream);
            stream[ESCAPE_DECODER].next();
            throw err;
          }
        }
      }
    } else {
      stream.removeListener("data", onData);
      stream.on("newListener", onNewListener);
    }
  }
  function onNewListener(event) {
    if (event === "keypress") {
      stream.on("data", onData);
      stream.removeListener("newListener", onNewListener);
    }
  }
  if (stream.listenerCount("keypress") > 0) {
    stream.on("data", onData);
  } else {
    stream.on("newListener", onNewListener);
  }
};
var onSelfCloseWithTerminal = function() {
  var input = this.input;
  var output = this.output;
  if (!input)
    throw new Error("Input not set, invalid state for readline!");
  input.removeListener("keypress", this[kOnKeyPress]);
  input.removeListener("error", this[kOnError]);
  input.removeListener("end", this[kOnTermEnd]);
  if (output !== null && output !== undefined) {
    output.removeListener("resize", this[kOnResize]);
  }
};
var onSelfCloseWithoutTerminal = function() {
  var input = this.input;
  if (!input)
    throw new Error("Input not set, invalid state for readline!");
  input.removeListener("data", this[kOnData]);
  input.removeListener("error", this[kOnError]);
  input.removeListener("end", this[kOnEnd]);
};
var onError = function(err) {
  this.emit("error", err);
};
var onData = function(data) {
  debug("onData");
  this[kNormalWrite](data);
};
var onEnd = function() {
  debug("onEnd");
  if (typeof this[kLine_buffer] === "string" && this[kLine_buffer].length > 0) {
    this.emit("line", this[kLine_buffer]);
  }
  this.close();
};
var onTermEnd = function() {
  debug("onTermEnd");
  if (typeof this.line === "string" && this.line.length > 0) {
    this.emit("line", this.line);
  }
  this.close();
};
var onKeyPress = function(s, key) {
  this[kTtyWrite](s, key);
  if (key && key.sequence) {
    var ch = StringPrototypeCodePointAt.call(key.sequence, 0);
    if (ch >= 55296 && ch <= 57343)
      this[kRefreshLine]();
  }
};
var onResize = function() {
  this[kRefreshLine]();
};
var InterfaceConstructor = function(input, output, completer, terminal) {
  if (!(this instanceof InterfaceConstructor)) {
    return new InterfaceConstructor(input, output, completer, terminal);
  }
  EventEmitter.call(this);
  this[kOnSelfCloseWithoutTerminal] = onSelfCloseWithoutTerminal.bind(this);
  this[kOnSelfCloseWithTerminal] = onSelfCloseWithTerminal.bind(this);
  this[kOnError] = onError.bind(this);
  this[kOnData] = onData.bind(this);
  this[kOnEnd] = onEnd.bind(this);
  this[kOnTermEnd] = onTermEnd.bind(this);
  this[kOnKeyPress] = onKeyPress.bind(this);
  this[kOnResize] = onResize.bind(this);
  this[kSawReturnAt] = 0;
  this.isCompletionEnabled = true;
  this[kSawKeyPress] = false;
  this[kPreviousKey] = null;
  this.escapeCodeTimeout = ESCAPE_CODE_TIMEOUT;
  this.tabSize = 8;
  var history;
  var historySize;
  var removeHistoryDuplicates = false;
  var crlfDelay;
  var prompt = "> ";
  var signal;
  if (input?.input) {
    output = input.output;
    completer = input.completer;
    terminal = input.terminal;
    history = input.history;
    historySize = input.historySize;
    signal = input.signal;
    var tabSize = input.tabSize;
    if (tabSize !== undefined) {
      validateUint32(tabSize, "tabSize", true);
      this.tabSize = tabSize;
    }
    removeHistoryDuplicates = input.removeHistoryDuplicates;
    var inputPrompt = input.prompt;
    if (inputPrompt !== undefined) {
      prompt = inputPrompt;
    }
    var inputEscapeCodeTimeout = input.escapeCodeTimeout;
    if (inputEscapeCodeTimeout !== undefined) {
      if (NumberIsFinite(inputEscapeCodeTimeout)) {
        this.escapeCodeTimeout = inputEscapeCodeTimeout;
      } else {
        throw new ERR_INVALID_ARG_VALUE("input.escapeCodeTimeout", this.escapeCodeTimeout);
      }
    }
    if (signal) {
      validateAbortSignal(signal, "options.signal");
    }
    crlfDelay = input.crlfDelay;
    input = input.input;
  }
  if (completer !== undefined && typeof completer !== "function") {
    throw new ERR_INVALID_ARG_VALUE("completer", completer);
  }
  if (history === undefined) {
    history = [];
  } else {
    validateArray(history, "history");
  }
  if (historySize === undefined) {
    historySize = kHistorySize;
  }
  if (typeof historySize !== "number" || NumberIsNaN(historySize) || historySize < 0) {
    throw new ERR_INVALID_ARG_VALUE("historySize", historySize);
  }
  if (terminal === undefined && !(output === null || output === undefined)) {
    terminal = !!output.isTTY;
  }
  this.line = "";
  this[kSubstringSearch] = null;
  this.output = output;
  this.input = input;
  this[kUndoStack] = [];
  this[kRedoStack] = [];
  this.history = history;
  this.historySize = historySize;
  this[kKillRing] = [];
  this[kKillRingCursor] = 0;
  this.removeHistoryDuplicates = !!removeHistoryDuplicates;
  this.crlfDelay = crlfDelay ? MathMax(kMincrlfDelay, crlfDelay) : kMincrlfDelay;
  this.completer = completer;
  this.setPrompt(prompt);
  this.terminal = !!terminal;
  this[kLineObjectStream] = undefined;
  input.on("error", this[kOnError]);
  if (!this.terminal) {
    input.on("data", this[kOnData]);
    input.on("end", this[kOnEnd]);
    this.once("close", this[kOnSelfCloseWithoutTerminal]);
    this[kDecoder] = new StringDecoder("utf8");
  } else {
    emitKeypressEvents(input, this);
    input.on("keypress", this[kOnKeyPress]);
    input.on("end", this[kOnTermEnd]);
    this[kSetRawMode](true);
    this.terminal = true;
    this.cursor = 0;
    this.historyIndex = -1;
    if (output !== null && output !== undefined)
      output.on("resize", this[kOnResize]);
    this.once("close", this[kOnSelfCloseWithTerminal]);
  }
  if (signal) {
    var onAborted = (() => this.close()).bind(this);
    if (signal.aborted) {
      process.nextTick(onAborted);
    } else {
      signal.addEventListener("abort", onAborted, { once: true });
      this.once("close", () => signal.removeEventListener("abort", onAborted));
    }
  }
  this.line = "";
  input.resume();
};
var Interface = function(input, output, completer, terminal) {
  if (!(this instanceof Interface)) {
    return new Interface(input, output, completer, terminal);
  }
  if (input?.input && typeof input.completer === "function" && input.completer.length !== 2) {
    var { completer } = input;
    input.completer = (v, cb) => cb(null, completer(v));
  } else if (typeof completer === "function" && completer.length !== 2) {
    var realCompleter = completer;
    completer = (v, cb) => cb(null, realCompleter(v));
  }
  InterfaceConstructor.call(this, input, output, completer, terminal);
  if (false) {
  }
};
var createInterface = function(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
};
var { Array, RegExp, String, Bun } = import.meta.primordials;
var EventEmitter = import.meta.require("node:events");
var { clearTimeout, setTimeout } = import.meta.require("timers");
var { StringDecoder } = import.meta.require("string_decoder");
var isWritable;
var { inspect } = Bun;
var debug = process.env.BUN_JS_DEBUG ? console.log : () => {
};
var SymbolAsyncIterator = Symbol.asyncIterator;
var SymbolIterator = Symbol.iterator;
var SymbolFor = Symbol.for;
var SymbolReplace = Symbol.replace;
var ArrayFrom = Array.from;
var ArrayIsArray = Array.isArray;
var ArrayPrototypeFilter = Array.prototype.filter;
var ArrayPrototypeSort = Array.prototype.sort;
var ArrayPrototypeIndexOf = Array.prototype.indexOf;
var ArrayPrototypeJoin = Array.prototype.join;
var ArrayPrototypeMap = Array.prototype.map;
var ArrayPrototypePop = Array.prototype.pop;
var ArrayPrototypePush = Array.prototype.push;
var ArrayPrototypeSlice = Array.prototype.slice;
var ArrayPrototypeSplice = Array.prototype.splice;
var ArrayPrototypeReverse = Array.prototype.reverse;
var ArrayPrototypeShift = Array.prototype.shift;
var ArrayPrototypeUnshift = Array.prototype.unshift;
var RegExpPrototypeExec = RegExp.prototype.exec;
var RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
var StringFromCharCode = String.fromCharCode;
var StringPrototypeCharCodeAt = String.prototype.charCodeAt;
var StringPrototypeCodePointAt = String.prototype.codePointAt;
var StringPrototypeSlice = String.prototype.slice;
var StringPrototypeToLowerCase = String.prototype.toLowerCase;
var StringPrototypeEndsWith = String.prototype.endsWith;
var StringPrototypeRepeat = String.prototype.repeat;
var StringPrototypeStartsWith = String.prototype.startsWith;
var StringPrototypeTrim = String.prototype.trim;
var StringPrototypeNormalize = String.prototype.normalize;
var NumberIsNaN = Number.isNaN;
var NumberIsFinite = Number.isFinite;
var NumberIsInteger = Number.isInteger;
var NumberMAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
var NumberMIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
var MathCeil = Math.ceil;
var MathFloor = Math.floor;
var MathMax = Math.max;
var MathMaxApply = Math.max.apply;
var DateNow = Date.now;
var FunctionPrototype = Function.prototype;
var StringPrototype = String.prototype;
var StringPrototypeSymbolIterator = StringPrototype[SymbolIterator];
var StringIteratorPrototypeNext = StringPrototypeSymbolIterator.call("").next;
var ObjectSetPrototypeOf = Object.setPrototypeOf;
var ObjectDefineProperty = Object.defineProperty;
var ObjectDefineProperties = Object.defineProperties;
var ObjectFreeze = Object.freeze;
var ObjectCreate = Object.create;
var ObjectKeys = Object.keys;
var createSafeIterator = (factory, next) => {
  class SafeIterator {
    #iterator;
    constructor(iterable) {
      this.#iterator = factory.call(iterable);
    }
    next() {
      return next.call(this.#iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  ObjectSetPrototypeOf(SafeIterator.prototype, null);
  ObjectFreeze(SafeIterator.prototype);
  ObjectFreeze(SafeIterator);
  return SafeIterator;
};
var SafeStringIterator = createSafeIterator(StringPrototypeSymbolIterator, StringIteratorPrototypeNext);
var isFullWidthCodePoint = (code) => {
  return code >= 4352 && (code <= 4447 || code === 9001 || code === 9002 || code >= 11904 && code <= 12871 && code !== 12351 || code >= 12880 && code <= 19903 || code >= 19968 && code <= 42182 || code >= 43360 && code <= 43388 || code >= 44032 && code <= 55203 || code >= 63744 && code <= 64255 || code >= 65040 && code <= 65049 || code >= 65072 && code <= 65131 || code >= 65281 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 110592 && code <= 110593 || code >= 127488 && code <= 127569 || code >= 127744 && code <= 128591 || code >= 131072 && code <= 262141);
};
var isZeroWidthCodePoint = (code) => {
  return code <= 31 || code >= 127 && code <= 159 || code >= 768 && code <= 879 || code >= 8203 && code <= 8207 || code >= 8400 && code <= 8447 || code >= 65024 && code <= 65039 || code >= 65056 && code <= 65071 || code >= 917760 && code <= 917999;
};
var getStringWidth = function getStringWidth2(str, removeControlChars = true) {
  var width = 0;
  if (removeControlChars)
    str = stripVTControlCharacters(str);
  str = StringPrototypeNormalize.call(str, "NFC");
  for (var char of new SafeStringIterator(str)) {
    var code = StringPrototypeCodePointAt.call(char, 0);
    if (isFullWidthCodePoint(code)) {
      width += 2;
    } else if (!isZeroWidthCodePoint(code)) {
      width++;
    }
  }
  return width;
};
var ansiPattern = "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
var ansi = new RegExp(ansiPattern, "g");
var kCustomPromisifiedSymbol = SymbolFor("nodejs.util.promisify.custom");
var kCustomPromisifyArgsSymbol = Symbol("customPromisifyArgs");
promisify.custom = kCustomPromisifiedSymbol;
var kUTF16SurrogateThreshold = 65536;
var kEscape = "\x1B";
var kSubstringSearch = Symbol("kSubstringSearch");
var kIsNodeError = Symbol("kIsNodeError");
var errorBases = {};
var VALID_NODE_ERROR_BASES = {
  TypeError,
  RangeError,
  Error
};
var NodeError = getNodeErrorByName("Error");
var NodeTypeError = getNodeErrorByName("TypeError");
var NodeRangeError = getNodeErrorByName("RangeError");

class ERR_INVALID_ARG_TYPE extends NodeTypeError {
  constructor(name, type, value) {
    super(`The "${name}" argument must be of type ${type}. Received type ${typeof value}`, {
      code: "ERR_INVALID_ARG_TYPE"
    });
  }
}

class ERR_INVALID_ARG_VALUE extends NodeTypeError {
  constructor(name, value, reason = "not specified") {
    super(`The value "${String(value)}" is invalid for argument '${name}'. Reason: ${reason}`, {
      code: "ERR_INVALID_ARG_VALUE"
    });
  }
}

class ERR_INVALID_CURSOR_POS extends NodeTypeError {
  constructor() {
    super("Cannot set cursor row without setting its column", {
      code: "ERR_INVALID_CURSOR_POS"
    });
  }
}

class ERR_OUT_OF_RANGE extends NodeRangeError {
  constructor(name, range, received) {
    super(`The value of "${name}" is out of range. It must be ${range}. Received ${received}`, {
      code: "ERR_OUT_OF_RANGE"
    });
  }
}

class ERR_USE_AFTER_CLOSE extends NodeError {
  constructor() {
    super("This socket has been ended by the other party", {
      code: "ERR_USE_AFTER_CLOSE"
    });
  }
}

class AbortError extends Error {
  code;
  constructor() {
    super("The operation was aborted");
    this.code = "ABORT_ERR";
  }
}
var kClearLine;
var kClearScreenDown;
var kClearToLineBeginning;
var kClearToLineEnd;
CSI.kEscape = kEscape;
CSI.kClearLine = kClearLine = CSI`2K`;
CSI.kClearScreenDown = kClearScreenDown = CSI`0J`;
CSI.kClearToLineBeginning = kClearToLineBeginning = CSI`1K`;
CSI.kClearToLineEnd = kClearToLineEnd = CSI`0K`;
var KEYPRESS_DECODER = Symbol("keypress-decoder");
var ESCAPE_DECODER = Symbol("escape-decoder");
var ESCAPE_CODE_TIMEOUT = 500;
var kEmptyObject = ObjectFreeze(ObjectCreate(null));
var kHistorySize = 30;
var kMaxUndoRedoStackSize = 2048;
var kMincrlfDelay = 100;
var lineEnding = /\r?\n|\r(?!\n)/g;
var kMaxLengthOfKillRing = 32;
var kLineObjectStream = Symbol("line object stream");
var kQuestionCancel = Symbol("kQuestionCancel");
var kQuestion = Symbol("kQuestion");
var kAddHistory = Symbol("_addHistory");
var kBeforeEdit = Symbol("_beforeEdit");
var kDecoder = Symbol("_decoder");
var kDeleteLeft = Symbol("_deleteLeft");
var kDeleteLineLeft = Symbol("_deleteLineLeft");
var kDeleteLineRight = Symbol("_deleteLineRight");
var kDeleteRight = Symbol("_deleteRight");
var kDeleteWordLeft = Symbol("_deleteWordLeft");
var kDeleteWordRight = Symbol("_deleteWordRight");
var kGetDisplayPos = Symbol("_getDisplayPos");
var kHistoryNext = Symbol("_historyNext");
var kHistoryPrev = Symbol("_historyPrev");
var kInsertString = Symbol("_insertString");
var kLine = Symbol("_line");
var kLine_buffer = Symbol("_line_buffer");
var kKillRing = Symbol("_killRing");
var kKillRingCursor = Symbol("_killRingCursor");
var kMoveCursor = Symbol("_moveCursor");
var kNormalWrite = Symbol("_normalWrite");
var kOldPrompt = Symbol("_oldPrompt");
var kOnLine = Symbol("_onLine");
var kPreviousKey = Symbol("_previousKey");
var kPrompt = Symbol("_prompt");
var kPushToKillRing = Symbol("_pushToKillRing");
var kPushToUndoStack = Symbol("_pushToUndoStack");
var kQuestionCallback = Symbol("_questionCallback");
var kRedo = Symbol("_redo");
var kRedoStack = Symbol("_redoStack");
var kRefreshLine = Symbol("_refreshLine");
var kSawKeyPress = Symbol("_sawKeyPress");
var kSawReturnAt = Symbol("_sawReturnAt");
var kSetRawMode = Symbol("_setRawMode");
var kTabComplete = Symbol("_tabComplete");
var kTabCompleter = Symbol("_tabCompleter");
var kTtyWrite = Symbol("_ttyWrite");
var kUndo = Symbol("_undo");
var kUndoStack = Symbol("_undoStack");
var kWordLeft = Symbol("_wordLeft");
var kWordRight = Symbol("_wordRight");
var kWriteToOutput = Symbol("_writeToOutput");
var kYank = Symbol("_yank");
var kYanking = Symbol("_yanking");
var kYankPop = Symbol("_yankPop");
var kFirstEventParam = Symbol("nodejs.kFirstEventParam");
var kOnSelfCloseWithTerminal = Symbol("_onSelfCloseWithTerminal");
var kOnSelfCloseWithoutTerminal = Symbol("_onSelfCloseWithoutTerminal");
var kOnKeyPress = Symbol("_onKeyPress");
var kOnError = Symbol("_onError");
var kOnData = Symbol("_onData");
var kOnEnd = Symbol("_onEnd");
var kOnTermEnd = Symbol("_onTermEnd");
var kOnResize = Symbol("_onResize");
ObjectSetPrototypeOf(InterfaceConstructor.prototype, EventEmitter.prototype);
ObjectSetPrototypeOf(InterfaceConstructor, EventEmitter);
var _Interface = class Interface2 extends InterfaceConstructor {
  constructor(input, output, completer, terminal) {
    super(input, output, completer, terminal);
  }
  get columns() {
    var output = this.output;
    if (output && output.columns)
      return output.columns;
    return Infinity;
  }
  setPrompt(prompt) {
    this[kPrompt] = prompt;
  }
  getPrompt() {
    return this[kPrompt];
  }
  [kSetRawMode](mode) {
    var input = this.input;
    var { setRawMode, wasInRawMode } = input;
    debug("setRawMode", mode, "set!");
    return wasInRawMode;
  }
  prompt(preserveCursor) {
    if (this.paused)
      this.resume();
    if (this.terminal && true) {
      if (!preserveCursor)
        this.cursor = 0;
      this[kRefreshLine]();
    } else {
      this[kWriteToOutput](this[kPrompt]);
    }
  }
  [kQuestion](query, cb) {
    if (this.closed) {
      throw new ERR_USE_AFTER_CLOSE("readline");
    }
    if (this[kQuestionCallback]) {
      this.prompt();
    } else {
      this[kOldPrompt] = this[kPrompt];
      this.setPrompt(query);
      this[kQuestionCallback] = cb;
      this.prompt();
    }
  }
  [kOnLine](line) {
    if (this[kQuestionCallback]) {
      var cb = this[kQuestionCallback];
      this[kQuestionCallback] = null;
      this.setPrompt(this[kOldPrompt]);
      cb(line);
    } else {
      this.emit("line", line);
    }
  }
  [kBeforeEdit](oldText, oldCursor) {
    this[kPushToUndoStack](oldText, oldCursor);
  }
  [kQuestionCancel]() {
    if (this[kQuestionCallback]) {
      this[kQuestionCallback] = null;
      this.setPrompt(this[kOldPrompt]);
      this.clearLine();
    }
  }
  [kWriteToOutput](stringToWrite) {
    validateString(stringToWrite, "stringToWrite");
    if (this.output !== null && this.output !== undefined) {
      this.output.write(stringToWrite);
    }
  }
  [kAddHistory]() {
    if (this.line.length === 0)
      return "";
    if (this.historySize === 0)
      return this.line;
    if (StringPrototypeTrim.call(this.line).length === 0)
      return this.line;
    if (this.history.length === 0 || this.history[0] !== this.line) {
      if (this.removeHistoryDuplicates) {
        var dupIndex = ArrayPrototypeIndexOf.call(this.history, this.line);
        if (dupIndex !== -1)
          ArrayPrototypeSplice.call(this.history, dupIndex, 1);
      }
      ArrayPrototypeUnshift.call(this.history, this.line);
      if (this.history.length > this.historySize)
        ArrayPrototypePop.call(this.history);
    }
    this.historyIndex = -1;
    var line = this.history[0];
    this.emit("history", this.history);
    return line;
  }
  [kRefreshLine]() {
    var line = this[kPrompt] + this.line;
    var dispPos = this[kGetDisplayPos](line);
    var lineCols = dispPos.cols;
    var lineRows = dispPos.rows;
    var cursorPos = this.getCursorPos();
    var prevRows = this.prevRows || 0;
    if (prevRows > 0) {
      moveCursor(this.output, 0, -prevRows);
    }
    cursorTo(this.output, 0);
    clearScreenDown(this.output);
    this[kWriteToOutput](line);
    if (lineCols === 0) {
      this[kWriteToOutput](" ");
    }
    cursorTo(this.output, cursorPos.cols);
    var diff = lineRows - cursorPos.rows;
    if (diff > 0) {
      moveCursor(this.output, 0, -diff);
    }
    this.prevRows = cursorPos.rows;
  }
  close() {
    if (this.closed)
      return;
    this.pause();
    if (this.terminal) {
      this[kSetRawMode](false);
    }
    this.closed = true;
    this.emit("close");
  }
  pause() {
    if (this.paused)
      return;
    this.input.pause();
    this.paused = true;
    this.emit("pause");
    return this;
  }
  resume() {
    if (!this.paused)
      return;
    this.input.resume();
    this.paused = false;
    this.emit("resume");
    return this;
  }
  write(d, key) {
    if (this.paused)
      this.resume();
    if (this.terminal) {
      this[kTtyWrite](d, key);
    } else {
      this[kNormalWrite](d);
    }
  }
  [kNormalWrite](b) {
    if (b === undefined) {
      return;
    }
    var string = this[kDecoder].write(b);
    if (this[kSawReturnAt] && DateNow() - this[kSawReturnAt] <= this.crlfDelay) {
      if (StringPrototypeCodePointAt.call(string) === 10)
        string = StringPrototypeSlice.call(string, 1);
      this[kSawReturnAt] = 0;
    }
    var newPartContainsEnding = RegExpPrototypeExec.call(lineEnding, string);
    if (newPartContainsEnding !== null) {
      if (this[kLine_buffer]) {
        string = this[kLine_buffer] + string;
        this[kLine_buffer] = null;
        newPartContainsEnding = RegExpPrototypeExec.call(lineEnding, string);
      }
      this[kSawReturnAt] = StringPrototypeEndsWith.call(string, "\r") ? DateNow() : 0;
      var indexes = [0, newPartContainsEnding.index, lineEnding.lastIndex];
      var nextMatch;
      while ((nextMatch = RegExpPrototypeExec.call(lineEnding, string)) !== null) {
        ArrayPrototypePush.call(indexes, nextMatch.index, lineEnding.lastIndex);
      }
      var lastIndex = indexes.length - 1;
      this[kLine_buffer] = StringPrototypeSlice.call(string, indexes[lastIndex]);
      for (var i = 1;i < lastIndex; i += 2) {
        this[kOnLine](StringPrototypeSlice.call(string, indexes[i - 1], indexes[i]));
      }
    } else if (string) {
      if (this[kLine_buffer]) {
        this[kLine_buffer] += string;
      } else {
        this[kLine_buffer] = string;
      }
    }
  }
  [kInsertString](c) {
    this[kBeforeEdit](this.line, this.cursor);
    if (this.cursor < this.line.length) {
      var beg = StringPrototypeSlice.call(this.line, 0, this.cursor);
      var end = StringPrototypeSlice.call(this.line, this.cursor, this.line.length);
      this.line = beg + c + end;
      this.cursor += c.length;
      this[kRefreshLine]();
    } else {
      var oldPos = this.getCursorPos();
      this.line += c;
      this.cursor += c.length;
      var newPos = this.getCursorPos();
      if (oldPos.rows < newPos.rows) {
        this[kRefreshLine]();
      } else {
        this[kWriteToOutput](c);
      }
    }
  }
  async[kTabComplete](lastKeypressWasTab) {
    this.pause();
    var string = StringPrototypeSlice.call(this.line, 0, this.cursor);
    var value;
    try {
      value = await this.completer(string);
    } catch (err) {
      this[kWriteToOutput](`Tab completion error: ${inspect(err)}`);
      return;
    } finally {
      this.resume();
    }
    this[kTabCompleter](lastKeypressWasTab, value);
  }
  [kTabCompleter](lastKeypressWasTab, { 0: completions, 1: completeOn }) {
    if (!completions || completions.length === 0) {
      return;
    }
    var prefix = commonPrefix(ArrayPrototypeFilter.call(completions, (e) => e !== ""));
    if (StringPrototypeStartsWith.call(prefix, completeOn) && prefix.length > completeOn.length) {
      this[kInsertString](StringPrototypeSlice.call(prefix, completeOn.length));
      return;
    } else if (!StringPrototypeStartsWith.call(completeOn, prefix)) {
      this.line = StringPrototypeSlice.call(this.line, 0, this.cursor - completeOn.length) + prefix + StringPrototypeSlice.call(this.line, this.cursor, this.line.length);
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this._refreshLine();
      return;
    }
    if (!lastKeypressWasTab) {
      return;
    }
    this[kBeforeEdit](this.line, this.cursor);
    var completionsWidth = ArrayPrototypeMap.call(completions, (e) => getStringWidth(e));
    var width = MathMaxApply(completionsWidth) + 2;
    var maxColumns = MathFloor(this.columns / width) || 1;
    if (maxColumns === Infinity) {
      maxColumns = 1;
    }
    var output = "\r\n";
    var lineIndex = 0;
    var whitespace = 0;
    for (var i = 0;i < completions.length; i++) {
      var completion = completions[i];
      if (completion === "" || lineIndex === maxColumns) {
        output += "\r\n";
        lineIndex = 0;
        whitespace = 0;
      } else {
        output += StringPrototypeRepeat.call(" ", whitespace);
      }
      if (completion !== "") {
        output += completion;
        whitespace = width - completionsWidth[i];
        lineIndex++;
      } else {
        output += "\r\n";
      }
    }
    if (lineIndex !== 0) {
      output += "\r\n\r\n";
    }
    this[kWriteToOutput](output);
    this[kRefreshLine]();
  }
  [kWordLeft]() {
    if (this.cursor > 0) {
      var leading = StringPrototypeSlice.call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.call(ArrayPrototypeReverse.call(ArrayFrom(leading)), "");
      var match = RegExpPrototypeExec.call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      this[kMoveCursor](-match[0].length);
    }
  }
  [kWordRight]() {
    if (this.cursor < this.line.length) {
      var trailing = StringPrototypeSlice.call(this.line, this.cursor);
      var match = RegExpPrototypeExec.call(/^(?:\s+|[^\w\s]+|\w+)\s*/, trailing);
      this[kMoveCursor](match[0].length);
    }
  }
  [kDeleteLeft]() {
    if (this.cursor > 0 && this.line.length > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      var charSize = charLengthLeft(this.line, this.cursor);
      this.line = StringPrototypeSlice.call(this.line, 0, this.cursor - charSize) + StringPrototypeSlice.call(this.line, this.cursor, this.line.length);
      this.cursor -= charSize;
      this[kRefreshLine]();
    }
  }
  [kDeleteRight]() {
    if (this.cursor < this.line.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var charSize = charLengthAt(this.line, this.cursor);
      this.line = StringPrototypeSlice.call(this.line, 0, this.cursor) + StringPrototypeSlice.call(this.line, this.cursor + charSize, this.line.length);
      this[kRefreshLine]();
    }
  }
  [kDeleteWordLeft]() {
    if (this.cursor > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      var leading = StringPrototypeSlice.call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.call(ArrayPrototypeReverse.call(ArrayFrom(leading)), "");
      var match = RegExpPrototypeExec.call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      leading = StringPrototypeSlice.call(leading, 0, leading.length - match[0].length);
      this.line = leading + StringPrototypeSlice.call(this.line, this.cursor, this.line.length);
      this.cursor = leading.length;
      this[kRefreshLine]();
    }
  }
  [kDeleteWordRight]() {
    if (this.cursor < this.line.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var trailing = StringPrototypeSlice.call(this.line, this.cursor);
      var match = RegExpPrototypeExec.call(/^(?:\s+|\W+|\w+)\s*/, trailing);
      this.line = StringPrototypeSlice.call(this.line, 0, this.cursor) + StringPrototypeSlice.call(trailing, match[0].length);
      this[kRefreshLine]();
    }
  }
  [kDeleteLineLeft]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice.call(this.line, 0, this.cursor);
    this.line = StringPrototypeSlice.call(this.line, this.cursor);
    this.cursor = 0;
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }
  [kDeleteLineRight]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice.call(this.line, this.cursor);
    this.line = StringPrototypeSlice.call(this.line, 0, this.cursor);
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }
  [kPushToKillRing](del) {
    if (!del || del === this[kKillRing][0])
      return;
    ArrayPrototypeUnshift.call(this[kKillRing], del);
    this[kKillRingCursor] = 0;
    while (this[kKillRing].length > kMaxLengthOfKillRing)
      ArrayPrototypePop.call(this[kKillRing]);
  }
  [kYank]() {
    if (this[kKillRing].length > 0) {
      this[kYanking] = true;
      this[kInsertString](this[kKillRing][this[kKillRingCursor]]);
    }
  }
  [kYankPop]() {
    if (!this[kYanking]) {
      return;
    }
    if (this[kKillRing].length > 1) {
      var lastYank = this[kKillRing][this[kKillRingCursor]];
      this[kKillRingCursor]++;
      if (this[kKillRingCursor] >= this[kKillRing].length) {
        this[kKillRingCursor] = 0;
      }
      var currentYank = this[kKillRing][this[kKillRingCursor]];
      var head = StringPrototypeSlice.call(this.line, 0, this.cursor - lastYank.length);
      var tail = StringPrototypeSlice.call(this.line, this.cursor);
      this.line = head + currentYank + tail;
      this.cursor = head.length + currentYank.length;
      this[kRefreshLine]();
    }
  }
  clearLine() {
    this[kMoveCursor](Infinity);
    this[kWriteToOutput]("\r\n");
    this.line = "";
    this.cursor = 0;
    this.prevRows = 0;
  }
  [kLine]() {
    var line = this[kAddHistory]();
    this[kUndoStack] = [];
    this[kRedoStack] = [];
    this.clearLine();
    this[kOnLine](line);
  }
  [kPushToUndoStack](text, cursor) {
    if (ArrayPrototypePush.call(this[kUndoStack], { text, cursor }) > kMaxUndoRedoStackSize) {
      ArrayPrototypeShift.call(this[kUndoStack]);
    }
  }
  [kUndo]() {
    if (this[kUndoStack].length <= 0)
      return;
    ArrayPrototypePush.call(this[kRedoStack], {
      text: this.line,
      cursor: this.cursor
    });
    var entry = ArrayPrototypePop.call(this[kUndoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;
    this[kRefreshLine]();
  }
  [kRedo]() {
    if (this[kRedoStack].length <= 0)
      return;
    ArrayPrototypePush.call(this[kUndoStack], {
      text: this.line,
      cursor: this.cursor
    });
    var entry = ArrayPrototypePop.call(this[kRedoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;
    this[kRefreshLine]();
  }
  [kHistoryNext]() {
    if (this.historyIndex >= 0) {
      this[kBeforeEdit](this.line, this.cursor);
      var search = this[kSubstringSearch] || "";
      var index = this.historyIndex - 1;
      while (index >= 0 && (!StringPrototypeStartsWith.call(this.history[index], search) || this.line === this.history[index])) {
        index--;
      }
      if (index === -1) {
        this.line = search;
      } else {
        this.line = this.history[index];
      }
      this.historyIndex = index;
      this.cursor = this.line.length;
      this[kRefreshLine]();
    }
  }
  [kHistoryPrev]() {
    if (this.historyIndex < this.history.length && this.history.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var search = this[kSubstringSearch] || "";
      var index = this.historyIndex + 1;
      while (index < this.history.length && (!StringPrototypeStartsWith.call(this.history[index], search) || this.line === this.history[index])) {
        index++;
      }
      if (index === this.history.length) {
        this.line = search;
      } else {
        this.line = this.history[index];
      }
      this.historyIndex = index;
      this.cursor = this.line.length;
      this[kRefreshLine]();
    }
  }
  [kGetDisplayPos](str) {
    var offset = 0;
    var col = this.columns;
    var rows = 0;
    str = stripVTControlCharacters(str);
    for (var char of new SafeStringIterator(str)) {
      if (char === "\n") {
        rows += MathCeil(offset / col) || 1;
        offset = 0;
        continue;
      }
      if (char === "\t") {
        offset += this.tabSize - offset % this.tabSize;
        continue;
      }
      var width = getStringWidth(char, false);
      if (width === 0 || width === 1) {
        offset += width;
      } else {
        if ((offset + 1) % col === 0) {
          offset++;
        }
        offset += 2;
      }
    }
    var cols = offset % col;
    rows += (offset - cols) / col;
    return { cols, rows };
  }
  getCursorPos() {
    var strBeforeCursor = this[kPrompt] + StringPrototypeSlice.call(this.line, 0, this.cursor);
    return this[kGetDisplayPos](strBeforeCursor);
  }
  [kMoveCursor](dx) {
    if (dx === 0) {
      return;
    }
    var oldPos = this.getCursorPos();
    this.cursor += dx;
    if (this.cursor < 0) {
      this.cursor = 0;
    } else if (this.cursor > this.line.length) {
      this.cursor = this.line.length;
    }
    var newPos = this.getCursorPos();
    if (oldPos.rows === newPos.rows) {
      var diffWidth = newPos.cols - oldPos.cols;
      moveCursor(this.output, diffWidth, 0);
    } else {
      this[kRefreshLine]();
    }
  }
  [kTtyWrite](s, key) {
    var previousKey = this[kPreviousKey];
    key = key || kEmptyObject;
    this[kPreviousKey] = key;
    var { name: keyName, meta: keyMeta, ctrl: keyCtrl2, shift: keyShift, sequence: keySeq } = key;
    if (!keyMeta || keyName !== "y") {
      this[kYanking] = false;
    }
    if ((keyName === "up" || keyName === "down") && !keyCtrl2 && !keyMeta && !keyShift) {
      if (this[kSubstringSearch] === null) {
        this[kSubstringSearch] = StringPrototypeSlice.call(this.line, 0, this.cursor);
      }
    } else if (this[kSubstringSearch] !== null) {
      this[kSubstringSearch] = null;
      if (this.history.length === this.historyIndex) {
        this.historyIndex = -1;
      }
    }
    if (typeof keySeq === "string") {
      switch (StringPrototypeCodePointAt.call(keySeq, 0)) {
        case 31:
          this[kUndo]();
          return;
        case 30:
          this[kRedo]();
          return;
        default:
          break;
      }
    }
    if (keyName === "escape")
      return;
    if (keyCtrl2 && keyShift) {
      switch (keyName) {
        case "backspace":
          this[kDeleteLineLeft]();
          break;
        case "delete":
          this[kDeleteLineRight]();
          break;
      }
    } else if (keyCtrl2) {
      switch (keyName) {
        case "c":
          if (this.listenerCount("SIGINT") > 0) {
            this.emit("SIGINT");
          } else {
            this.close();
          }
          break;
        case "h":
          this[kDeleteLeft]();
          break;
        case "d":
          if (this.cursor === 0 && this.line.length === 0) {
            this.close();
          } else if (this.cursor < this.line.length) {
            this[kDeleteRight]();
          }
          break;
        case "u":
          this[kDeleteLineLeft]();
          break;
        case "k":
          this[kDeleteLineRight]();
          break;
        case "a":
          this[kMoveCursor]((-Infinity));
          break;
        case "e":
          this[kMoveCursor](Infinity);
          break;
        case "b":
          this[kMoveCursor](-charLengthLeft(this.line, this.cursor));
          break;
        case "f":
          this[kMoveCursor](+charLengthAt(this.line, this.cursor));
          break;
        case "l":
          cursorTo(this.output, 0, 0);
          clearScreenDown(this.output);
          this[kRefreshLine]();
          break;
        case "n":
          this[kHistoryNext]();
          break;
        case "p":
          this[kHistoryPrev]();
          break;
        case "y":
          this[kYank]();
          break;
        case "z":
          if (false)
            ;
          if (this.listenerCount("SIGTSTP") > 0) {
            this.emit("SIGTSTP");
          } else {
            process.once("SIGCONT", () => {
              if (!this.paused) {
                this.pause();
                this.emit("SIGCONT");
              }
              this[kSetRawMode](true);
              this[kRefreshLine]();
            });
            this[kSetRawMode](false);
            process.kill(process.pid, "SIGTSTP");
          }
          break;
        case "w":
        case "backspace":
          this[kDeleteWordLeft]();
          break;
        case "delete":
          this[kDeleteWordRight]();
          break;
        case "left":
          this[kWordLeft]();
          break;
        case "right":
          this[kWordRight]();
          break;
      }
    } else if (keyMeta) {
      switch (keyName) {
        case "b":
          this[kWordLeft]();
          break;
        case "f":
          this[kWordRight]();
          break;
        case "d":
        case "delete":
          this[kDeleteWordRight]();
          break;
        case "backspace":
          this[kDeleteWordLeft]();
          break;
        case "y":
          this[kYankPop]();
          break;
      }
    } else {
      if (this[kSawReturnAt] && keyName !== "enter")
        this[kSawReturnAt] = 0;
      switch (keyName) {
        case "return":
          this[kSawReturnAt] = DateNow();
          this[kLine]();
          break;
        case "enter":
          if (this[kSawReturnAt] === 0 || DateNow() - this[kSawReturnAt] > this.crlfDelay) {
            this[kLine]();
          }
          this[kSawReturnAt] = 0;
          break;
        case "backspace":
          this[kDeleteLeft]();
          break;
        case "delete":
          this[kDeleteRight]();
          break;
        case "left":
          this[kMoveCursor](-charLengthLeft(this.line, this.cursor));
          break;
        case "right":
          this[kMoveCursor](+charLengthAt(this.line, this.cursor));
          break;
        case "home":
          this[kMoveCursor]((-Infinity));
          break;
        case "end":
          this[kMoveCursor](Infinity);
          break;
        case "up":
          this[kHistoryPrev]();
          break;
        case "down":
          this[kHistoryNext]();
          break;
        case "tab":
          if (typeof this.completer === "function" && this.isCompletionEnabled) {
            var lastKeypressWasTab = previousKey && previousKey.name === "tab";
            this[kTabComplete](lastKeypressWasTab);
            break;
          }
        default:
          if (typeof s === "string" && s) {
            var nextMatch = RegExpPrototypeExec.call(lineEnding, s);
            if (nextMatch !== null) {
              this[kInsertString](StringPrototypeSlice.call(s, 0, nextMatch.index));
              var { lastIndex } = lineEnding;
              while ((nextMatch = RegExpPrototypeExec.call(lineEnding, s)) !== null) {
                this[kLine]();
                this[kInsertString](StringPrototypeSlice.call(s, lastIndex, nextMatch.index));
                ({ lastIndex } = lineEnding);
              }
              if (lastIndex === s.length)
                this[kLine]();
            } else {
              this[kInsertString](s);
            }
          }
      }
    }
  }
  [SymbolAsyncIterator]() {
    if (this[kLineObjectStream] === undefined) {
      this[kLineObjectStream] = EventEmitter.on(this, "line", {
        close: ["close"],
        highWatermark: 1024,
        [kFirstEventParam]: true
      });
    }
    return this[kLineObjectStream];
  }
};
ObjectSetPrototypeOf(Interface.prototype, _Interface.prototype);
ObjectSetPrototypeOf(Interface, _Interface);
Interface.prototype.question = function question(query, options, cb) {
  cb = typeof options === "function" ? options : cb;
  if (options === null || typeof options !== "object") {
    options = kEmptyObject;
  }
  var signal = options?.signal;
  if (signal) {
    validateAbortSignal(signal, "options.signal");
    if (signal.aborted) {
      return;
    }
    var onAbort = () => {
      this[kQuestionCancel]();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    var cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    var originalCb = cb;
    cb = typeof cb === "function" ? (answer) => {
      cleanup();
      return originalCb(answer);
    } : cleanup;
  }
  if (typeof cb === "function") {
    this[kQuestion](query, cb);
  }
};
Interface.prototype.question[promisify.custom] = function question2(query, options) {
  if (options === null || typeof options !== "object") {
    options = kEmptyObject;
  }
  var signal = options?.signal;
  if (signal && signal.aborted) {
    return PromiseReject(new AbortError(undefined, { cause: signal.reason }));
  }
  return new Promise((resolve, reject) => {
    var cb = resolve;
    if (signal) {
      var onAbort = () => {
        reject(new AbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cb = (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      };
    }
    this.question(query, options, cb);
  });
};
ObjectDefineProperties(Interface.prototype, {
  [kSetRawMode]: {
    __proto__: null,
    get() {
      return this._setRawMode;
    }
  },
  [kOnLine]: {
    __proto__: null,
    get() {
      return this._onLine;
    }
  },
  [kWriteToOutput]: {
    __proto__: null,
    get() {
      return this._writeToOutput;
    }
  },
  [kAddHistory]: {
    __proto__: null,
    get() {
      return this._addHistory;
    }
  },
  [kRefreshLine]: {
    __proto__: null,
    get() {
      return this._refreshLine;
    }
  },
  [kNormalWrite]: {
    __proto__: null,
    get() {
      return this._normalWrite;
    }
  },
  [kInsertString]: {
    __proto__: null,
    get() {
      return this._insertString;
    }
  },
  [kTabComplete]: {
    __proto__: null,
    get() {
      return this._tabComplete;
    }
  },
  [kWordLeft]: {
    __proto__: null,
    get() {
      return this._wordLeft;
    }
  },
  [kWordRight]: {
    __proto__: null,
    get() {
      return this._wordRight;
    }
  },
  [kDeleteLeft]: {
    __proto__: null,
    get() {
      return this._deleteLeft;
    }
  },
  [kDeleteRight]: {
    __proto__: null,
    get() {
      return this._deleteRight;
    }
  },
  [kDeleteWordLeft]: {
    __proto__: null,
    get() {
      return this._deleteWordLeft;
    }
  },
  [kDeleteWordRight]: {
    __proto__: null,
    get() {
      return this._deleteWordRight;
    }
  },
  [kDeleteLineLeft]: {
    __proto__: null,
    get() {
      return this._deleteLineLeft;
    }
  },
  [kDeleteLineRight]: {
    __proto__: null,
    get() {
      return this._deleteLineRight;
    }
  },
  [kLine]: {
    __proto__: null,
    get() {
      return this._line;
    }
  },
  [kHistoryNext]: {
    __proto__: null,
    get() {
      return this._historyNext;
    }
  },
  [kHistoryPrev]: {
    __proto__: null,
    get() {
      return this._historyPrev;
    }
  },
  [kGetDisplayPos]: {
    __proto__: null,
    get() {
      return this._getDisplayPos;
    }
  },
  [kMoveCursor]: {
    __proto__: null,
    get() {
      return this._moveCursor;
    }
  },
  [kTtyWrite]: {
    __proto__: null,
    get() {
      return this._ttyWrite;
    }
  },
  _decoder: {
    __proto__: null,
    get() {
      return this[kDecoder];
    },
    set(value) {
      this[kDecoder] = value;
    }
  },
  _line_buffer: {
    __proto__: null,
    get() {
      return this[kLine_buffer];
    },
    set(value) {
      this[kLine_buffer] = value;
    }
  },
  _oldPrompt: {
    __proto__: null,
    get() {
      return this[kOldPrompt];
    },
    set(value) {
      this[kOldPrompt] = value;
    }
  },
  _previousKey: {
    __proto__: null,
    get() {
      return this[kPreviousKey];
    },
    set(value) {
      this[kPreviousKey] = value;
    }
  },
  _prompt: {
    __proto__: null,
    get() {
      return this[kPrompt];
    },
    set(value) {
      this[kPrompt] = value;
    }
  },
  _questionCallback: {
    __proto__: null,
    get() {
      return this[kQuestionCallback];
    },
    set(value) {
      this[kQuestionCallback] = value;
    }
  },
  _sawKeyPress: {
    __proto__: null,
    get() {
      return this[kSawKeyPress];
    },
    set(value) {
      this[kSawKeyPress] = value;
    }
  },
  _sawReturnAt: {
    __proto__: null,
    get() {
      return this[kSawReturnAt];
    },
    set(value) {
      this[kSawReturnAt] = value;
    }
  }
});
Interface.prototype._setRawMode = _Interface.prototype[kSetRawMode];
Interface.prototype._onLine = _Interface.prototype[kOnLine];
Interface.prototype._writeToOutput = _Interface.prototype[kWriteToOutput];
Interface.prototype._addHistory = _Interface.prototype[kAddHistory];
Interface.prototype._refreshLine = _Interface.prototype[kRefreshLine];
Interface.prototype._normalWrite = _Interface.prototype[kNormalWrite];
Interface.prototype._insertString = _Interface.prototype[kInsertString];
Interface.prototype._tabComplete = function(lastKeypressWasTab) {
  this.pause();
  var string = StringPrototypeSlice.call(this.line, 0, this.cursor);
  this.completer(string, (err, value) => {
    this.resume();
    if (err) {
      this._writeToOutput(`Tab completion error: ${inspect(err)}`);
      return;
    }
    this[kTabCompleter](lastKeypressWasTab, value);
  });
};
Interface.prototype._wordLeft = _Interface.prototype[kWordLeft];
Interface.prototype._wordRight = _Interface.prototype[kWordRight];
Interface.prototype._deleteLeft = _Interface.prototype[kDeleteLeft];
Interface.prototype._deleteRight = _Interface.prototype[kDeleteRight];
Interface.prototype._deleteWordLeft = _Interface.prototype[kDeleteWordLeft];
Interface.prototype._deleteWordRight = _Interface.prototype[kDeleteWordRight];
Interface.prototype._deleteLineLeft = _Interface.prototype[kDeleteLineLeft];
Interface.prototype._deleteLineRight = _Interface.prototype[kDeleteLineRight];
Interface.prototype._line = _Interface.prototype[kLine];
Interface.prototype._historyNext = _Interface.prototype[kHistoryNext];
Interface.prototype._historyPrev = _Interface.prototype[kHistoryPrev];
Interface.prototype._getDisplayPos = _Interface.prototype[kGetDisplayPos];
Interface.prototype._getCursorPos = _Interface.prototype.getCursorPos;
Interface.prototype._moveCursor = _Interface.prototype[kMoveCursor];
Interface.prototype._ttyWrite = _Interface.prototype[kTtyWrite];

class Readline {
  #autoCommit = false;
  #stream;
  #todo = [];
  constructor(stream, options = undefined) {
    isWritable ??= import.meta.require("node:stream").isWritable;
    if (!isWritable(stream))
      throw new ERR_INVALID_ARG_TYPE("stream", "Writable", stream);
    this.#stream = stream;
    if (options?.autoCommit != null) {
      validateBoolean(options.autoCommit, "options.autoCommit");
      this.#autoCommit = options.autoCommit;
    }
  }
  cursorTo(x, y = undefined) {
    validateInteger(x, "x");
    if (y != null)
      validateInteger(y, "y");
    var data = y == null ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
    if (this.#autoCommit)
      process.nextTick(() => this.#stream.write(data));
    else
      ArrayPrototypePush.call(this.#todo, data);
    return this;
  }
  moveCursor(dx, dy) {
    if (dx || dy) {
      validateInteger(dx, "dx");
      validateInteger(dy, "dy");
      var data = "";
      if (dx < 0) {
        data += CSI`${-dx}D`;
      } else if (dx > 0) {
        data += CSI`${dx}C`;
      }
      if (dy < 0) {
        data += CSI`${-dy}A`;
      } else if (dy > 0) {
        data += CSI`${dy}B`;
      }
      if (this.#autoCommit)
        process.nextTick(() => this.#stream.write(data));
      else
        ArrayPrototypePush.call(this.#todo, data);
    }
    return this;
  }
  clearLine(dir) {
    validateInteger(dir, "dir", -1, 1);
    var data = dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
    if (this.#autoCommit)
      process.nextTick(() => this.#stream.write(data));
    else
      ArrayPrototypePush.call(this.#todo, data);
    return this;
  }
  clearScreenDown() {
    if (this.#autoCommit) {
      process.nextTick(() => this.#stream.write(kClearScreenDown));
    } else {
      ArrayPrototypePush.call(this.#todo, kClearScreenDown);
    }
    return this;
  }
  commit() {
    return new Promise((resolve) => {
      this.#stream.write(ArrayPrototypeJoin.call(this.#todo, ""), resolve);
      this.#todo = [];
    });
  }
  rollback() {
    this.#todo = [];
    return this;
  }
}
var PromisesInterface = class Interface3 extends _Interface {
  constructor(input, output, completer, terminal) {
    super(input, output, completer, terminal);
  }
  question(query, options = kEmptyObject) {
    var signal = options?.signal;
    if (signal) {
      validateAbortSignal(signal, "options.signal");
      if (signal.aborted) {
        return PromiseReject(new AbortError(undefined, { cause: signal.reason }));
      }
    }
    return new Promise((resolve, reject) => {
      var cb = resolve;
      if (options?.signal) {
        var onAbort = () => {
          this[kQuestionCancel]();
          reject(new AbortError(undefined, { cause: signal.reason }));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        cb = (answer) => {
          signal.removeEventListener("abort", onAbort);
          resolve(answer);
        };
      }
      this[kQuestion](query, cb);
    });
  }
};
var Interface = Interface;
var clearLine = clearLine;
var clearScreenDown = clearScreenDown;
var createInterface = createInterface;
var cursorTo = cursorTo;
var emitKeypressEvents = emitKeypressEvents;
var moveCursor = moveCursor;
var promises = {
  Readline,
  Interface: PromisesInterface,
  createInterface(input, output, completer, terminal) {
    return new PromisesInterface(input, output, completer, terminal);
  }
};
var readline_default = {
  Interface,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,
  [SymbolFor("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")]: {
    CSI,
    utils: {
      getStringWidth,
      stripVTControlCharacters
    }
  },
  [SymbolFor("CommonJS")]: 0
};
export {
  promises,
  moveCursor,
  emitKeypressEvents,
  readline_default as default,
  cursorTo,
  createInterface,
  clearScreenDown,
  clearLine,
  Interface
};

//# debugId=B80CCA7A0FEDC3D764756e2164756e21
