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
import type { Readable, Writable } from "node:stream";
import type { InspectOptions } from "node-inspect-extracted";
import type { ReadLine, ReadLineOptions, Key as ReadlineKey } from "node:readline";
import type { StringDecoder as IStringDecoder } from "node:string_decoder";
import type { EventEmitter as IEventEmitter } from "node:events";

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

var { Writable: StreamWritable } = require("node:stream");

var { inspect } = require("node:util");
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
const MathCeil = Math.ceil;
const MathFloor = Math.floor;
const MathMax = Math.max;
const DateNow = Date.now;
const StringPrototype = String.prototype;
const StringPrototypeSymbolIterator = StringPrototype[SymbolIterator];
const StringIteratorPrototypeNext = (StringPrototypeSymbolIterator as any).$call("").next;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectDefineProperties = Object.defineProperties;
const ObjectFreeze = Object.freeze;
const ObjectCreate = Object.create;

// Define Key locally to include 'code' if it's missing from the imported type
interface Key extends ReadlineKey {
  code?: string;
}

var createSafeIterator = (factory, next) => {
  class SafeIterator {
    #iterator: Iterator<string>;
    constructor(iterable: string) {
      this.#iterator = factory.$call(iterable);
    }
    next() {
      return next.$call(this.#iterator);
    }
    [Symbol.iterator]() {
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
var getStringWidth = function getStringWidth(str: string, removeControlChars = true) {
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
    (i > 1 && (StringPrototypeCodePointAt.$call(str, i - 2) ?? 0) >= kUTF16SurrogateThreshold) ||
    (StringPrototypeCodePointAt.$call(str, i - 1) ?? 0) >= kUTF16SurrogateThreshold
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
  return (StringPrototypeCodePointAt.$call(str, i) ?? 0) >= kUTF16SurrogateThreshold ? 2 : 1;
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
    const key: Key = {
      sequence: undefined,
      name: undefined,
      ctrl: false,
      meta: false,
      shift: false,
      code: undefined,
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
         * So the generic regexp is like /^((\d;)?(\d))?[A-Za-z]$/
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
      key.name = StringFromCharCode(StringPrototypeCharCodeAt.$call(ch, 0) + StringPrototypeCharCodeAt.$call("a", 0) - 1); // prettier-ignore
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

function cursorTo(
  stream: Writable,
  x: number,
  y?: number,
  callback?: (err?: Error | null | undefined) => void,
): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (typeof y === "function") {
    callback = y;
    y = undefined;
  }

  if (NumberIsNaN(x)) throw $ERR_INVALID_ARG_VALUE("x", x);
  if (y !== undefined && NumberIsNaN(y)) throw $ERR_INVALID_ARG_VALUE("y", y);

  if (stream == null || (typeof x !== "number" && typeof y !== "number")) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  if (typeof x !== "number") throw $ERR_INVALID_CURSOR_POS();

  var data = typeof y !== "number" ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
  return stream.write(data, callback as (error: Error | null | undefined) => void);
}

/**
 * moves the cursor relative to its current location
 */

function moveCursor(
  stream: Writable,
  dx: number,
  dy: number,
  callback?: (err?: Error | null | undefined) => void,
): boolean {
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

  return stream.write(data, callback as (error: Error | null | undefined) => void);
}

/**
 * clears the current line the cursor is on:
 *   -1 for left of the cursor
 *   +1 for right of the cursor
 *    0 for the entire line
 */

function clearLine(stream: Writable, dir: number, callback?: (err?: Error | null | undefined) => void): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  var type = dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
  return stream.write(type, callback as (error: Error | null | undefined) => void);
}

/**
 * clears the screen from the current position of the cursor down
 */

function clearScreenDown(stream: Writable, callback?: (err?: Error | null | undefined) => void): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  return stream.write(kClearScreenDown, callback as (error: Error | null | undefined) => void);
}

// ----------------------------------------------------------------------------
// Section: Emit keypress events
// ----------------------------------------------------------------------------

var KEYPRESS_DECODER = Symbol("keypress-decoder");
var ESCAPE_DECODER = Symbol("escape-decoder");

// GNU readline library - keyseq-timeout is 500ms (default)
var ESCAPE_CODE_TIMEOUT = 500;

interface KeypressInterface {
  escapeCodeTimeout?: number;
  $sawKeyPress?: boolean;
  isCompletionEnabled?: boolean;
  // Removed [key: symbol]: any; as it's not used on the iface object itself
}

/**
 * accepts a readable Stream instance and makes it emit "keypress" events
 */

function emitKeypressEvents(stream: Readable & { [key: symbol]: any }, iface: KeypressInterface = {}) {
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
        iface.$sawKeyPress = charLengthAt(string, 0) === string.length;
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

// Event symbols
// const kNodeJSFirstEventParam = SymbolFor("nodejs.kFirstEventParam"); // Removed due to TS1166

class Interface extends (EventEmitter as typeof IEventEmitter) implements ReadLine {
  // Public properties
  readonly terminal: boolean;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream | undefined;
  line: string = "";
  cursor: number = 0;
  history: string[];
  historySize: number;
  historyIndex: number = -1;
  removeHistoryDuplicates: boolean = false;
  crlfDelay: number;
  escapeCodeTimeout: number = ESCAPE_CODE_TIMEOUT;
  tabSize: number = 8;
  completer?:
    | ((line: string, callback: (err: null | Error, result?: [string[], string]) => void) => any)
    | ((line: string) => Promise<[string[], string] | undefined> | [string[], string] | undefined);

  // Internal properties
  $decoder?: IStringDecoder;
  $line_buffer?: string | null = null;
  $oldPrompt?: string;
  $previousKey?: Key | null;
  $prompt: string = "> ";
  $questionCallback?: ((answer: string) => void) | null = null;
  $sawKeyPress: boolean = false;
  $sawReturnAt: number = 0;
  $substringSearch: string | null = null;
  $undoStack: { text: string; cursor: number }[] = [];
  $redoStack: { text: string; cursor: number }[] = [];
  $killRing: string[] = [];
  $killRingCursor: number = 0;
  $yanking: boolean = false;
  $lineObjectStream?: AsyncIterableIterator<string>;
  prevRows: number = 0;
  paused: boolean = false;
  closed: boolean = false;
  isCompletionEnabled: boolean = true;

  // Symbol properties for event handling
  // declare [kNodeJSFirstEventParam]: any; // Removed due to TS1166

  constructor(
    options: ReadLineOptions | NodeJS.ReadableStream,
    output?: NodeJS.WritableStream,
    completer?: Function,
    terminal?: boolean,
  ) {
    super();

    var input: NodeJS.ReadableStream;
    var history: string[] | undefined;
    var historySize: number | undefined;
    var removeHistoryDuplicates: boolean | undefined = false;
    var crlfDelay: number | undefined;
    var prompt: string | undefined = "> ";
    var signal: AbortSignal | undefined;

    if (options && (options as ReadLineOptions).input) {
      const opts = options as ReadLineOptions;
      output = opts.output;
      completer = opts.completer;
      terminal = opts.terminal;
      history = opts.history;
      historySize = opts.historySize;
      signal = opts.signal;

      var tabSize = opts.tabSize;
      if (tabSize !== undefined) {
        validateUint32(tabSize, "tabSize", true);
        this.tabSize = tabSize;
      }
      removeHistoryDuplicates = !!opts.removeHistoryDuplicates;

      var inputPrompt = opts.prompt;
      if (inputPrompt !== undefined) {
        prompt = inputPrompt;
      }

      var inputEscapeCodeTimeout = opts.escapeCodeTimeout;
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

      crlfDelay = opts.crlfDelay;
      input = opts.input;
    } else {
      input = options as NodeJS.ReadableStream;
    }

    if (completer !== undefined) {
      if (typeof completer !== "function") {
        throw $ERR_INVALID_ARG_VALUE("completer", completer);
      }
      // Adapt async completer to callback completer if needed
      if (completer.length !== 2) {
        const realCompleter = completer;
        this.completer = (v, cb) => {
          try {
            const result = realCompleter(v);
            if (result && typeof (result as any).then === "function") {
              (result as Promise<any>).then(
                res => cb(null, res),
                err => cb(err),
              );
            } else {
              cb(null, result as [string[], string]);
            }
          } catch (err) {
            cb(err as Error);
          }
        };
      } else {
        this.completer = completer as any;
      }
    }

    if (history === undefined) {
      this.history = [];
    } else {
      validateArray(history, "history");
      this.history = history;
    }

    if (historySize === undefined) {
      this.historySize = kHistorySize;
    } else {
      validateNumber(historySize, "historySize", 0);
      this.historySize = historySize;
    }

    // Backwards compat; check the isTTY prop of the output stream
    //  when `terminal` was not specified
    if (terminal === undefined && !(output == null)) {
      terminal = !!(output as any).isTTY;
    }

    this.output = output as NodeJS.WritableStream | undefined;
    this.input = input as NodeJS.ReadableStream;
    this.removeHistoryDuplicates = !!removeHistoryDuplicates;
    this.crlfDelay = crlfDelay ? MathMax(kMincrlfDelay, crlfDelay) : kMincrlfDelay;

    this.setPrompt(prompt ?? "");
    this.terminal = !!terminal;

    input.on("error", this.#onError);

    if (!this.terminal) {
      this.$decoder = new StringDecoder("utf8");
      input.on("data", this.#onData);
      input.on("end", this.#onEnd);
      this.once("close", this.#onSelfCloseWithoutTerminal);
    } else {
      emitKeypressEvents(input as any, this); // Removed 'as KeypressInterface' cast

      // `input` usually refers to stdin
      input.on("keypress", this.#onKeyPress as (...args: any[]) => void);
      input.on("end", this.#onTermEnd);

      this.$setRawMode(true);

      if (output !== null && output !== undefined) output.on("resize", this.#onResize);

      this.once("close", this.#onSelfCloseWithTerminal);
    }

    if (signal) {
      var onAborted = (() => this.close()).bind(this);
      if (signal.aborted) {
        process.nextTick(onAborted);
      } else {
        signal.addEventListener("abort", onAborted, { once: true });
        this.once("close", () => signal!.removeEventListener("abort", onAborted));
      }
    }

    input.resume();
  }

  #onSelfCloseWithTerminal = () => {
    const input = this.input;
    const output = this.output;

    if (!input) throw new Error("Input not set, invalid state for readline!");

    input.removeListener("keypress", this.#onKeyPress as (...args: any[]) => void);
    input.removeListener("error", this.#onError);
    input.removeListener("end", this.#onTermEnd);
    if (output !== null && output !== undefined) {
      output.removeListener("resize", this.#onResize);
    }
    // Ensure raw mode is turned off.
    this.$setRawMode(false);
  };

  #onSelfCloseWithoutTerminal = () => {
    const input = this.input;
    if (!input) throw new Error("Input not set, invalid state for readline!");

    input.removeListener("data", this.#onData);
    input.removeListener("error", this.#onError);
    input.removeListener("end", this.#onEnd);
  };

  #onError = (err) => {
    this.emit("error", err);
  };

  #onData = (data) => {
    debug("onData");
    this.$normalWrite(data);
  };

  #onEnd = () => {
    debug("onEnd");
    if (typeof this.$line_buffer === "string" && (this.$line_buffer ?? "").length > 0) {
      this.emit("line", this.$line_buffer);
    }
    this.close();
  };

  #onTermEnd = () => {
    debug("onTermEnd");
    if (typeof this.line === "string" && this.line.length > 0) {
      this.emit("line", this.line);
    }
    this.close();
  };

  #onKeyPress = (s, key) => {
    this.$ttyWrite(s, key as Key);
    if (key && key.sequence) {
      // If the keySeq is half of a surrogate pair
      // (>= 0xd800 and <= 0xdfff), refresh the line so
      // the character is displayed appropriately.
      var ch = StringPrototypeCodePointAt.$call(key.sequence, 0)!;
      if (ch >= 0xd800 && ch <= 0xdfff) this.$refreshLine();
    }
  };

  #onResize = () => {
    this.$refreshLine();
  };

  get columns() {
    var output = this.output;
    if (output && (output as any).columns) return (output as any).columns;
    return Infinity;
  }

  /**
   * Sets the prompt written to the output.
   * @param {string} prompt
   * @returns {void}
   */
  setPrompt(prompt: string) {
    this.$prompt = prompt;
  }

  /**
   * Returns the current prompt used by `rl.prompt()`.
   * @returns {string}
   */
  getPrompt(): string {
    return this.$prompt;
  }

  $setRawMode(mode: boolean) {
    const wasInRawMode = (this.input as any).isRaw;

    var setRawMode = (this.input as any).setRawMode;
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
  prompt(preserveCursor?) {
    if (this.paused) this.resume();
    if (this.terminal && process.env.TERM !== "dumb") {
      if (!preserveCursor) this.cursor = 0;
      this.$refreshLine();
    } else {
      this.$writeToOutput(this.$prompt);
    }
  }

  $question(query, cb) {
    if (this.closed) {
      throw $ERR_USE_AFTER_CLOSE("readline");
    }
    if (this.$questionCallback) {
      this.prompt();
    } else {
      this.$oldPrompt = this.$prompt;
      this.setPrompt(query);
      this.$questionCallback = cb;
      this.prompt();
    }
  }

  $onLine(line) {
    const cb = this.$questionCallback;
    if (cb) {
      this.$questionCallback = null;
      this.setPrompt(this.$oldPrompt!);
      this.$oldPrompt = undefined; // Clear old prompt
      cb(line);
    } else {
      this.emit("line", line);
    }
  }

  $beforeEdit(oldText, oldCursor) {
    this.$pushToUndoStack(oldText, oldCursor);
  }

  $questionCancel() {
    if (this.$questionCallback) {
      this.$questionCallback = null;
      this.setPrompt(this.$oldPrompt!);
      this.$oldPrompt = undefined; // Clear old prompt
      if (this.output) {
        clearLine(this.output as Writable, 0);
      }
    }
  }

  $writeToOutput(stringToWrite: string | Buffer | Uint8Array) {
    if (this.output !== null && this.output !== undefined) {
      this.output.write(stringToWrite);
    }
  }

  $addHistory() {
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

  $refreshLine() {
    if (!this.output) return;
    // line length
    var line = this.$prompt + this.line;
    var dispPos = this.$getDisplayPos(line);
    var lineCols = dispPos.cols;
    var lineRows = dispPos.rows;

    // cursor position
    var cursorPos = this.getCursorPos();

    // First move to the bottom of the current line, based on cursor pos
    var prevRows = this.prevRows || 0;
    if (prevRows > 0) {
      moveCursor(this.output as Writable, 0, -prevRows);
    }

    // Cursor to left edge.
    cursorTo(this.output as Writable, 0);
    // erase data
    clearScreenDown(this.output as Writable);

    // Write the prompt and the current buffer content.
    this.$writeToOutput(line);

    // Force terminal to allocate a new line
    if (lineCols === 0) {
      this.$writeToOutput(" ");
    }

    // Move cursor to original position.
    cursorTo(this.output as Writable, cursorPos.cols);

    var diff = lineRows - cursorPos.rows;
    if (diff > 0) {
      moveCursor(this.output as Writable, 0, -diff);
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
      this.$setRawMode(false);
    }
    this.closed = true;
    this.emit("close");
  }

  /**
   * Pauses the `input` stream.
   * @returns {void | Interface}
   */
  pause() {
    if (this.paused) return this;
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
    if (!this.paused) return this;
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
  write(d, key?) {
    if (this.paused) this.resume();
    if (this.terminal) {
      this.$ttyWrite(d, key as Key);
    } else {
      this.$normalWrite(d);
    }
  }

  $normalWrite(b) {
    if (b === undefined) {
      return;
    }
    const decoder = this.$decoder;
    if (!decoder) return;

    var string = decoder.write(b);
    if (this.$sawReturnAt && DateNow() - (this.$sawReturnAt ?? 0) <= this.crlfDelay) {
      if (StringPrototypeCodePointAt.$call(string, 0) === 10) string = StringPrototypeSlice.$call(string, 1);
      this.$sawReturnAt = 0;
    }

    // Run test() on the new string chunk, not on the entire line buffer.
    var newPartContainsEnding = RegExpPrototypeExec.$call(lineEnding, string);
    if (newPartContainsEnding !== null) {
      if (this.$line_buffer) {
        string = this.$line_buffer + string;
        this.$line_buffer = null;
        lineEnding.lastIndex = 0; // Start the search from the beginning of the string.
        newPartContainsEnding = RegExpPrototypeExec.$call(lineEnding, string);
      }
      this.$sawReturnAt = StringPrototypeEndsWith.$call(string, "\r") ? DateNow() : 0;

      var indexes = [0, newPartContainsEnding!.index, lineEnding.lastIndex];
      var nextMatch;
      while ((nextMatch = RegExpPrototypeExec.$call(lineEnding, string)) !== null) {
        ArrayPrototypePush.$call(indexes, nextMatch.index, lineEnding.lastIndex);
      }
      var lastIndex = indexes.length - 1;
      // Either '' or (conceivably) the unfinished portion of the next line
      this.$line_buffer = StringPrototypeSlice.$call(string, indexes[lastIndex]);
      for (var i = 1; i < lastIndex; i += 2) {
        this.$onLine(StringPrototypeSlice.$call(string, indexes[i - 1], indexes[i]));
      }
    } else if (string) {
      // No newlines this time, save what we have for next time
      if (this.$line_buffer) {
        this.$line_buffer += string;
      } else {
        this.$line_buffer = string;
      }
    }
  }

  $insertString(c) {
    this.$beforeEdit(this.line, this.cursor);
    if (this.cursor < this.line.length) {
      var beg = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var end = StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
      this.line = beg + c + end;
      this.cursor += c.length;
      this.$refreshLine();
    } else {
      var oldPos = this.getCursorPos();
      this.line += c;
      this.cursor += c.length;
      var newPos = this.getCursorPos();

      if (oldPos.rows < newPos.rows) {
        this.$refreshLine();
      } else {
        this.$writeToOutput(c);
      }
    }
  }

  async $tabComplete(lastKeypressWasTab) {
    if (typeof this.completer !== "function") return;
    this.pause();
    var string = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    var value;
    try {
      // Ensure completer is callable before invoking
      if (typeof this.completer === "function") {
        value = await new Promise((resolve, reject) => {
          // The completer might be sync or async, handle both
          const cb = (err, result) => {
            if (err) reject(err);
            else resolve(result);
          };
          // Use non-null assertion as we've checked the type
          const potentialPromise = this.completer!(string, cb);
          // Handle completers that return a promise directly (async completer signature)
          if (potentialPromise && typeof (potentialPromise as any).then === "function") {
            (potentialPromise as Promise<any>).then(
              res => cb(null, res),
              err => cb(err, undefined), // Pass undefined for result on error
            );
          }
          // Otherwise, assume it used the callback (sync completer signature)
        });
      } else {
        // Should not happen due to the initial check, but satisfies TS
        throw new Error("Completer is not a function");
      }
    } catch (err) {
      this.$writeToOutput(`Tab completion error: ${inspect(err)}`);
      return;
    } finally {
      this.resume();
    }
    this.$tabCompleter(lastKeypressWasTab, value as [string[], string]);
  }

  $tabCompleter(lastKeypressWasTab, completionsResult) {
    if (!completionsResult) return;
    const [completions, completeOn] = completionsResult;

    if (!completions || completions.length === 0) {
      return;
    }

    // If there is a common prefix to all matches, then apply that portion.
    var prefix = commonPrefix(ArrayPrototypeFilter.$call(completions, e => e !== ""));
    if (StringPrototypeStartsWith.$call(prefix, completeOn) && prefix.length > completeOn.length) {
      this.$insertString(StringPrototypeSlice.$call(prefix, completeOn.length));
      return;
    } else if (!StringPrototypeStartsWith.$call(completeOn, prefix)) {
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor - completeOn.length) +
        prefix +
        StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this.$refreshLine();
      return;
    }

    if (!lastKeypressWasTab) {
      return;
    }

    this.$beforeEdit(this.line, this.cursor);

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
    this.$writeToOutput(output);
    this.$refreshLine();
  }

  $wordLeft() {
    if (this.cursor > 0) {
      // Reverse the string and match a word near beginning
      // to avoid quadratic time complexity
      var leading = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.$call(ArrayFrom(leading), "");
      var match = RegExpPrototypeExec.$call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      this.$moveCursor(-(match?.[0]?.length ?? 0));
    }
  }

  $wordRight() {
    if (this.cursor < this.line.length) {
      var trailing = StringPrototypeSlice.$call(this.line, this.cursor);
      var match = RegExpPrototypeExec.$call(/^(?:\s+|[^\w\s]+|\w+)\s*/, trailing);
      this.$moveCursor(match?.[0]?.length ?? 0);
    }
  }

  $deleteLeft() {
    if (this.cursor > 0 && this.line.length > 0) {
      this.$beforeEdit(this.line, this.cursor);
      // The number of UTF-16 units comprising the character to the left
      var charSize = charLengthLeft(this.line, this.cursor);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor - charSize) +
        StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);

      this.cursor -= charSize;
      this.$refreshLine();
    }
  }

  $deleteRight() {
    if (this.cursor < this.line.length) {
      this.$beforeEdit(this.line, this.cursor);
      // The number of UTF-16 units comprising the character to the left
      var charSize = charLengthAt(this.line, this.cursor);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor) + StringPrototypeSlice.$call(this.line, this.cursor + charSize, this.line.length);
      this.$refreshLine();
    }
  }

  $deleteWordLeft() {
    if (this.cursor > 0) {
      this.$beforeEdit(this.line, this.cursor);
      // Reverse the string and match a word near beginning
      // to avoid quadratic time complexity
      var leading = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin.$call(ArrayFrom(leading), "");
      var match = RegExpPrototypeExec.$call(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      leading = StringPrototypeSlice.$call(leading, 0, leading.length - (match?.[0]?.length ?? 0));
      this.line = leading + StringPrototypeSlice.$call(this.line, this.cursor, this.line.length);
      this.cursor = leading.length;
      this.$refreshLine();
    }
  }

  $deleteWordRight() {
    if (this.cursor < this.line.length) {
      this.$beforeEdit(this.line, this.cursor);
      var trailing = StringPrototypeSlice.$call(this.line, this.cursor);
      var match = RegExpPrototypeExec.$call(/^(?:\s+|\W+|\w+)\s*/, trailing);
      this.line =
        StringPrototypeSlice.$call(this.line, 0, this.cursor) + StringPrototypeSlice.$call(trailing, match?.[0]?.length ?? 0);
      this.$refreshLine();
    }
  }

  $deleteLineLeft() {
    this.$beforeEdit(this.line, this.cursor);
    var del = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    this.line = StringPrototypeSlice.$call(this.line, this.cursor);
    this.cursor = 0;
    this.$pushToKillRing(del);
    this.$refreshLine();
  }

  $deleteLineRight() {
    this.$beforeEdit(this.line, this.cursor);
    var del = StringPrototypeSlice.$call(this.line, this.cursor);
    this.line = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    this.$pushToKillRing(del);
    this.$refreshLine();
  }

  $pushToKillRing(del) {
    if (!del || del === this.$killRing[0]) return;
    ArrayPrototypeUnshift.$call(this.$killRing, del);
    this.$killRingCursor = 0;
    while (this.$killRing.length > kMaxLengthOfKillRing) ArrayPrototypePop.$call(this.$killRing);
  }

  $yank() {
    if (this.$killRing.length > 0) {
      this.$yanking = true;
      const cursor = this.$killRingCursor;
      if (cursor >= 0 && cursor < this.$killRing.length) {
        const yankedString = this.$killRing[cursor];
        if (yankedString !== undefined) {
          this.$insertString(yankedString);
        }
      }
    }
  }

  $yankPop() {
    if (!this.$yanking) {
      return;
    }
    if (this.$killRing.length > 1) {
      var lastYank = this.$killRing[this.$killRingCursor];
      this.$killRingCursor++;
      if (this.$killRingCursor >= this.$killRing.length) {
        this.$killRingCursor = 0;
      }
      var currentYank = this.$killRing[this.$killRingCursor];
      if (typeof lastYank === "string" && typeof currentYank === "string") {
        var head = StringPrototypeSlice.$call(this.line, 0, this.cursor - lastYank.length);
        var tail = StringPrototypeSlice.$call(this.line, this.cursor);
        this.line = head + currentYank + tail;
        this.cursor = head.length + currentYank.length;
        this.$refreshLine();
      }
    }
  }

  clearLine() {
    this.$moveCursor(+Infinity);
    this.$writeToOutput("\r\n");
    this.line = "";
    this.cursor = 0;
    this.prevRows = 0;
  }

  $line() {
    var line = this.$addHistory();
    this.$undoStack = [];
    this.$redoStack = [];
    this.clearLine();
    this.$onLine(line);
  }

  $pushToUndoStack(text, cursor) {
    if (ArrayPrototypePush.$call(this.$undoStack, { text, cursor }) > kMaxUndoRedoStackSize) {
      ArrayPrototypeShift.$call(this.$undoStack);
    }
  }

  $undo() {
    if (this.$undoStack.length <= 0) return;

    ArrayPrototypePush.$call(this.$redoStack, {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop.$call(this.$undoStack);
    this.line = entry!.text;
    this.cursor = entry!.cursor;

    this.$refreshLine();
  }

  $redo() {
    if (this.$redoStack.length <= 0) return;

    ArrayPrototypePush.$call(this.$undoStack, {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop.$call(this.$redoStack);
    this.line = entry!.text;
    this.cursor = entry!.cursor;

    this.$refreshLine();
  }

  $historyNext() {
    if (this.historyIndex >= 0) {
      this.$beforeEdit(this.line, this.cursor);
      var search = this.$substringSearch || "";
      var index = this.historyIndex - 1;
      while (
        index >= 0 &&
        (!StringPrototypeStartsWith.$call(this.history[index as number], search) || this.line === this.history[index as number])
      ) {
        index--;
      }
      if (index === -1) {
        this.line = search;
      } else {
        const historyEntry = this.history[index as number];
        if (historyEntry !== undefined) {
          this.line = historyEntry;
        }
      }
      this.historyIndex = index;
      this.cursor = this.line.length; // Set cursor to end of line.
      this.$refreshLine();
    }
  }

  $historyPrev() {
    if (this.historyIndex < this.history.length && this.history.length) {
      this.$beforeEdit(this.line, this.cursor);
      var search = this.$substringSearch || "";
      var index = this.historyIndex + 1;
      while (
        index < this.history.length &&
        (!StringPrototypeStartsWith.$call(this.history[index as number], search) || this.line === this.history[index as number])
      ) {
        index++;
      }
      if (index === this.history.length) {
        this.line = search;
      } else {
        const historyEntry = this.history[index as number];
        if (historyEntry !== undefined) {
          this.line = historyEntry;
        }
      }
      this.historyIndex = index;
      this.cursor = this.line.length; // Set cursor to end of line.
      this.$refreshLine();
    }
  }

  // Returns the last character's display position of the given string
  $getDisplayPos(str) {
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
    var strBeforeCursor = this.$prompt + StringPrototypeSlice.$call(this.line, 0, this.cursor);
    return this.$getDisplayPos(strBeforeCursor);
  }

  // This function moves cursor dx places to the right
  // (-dx for left) and refreshes the line if it is needed.
  $moveCursor(dx) {
    if (dx === 0 || !this.output) {
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
      moveCursor(this.output as Writable, diffWidth, 0);
    } else {
      this.$refreshLine();
    }
  }

  // Handle a write from the tty
  $ttyWrite(s, key: Key) {
    var previousKey = this.$previousKey;
    key = key || kEmptyObject;
    this.$previousKey = key;
    const { name: keyName, meta: keyMeta, ctrl: keyCtrl, shift: keyShift, sequence: keySeq } = key;

    if (!keyMeta || keyName !== "y") {
      // Reset yanking state unless we are doing yank pop.
      this.$yanking = false;
    }

    // Activate or deactivate substring search.
    if ((keyName === "up" || keyName === "down") && !keyCtrl && !keyMeta && !keyShift) {
      if (this.$substringSearch === null) {
        this.$substringSearch = StringPrototypeSlice.$call(this.line, 0, this.cursor);
      }
    } else if (this.$substringSearch !== null) {
      this.$substringSearch = null;
      // Reset the index in case there's no match.
      if (this.history.length === this.historyIndex) {
        this.historyIndex = -1;
      }
    }

    // Undo & Redo
    if (typeof keySeq === "string") {
      switch (StringPrototypeCodePointAt.$call(keySeq, 0)) {
        case 0x1f:
          this.$undo();
          return;
        case 0x1e:
          this.$redo();
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
          this.$deleteLineLeft();
          break;

        case "delete":
          this.$deleteLineRight();
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
          this.$deleteLeft();
          break;

        case "d": // delete right or EOF
          if (this.cursor === 0 && this.line.length === 0) {
            // This readline instance is finished
            this.close();
          } else if (this.cursor < this.line.length) {
            this.$deleteRight();
          }
          break;

        case "u": // Delete from current to start of line
          this.$deleteLineLeft();
          break;

        case "k": // Delete from current to end of line
          this.$deleteLineRight();
          break;

        case "a": // Go to the start of the line
          this.$moveCursor(-Infinity);
          break;

        case "e": // Go to the end of the line
          this.$moveCursor(+Infinity);
          break;

        case "b": // back one character
          this.$moveCursor(-charLengthLeft(this.line, this.cursor));
          break;

        case "f": // Forward one character
          this.$moveCursor(+charLengthAt(this.line, this.cursor));
          break;

        case "l": // Clear the whole screen
          if (this.output) {
            cursorTo(this.output as Writable, 0, 0);
            clearScreenDown(this.output as Writable);
          }
          this.$refreshLine();
          break;

        case "n": // next history item
          this.$historyNext();
          break;

        case "p": // Previous history item
          this.$historyPrev();
          break;

        case "y": // Yank killed string
          this.$yank();
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
              this.$setRawMode(true);
              this.$refreshLine();
            });
            this.$setRawMode(false);
            process.kill(process.pid, "SIGTSTP");
          }
          break;

        case "w": // Delete backwards to a word boundary
        // falls through
        case "backspace":
          this.$deleteWordLeft();
          break;

        case "delete": // Delete forward to a word boundary
          this.$deleteWordRight();
          break;

        case "left":
          this.$wordLeft();
          break;

        case "right":
          this.$wordRight();
          break;
      }
    } else if (keyMeta) {
      /* Meta key pressed */

      switch (keyName) {
        case "b": // backward word
          this.$wordLeft();
          break;

        case "f": // forward word
          this.$wordRight();
          break;

        case "d": // delete forward word
        // falls through
        case "delete":
          this.$deleteWordRight();
          break;

        case "backspace": // Delete backwards to a word boundary
          this.$deleteWordLeft();
          break;

        case "y": // Doing yank pop
          this.$yankPop();
          break;
      }
    } else {
      /* No modifier keys used */

      // \r bookkeeping is only relevant if a \n comes right after.
      if (this.$sawReturnAt && keyName !== "enter") this.$sawReturnAt = 0;

      switch (keyName) {
        case "return": // Carriage return, i.e. \r
          this.$sawReturnAt = DateNow();
          this.$line();
          break;

        case "enter":
          // When key interval > crlfDelay
          if (this.$sawReturnAt === 0 || DateNow() - (this.$sawReturnAt ?? 0) > this.crlfDelay) {
            this.$line();
          }
          this.$sawReturnAt = 0;
          break;

        case "backspace":
          this.$deleteLeft();
          break;

        case "delete":
          this.$deleteRight();
          break;

        case "left":
          // Obtain the code point to the left
          this.$moveCursor(-charLengthLeft(this.line, this.cursor));
          break;

        case "right":
          this.$moveCursor(+charLengthAt(this.line, this.cursor));
          break;

        case "home":
          this.$moveCursor(-Infinity);
          break;

        case "end":
          this.$moveCursor(+Infinity);
          break;

        case "up":
          this.$historyPrev();
          break;

        case "down":
          this.$historyNext();
          break;

        case "tab":
          // If tab completion enabled, do that...
          if (typeof this.completer === "function" && this.isCompletionEnabled) {
            var lastKeypressWasTab = previousKey && previousKey.name === "tab";
            this.$tabComplete(lastKeypressWasTab);
            break; // Don't fall through if completion is enabled
          }
          // falls through if completion is disabled
          // eslint-disable-next-line no-fallthrough
          // Fallthrough case - fixed by adding break
          break; // Added break to fix fallthrough error TS7029

        default:
          if (typeof s === "string" && s) {
            // Erase state of previous searches.
            lineEnding.lastIndex = 0;
            let nextMatch;
            // Keep track of the end of the last match.
            let lastIndex = 0;
            while ((nextMatch = RegExpPrototypeExec.$call(lineEnding, s)) !== null) {
              this.$insertString(StringPrototypeSlice.$call(s, lastIndex, nextMatch.index));
              ({ lastIndex } = lineEnding);
              this.$line();
              // Restore lastIndex as the call to kLine could have mutated it.
              lineEnding.lastIndex = lastIndex;
            }
            // This ensures that the last line is written if it doesn't end in a newline.
            // Note that the last line may be the first line, in which case this still works.
            this.$insertString(StringPrototypeSlice.$call(s, lastIndex));
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
  [Symbol.asyncIterator](): NodeJS.AsyncIterator<string, any, any> {
    if (this.$lineObjectStream === undefined) {
      this.$lineObjectStream = EventEmitter.on(this as any, "line", {
        close: ["close"],
        highWaterMark: 1024,
        [SymbolFor("nodejs.kFirstEventParam")]: true,
      }) as AsyncIterableIterator<string>;
    }
    // Cast to satisfy the interface, acknowledging potential runtime differences
    return this.$lineObjectStream! as NodeJS.AsyncIterator<string, any, any>;
  }

  /**
   * Displays `query` by writing it to the `output`.
   * @param {string} query
   * @param {{ signal?: AbortSignal; }} [options]
   * @param {Function} cb
   * @returns {void}
   */
  question(query, options, cb?) {
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
        this.$questionCancel();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      var cleanup = () => {
        signal!.removeEventListener("abort", onAbort);
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
      this.$question(query, cb);
    }
  }

  // Make internal methods public for backward compatibility.
  _setRawMode = this.$setRawMode;
  _onLine = this.$onLine;
  _writeToOutput = this.$writeToOutput;
  _addHistory = this.$addHistory;
  _refreshLine = this.$refreshLine;
  _normalWrite = this.$normalWrite;
  _insertString = this.$insertString;
  _tabComplete = lastKeypressWasTab => {
    // Overriding parent method because `this.completer` in the legacy
    // implementation takes a callback instead of being an async function.
    if (typeof this.completer !== "function") return;
    this.pause();
    var string = StringPrototypeSlice.$call(this.line, 0, this.cursor);
    this.completer(string, (err, value) => {
      this.resume();

      if (err) {
        this._writeToOutput(`Tab completion error: ${inspect(err)}`);
        return;
      }

      this.$tabCompleter(lastKeypressWasTab, value!);
    });
  };
  _wordLeft = this.$wordLeft;
  _wordRight = this.$wordRight;
  _deleteLeft = this.$deleteLeft;
  _deleteRight = this.$deleteRight;
  _deleteWordLeft = this.$deleteWordLeft;
  _deleteWordRight = this.$deleteWordRight;
  _deleteLineLeft = this.$deleteLineLeft;
  _deleteLineRight = this.$deleteLineRight;
  _line = this.$line;
  _historyNext = this.$historyNext;
  _historyPrev = this.$historyPrev;
  _getDisplayPos = this.$getDisplayPos;
  _getCursorPos = this.getCursorPos;
  _moveCursor = this.$moveCursor;
  _ttyWrite = this.$ttyWrite;
}

const questionPromise = promisify(Interface.prototype.question);
(questionPromise as any)[inspect.custom] = function questionCustom(depth, options) {
  // This is a placeholder implementation for the custom inspect function.
  // Node's implementation returns a Promise, but the signature here is for sync inspect.
  // We'll return a string indicating it's a promisified function.
  return `[Function: question] ${this.name || ""}`.trim();
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
function createInterface(input, output?, completer?, terminal?) {
  return new Interface(input, output, completer, terminal);
}

function _ttyWriteDumb(this: Interface, s, key) {
  key = key || kEmptyObject;

  if ((key as Key).name === "escape") return;

  if (this.$sawReturnAt && (key as Key).name !== "enter") this.$sawReturnAt = 0;

  if ((key as Key).ctrl) {
    if ((key as Key).name === "c") {
      if (this.listenerCount("SIGINT") > 0) {
        this.emit("SIGINT");
      } else {
        // This readline instance is finished
        this.close();
      }

      return;
    } else if ((key as Key).name === "d") {
      this.close();
      return;
    }
  }

  switch ((key as Key).name) {
    case "return": // Carriage return, i.e. \r
      this.$sawReturnAt = DateNow();
      (this as any)._line();
      break;

    case "enter":
      // When key interval > crlfDelay
      if (this.$sawReturnAt === 0 || DateNow() - (this.$sawReturnAt ?? 0) > this.crlfDelay) {
        (this as any)._line();
      }
      this.$sawReturnAt = 0;
      break;

    default:
      if (typeof s === "string" && s) {
        this.line += s;
        this.cursor += s.length;
        (this as any)._writeToOutput(s);
      }
  }
}

// TODO: Test this
if (process.env.TERM === "dumb") {
  Interface.prototype._ttyWrite = _ttyWriteDumb;
}

class PromisesReadline {
  #autoCommit = false;
  #stream: Writable;
  #todo: string[] = [];

  constructor(stream: Writable, options: { autoCommit?: boolean } | undefined = undefined) {
    if (!(stream instanceof StreamWritable)) throw $ERR_INVALID_ARG_TYPE("stream", "Writable", stream);
    this.#stream = stream;
    if (options?.autoCommit != null) {
      validateBoolean(!!options.autoCommit, "options.autoCommit");
      this.#autoCommit = !!options.autoCommit;
    }
  }

  /**
   * Moves the cursor to the x and y coordinate on the given stream.
   * @param {integer} x
   * @param {integer} [y]
   * @returns {Readline} this
   */
  cursorTo(x: number, y: number | undefined = undefined) {
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
  moveCursor(dx: number, dy: number) {
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
  clearLine(dir: number) {
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
    const { resolve, reject, promise } = $newPromiseCapability(Promise);

    try {
      const data = ArrayPrototypeJoin.$call(this.#todo, "");
      // Add a no-op callback to satisfy the write method signature
      this.#stream.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
      this.#todo = [];
    } catch (err) {
      reject(err);
    }
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

class PromisesInterface extends Interface {
  // eslint-disable-next-line no-useless-constructor
  constructor(input, output?, completer?, terminal?) {
    super(input, output, completer, terminal);
  }
  question(query, options: { signal?: AbortSignal } = kEmptyObject) {
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
        this.$questionCancel();
        reject($makeAbortError(undefined, { cause: signal!.reason }));
      };
      signal!.addEventListener("abort", onAbort, { once: true });
      cb = answer => {
        signal!.removeEventListener("abort", onAbort);
        resolve(answer);
      };
    }
    this.$question(query, cb);
    return promise;
  }
}

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
    Readline: PromisesReadline,
    Interface: PromisesInterface,
    createInterface(input, output?, completer?, terminal?) {
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
} as unknown as typeof import("node:readline"); // dear agent: mandatory, DO NOT DELETE;