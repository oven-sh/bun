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

var { Array, RegExp, String, Symbol, Number } = import.meta.primordials;
var EventEmitter = import.meta.require("node:events");
var { clearTimeout, setTimeout } = import.meta.require("timers");
var { StringDecoder } = import.meta.require("string_decoder");

// ----------------------------------------------------------------------------
// Section: Preamble
// ----------------------------------------------------------------------------

// Extended primordials

var ArrayFrom = Array.from;
var ArrayPrototypeFilter = Array.prototype.filter.call;
var ArrayPrototypeSort = Array.prototype.sort.call;
var ArrayPrototypeIndexOf = Array.prototype.indexOf.call;
var ArrayPrototypeJoin = Array.prototype.join.call;
var ArrayPrototypeMap = Array.prototype.map.call;
var ArrayPrototypePop = Array.prototype.pop.call;
var ArrayPrototypePush = Array.prototype.push.call;
var ArrayPrototypeSlice = Array.prototype.slice.call;
var ArrayPrototypeSplice = Array.prototype.splice.call;
var ArrayPrototypeReverse = Array.prototype.reverse.call;
var ArrayPrototypeShift = Array.prototype.shift.call;
var ArrayPrototypeUnshift = Array.prototype.unshift.call;
var RegExpPrototypeExec = RegExp.prototype.exec.call;
var StringFromCharCode = String.fromCharCode;
var StringPrototypeCharCodeAt = String.prototype.charCodeAt.call;
var StringPrototypeCodePointAt = String.prototype.codePointAt.call;
var StringPrototypeSlice = String.prototype.slice.call;
var StringPrototypeToLowerCase = String.prototype.toLowerCase.call;
var StringPrototypeEndsWith = String.prototype.endsWith.call;
var StringPrototypeRepeat = String.prototype.repeat.call;
var StringPrototypeStartsWith = String.prototype.startsWith.call;
var StringPrototypeTrim = String.prototype.trim.call;
var NumberIsNaN = Number.isNaN;
var NumberIsFinite = Number.isFinite;
var MaxCeil = Math.ceil;
var MaxFloor = Math.floor;
var MathMax = Math.max;
var MathMaxApply = Math.max.apply;
var DateNow = Date.now;
var FunctionPrototypeCall = Function.prototype.call;
var SymbolAsyncIterator = Symbol.asyncIterator;
var SymbolIterator = Symbol.iterator;
var StringPrototypeSymbolIterator = String.prototype[SymbolIterator];
var StringIteratorPrototypeNext = StringPrototypeSymbolIterator.prototype.next;
var ObjectSetPrototypeOf = Object.setPrototypeOf;
var ObjectFreeze = Object.freeze;

