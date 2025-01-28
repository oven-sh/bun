// Hardcoded module "node:readline"
// Attribution: Some parts of of this module are derived from code originating from the Node.js
// readline module which is licensed under an MIT license:
//
// Copyright Node.js contributors. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

// ----------------------------------------------------------------------------
// Section: Imports
// ----------------------------------------------------------------------------
const EventEmitter = require("node:events");
const { StringDecoder } = require("node:string_decoder");
const { promisify } = require("internal/promisify");

const {
  validateFunction,
  validateAbortSignal,
  validateArray,
  validateString,
  validateBoolean,
  validateInteger,
  validateUint32,
  validateNumber,
} = require("internal/validators");

const internalGetStringWidth = $newZigFunction("string.zig", "String.jsGetStringWidth", 1);

const PromiseReject = Promise.reject;

var isWritable;

var { inspect } = Bun;
var debug = process.env.BUN_JS_DEBUG ? console.log : () => {};

// ----------------------------------------------------------------------------
// Section: Preamble
// ----------------------------------------------------------------------------

const SymbolAsyncIterator = Symbol.asyncIterator;
const SymbolIterator = Symbol.iterator;
const SymbolFor = Symbol.for;
const SymbolReplace = Symbol.replace;
const ArrayFrom = Array.from;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeSort = Array.prototype.sort;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeMap = Array.prototype.map;
const ArrayPrototypePop = Array.prototype.pop;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypeReverse = Array.prototype.reverse;
const ArrayPrototypeShift = Array.prototype.shift;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const RegExpPrototypeExec = RegExp.prototype.exec;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeCodePointAt = String.prototype.codePointAt;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeRepeat = String.prototype.repeat;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeTrim = String.prototype.trim;
const StringPrototypeNormalize = String.prototype.normalize;
const NumberIsNaN = Number.isNaN;
const NumberIsFinite = Number.isFinite;
const NumberIsInteger = Number.isInteger;
const NumberMAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NumberMIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
const MathCeil = Math.ceil;
const MathFloor = Math.floor;
const MathMax = Math.max;
const DateNow = Date.now;
const FunctionPrototype = Function.prototype;
const StringPrototype = String.prototype;
const StringPrototypeSymbolIterator = StringPrototype[SymbolIterator];
const StringIteratorPrototypeNext = StringPrototypeSymbolIterator.$call("").next;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectFreeze = Object.freeze;
const ObjectAssign = Object.assign;
const ObjectCreate = Object.create;
const ObjectKeys = Object.keys;
const ObjectSeal = Object.seal;

