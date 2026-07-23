// Ported from Node.js v26.3.0 lib/readline.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} };
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

const {
  DateNow,
  FunctionPrototypeBind,
  FunctionPrototypeCall,
  ObjectDefineProperties,
  ObjectSetPrototypeOf,
  Promise,
  PromiseReject,
  StringPrototypeSlice,
  SymbolDispose,
} = primordials;

const { clearLine, clearScreenDown, cursorTo, moveCursor } = require("internal/readline/callbacks");
const emitKeypressEvents = require("internal/readline/emitKeypressEvents");
const promises = require("node:readline/promises");

const { AbortError } = require("internal/repl/node-errors");
// Don't destructure `inspect` — reading it loads internal/util/inspect (99 KB).
const nodeInspect = require("internal/repl/node-inspect");
// node-shims eagerly loads node:{util,module,path,vm}; readline only needs
// kEmptyObject/promisify, so import from their tiny sources.
const { kEmptyObject } = require("internal/shared");
const { promisify } = require("internal/promisify");
const { validateAbortSignal } = require("internal/validators");

/**
 * @typedef {import('./stream.js').Readable} Readable
 * @typedef {import('./stream.js').Writable} Writable
 */

const {
  Interface: _Interface,
  InterfaceConstructor,
  kAddHistory,
  kDecoder,
  kDeleteLeft,
  kDeleteLineLeft,
  kDeleteLineRight,
  kDeleteRight,
  kDeleteWordLeft,
  kDeleteWordRight,
  kGetDisplayPos,
  kHistoryNext,
  kHistoryPrev,
  kInsertString,
  kLine,
  kLine_buffer,
  kMoveCursor,
  kNormalWrite,
  kOldPrompt,
  kOnLine,
  kPreviousKey,
  kPrompt,
  kQuestion,
  kQuestionCallback,
  kQuestionCancel,
  kRefreshLine,
  kSawKeyPress,
  kSawReturnAt,
  kSetRawMode,
  kTabComplete,
  kTabCompleter,
  kTtyWrite,
  kWordLeft,
  kWordRight,
  kWriteToOutput,
} = require("internal/readline/interface");
let addAbortListener;

function Interface(input, output, completer, terminal) {
  if (!(this instanceof Interface)) {
    return new Interface(input, output, completer, terminal);
  }

  if (input?.input && typeof input.completer === "function" && input.completer.length !== 2) {
    const { completer } = input;
    input.completer = (v, cb) => cb(null, completer(v));
  } else if (typeof completer === "function" && completer.length !== 2) {
    const realCompleter = completer;
    completer = (v, cb) => cb(null, realCompleter(v));
  }

  FunctionPrototypeCall(InterfaceConstructor, this, input, output, completer, terminal);

  if (process.env.TERM === "dumb") {
    this._ttyWrite = FunctionPrototypeBind(_ttyWriteDumb, this);
  }
}

$toClass(Interface, "Interface", _Interface);

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
    addAbortListener ??= require("internal/abort_listener").addAbortListener;
    const disposable = addAbortListener(options.signal, onAbort);
    const originalCb = cb;
    cb =
      typeof cb === "function"
        ? answer => {
            disposable[SymbolDispose]();
            return originalCb(answer);
          }
        : disposable[SymbolDispose];
  }

  if (typeof cb === "function") {
    this[kQuestion](query, cb);
  }
};
Interface.prototype.question[promisify.custom] = function question(query, options) {
  if (options === null || typeof options !== "object") {
    options = kEmptyObject;
  }

  if (options.signal?.aborted) {
    return PromiseReject(new AbortError(undefined, { cause: options.signal.reason }));
  }

  return new Promise((resolve, reject) => {
    let cb = resolve;

    if (options.signal) {
      const onAbort = () => {
        reject(new AbortError(undefined, { cause: options.signal.reason }));
      };
      addAbortListener ??= require("internal/abort_listener").addAbortListener;
      const disposable = addAbortListener(options.signal, onAbort);
      cb = answer => {
        disposable[SymbolDispose]();
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
      this._writeToOutput(`Tab completion error: ${nodeInspect.inspect(err)}`);
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
  key ||= kEmptyObject;
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

__node_module__.exports = {
  Interface,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,
};

// Bun-internal hook consumed by pre-existing readline tests/utilities.
// Non-enumerable so it stays off the public node:readline surface.
Object.defineProperty(__node_module__.exports, Symbol.for("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__"), {
  __proto__: null,
  // A test-only hook; keep it lazy so `require("node:readline")` doesn't pull
  // in internal/util/inspect and node:util just to publish it.
  get() {
    return {
      CSI: require("internal/readline/utils").CSI,
      utils: {
        getStringWidth: require("internal/util/inspect").getStringWidth,
        stripVTControlCharacters: require("node:util").stripVTControlCharacters,
      },
    };
  },
});

// The builtin bundler dedupe-renames the second `function question`;
// promisify(question).name must stay 'question' (test-util-promisify-custom-names).
Object.defineProperty(Interface.prototype.question[promisify.custom], "name", { value: "question" });

export default __node_module__.exports;