var createSafeIterator = (factory, next) => {
  class SafeIterator {
    #iterator;
    constructor(iterable) {
      this.#iterator = factory(iterable);
    }
    next() {
      return next(this.#iterator);
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

var SafeStringIterator = createSafeIterator(
  StringPrototypeSymbolIterator,
  StringIteratorPrototypeNext,
);

// TODO
// var {
//   inspect,
//   getStringWidth,
//   stripVTControlCharacters,
// } = require('internal/util/inspect');

// Constants

var kUTF16SurrogateThreshold = 0x10000; // 2 ** 16
var kEscape = "\x1b";
var kSubstringSearch = Symbol("kSubstringSearch");

// Errors

function ERR_INVALID_ARG_TYPE(name, type, value) {
  var err = new TypeError(
    `The "${name}" argument must be of type ${type}. Received ${value}`,
  );
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  return new TypeError(
    `The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`,
  );
}

function ERR_INVALID_CURSOR_POS() {
  return new TypeError("Cannot set cursor row without setting its column");
}

// TODO
// ERR_USE_AFTER_CLOSE,

// Validators

// TODO
// validateAbortSignal,
// validateArray,
// validateString,
// validateUint32,

function validateFunction(value, name) {
  if (typeof value !== "function")
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
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

// TODO(BridgeAR): Treat combined characters as single character, i.e,
// 'a\u0301' and '\u0301a' (both have the same visual output).
// Check Canonical_Combining_Class in
// http://userguide.icu-project.org/strings/properties
function charLengthLeft(str, i) {
  if (i <= 0) return 0;
  if (
    (i > 1 &&
      StringPrototypeCodePointAt(str, i - 2) >= kUTF16SurrogateThreshold) ||
    StringPrototypeCodePointAt(str, i - 1) >= kUTF16SurrogateThreshold
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
  return StringPrototypeCodePointAt(str, i) >= kUTF16SurrogateThreshold ? 2 : 1;
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
    var ch = yield;
    var s = ch;
    var escaped = false;

    var ketSeq = null;
    var keyName;
    var keyCtrl,
      keyMeta,
      keyShift = false;

    // var key = {
    //   sequence: null,
    //   name: undefined,
    //   ctrl: false,
    //   meta: false,
    //   shift: false,
    // };

    if (ch === kEscape) {
      escaped = true;
      s += ch = yield;

      if (ch === kEscape) {
        s += ch = yield;
      }
    }

    if (escaped && (ch === "O" || ch === "[")) {
      // ANSI escape sequence
      var code = ch;
      var modifier = 0;

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
         *
         * So the generic regexp is like /^\d\d?(;\d)?[~^$]$/
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
        var cmdStart = s.length - 1;

        // Skip one or two leading digits
        if (ch >= "0" && ch <= "9") {
          s += ch = yield;

          if (ch >= "0" && ch <= "9") {
            s += ch = yield;
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
        var cmd = StringPrototypeSlice(s, cmdStart);
        var match;

        if ((match = RegExpPrototypeExec(/^(\d\d?)(;(\d))?([~^$])$/, cmd))) {
          code += match[1] + match[4];
          modifier = (match[3] || 1) - 1;
        } else if (
          (match = RegExpPrototypeExec(/^((\d;)?(\d))?([A-Za-z])$/, cmd))
        ) {
          code += match[4];
          modifier = (match[3] || 1) - 1;
        } else {
          code += cmd;
        }
      }

      // Parse the key modifier
      keyCtrl = !!(modifier & 4);
      key.meta = !!(modifier & 10);
      key.shift = !!(modifier & 1);
      key.code = code;

      // Parse the key itself
      switch (code) {
        /* xterm/gnome ESC [ letter (with modifier) */
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

        /* xterm/gnome ESC O letter (without modifier) */
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

        /* xterm/rxvt ESC [ number ~ */
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

        /* from Cygwin and used in libuv */
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

        /* common */
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

        /* xterm ESC [ letter */
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

        /* xterm/gnome ESC O letter */
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

        /* xterm/rxvt ESC [ number ~ */
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

        /* putty */
        case "[[5~":
          keyName = "pageup";
          break;
        case "[[6~":
          keyName = "pagedown";
          break;

        /* rxvt */
        case "[7~":
          keyName = "home";
          break;
        case "[8~":
          keyName = "end";
          break;

        /* rxvt keys with modifiers */
        case "[a":
          keyName = "up";
          key.shift = true;
          break;
        case "[b":
          keyName = "down";
          key.shift = true;
          break;
        case "[c":
          keyName = "right";
          key.shift = true;
          break;
        case "[d":
          keyName = "left";
          key.shift = true;
          break;
        case "[e":
          keyName = "clear";
          key.shift = true;
          break;

        case "[2$":
          keyName = "insert";
          key.shift = true;
          break;
        case "[3$":
          keyName = "delete";
          key.shift = true;
          break;
        case "[5$":
          keyName = "pageup";
          key.shift = true;
          break;
        case "[6$":
          keyName = "pagedown";
          key.shift = true;
          break;
        case "[7$":
          keyName = "home";
          key.shift = true;
          break;
        case "[8$":
          keyName = "end";
          key.shift = true;
          break;

        case "Oa":
          keyName = "up";
          keyCtrl = true;
          break;
        case "Ob":
          keyName = "down";
          keyCtrl = true;
          break;
        case "Oc":
          keyName = "right";
          keyCtrl = true;
          break;
        case "Od":
          keyName = "left";
          keyCtrl = true;
          break;
        case "Oe":
          keyName = "clear";
          keyCtrl = true;
          break;

        case "[2^":
          keyName = "insert";
          keyCtrl = true;
          break;
        case "[3^":
          keyName = "delete";
          keyCtrl = true;
          break;
        case "[5^":
          keyName = "pageup";
          keyCtrl = true;
          break;
        case "[6^":
          keyName = "pagedown";
          keyCtrl = true;
          break;
        case "[7^":
          keyName = "home";
          keyCtrl = true;
          break;
        case "[8^":
          keyName = "end";
          keyCtrl = true;
          break;

        /* misc. */
        case "[Z":
          keyName = "tab";
          key.shift = true;
          break;
        default:
          keyName = "undefined";
          break;
      }
    } else if (ch === "\r") {
      // carriage return
      keyName = "return";
      key.meta = escaped;
    } else if (ch === "\n") {
      // Enter, should have been called linefeed
      keyName = "enter";
      key.meta = escaped;
    } else if (ch === "\t") {
      // tab
      keyName = "tab";
      key.meta = escaped;
    } else if (ch === "\b" || ch === "\x7f") {
      // backspace or ctrl+h
      keyName = "backspace";
      key.meta = escaped;
    } else if (ch === kEscape) {
      // escape key
      keyName = "escape";
      key.meta = escaped;
    } else if (ch === " ") {
      keyName = "space";
      key.meta = escaped;
    } else if (!escaped && ch <= "\x1a") {
      // ctrl+letter
      keyName = StringFromCharCode(
        StringPrototypeCharCodeAt(ch) + StringPrototypeCharCodeAt("a") - 1,
      );
      keyCtrl = true;
    } else if (RegExpPrototypeExec(/^[0-9A-Za-z]$/, ch) !== null) {
      // Letter, number, shift+letter
      keyName = StringPrototypeToLowerCase(ch);
      key.shift = RegExpPrototypeExec(/^[A-Z]$/, ch) !== null;
      key.meta = escaped;
    } else if (escaped) {
      // Escape sequence timeout
      keyName = ch.length ? undefined : "escape";
      key.meta = true;
    }

    key.sequence = s;

    if (s.length !== 0 && (keyName !== undefined || escaped)) {
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
  var sorted = ArrayPrototypeSort(ArrayPrototypeSlice(strings));
  var min = sorted[0];
  var max = sorted[sorted.length - 1];
  for (var i = 0; i < min.length; i++) {
    if (min[i] !== max[i]) {
      return StringPrototypeSlice(min, 0, i);
    }
  }
  return min;
}

// ----------------------------------------------------------------------------
// Section: Callbacks
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

  if (NumberIsNaN(x)) throw new ERR_INVALID_ARG_VALUE("x", x);
  if (NumberIsNaN(y)) throw new ERR_INVALID_ARG_VALUE("y", y);

  if (stream == null || (typeof x !== "number" && typeof y !== "number")) {
    if (typeof callback === "function") process.nextTick(callback, null);
    return true;
  }

  if (typeof x !== "number") throw new ERR_INVALID_CURSOR_POS();

  var data = typeof y !== "number" ? CSI`${x + 1}G` : CSI`${y + 1};${x + 1}H`;
  return stream.write(data, callback);
}

/**
 * moves the cursor relative to its current location
 */

function moveCursor(stream, dx, dy, callback) {
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

  var type =
    dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
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

var emitKeypressEvents;
var kFirstEventParam;
var kEmptyObject = ObjectFreeze({});

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
var kFirstEventParam = Symbol("nodejs.kFirstEventParam");

// TODO: Get base case working for createInterface (or whatever it is)
// TODO: Refactor pass - destructure all vars which can be destructured
// TODO: Cleanup pass - make sure all the used vars are defined on constructor

class InterfaceConstructor extends EventEmitter {
  #onSelfCloseWithTerminal;
  #onSelfCloseWithoutTerminal;

  #onError;
  #onData;
  #onEnd;
  #onTermEnd;
  #onKeyPress;
  #onResize;

  [kSawReturnAt];
  isCompletionEnabled = true;
  [kSawKeyPress];
  [kPreviousKey];
  escapeCodeTimeout;
  tabSize;

  line;
  [kSubstringSearch];
  output;
  input;
  [kUndoStack];
  [kRedoStack];
  history;
  historySize;

  [kKillRing];
  [kKillRingCursor];

  removeHistoryDuplicates;
  crlfDelay;
  completer;

  terminal;
  [kLineObjectStream];

  cursor;
  historyIndex;

  constructor(input, output, completer, terminal) {
    super();

    this.#onSelfCloseWithTerminal = this.#onSelfCloseWithTerminal_.bind(this);
    this.#onSelfCloseWithoutTerminal =
      this.#onSelfCloseWithoutTerminal_.bind(this);

    this.#onError = this.#onError_.bind(this);
    this.#onData = this.#onData_.bind(this);
    this.#onEnd = this.#onEnd_.bind(this);
    this.#onTermEnd = this.#onTermEnd_.bind(this);
    this.#onKeyPress = this.#onKeyPress_.bind(this);
    this.#onResize = this.#onResize_.bind(this);

    this[kSawReturnAt] = 0;
    // TODO(BridgeAR): Document this property. The name is not ideal, so we
    // might want to expose an alias and document that instead.
    this.isCompletionEnabled = true;
    this[kSawKeyPress] = false;
    this[kPreviousKey] = null;
    this.escapeCodeTimeout = ESCAPE_CODE_TIMEOUT;
    this.tabSize = 8;

    let history;
    let historySize;
    let removeHistoryDuplicates = false;
    let crlfDelay;
    let prompt = "> ";
    let signal;

    if (input?.input) {
      // An options object was given
      output = input.output;
      completer = input.completer;
      terminal = input.terminal;
      history = input.history;
      historySize = input.historySize;
      signal = input.signal;
      if (input.tabSize !== undefined) {
        validateUint32(input.tabSize, "tabSize", true);
        this.tabSize = input.tabSize;
      }
      removeHistoryDuplicates = input.removeHistoryDuplicates;
      if (input.prompt !== undefined) {
        prompt = input.prompt;
      }
      if (input.escapeCodeTimeout !== undefined) {
        if (NumberIsFinite(input.escapeCodeTimeout)) {
          this.escapeCodeTimeout = input.escapeCodeTimeout;
        } else {
          throw new ERR_INVALID_ARG_VALUE(
            "input.escapeCodeTimeout",
            this.escapeCodeTimeout,
          );
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

    if (
      typeof historySize !== "number" ||
      NumberIsNaN(historySize) ||
      historySize < 0
    ) {
      throw new ERR_INVALID_ARG_VALUE.RangeError("historySize", historySize);
    }

    // Backwards compat; check the isTTY prop of the output stream
    //  when `terminal` was not specified
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

    // The kill ring is a global list of blocks of text that were previously
    // killed (deleted). If its size exceeds kMaxLengthOfKillRing, the oldest
    // element will be removed to make room for the latest deletion. With kill
    // ring, users are able to recall (yank) or cycle (yank pop) among previously
    // killed texts, quite similar to the behavior of Emacs.
    this[kKillRing] = [];
    this[kKillRingCursor] = 0;

    this.removeHistoryDuplicates = !!removeHistoryDuplicates;
    this.crlfDelay = crlfDelay
      ? MathMax(kMincrlfDelay, crlfDelay)
      : kMincrlfDelay;
    this.completer = completer;

    this.setPrompt(prompt);

    this.terminal = !!terminal;

    this[kLineObjectStream] = undefined;

    input.on("error", onerror);

    if (!this.terminal) {
      input.on("data", this.#onData);
      input.on("end", this.#onEnd);
      this.once("close", this.#onSelfCloseWithoutTerminal);
      this[kDecoder] = new StringDecoder("utf8");
    } else {
      emitKeypressEvents(input, this);

      // `input` usually refers to stdin
      input.on("keypress", this.#onKeyPress);
      input.on("end", this.#onTermEnd);

      this[kSetRawMode](true);
      this.terminal = true;

      // Cursor position on the line.
      this.cursor = 0;
      this.historyIndex = -1;

      if (output !== null && output !== undefined)
        output.on("resize", onresize);

      this.once("close", this.#onSelfCloseWithTerminal);
    }

    if (signal) {
      var onAborted = (() => this.close()).bind(this);
      if (signal.aborted) {
        process.nextTick(onAborted);
      } else {
        signal.addEventListener("abort", onAborted, { once: true });
        this.once("close", () =>
          signal.removeEventListener("abort", onAborted),
        );
      }
    }

    // Current line
    this.line = "";

    input.resume();
  }

  #onSelfCloseWithTerminal_() {
    var input = this.input;
    var output = this.output;

    if (!input) throw new Error("Input not set, invalid state for readline!");

    input.removeListener("keypress", this.#onKeyPress);
    input.removeListener("error", this.#onError);
    input.removeListener("end", this.#onTermEnd);
    if (output !== null && output !== undefined) {
      output.removeListener("resize", this.#onResize);
    }
  }

  #onSelfCloseWithoutTerminal_() {
    var input = this.input;
    if (!input) throw new Error("Input not set, invalid state for readline!");

    input.removeListener("data", this.#onData);
    input.removeListener("error", this.#onError);
    input.removeListener("end", this.#onEnd);
  }

  #onError_(err) {
    this.emit("error", err);
  }

  #onData_(data) {
    this[kNormalWrite](data);
  }

  #onEnd_() {
    if (
      typeof this[kLine_buffer] === "string" &&
      this[kLine_buffer].length > 0
    ) {
      this.emit("line", this[kLine_buffer]);
    }
    this.close();
  }

  #onTermEnd_() {
    if (typeof this.line === "string" && this.line.length > 0) {
      this.emit("line", this.line);
    }
    this.close();
  }

  #onKeyPress_(s, key) {
    this[kTtyWrite](s, key);
    if (key && key.sequence) {
      // If the key.sequence is half of a surrogate pair
      // (>= 0xd800 and <= 0xdfff), refresh the line so
      // the character is displayed appropriately.
      var ch = StringPrototypeCodePointAt(key.sequence, 0);
      if (ch >= 0xd800 && ch <= 0xdfff) this[kRefreshLine]();
    }
  }

  #onResize_() {
    this[kRefreshLine]();
  }
}

// close
// #setRawMode

// TODO: Figure out which one is #onSelfCloseWithoutTerminal
// TODO: Implement #kRefreshLine
// TODO: Implement #setRawMode ???
// TODO: Implement close ???

var _Interface = class Interface extends InterfaceConstructor {
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
    this.#kPrompt = prompt;
  }

  /**
   * Returns the current prompt used by `rl.prompt()`.
   * @returns {string}
   */
  getPrompt() {
    return this.#kPrompt;
  }

  [kSetRawMode](mode) {
    var input = this.input;
    var { setRawMode, wasInRawMode } = input;

    // TODO: Refactor and make work, for now just mock this
    console.log("setRawMode", mode, "set!");
    // if (typeof setRawMode === "function") {
    //   setRawMode(mode);
    // }

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
      this.#kRefreshLine();
    } else {
      this.#kWriteToOutput(this.#kPrompt);
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
    if (StringPrototypeTrim(this.line).length === 0) return this.line;

    if (this.history.length === 0 || this.history[0] !== this.line) {
      if (this.removeHistoryDuplicates) {
        // Remove older history line if identical to new one
        var dupIndex = ArrayPrototypeIndexOf(this.history, this.line);
        if (dupIndex !== -1) ArrayPrototypeSplice(this.history, dupIndex, 1);
      }

      ArrayPrototypeUnshift(this.history, this.line);

      // Only store so many
      if (this.history.length > this.historySize)
        ArrayPrototypePop(this.history);
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
    if (
      this[kSawReturnAt] &&
      DateNow() - this[kSawReturnAt] <= this.crlfDelay
    ) {
      if (StringPrototypeCodePointAt(string) === 10)
        string = StringPrototypeSlice(string, 1);
      this[kSawReturnAt] = 0;
    }

    // Run test() on the new string chunk, not on the entire line buffer.
    var newPartContainsEnding = RegExpPrototypeExec(lineEnding, string);
    if (newPartContainsEnding !== null) {
      if (this[kLine_buffer]) {
        string = this[kLine_buffer] + string;
        this[kLine_buffer] = null;
        newPartContainsEnding = RegExpPrototypeExec(lineEnding, string);
      }
      this[kSawReturnAt] = StringPrototypeEndsWith(string, "\r")
        ? DateNow()
        : 0;

      var indexes = [0, newPartContainsEnding.index, lineEnding.lastIndex];
      var nextMatch;
      while ((nextMatch = RegExpPrototypeExec(lineEnding, string)) !== null) {
        ArrayPrototypePush(indexes, nextMatch.index, lineEnding.lastIndex);
      }
      var lastIndex = indexes.length - 1;
      // Either '' or (conceivably) the unfinished portion of the next line
      this[kLine_buffer] = StringPrototypeSlice(string, indexes[lastIndex]);
      for (var i = 1; i < lastIndex; i += 2) {
        this[kOnLine](StringPrototypeSlice(string, indexes[i - 1], indexes[i]));
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
      var beg = StringPrototypeSlice(this.line, 0, this.cursor);
      var end = StringPrototypeSlice(this.line, this.cursor, this.line.length);
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
    var string = StringPrototypeSlice(this.line, 0, this.cursor);
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
    var prefix = commonPrefix(
      ArrayPrototypeFilter(completions, (e) => e !== ""),
    );
    if (
      StringPrototypeStartsWith(prefix, completeOn) &&
      prefix.length > completeOn.length
    ) {
      this[kInsertString](StringPrototypeSlice(prefix, completeOn.length));
      return;
    } else if (!StringPrototypeStartsWith(completeOn, prefix)) {
      this.line =
        StringPrototypeSlice(this.line, 0, this.cursor - completeOn.length) +
        prefix +
        StringPrototypeSlice(this.line, this.cursor, this.line.length);
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this._refreshLine();
      return;
    }

    if (!lastKeypressWasTab) {
      return;
    }

    this[kBeforeEdit](this.line, this.cursor);

    // Apply/show completions.
    var completionsWidth = ArrayPrototypeMap(completions, (e) =>
      getStringWidth(e),
    );
    var width = MathMaxApply(completionsWidth) + 2; // 2 space padding
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
        output += StringPrototypeRepeat(" ", whitespace);
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
      var leading = StringPrototypeSlice(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin(
        ArrayPrototypeReverse(ArrayFrom(leading)),
        "",
      );
      var match = RegExpPrototypeExec(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      this[kMoveCursor](-match[0].length);
    }
  }

  [kWordRight]() {
    if (this.cursor < this.line.length) {
      var trailing = StringPrototypeSlice(this.line, this.cursor);
      var match = RegExpPrototypeExec(/^(?:\s+|[^\w\s]+|\w+)\s*/, trailing);
      this[kMoveCursor](match[0].length);
    }
  }

  [kDeleteLeft]() {
    if (this.cursor > 0 && this.line.length > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      // The number of UTF-16 units comprising the character to the left
      var charSize = charLengthLeft(this.line, this.cursor);
      this.line =
        StringPrototypeSlice(this.line, 0, this.cursor - charSize) +
        StringPrototypeSlice(this.line, this.cursor, this.line.length);

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
        StringPrototypeSlice(this.line, 0, this.cursor) +
        StringPrototypeSlice(
          this.line,
          this.cursor + charSize,
          this.line.length,
        );
      this[kRefreshLine]();
    }
  }

  [kDeleteWordLeft]() {
    if (this.cursor > 0) {
      this[kBeforeEdit](this.line, this.cursor);
      // Reverse the string and match a word near beginning
      // to avoid quadratic time complexity
      var leading = StringPrototypeSlice(this.line, 0, this.cursor);
      var reversed = ArrayPrototypeJoin(
        ArrayPrototypeReverse(ArrayFrom(leading)),
        "",
      );
      var match = RegExpPrototypeExec(/^\s*(?:[^\w\s]+|\w+)?/, reversed);
      leading = StringPrototypeSlice(
        leading,
        0,
        leading.length - match[0].length,
      );
      this.line =
        leading +
        StringPrototypeSlice(this.line, this.cursor, this.line.length);
      this.cursor = leading.length;
      this[kRefreshLine]();
    }
  }

  [kDeleteWordRight]() {
    if (this.cursor < this.line.length) {
      this[kBeforeEdit](this.line, this.cursor);
      var trailing = StringPrototypeSlice(this.line, this.cursor);
      var match = RegExpPrototypeExec(/^(?:\s+|\W+|\w+)\s*/, trailing);
      this.line =
        StringPrototypeSlice(this.line, 0, this.cursor) +
        StringPrototypeSlice(trailing, match[0].length);
      this[kRefreshLine]();
    }
  }

  [kDeleteLineLeft]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice(this.line, 0, this.cursor);
    this.line = StringPrototypeSlice(this.line, this.cursor);
    this.cursor = 0;
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }

  [kDeleteLineRight]() {
    this[kBeforeEdit](this.line, this.cursor);
    var del = StringPrototypeSlice(this.line, this.cursor);
    this.line = StringPrototypeSlice(this.line, 0, this.cursor);
    this[kPushToKillRing](del);
    this[kRefreshLine]();
  }

  [kPushToKillRing](del) {
    if (!del || del === this[kKillRing][0]) return;
    ArrayPrototypeUnshift(this[kKillRing], del);
    this[kKillRingCursor] = 0;
    while (this[kKillRing].length > kMaxLengthOfKillRing)
      ArrayPrototypePop(this[kKillRing]);
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
      var head = StringPrototypeSlice(
        this.line,
        0,
        this.cursor - lastYank.length,
      );
      var tail = StringPrototypeSlice(this.line, this.cursor);
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
    if (
      ArrayPrototypePush(this[kUndoStack], { text, cursor }) >
      kMaxUndoRedoStackSize
    ) {
      ArrayPrototypeShift(this[kUndoStack]);
    }
  }

  [kUndo]() {
    if (this[kUndoStack].length <= 0) return;

    ArrayPrototypePush(this[kRedoStack], {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop(this[kUndoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;

    this[kRefreshLine]();
  }

  [kRedo]() {
    if (this[kRedoStack].length <= 0) return;

    ArrayPrototypePush(this[kUndoStack], {
      text: this.line,
      cursor: this.cursor,
    });

    var entry = ArrayPrototypePop(this[kRedoStack]);
    this.line = entry.text;
    this.cursor = entry.cursor;

    this[kRefreshLine]();
  }

  // TODO(BridgeAR): Add underscores to the search part and a red background in
  // case no match is found. This should only be the visual part and not the
  // actual line content!
  // TODO(BridgeAR): In case the substring based search is active and the end is
  // reached, show a comment how to search the history as before. E.g., using
  // <ctrl> + N. Only show this after two/three UPs or DOWNs, not on the first
  // one.
  [kHistoryNext]() {
    if (this.historyIndex >= 0) {
      this[kBeforeEdit](this.line, this.cursor);
      var search = this[kSubstringSearch] || "";
      var index = this.historyIndex - 1;
      while (
        index >= 0 &&
        (!StringPrototypeStartsWith(this.history[index], search) ||
          this.line === this.history[index])
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
        (!StringPrototypeStartsWith(this.history[index], search) ||
          this.line === this.history[index])
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
   *   }}
   */
  getCursorPos() {
    var strBeforeCursor =
      this[kPrompt] + StringPrototypeSlice(this.line, 0, this.cursor);
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
    var { name: keyName, meta: keyMeta } = key;

    if (!key.meta || keyName !== "y") {
      // Reset yanking state unless we are doing yank pop.
      this[kYanking] = false;
    }

    // Activate or deactivate substring search.
    if (
      (keyName === "up" || keyName === "down") &&
      !key.ctrl &&
      !key.meta &&
      !key.shift
    ) {
      if (this[kSubstringSearch] === null) {
        this[kSubstringSearch] = StringPrototypeSlice(
          this.line,
          0,
          this.cursor,
        );
      }
    } else if (this[kSubstringSearch] !== null) {
      this[kSubstringSearch] = null;
      // Reset the index in case there's no match.
      if (this.history.length === this.historyIndex) {
        this.historyIndex = -1;
      }
    }

    // Undo & Redo
    if (typeof key.sequence === "string") {
      switch (StringPrototypeCodePointAt(key.sequence, 0)) {
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

    if (key.ctrl && key.shift) {
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
    } else if (key.ctrl) {
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
        // TODO(BridgeAR): The transmitted escape sequence is `\b` and that is
        // identical to <ctrl>-h. It should have a unique escape sequence.
        // Falls through
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
    } else if (key.meta) {
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
          if (
            this[kSawReturnAt] === 0 ||
            DateNow() - this[kSawReturnAt] > this.crlfDelay
          ) {
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
          if (
            typeof this.completer === "function" &&
            this.isCompletionEnabled
          ) {
            var lastKeypressWasTab = previousKey && previousKey.name === "tab";
            this[kTabComplete](lastKeypressWasTab);
            break;
          }
        // falls through
        default:
          if (typeof s === "string" && s) {
            var nextMatch = RegExpPrototypeExec(lineEnding, s);
            if (nextMatch !== null) {
              this[kInsertString](StringPrototypeSlice(s, 0, nextMatch.index));
              var { lastIndex } = lineEnding;
              while (
                (nextMatch = RegExpPrototypeExec(lineEnding, s)) !== null
              ) {
                this[kLine]();
                this[kInsertString](
                  StringPrototypeSlice(s, lastIndex, nextMatch.index),
                );
                ({ lastIndex } = lineEnding);
              }
              if (lastIndex === s.length) this[kLine]();
            } else {
              this[kInsertString](s);
            }
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

  if (
    input?.input &&
    typeof input.completer === "function" &&
    input.completer.length !== 2
  ) {
    const { completer } = input;
    input.completer = (v, cb) => cb(null, completer(v));
  } else if (typeof completer === "function" && completer.length !== 2) {
    const realCompleter = completer;
    completer = (v, cb) => cb(null, realCompleter(v));
  }

  FunctionPrototypeCall(
    InterfaceConstructor,
    this,
    input,
    output,
    completer,
    terminal,
  );

  if (process.env.TERM === "dumb") {
    this._ttyWrite = FunctionPrototypeBind(_ttyWriteDumb, this);
  }
}

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

  if (options.signal) {
    validateAbortSignal(options.signal, "options.signal");
    if (options.signal.aborted) {
      return;
    }

    const onAbort = () => {
      this[kQuestionCancel]();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      options.signal.removeEventListener("abort", onAbort);
    };
    const originalCb = cb;
    cb =
      typeof cb === "function"
        ? (answer) => {
            cleanup();
            return originalCb(answer);
          }
        : cleanup;
  }

  if (typeof cb === "function") {
    this[kQuestion](query, cb);
  }
};
Interface.prototype.question[promisify.custom] = function question(
  query,
  options,
) {
  if (options === null || typeof options !== "object") {
    options = kEmptyObject;
  }

  if (options.signal && options.signal.aborted) {
    return PromiseReject(
      new AbortError(undefined, { cause: options.signal.reason }),
    );
  }

  return new Promise((resolve, reject) => {
    let cb = resolve;

    if (options.signal) {
      const onAbort = () => {
        reject(new AbortError(undefined, { cause: options.signal.reason }));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      cb = (answer) => {
        options.signal.removeEventListener("abort", onAbort);
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
  const string = StringPrototypeSlice(this.line, 0, this.cursor);
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
      if (
        this[kSawReturnAt] === 0 ||
        DateNow() - this[kSawReturnAt] > this.crlfDelay
      ) {
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

// TODO: Promises

export var Interface = Interface;
export var clearLine = clearLine;
export var clearScreenDown = clearScreenDown;
export var createInterface = createInterface;
export var cursorTo = cursorTo;
export var emitKeypressEvents = emitKeypressEvents;
export var moveCursor = moveCursor;
export var promises = promises;

export default {
  Interface,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,

  [Symbol.for("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")]: {
    CSI,
  },
  [Symbol.for("CommonJS")]: true,
};