var createSafeIterator = (factory, next) => {
  class SafeIterator {
    #iterator;
    constructor(iterable) {
      this.#iterator = factory.$call(iterable);
    }
    next() {
      return next.$call(this.#iterator);
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

// ----------------------------------------------------------------------------
// Section: "Internal" modules
// ----------------------------------------------------------------------------

/**
 * Returns the number of columns required to display the given string.
 */
var getStringWidth = function getStringWidth(str, removeControlChars = true) {
  if (removeControlChars) str = stripVTControlCharacters(str);
  str = StringPrototypeNormalize.$call(str, "NFC");
  return internalGetStringWidth(str);
};

// Regex used for ansi escape code splitting
// Adopted from https://github.com/chalk/ansi-regex/blob/HEAD/index.js
// License: MIT, authors: @sindresorhus, Qix-, arjunmehta and LitoMore
// Matches all ansi escape code sequences in a string
var ansiPattern =
  "[\\u001B\\u009B][[\\]()#;?]*" +
  "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*" +
  "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)" +
  "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
var ansi = new RegExp(ansiPattern, "g");

/**
 * Remove all VT control characters. Use to estimate displayed string width.
 */
function stripVTControlCharacters(str) {
  validateString(str, "str");
  return RegExpPrototypeSymbolReplace.$call(ansi, str, "");
}

// Constants

const kUTF16SurrogateThreshold = 0x10000; // 2 ** 16
const kEscape = "\x1b";
const kSubstringSearch = Symbol("kSubstringSearch");
const kIsNodeError = Symbol("kIsNodeError");

// Errors
var errorBases = {};
var VALID_NODE_ERROR_BASES = {
  TypeError,
  RangeError,
  Error,
};

function getNodeErrorByName(typeName) {
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
}

var NodeError = getNodeErrorByName("Error");
var NodeTypeError = getNodeErrorByName("TypeError");
var NodeRangeError = getNodeErrorByName("RangeError");

class ERR_USE_AFTER_CLOSE extends NodeError {
  constructor() {
    super("This socket has been ended by the other party", {
      code: "ERR_USE_AFTER_CLOSE",
    });
  }
}

// ----------------------------------------------------------------------------
// Section: Utils
// ----------------------------------------------------------------------------

function CSI(strings, ...args) {
  var ret = `${kEscape}[`;
  for (var n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return ret;
}

var kClearLine, kClearScreenDown, kClearToLineBeginning, kClearToLineEnd;

CSI.kEscape = kEscape;
CSI.kClearLine = kClearLine = CSI`2K`;
CSI.kClearScreenDown = kClearScreenDown = CSI`0J`;
CSI.kClearToLineBeginning = kClearToLineBeginning = CSI`1K`;
CSI.kClearToLineEnd = kClearToLineEnd = CSI`0K`;

function charLengthLeft(str: string, i: number) {
  if (i <= 0) return 0;
  if (
    (i > 1 && StringPrototypeCodePointAt.$call(str, i - 2) >= kUTF16SurrogateThreshold) ||
    StringPrototypeCodePointAt.$call(str, i - 1) >= kUTF16SurrogateThreshold
  ) {
    return 2;
  }
  return 1;
}

function charLengthAt(str, i) {
  if (str.length <= i) {
    // Pretend to move to the right. This is necessary to autocomplete while
    // moving to the right.
    return 1;
  }
  return StringPrototypeCodePointAt.$call(str, i) >= kUTF16SurrogateThreshold ? 2 : 1;
}

/*
  Some patterns seen in terminal key escape codes, derived from combos seen
  at http://www.midnight-commander.org/browser/lib/tty/key.c

  ESC letter
  ESC [ letter
  ESC [ modifier letter
  ESC [ 1 ; modifier letter
  ESC [ num char
  ESC [ num ; modifier char
  ESC O letter
  ESC O modifier letter
  ESC O 1 ; modifier letter
  ESC N letter
  ESC [ [ num ; modifier char
  ESC [ [ 1 ; modifier letter
  ESC ESC [ num char
  ESC ESC O letter

  - char is usually ~ but $ and ^ also happen with rxvt
  - modifier is 1 +
                (shift     * 1) +
                (left_alt  * 2) +
                (ctrl      * 4) +
                (right_alt * 8)
  - two leading ESCs apparently mean the same as one leading ESC
*/
function* emitKeys(stream) {
  while (true) {
    let ch = yield;
    let s = ch;
    let escaped = false;
    const key: {
      sequence: string | null;
      name?: string;
      code?: string;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
    } = {
      sequence: null,
      name: undefined,
      ctrl: false,
      meta: false,
      shift: false,
    };

    if (ch === kEscape) {
      escaped = true;
      s += ch = yield;

      if (ch === kEscape) {
        s += ch = yield;
      }
    }

    if (escaped && (ch === "O" || ch === "[")) {
      // ANSI escape sequence
      let code = ch;
      let modifier = 0;

      if (ch === "O") {
        // ESC O letter
        // ESC O modifier letter
        s += ch = yield;

        if (ch >= "0" && ch <= "9") {
          modifier = (ch >> 0) - 1;
          s += ch = yield;
        }

        code += ch;
      } else if (ch === "[") {
        // ESC [ letter
        // ESC [ modifier letter
        // ESC [ [ modifier letter
        // ESC [ [ num char
        s += ch = yield;

        if (ch === "[") {
          // \x1b[[A
          //      ^--- escape codes might have a second bracket
          code += ch;
          s += ch = yield;
        }

        /*
         * Here and later we try to buffer just enough data to get
         * a complete ascii sequence.
         *
         * We have basically two classes of ascii characters to process:
         *
         *
         * 1. `\x1b[24;5~` should be parsed as { code: '[24~', modifier: 5 }
         *
         * This particular example is featuring Ctrl+F12 in xterm.
         *
         *  - `;5` part is optional, e.g. it could be `\x1b[24~`
         *  - first part can contain one or two digits
         *  - there is also special case when there can be 3 digits
         *    but without modifier. They are the case of paste bracket mode
         *
         * So the generic regexp is like /^(?:\d\d?(;\d)?[~^$]|\d{3}~)$/
         *
         *
         * 2. `\x1b[1;5H` should be parsed as { code: '[H', modifier: 5 }
         *
         * This particular example is featuring Ctrl+Home in xterm.
         *
         *  - `1;5` part is optional, e.g. it could be `\x1b[H`
         *  - `1;` part is optional, e.g. it could be `\x1b[5H`
         *
         * So the generic regexp is like /^((\d;)?\d)?[A-Za-z]$/
         *
         */
        const cmdStart = s.length - 1;

        // Skip one or two leading digits
        if (ch >= "0" && ch <= "9") {
          s += ch = yield;

          if (ch >= "0" && ch <= "9") {
            s += ch = yield;

            if (ch >= "0" && ch <= "9") {
              s += ch = yield;
            }
          }
        }

        // skip modifier
        if (ch === ";") {
          s += ch = yield;

          if (ch >= "0" && ch <= "9") {
            s += yield;
          }
        }

        /*
         * We buffered enough data, now trying to extract code
         * and modifier from it
         */
        const cmd = StringPrototypeSlice.$call(s, cmdStart);
        let match;

        if ((match = RegExpPrototypeExec.$call(/^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/, cmd))) {
          if (match[4]) {
            code += match[4];
          } else {
            code += match[1] + match[3];
            modifier = (match[2] || 1) - 1;
          }
        } else if ((match = RegExpPrototypeExec.$call(/^((\d;)?(\d))?([A-Za-z])$/, cmd))) {
          code += match[4];
          modifier = (match[3] || 1) - 1;
        } else {
          code += cmd;
        }
      }

      // Parse the key modifier
      key.ctrl = !!(modifier & 4);
      key.meta = !!(modifier & 10);
      key.shift = !!(modifier & 1);
      key.code = code;

      // Parse the key itself
      switch (code) {
        /* xterm/gnome ESC [ letter (with modifier) */
        case "[P":
          key.name = "f1";
          break;
        case "[Q":
          key.name = "f2";
          break;
        case "[R":
          key.name = "f3";
          break;
        case "[S":
          key.name = "f4";
          break;

        /* xterm/gnome ESC O letter (without modifier) */
        case "OP":
          key.name = "f1";
          break;
        case "OQ":
          key.name = "f2";
          break;
        case "OR":
          key.name = "f3";
          break;
        case "OS":
          key.name = "f4";
          break;

        /* xterm/rxvt ESC [ number ~ */
        case "[11~":
          key.name = "f1";
          break;
        case "[12~":
          key.name = "f2";
          break;
        case "[13~":
          key.name = "f3";
          break;
        case "[14~":
          key.name = "f4";
          break;

        /* paste bracket mode */
        case "[200~":
          key.name = "paste-start";
          break;
        case "[201~":
          key.name = "paste-end";
          break;

        /* from Cygwin and used in libuv */
        case "[[A":
          key.name = "f1";
          break;
        case "[[B":
          key.name = "f2";
          break;
        case "[[C":
          key.name = "f3";
          break;
        case "[[D":
          key.name = "f4";
          break;
        case "[[E":
          key.name = "f5";
          break;

        /* common */
        case "[15~":
          key.name = "f5";
          break;
        case "[17~":
          key.name = "f6";
          break;
        case "[18~":
          key.name = "f7";
          break;
        case "[19~":
          key.name = "f8";
          break;
        case "[20~":
          key.name = "f9";
          break;
        case "[21~":
          key.name = "f10";
          break;
        case "[23~":
          key.name = "f11";
          break;
        case "[24~":
          key.name = "f12";
          break;

        /* xterm ESC [ letter */
        case "[A":
          key.name = "up";
          break;
        case "[B":
          key.name = "down";
          break;
        case "[C":
          key.name = "right";
          break;
        case "[D":
          key.name = "left";
          break;
        case "[E":
          key.name = "clear";
          break;
        case "[F":
          key.name = "end";
          break;
        case "[H":
          key.name = "home";
          break;

        /* xterm/gnome ESC O letter */
        case "OA":
          key.name = "up";
          break;
        case "OB":
          key.name = "down";
          break;
        case "OC":
          key.name = "right";
          break;
        case "OD":
          key.name = "left";
          break;
        case "OE":
          key.name = "clear";
          break;
        case "OF":
          key.name = "end";
          break;
        case "OH":
          key.name = "home";
          break;

        /* xterm/rxvt ESC [ number ~ */
        case "[1~":
          key.name = "home";
          break;
        case "[2~":
          key.name = "insert";
          break;
        case "[3~":
          key.name = "delete";
          break;
        case "[4~":
          key.name = "end";
          break;
        case "[5~":
          key.name = "pageup";
          break;
        case "[6~":
          key.name = "pagedown";
          break;

        /* putty */
        case "[[5~":
          key.name = "pageup";
          break;
        case "[[6~":
          key.name = "pagedown";
          break;

        /* rxvt */
        case "[7~":
          key.name = "home";
          break;
        case "[8~":
          key.name = "end";
          break;

        /* rxvt keys with modifiers */
        case "[a":
          key.name = "up";
          key.shift = true;
          break;
        case "[b":
          key.name = "down";
          key.shift = true;
          break;
        case "[c":
          key.name = "right";
          key.shift = true;
          break;
        case "[d":
          key.name = "left";
          key.shift = true;
          break;
        case "[e":
          key.name = "clear";
          key.shift = true;
          break;

        case "[2$":
          key.name = "insert";
          key.shift = true;
          break;
        case "[3$":
          key.name = "delete";
          key.shift = true;
          break;
        case "[5$":
          key.name = "pageup";
          key.shift = true;
          break;
        case "[6$":
          key.name = "pagedown";
          key.shift = true;
          break;
        case "[7$":
          key.name = "home";
          key.shift = true;
          break;
        case "[8$":
          key.name = "end";
          key.shift = true;
          break;

        case "Oa":
          key.name = "up";
          key.ctrl = true;
          break;
        case "Ob":
          key.name = "down";
          key.ctrl = true;
          break;
        case "Oc":
          key.name = "right";
          key.ctrl = true;
          break;
        case "Od":
          key.name = "left";
          key.ctrl = true;
          break;
        case "Oe":
          key.name = "clear";
          key.ctrl = true;
          break;

        case "[2^":
          key.name = "insert";
          key.ctrl = true;
          break;
        case "[3^":
          key.name = "delete";
          key.ctrl = true;
          break;
        case "[5^":
          key.name = "pageup";
          key.ctrl = true;
          break;
        case "[6^":
          key.name = "pagedown";
          key.ctrl = true;
          break;
        case "[7^":
          key.name = "home";
          key.ctrl = true;
          break;
        case "[8^":
          key.name = "end";
          key.ctrl = true;
          break;

        /* misc. */
        case "[Z":
          key.name = "tab";
          key.shift = true;
          break;
        default:
          key.name = "undefined";
          break;
      }
    } else if (ch === "\r") {
      // carriage return
      key.name = "return";
      key.meta = escaped;
    } else if (ch === "\n") {
      // Enter, should have been called linefeed
      key.name = "enter";
      key.meta = escaped;
    } else if (ch === "\t") {
      // tab
      key.name = "tab";
      key.meta = escaped;
    } else if (ch === "\b" || ch === "\x7f") {
      // backspace or ctrl+h
      key.name = "backspace";
      key.meta = escaped;
    } else if (ch === kEscape) {
      // escape key
      key.name = "escape";
      key.meta = escaped;
    } else if (ch === " ") {
      key.name = "space";
      key.meta = escaped;
    } else if (!escaped && ch <= "\x1a") {
      // ctrl+letter
      key.name = StringFromCharCode(StringPrototypeCharCodeAt.$call(ch) + StringPrototypeCharCodeAt.$call("a") - 1);
      key.ctrl = true;
    } else if (RegExpPrototypeExec.$call(/^[0-9A-Za-z]$/, ch) !== null) {
      // Letter, number, shift+letter
      key.name = StringPrototypeToLowerCase.$call(ch);
      key.shift = RegExpPrototypeExec.$call(/^[A-Z]$/, ch) !== null;
      key.meta = escaped;
    } else if (escaped) {
      // Escape sequence timeout
      key.name = ch.length ? undefined : "escape";
      key.meta = true;
    }

    key.sequence = s;

    if (s.length !== 0 && (key.name !== undefined || escaped)) {
      /* Named character or sequence */
      stream.emit("keypress", escaped ? undefined : s, key);
    } else if (charLengthAt(s, 0) === s.length) {
      /* Single unnamed character, e.g. "." */
      stream.emit("keypress", s, key);
    }
    /* Unrecognized or broken escape sequence, don't emit anything */
  }
}

// This runs in O(n log n).
function commonPrefix(strings) {
  if (strings.length === 0) {
    return "";
  }
  if (strings.length === 1) {
    return strings[0];
  }
  var sorted = ArrayPrototypeSort.$call(ArrayPrototypeSlice.$call(strings));
  var min = sorted[0];
  var max = sorted[sorted.length - 1];
  for (var i = 0; i < min.length; i++) {
    if (min[i] !== max[i]) {
      return StringPrototypeSlice.$call(min, 0, i);
    }
  }
  return min;
}

// ----------------------------------------------------------------------------
// Section: Cursor Functions
// ----------------------------------------------------------------------------

/**
 * moves the cursor to the x and y coordinate on the given stream
 */

function cursorTo(stream, x, y, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (typeof y === "function") {
    callback = y;
    y = undefined;
  }

  if (NumberIsNaN(x)) throw $ERR_INVALID_ARG_VALUE("x", x);
  if (NumberIsNaN(y)) throw $ERR_INVALID_ARG_VALUE("y", y);

  if (stream == null || (typeof x !== "number" && typeof y !== "number")) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  if (typeof x !== "number") throw $ERR_INVALID_CURSOR_POS();

  var data = typeof y !== "number" ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
  return stream.write(data, callback);
}

/**
 * moves the cursor relative to its current location
 */

function moveCursor(stream, dx, dy, callback?) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream == null || !(dx || dy)) {
    if (typeof callback === "function") process.nextTick(callback, null);
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
}

/**
 * clears the current line the cursor is on:
 *   -1 for left of the cursor
 *   +1 for right of the cursor
 *    0 for the entire line
 */

function clearLine(stream, dir, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  var type = dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
  return stream.write(type, callback);
}

/**
 * clears the screen from the current position of the cursor down
 */

function clearScreenDown(stream, callback) {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  return stream.write(kClearScreenDown, callback);
}

// ----------------------------------------------------------------------------
// Section: Emit keypress events
// ----------------------------------------------------------------------------

var KEYPRESS_DECODER = Symbol("keypress-decoder");
var ESCAPE_DECODER = Symbol("escape-decoder");

// GNU readline library - keyseq-timeout is 500ms (default)
var ESCAPE_CODE_TIMEOUT = 500;

/**
 * accepts a readable Stream instance and makes it emit "keypress" events
 */

function emitKeypressEvents(stream, iface = {}) {
  if (stream[KEYPRESS_DECODER]) return;

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

        // This supports characters of length 2.
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
            // Escape letter at the tail position
            if (length === string.length && character === kEscape) {
              timeoutId = setTimeout(triggerEscape, escapeCodeTimeout);
            }
          } catch (err) {
            // If the generator throws (it could happen in the `keypress`
            // event), we need to restart it.
            stream[ESCAPE_DECODER] = emitKeys(stream);
            stream[ESCAPE_DECODER].next();
            throw err;
          }
        }
      }
    } else {
      // Nobody's watching anyway
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
}

// ----------------------------------------------------------------------------
// Section: Interface
// ----------------------------------------------------------------------------

var kEmptyObject = ObjectFreeze(ObjectCreate(null));

// Some constants regarding configuration of interface
var kHistorySize = 30;
var kMaxUndoRedoStackSize = 2048;
var kMincrlfDelay = 100;
// \r\n, \n, or \r followed by something other than \n
var lineEnding = /\r?\n|\r(?!\n)/g;

// Max length of the kill ring
var kMaxLengthOfKillRing = 32;

// Symbols

// Public symbols
var kLineObjectStream = Symbol("line object stream");
var kQuestionCancel = Symbol("kQuestionCancel");
var kQuestion = Symbol("kQuestion");

// Private symbols
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

// Event symbols
var kFirstEventParam = SymbolFor("nodejs.kFirstEventParam");

// class InterfaceConstructor extends EventEmitter {
// #onSelfCloseWithTerminal;
// #onSelfCloseWithoutTerminal;

// #onError;
// #onData;
// #onEnd;
// #onTermEnd;
// #onKeyPress;
// #onResize;

// [kSawReturnAt];
// isCompletionEnabled = true;
// [kSawKeyPress];
// [kPreviousKey];
// escapeCodeTimeout;
// tabSize;

// line;
// [kSubstringSearch];
// output;
// input;
// [kUndoStack];
// [kRedoStack];
// history;
// historySize;

// [kKillRing];
// [kKillRingCursor];

// removeHistoryDuplicates;
// crlfDelay;
// completer;

// terminal;
// [kLineObjectStream];

// cursor;
// historyIndex;

// constructor(input, output, completer, terminal) {
//   super();

var kOnSelfCloseWithTerminal = Symbol("_onSelfCloseWithTerminal");
var kOnSelfCloseWithoutTerminal = Symbol("_onSelfCloseWithoutTerminal");
var kOnKeyPress = Symbol("_onKeyPress");
var kOnError = Symbol("_onError");
var kOnData = Symbol("_onData");
var kOnEnd = Symbol("_onEnd");
var kOnTermEnd = Symbol("_onTermEnd");
var kOnResize = Symbol("_onResize");

function onSelfCloseWithTerminal() {
  var input = this.input;
  var output = this.output;

  if (!input) throw new Error("Input not set, invalid state for readline!");

  input.removeListener("keypress", this[kOnKeyPress]);
  input.removeListener("error", this[kOnError]);
  input.removeListener("end", this[kOnTermEnd]);
  if (output !== null && output !== undefined) {
    output.removeListener("resize", this[kOnResize]);
  }
}

function onSelfCloseWithoutTerminal() {
  var input = this.input;
  if (!input) throw new Error("Input not set, invalid state for readline!");

  input.removeListener("data", this[kOnData]);
  input.removeListener("error", this[kOnError]);
  input.removeListener("end", this[kOnEnd]);
}

function onError(err) {
  this.emit("error", err);
}

function onData(data) {
  debug("onData");
  this[kNormalWrite](data);
}

function onEnd() {
  debug("onEnd");
  if (typeof this[kLine_buffer] === "string" && this[kLine_buffer].length > 0) {
    this.emit("line", this[kLine_buffer]);
  }
  this.close();
}

function onTermEnd() {
  debug("onTermEnd");
  if (typeof this.line === "string" && this.line.length > 0) {
    this.emit("line", this.line);
  }
  this.close();
}

function onKeyPress(s, key) {
  this[kTtyWrite](s, key);
  if (key && key.sequence) {
    // If the keySeq is half of a surrogate pair
    // (>= 0xd800 and <= 0xdfff), refresh the line so
    // the character is displayed appropriately.
    var ch = StringPrototypeCodePointAt.$call(key.sequence, 0)!;
    if (ch >= 0xd800 && ch <= 0xdfff) this[kRefreshLine]();
  }
}

function onResize() {
  this[kRefreshLine]();
}

function InterfaceConstructor(input, output, completer, terminal) {
  if (!(this instanceof InterfaceConstructor)) {
    return new InterfaceConstructor(input, output, completer, terminal);
  }

  EventEmitter.$call(this);

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
    // An options object was given
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
        throw $ERR_INVALID_ARG_VALUE("input.escapeCodeTimeout", this.escapeCodeTimeout);
      }
    }

    if (signal) {
      validateAbortSignal(signal, "options.signal");
    }

    crlfDelay = input.crlfDelay;
    input = input.input;
  }

  if (completer !== undefined && typeof completer !== "function") {
    throw $ERR_INVALID_ARG_VALUE("completer", completer);
  }

  if (history === undefined) {
    history = [];
  } else {
    validateArray(history, "history");
  }

  if (historySize === undefined) {
    historySize = kHistorySize;
  }

  validateNumber(historySize, "historySize", 0);

  // Backwards compat; check the isTTY prop of the output stream
  //  when `terminal` was not specified
  if (terminal === undefined && !(output == null)) {
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

  // The kill ring is a global list of blocks of text that were previously
  // killed (deleted). If its size exceeds kMaxLengthOfKillRing, the oldest
  // element will be removed to make room for the latest deletion. With kill
  // ring, users are able to recall (yank) or cycle (yank pop) among previously
  // killed texts, quite similar to the behavior of Emacs.
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
    this[kDecoder] = new StringDecoder("utf8");
    input.on("data", this[kOnData]);
    input.on("end", this[kOnEnd]);
    this.once("close", this[kOnSelfCloseWithoutTerminal]);
  } else {
    emitKeypressEvents(input, this);

    // `input` usually refers to stdin
    input.on("keypress", this[kOnKeyPress]);
    input.on("end", this[kOnTermEnd]);

    this[kSetRawMode](true);
    this.terminal = true;

    // Cursor position on the line.
    this.cursor = 0;
    this.historyIndex = -1;

    if (output !== null && output !== undefined) output.on("resize", this[kOnResize]);

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

  // Current line
  this.line = "";

  input.resume();
}
InterfaceConstructor.prototype = {};

ObjectSetPrototypeOf(InterfaceConstructor.prototype, EventEmitter.prototype);
// ObjectSetPrototypeOf(InterfaceConstructor, EventEmitter);

var _Interface = class Interface extends InterfaceConstructor {
  // TODO: Enumerate all the properties of the class

  // eslint-disable-next-line no-useless-constructor
  constructor(input, output, completer, terminal) {
    super(input, output, completer, terminal);
  }
  get columns() {
    var output = this.output;
    if (output && output.columns) return output.columns;
    return Infinity;
  }

  /**
   * Sets the prompt written to the output.
   * @param {string} prompt
   * @returns {void}
   */
  setPrompt(prompt) {
    this[kPrompt] = prompt;
  }

  /**
   * Returns the current prompt used by `rl.prompt()`.
   * @returns {string}
   */
  getPrompt() {
    return this[kPrompt];
  }

  [kSetRawMode](mode) {
    const wasInRawMode = this.input.isRaw;

    var setRawMode = this.input.setRawMode;
    if (typeof setRawMode === "function") {
      setRawMode.$call(this.input, mode);
    }

    return wasInRawMode;
  }

  /**
   * Writes the configured `prompt` to a new line in `output`.
   * @param {boolean} [preserveCursor]
   * @returns {void}
   */
  prompt(preserveCursor) {
    if (this.paused) this.resume();
    if (this.terminal && process.env.TERM !== "dumb") {
      if (!preserveCursor) this.cursor = 0;
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
    if (this.line.length === 0) return "";

    // If the history is disabled then return the line
    if (this.historySize === 0) return this.line;

    // If the trimmed line is empty then return the line
    if (StringPrototypeTrim.$call(this.line).length === 0) return this.line;

    if (this.history.length === 0 || this.history[0] !== this.line) {
      if (this.removeHistoryDuplicates) {
        // Remove older history line if identical to new one
        var dupIndex = ArrayPrototypeIndexOf.$call(this.history, this.line);
        if (dupIndex !== -1) ArrayPrototypeSplice.$call(this.history, dupIndex, 1);
      }

      ArrayPrototypeUnshift.$call(this.history, this.line);

      // Only store so many
      if (this.history.length > this.historySize) ArrayPrototypePop.$call(this.history);
    }

    this.historyIndex = -1;

    // The listener could change the history object, possibly
    // to remove the last added entry if it is sensitive and should
    // not be persisted in the history, like a password
    var line = this.history[0];

    // Emit history event to notify listeners of update
    this.emit("history", this.history);

    return line;
  }

  [kRefreshLine]() {
    // line length
    var line = this[kPrompt] + this.line;
    var dispPos = this[kGetDisplayPos](line);
    var lineCols = dispPos.cols;
    var lineRows = dispPos.rows;

    // cursor position
    var cursorPos = this.getCursorPos();

    // First move to the bottom of the current line, based on cursor pos
    var prevRows = this.prevRows || 0;
    if (prevRows > 0) {
      moveCursor(this.output, 0, -prevRows);
    }

    // Cursor to left edge.
    cursorTo(this.output, 0);
    // erase data
    clearScreenDown(this.output);

    // Write the prompt and the current buffer content.
    this[kWriteToOutput](line);

    // Force terminal to allocate a new line
    if (lineCols === 0) {
      this[kWriteToOutput](" ");
    }

    // Move cursor to original position.
    cursorTo(this.output, cursorPos.cols);

    var diff = lineRows - cursorPos.rows;
    if (diff > 0) {
      moveCursor(this.output, 0, -diff);
    }

    this.prevRows = cursorPos.rows;
  }

  /**
   * Closes the `readline.Interface` instance.
   * @returns {void}
   */
  close() {
    if (this.closed) return;
    this.pause();
    if (this.terminal) {
      this[kSetRawMode](false);
    }
    this.closed = true;
    this.emit("close");
  }

  /**
   * Pauses the `input` stream.
   * @returns {void | Interface}
   */
  pause() {
    if (this.paused) return;
    this.input.pause();
    this.paused = true;
    this.emit("pause");
    return this;
  }

  /**
   * Resumes the `input` stream if paused.
   * @returns {void | Interface}
   */
  resume() {
    if (!this.paused) return;
    this.input.resume();
    this.paused = false;
    this.emit("resume");
    return this;
  }

  /**
   * Writes either `data` or a `key` sequence identified by
   * `key` to the `output`.
   * @param {string} d
   * @param {{
   *   ctrl?: boolean;
   *   meta?: boolean;
   *   shift?: boolean;
   *   name?: string;
   *   }} [key]
   * @returns {void}
   */
  write(d, key) {
    if (this.paused) this.resume();
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
      if (StringPrototypeCodePointAt.$call(string) === 10) string = StringPrototypeSlice.$call(string, 1);
      this[kSawReturnAt] = 0;
    }

    // Run test() on the new string chunk, not on the entire line buffer.
    var newPartContainsEnding = RegExpPrototypeExec.$call(lineEnding, string);
    if (newPartContainsEnding !== null) {
      if (this[kLine_buffer]) {
        string = this[kLine_buffer] + string;
        this[kLine_buffer] = null;
        lineEnding.lastIndex = 0; // Start the search from the beginning of the string.
        newPartContainsEnding = RegExpPrototypeExec.$call(lineEnding, string);
      }
      this[kSawReturnAt] = StringPrototypeEndsWith.$call(string, "\r") ? DateNow() : 0;

      var indexes = [0, newPartContainsEnding.index, lineEnding.lastIndex];
      var nextMatch;
      while ((nextMatch = RegExpPrototypeExec.$call(lineEnding, string)) !== null) {
        ArrayPrototypePush.$call(indexes, nextMatch.index, lineEnding.lastIndex);
      }
      var lastIndex = indexes.length - 1;
      // Either '' or (conceivably) the unfinished portion of the next line
      this[kLine_buffer] = StringPrototypeSlice.$call(string, indexes[lastIndex]);
      for (var i = 1; i < lastIndex; i += 2) {
        this[kOnLine](StringPrototypeSlice.$call(string, indexes[i - 1], indexes[i]));
      }
    } else if (string) {
      // No newlines this time, save what we have for next time
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
      var beg = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var end = StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
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

  async [kTabComplete](lastKeypressWasTab) {
    this.pause();
    var string = StringPrototypeSlice.$call(this.line, 0, this.cursor);
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
    // Result and the text that was completed.

    if (!completions || completions.length === 0) {
      return;
    }

    // If there is a common prefix to all matches, then apply that portion.
    var prefix = commonPrefix(ArrayPrototypeFilter.$call(completions, e => e !== ""));
    if (StringPrototypeStartsWith.$call(prefix, completeOn) && prefix.length > completeOn.length) {
      this[kInsertString](StringPrototypeSlice.$call(prefix, completeOn.length));
      return;
    } else if (!StringPrototypeStartsWith.$call(completeOn, prefix)) {
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor - completeOn.length) +
        prefix +
        StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this._refreshLine();
      return;
    }

    if (!lastKeypressWasTab) {
      return;
    }

    this[kBeforeEdit](this.line, this.cursor);

    // Apply/show completions.
    var completionsWidth = ArrayPrototypeMap.$call(completions, e => getStringWidth(e));
    var width = MathMax.$apply(null, completionsWidth) + 2; // 2 space padding
    var maxColumns = MathFloor(this.columns / width) || 1;
    if (maxColumns === Infinity) {
      maxColumns = 1;
    }
    var output = "\r\n";
    var lineIndex = 0;
    var whitespace = 0;
    for (var i = 0; i < completions.length; i++) {
      var completion = completions[i];
      if (completion === "" || lineIndex === maxColumns) {
        output += "\r\n";
        lineIndex = 0;
        whitespace = 0;
      } else {
        output += StringPrototypeRepeat.$call(" ", whitespace);
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
      // Reverse the string and match a word near beginning
      // to avoid quadratic time complexity
      var leading = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.$call(ArrayPrototypeReverse.$call(ArrayFrom(leading)), "");
      var match = RegExpPrototypeExec.$call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      this[kMoveCursor](-match[0].length);
    }
  }

  [kWordRight]() {
    if (this.cursor < this.line.length) {
      var trailing = StringPrototypeSlice.$call(this.line, this.cursor);
      var match = RegExpPrototypeExec.$call(/^(?:\s+|[^\w\s]+|\w+)\s*/, trailing);
      this[kMoveCursor](match[0].length);
    }
  }

  [kDeleteLeft]() {
    if (this.cursor > 0 && this.line.length > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      // The number of UTF-16 units comprising the character to the left
      var charSize = charLengthLeft(this.line, this.cursor);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor - charSize) +
        StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);

      this.cursor -= charSize;
      this[kRefreshLine]();
    }
  }

  [kDeleteRight]() {
    if (this.cursor < this.line.length) {
      this[kBeforeEdit](this.line, this.cursor);
      // The number of UTF-16 units comprising the character to the left
      var charSize = charLengthAt(this.line, this.cursor);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor) +
        StringPrototypeSlice.$call(this.line, this.cursor + charSize, this.line.length);
      this[kRefreshLine]();
    }
  }

  [kDeleteWordLeft]() {
    if (this.cursor > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      // Reverse the string and match a word near beginning
      // to avoid quadratic time complexity
      var leading = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.$call(ArrayPrototypeReverse.$call(ArrayFrom(leading)), "");
      var match = RegExpPrototypeExec.$call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      leading = StringPrototypeSlice.$call(leading, 0, leading.length - match[0].length);
      this.line = leading + StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
      this.cursor = leading.length;
      this[kRefreshLine]();
    }
  }

  [kDeleteWordRight]() {
    if (this.cursor < this.line.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var trailing = StringPrototypeSlice.$call(this.line, this.cursor);
      var match = RegExpPrototypeExec.$call(/^(?:\s+|\W+|\w+)\s*/, trailing);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor) + StringPrototypeSlice.$call(trailing, match[0].length);
      this[kRefreshLine]();
    }
  }

  [kDeleteLineLeft]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    this.line = StringPrototypeSlice.$call(this.line, this.cursor);
    this.cursor = 0;
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }

  [kDeleteLineRight]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice.$call(this.line, this.cursor);
    this.line = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }

  [kPushToKillRing](del) {
    if (!del || del === this[kKillRing][0]) return;
    ArrayPrototypeUnshift.$call(this[kKillRing], del);
    this[kKillRingCursor] = 0;
    while (this[kKillRing].length > kMaxLengthOfKillRing) ArrayPrototypePop.$call(this[kKillRing]);
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
      var head = StringPrototypeSlice.$call(this.line, 0, this.cursor - lastYank.length);
      var tail = StringPrototypeSlice.$call(this.line, this.cursor);
      this.line = head + currentYank + tail;
      this.cursor = head.length + currentYank.length;
      this[kRefreshLine]();
    }
  }

  clearLine() {
    this[kMoveCursor](+Infinity);
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
    if (ArrayPrototypePush.$call(this[kUndoStack], { text, cursor }) > kMaxUndoRedoStackSize) {
      ArrayPrototypeShift.$call(this[kUndoStack]);
    }
  }

  [kUndo]() {
    if (this[kUndoStack].length <= 0) return;

    ArrayPrototypePush.$call(this[kRedoStack], {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop.$call(this[kUndoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;

    this[kRefreshLine]();
  }

  [kRedo]() {
    if (this[kRedoStack].length <= 0) return;

    ArrayPrototypePush.$call(this[kUndoStack], {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop.$call(this[kRedoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;

    this[kRefreshLine]();
  }

  [kHistoryNext]() {
    if (this.historyIndex >= 0) {
      this[kBeforeEdit](this.line, this.cursor);
      var search = this[kSubstringSearch] || "";
      var index = this.historyIndex - 1;
      while (
        index >= 0 &&
        (!StringPrototypeStartsWith.$call(this.history[index], search) || this.line === this.history[index])
      ) {
        index--;
      }
      if (index === -1) {
        this.line = search;
      } else {
        this.line = this.history[index];
      }
      this.historyIndex = index;
      this.cursor = this.line.length; // Set cursor to end of line.
      this[kRefreshLine]();
    }
  }

  [kHistoryPrev]() {
    if (this.historyIndex < this.history.length && this.history.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var search = this[kSubstringSearch] || "";
      var index = this.historyIndex + 1;
      while (
        index < this.history.length &&
        (!StringPrototypeStartsWith.$call(this.history[index], search) || this.line === this.history[index])
      ) {
        index++;
      }
      if (index === this.history.length) {
        this.line = search;
      } else {
        this.line = this.history[index];
      }
      this.historyIndex = index;
      this.cursor = this.line.length; // Set cursor to end of line.
      this[kRefreshLine]();
    }
  }

  // Returns the last character's display position of the given string
  [kGetDisplayPos](str) {
    var offset = 0;
    var col = this.columns;
    var rows = 0;
    str = stripVTControlCharacters(str);
    for (var char of new SafeStringIterator(str)) {
      if (char === "\n") {
        // Rows must be incremented by 1 even if offset = 0 or col = +Infinity.
        rows += MathCeil(offset / col) || 1;
        offset = 0;
        continue;
      }
      // Tabs must be aligned by an offset of the tab size.
      if (char === "\t") {
        offset += this.tabSize - (offset % this.tabSize);
        continue;
      }
      var width = getStringWidth(char, false /* stripVTControlCharacters */);
      if (width === 0 || width === 1) {
        offset += width;
      } else {
        // width === 2
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

  /**
   * Returns the real position of the cursor in relation
   * to the input prompt + string.
   * @returns {{
   *   rows: number;
   *   cols: number;
   * }}
   */
  getCursorPos() {
    var strBeforeCursor = this[kPrompt] + StringPrototypeSlice.$call(this.line, 0, this.cursor);
    return this[kGetDisplayPos](strBeforeCursor);
  }

  // This function moves cursor dx places to the right
  // (-dx for left) and refreshes the line if it is needed.
  [kMoveCursor](dx) {
    if (dx === 0) {
      return;
    }
    var oldPos = this.getCursorPos();
    this.cursor += dx;

    // Bounds check
    if (this.cursor < 0) {
      this.cursor = 0;
    } else if (this.cursor > this.line.length) {
      this.cursor = this.line.length;
    }

    var newPos = this.getCursorPos();

    // Check if cursor stayed on the line.
    if (oldPos.rows === newPos.rows) {
      var diffWidth = newPos.cols - oldPos.cols;
      moveCursor(this.output, diffWidth, 0);
    } else {
      this[kRefreshLine]();
    }
  }

  // Handle a write from the tty
  [kTtyWrite](s, key) {
    var previousKey = this[kPreviousKey];
    key = key || kEmptyObject;
    this[kPreviousKey] = key;
    var { name: keyName, meta: keyMeta, ctrl: keyCtrl, shift: keyShift, sequence: keySeq } = key;

    if (!keyMeta || keyName !== "y") {
      // Reset yanking state unless we are doing yank pop.
      this[kYanking] = false;
    }

    // Activate or deactivate substring search.
    if ((keyName === "up" || keyName === "down") && !keyCtrl && !keyMeta && !keyShift) {
      if (this[kSubstringSearch] === null) {
        this[kSubstringSearch] = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      }
    } else if (this[kSubstringSearch] !== null) {
      this[kSubstringSearch] = null;
      // Reset the index in case there's no match.
      if (this.history.length === this.historyIndex) {
        this.historyIndex = -1;
      }
    }

    // Undo & Redo
    if (typeof keySeq === "string") {
      switch (StringPrototypeCodePointAt.$call(keySeq, 0)) {
        case 0x1f:
          this[kUndo]();
          return;
        case 0x1e:
          this[kRedo]();
          return;
        default:
          break;
      }
    }

    // Ignore escape key, fixes
    // https://github.com/nodejs/node-v0.x-archive/issues/2876.
    if (keyName === "escape") return;

    if (keyCtrl && keyShift) {
      /* Control and shift pressed */
      switch (keyName) {
        // TODO(BridgeAR): The transmitted escape sequence is `\b` and that is
        // identical to <ctrl>-h. It should have a unique escape sequence.
        case "backspace":
          this[kDeleteLineLeft]();
          break;

        case "delete":
          this[kDeleteLineRight]();
          break;
      }
    } else if (keyCtrl) {
      /* Control key pressed */

      switch (keyName) {
        case "c":
          if (this.listenerCount("SIGINT") > 0) {
            this.emit("SIGINT");
          } else {
            // This readline instance is finished
            this.close();
          }
          break;

        case "h": // delete left
          this[kDeleteLeft]();
          break;

        case "d": // delete right or EOF
          if (this.cursor === 0 && this.line.length === 0) {
            // This readline instance is finished
            this.close();
          } else if (this.cursor < this.line.length) {
            this[kDeleteRight]();
          }
          break;

        case "u": // Delete from current to start of line
          this[kDeleteLineLeft]();
          break;

        case "k": // Delete from current to end of line
          this[kDeleteLineRight]();
          break;

        case "a": // Go to the start of the line
          this[kMoveCursor](-Infinity);
          break;

        case "e": // Go to the end of the line
          this[kMoveCursor](+Infinity);
          break;

        case "b": // back one character
          this[kMoveCursor](-charLengthLeft(this.line, this.cursor));
          break;

        case "f": // Forward one character
          this[kMoveCursor](+charLengthAt(this.line, this.cursor));
          break;

        case "l": // Clear the whole screen
          cursorTo(this.output, 0, 0);
          clearScreenDown(this.output);
          this[kRefreshLine]();
          break;

        case "n": // next history item
          this[kHistoryNext]();
          break;

        case "p": // Previous history item
          this[kHistoryPrev]();
          break;

        case "y": // Yank killed string
          this[kYank]();
          break;

        case "z":
          if (process.platform === "win32") break;
          if (this.listenerCount("SIGTSTP") > 0) {
            this.emit("SIGTSTP");
          } else {
            process.once("SIGCONT", () => {
              // Don't raise events if stream has already been abandoned.
              if (!this.paused) {
                // Stream must be paused and resumed after SIGCONT to catch
                // SIGINT, SIGTSTP, and EOF.
                this.pause();
                this.emit("SIGCONT");
              }
              // Explicitly re-enable "raw mode" and move the cursor to
              // the correct position.
              // See https://github.com/joyent/node/issues/3295.
              this[kSetRawMode](true);
              this[kRefreshLine]();
            });
            this[kSetRawMode](false);
            process.kill(process.pid, "SIGTSTP");
          }
          break;

        case "w": // Delete backwards to a word boundary
        case "backspace":
          this[kDeleteWordLeft]();
          break;

        case "delete": // Delete forward to a word boundary
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
      /* Meta key pressed */

      switch (keyName) {
        case "b": // backward word
          this[kWordLeft]();
          break;

        case "f": // forward word
          this[kWordRight]();
          break;

        case "d": // delete forward word
        case "delete":
          this[kDeleteWordRight]();
          break;

        case "backspace": // Delete backwards to a word boundary
          this[kDeleteWordLeft]();
          break;

        case "y": // Doing yank pop
          this[kYankPop]();
          break;
      }
    } else {
      /* No modifier keys used */

      // \r bookkeeping is only relevant if a \n comes right after.
      if (this[kSawReturnAt] && keyName !== "enter") this[kSawReturnAt] = 0;

      switch (keyName) {
        case "return": // Carriage return, i.e. \r
          this[kSawReturnAt] = DateNow();
          this[kLine]();
          break;

        case "enter":
          // When key interval > crlfDelay
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
          // Obtain the code point to the left
          this[kMoveCursor](-charLengthLeft(this.line, this.cursor));
          break;

        case "right":
          this[kMoveCursor](+charLengthAt(this.line, this.cursor));
          break;

        case "home":
          this[kMoveCursor](-Infinity);
          break;

        case "end":
          this[kMoveCursor](+Infinity);
          break;

        case "up":
          this[kHistoryPrev]();
          break;

        case "down":
          this[kHistoryNext]();
          break;

        case "tab":
          // If tab completion enabled, do that...
          if (typeof this.completer === "function" && this.isCompletionEnabled) {
            var lastKeypressWasTab = previousKey && previousKey.name === "tab";
            this[kTabComplete](lastKeypressWasTab);
            break;
          }
        // falls through
        default:
          if (typeof s === "string" && s) {
            // Erase state of previous searches.
            lineEnding.lastIndex = 0;
            let nextMatch;
            // Keep track of the end of the last match.
            let lastIndex = 0;
            while ((nextMatch = RegExpPrototypeExec.$call(lineEnding, s)) !== null) {
              this[kInsertString](StringPrototypeSlice.$call(s, lastIndex, nextMatch.index));
              ({ lastIndex } = lineEnding);
              this[kLine]();
              // Restore lastIndex as the call to kLine could have mutated it.
              lineEnding.lastIndex = lastIndex;
            }
            // This ensures that the last line is written if it doesn't end in a newline.
            // Note that the last line may be the first line, in which case this still works.
            this[kInsertString](StringPrototypeSlice.$call(s, lastIndex));
          }
      }
    }
  }

  /**
   * Creates an `AsyncIterator` object that iterates through
   * each line in the input stream as a string.
   * @typedef {{
   *   [Symbol.asyncIterator]: () => InterfaceAsyncIterator,
   *   next: () => Promise<string>
   * }} InterfaceAsyncIterator
   * @returns {InterfaceAsyncIterator}
   */
  [SymbolAsyncIterator]() {
    if (this[kLineObjectStream] === undefined) {
      this[kLineObjectStream] = EventEmitter.on(this, "line", {
        close: ["close"],
        highWatermark: 1024,
        [kFirstEventParam]: true,
      });
    }
    return this[kLineObjectStream];
  }
};

function Interface(input, output, completer, terminal) {
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

  InterfaceConstructor.$call(this, input, output, completer, terminal);

  // TODO: Test this
  if (process.env.TERM === "dumb") {
    this._ttyWrite = _ttyWriteDumb.bind(this);
  }
}
Interface.prototype = {};

ObjectSetPrototypeOf(Interface.prototype, _Interface.prototype);
ObjectSetPrototypeOf(Interface, _Interface);

/**
 * Displays `query` by writing it to the `output`.
 * @param {string} query
 * @param {{ signal?: AbortSignal; }} [options]
 * @param {Function} cb
 * @returns {void}
 */
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
    cb =
      typeof cb === "function"
        ? answer => {
            cleanup();
            return originalCb(answer);
          }
        : cleanup;
  }

  if (typeof cb === "function") {
    this[kQuestion](query, cb);
  }
};

Interface.prototype.question[promisify.custom] = function question(query, options) {
  if (options === null || typeof options !== "object") {
    options = kEmptyObject;
  }

  var signal = options?.signal;

  if (signal && signal.aborted) {
    return PromiseReject($makeAbortError(undefined, { cause: signal.reason }));
  }

  return new Promise((resolve, reject) => {
    var cb = resolve;
    if (signal) {
      var onAbort = () => {
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cb = answer => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      };
    }
    this.question(query, options, cb);
  });
};

/**
 * Creates a new `readline.Interface` instance.
 * @param {Readable | {
 *   input: Readable;
 *   output: Writable;
 *   completer?: Function;
 *   terminal?: boolean;
 *   history?: string[];
 *   historySize?: number;
 *   removeHistoryDuplicates?: boolean;
 *   prompt?: string;
 *   crlfDelay?: number;
 *   escapeCodeTimeout?: number;
 *   tabSize?: number;
 *   signal?: AbortSignal;
 *   }} input
 * @param {Writable} [output]
 * @param {Function} [completer]
 * @param {boolean} [terminal]
 * @returns {Interface}
 */
function createInterface(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
}

ObjectDefineProperties(Interface.prototype, {
  // Redirect internal prototype methods to the underscore notation for backward
  // compatibility.
  [kSetRawMode]: {
    __proto__: null,
    get() {
      return this._setRawMode;
    },
  },
  [kOnLine]: {
    __proto__: null,
    get() {
      return this._onLine;
    },
  },
  [kWriteToOutput]: {
    __proto__: null,
    get() {
      return this._writeToOutput;
    },
  },
  [kAddHistory]: {
    __proto__: null,
    get() {
      return this._addHistory;
    },
  },
  [kRefreshLine]: {
    __proto__: null,
    get() {
      return this._refreshLine;
    },
  },
  [kNormalWrite]: {
    __proto__: null,
    get() {
      return this._normalWrite;
    },
  },
  [kInsertString]: {
    __proto__: null,
    get() {
      return this._insertString;
    },
  },
  [kTabComplete]: {
    __proto__: null,
    get() {
      return this._tabComplete;
    },
  },
  [kWordLeft]: {
    __proto__: null,
    get() {
      return this._wordLeft;
    },
  },
  [kWordRight]: {
    __proto__: null,
    get() {
      return this._wordRight;
    },
  },
  [kDeleteLeft]: {
    __proto__: null,
    get() {
      return this._deleteLeft;
    },
  },
  [kDeleteRight]: {
    __proto__: null,
    get() {
      return this._deleteRight;
    },
  },
  [kDeleteWordLeft]: {
    __proto__: null,
    get() {
      return this._deleteWordLeft;
    },
  },
  [kDeleteWordRight]: {
    __proto__: null,
    get() {
      return this._deleteWordRight;
    },
  },
  [kDeleteLineLeft]: {
    __proto__: null,
    get() {
      return this._deleteLineLeft;
    },
  },
  [kDeleteLineRight]: {
    __proto__: null,
    get() {
      return this._deleteLineRight;
    },
  },
  [kLine]: {
    __proto__: null,
    get() {
      return this._line;
    },
  },
  [kHistoryNext]: {
    __proto__: null,
    get() {
      return this._historyNext;
    },
  },
  [kHistoryPrev]: {
    __proto__: null,
    get() {
      return this._historyPrev;
    },
  },
  [kGetDisplayPos]: {
    __proto__: null,
    get() {
      return this._getDisplayPos;
    },
  },
  [kMoveCursor]: {
    __proto__: null,
    get() {
      return this._moveCursor;
    },
  },
  [kTtyWrite]: {
    __proto__: null,
    get() {
      return this._ttyWrite;
    },
  },

  // Defining proxies for the internal instance properties for backward
  // compatibility.
  _decoder: {
    __proto__: null,
    get() {
      return this[kDecoder];
    },
    set(value) {
      this[kDecoder] = value;
    },
  },
  _line_buffer: {
    __proto__: null,
    get() {
      return this[kLine_buffer];
    },
    set(value) {
      this[kLine_buffer] = value;
    },
  },
  _oldPrompt: {
    __proto__: null,
    get() {
      return this[kOldPrompt];
    },
    set(value) {
      this[kOldPrompt] = value;
    },
  },
  _previousKey: {
    __proto__: null,
    get() {
      return this[kPreviousKey];
    },
    set(value) {
      this[kPreviousKey] = value;
    },
  },
  _prompt: {
    __proto__: null,
    get() {
      return this[kPrompt];
    },
    set(value) {
      this[kPrompt] = value;
    },
  },
  _questionCallback: {
    __proto__: null,
    get() {
      return this[kQuestionCallback];
    },
    set(value) {
      this[kQuestionCallback] = value;
    },
  },
  _sawKeyPress: {
    __proto__: null,
    get() {
      return this[kSawKeyPress];
    },
    set(value) {
      this[kSawKeyPress] = value;
    },
  },
  _sawReturnAt: {
    __proto__: null,
    get() {
      return this[kSawReturnAt];
    },
    set(value) {
      this[kSawReturnAt] = value;
    },
  },
});

// Make internal methods public for backward compatibility.
Interface.prototype._setRawMode = _Interface.prototype[kSetRawMode];
Interface.prototype._onLine = _Interface.prototype[kOnLine];
Interface.prototype._writeToOutput = _Interface.prototype[kWriteToOutput];
Interface.prototype._addHistory = _Interface.prototype[kAddHistory];
Interface.prototype._refreshLine = _Interface.prototype[kRefreshLine];
Interface.prototype._normalWrite = _Interface.prototype[kNormalWrite];
Interface.prototype._insertString = _Interface.prototype[kInsertString];
Interface.prototype._tabComplete = function (lastKeypressWasTab) {
  // Overriding parent method because `this.completer` in the legacy
  // implementation takes a callback instead of being an async function.
  this.pause();
  var string = StringPrototypeSlice.$call(this.line, 0, this.cursor);
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

function _ttyWriteDumb(s, key) {
  key = key || kEmptyObject;

  if (key.name === "escape") return;

  if (this[kSawReturnAt] && key.name !== "enter") this[kSawReturnAt] = 0;

  if (key.ctrl) {
    if (key.name === "c") {
      if (this.listenerCount("SIGINT") > 0) {
        this.emit("SIGINT");
      } else {
        // This readline instance is finished
        this.close();
      }

      return;
    } else if (key.name === "d") {
      this.close();
      return;
    }
  }

  switch (key.name) {
    case "return": // Carriage return, i.e. \r
      this[kSawReturnAt] = DateNow();
      this._line();
      break;

    case "enter":
      // When key interval > crlfDelay
      if (this[kSawReturnAt] === 0 || DateNow() - this[kSawReturnAt] > this.crlfDelay) {
        this._line();
      }
      this[kSawReturnAt] = 0;
      break;

    default:
      if (typeof s === "string" && s) {
        this.line += s;
        this.cursor += s.length;
        this._writeToOutput(s);
      }
  }
}

class Readline {
  #autoCommit = false;
  #stream;
  #todo = [];

  constructor(stream, options = undefined) {
    isWritable ??= require("node:stream").isWritable;
    if (!isWritable(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "Writable", stream);
    this.#stream = stream;
    if (options?.autoCommit != null) {
      validateBoolean(options.autoCommit, "options.autoCommit");
      this.#autoCommit = options.autoCommit;
    }
  }

  /**
   * Moves the cursor to the x and y coordinate on the given stream.
   * @param {integer} x
   * @param {integer} [y]
   * @returns {Readline} this
   */
  cursorTo(x, y = undefined) {
    validateInteger(x, "x");
    if (y != null) validateInteger(y, "y");

    var data = y == null ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
    if (this.#autoCommit) process.nextTick(() => this.#stream.write(data));
    else ArrayPrototypePush.$call(this.#todo, data);

    return this;
  }

  /**
   * Moves the cursor relative to its current location.
   * @param {integer} dx
   * @param {integer} dy
   * @returns {Readline} this
   */
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
      if (this.#autoCommit) process.nextTick(() => this.#stream.write(data));
      else ArrayPrototypePush.$call(this.#todo, data);
    }
    return this;
  }

  /**
   * Clears the current line the cursor is on.
   * @param {-1|0|1} dir Direction to clear:
   *   -1 for left of the cursor
   *   +1 for right of the cursor
   *    0 for the entire line
   * @returns {Readline} this
   */
  clearLine(dir) {
    validateInteger(dir, "dir", -1, 1);

    var data = dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
    if (this.#autoCommit) process.nextTick(() => this.#stream.write(data));
    else ArrayPrototypePush.$call(this.#todo, data);
    return this;
  }

  /**
   * Clears the screen from the current position of the cursor down.
   * @returns {Readline} this
   */
  clearScreenDown() {
    if (this.#autoCommit) {
      process.nextTick(() => this.#stream.write(kClearScreenDown));
    } else {
      ArrayPrototypePush.$call(this.#todo, kClearScreenDown);
    }
    return this;
  }

  /**
   * Sends all the pending actions to the associated `stream` and clears the
   * internal list of pending actions.
   * @returns {Promise<void>} Resolves when all pending actions have been
   * flushed to the associated `stream`.
   */
  commit() {
    const { resolve, promise } = $newPromiseCapability(Promise);
    this.#stream.write(ArrayPrototypeJoin.$call(this.#todo, ""), resolve);
    this.#todo = [];

    return promise;
  }

  /**
   * Clears the internal list of pending actions without sending it to the
   * associated `stream`.
   * @returns {Readline} this
   */
  rollback() {
    this.#todo = [];
    return this;
  }
}

var PromisesInterface = class Interface extends _Interface {
  // eslint-disable-next-line no-useless-constructor
  constructor(input, output, completer, terminal) {
    super(input, output, completer, terminal);
  }
  question(query, options = kEmptyObject) {
    var signal = options?.signal;
    if (signal) {
      validateAbortSignal(signal, "options.signal");
      if (signal.aborted) {
        return PromiseReject($makeAbortError(undefined, { cause: signal.reason }));
      }
    }
    const { promise, resolve, reject } = $newPromiseCapability(Promise);
    var cb = resolve;
    if (options?.signal) {
      var onAbort = () => {
        this[kQuestionCancel]();
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cb = answer => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      };
    }
    this[kQuestion](query, cb);
    return promise;
  }
};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------
export default {
  Interface,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises: {
    Readline,
    Interface: PromisesInterface,
    createInterface(input, output, completer, terminal) {
      return new PromisesInterface(input, output, completer, terminal);
    },
  },

  [SymbolFor("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")]: {
    CSI,
    utils: {
      getStringWidth,
      stripVTControlCharacters,
    },
  },
};
