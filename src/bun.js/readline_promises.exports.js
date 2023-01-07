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

var { Promise } = import.meta.primordials;
var readline = import.meta.require("node:readline");
var isWritable;

var ArrayPrototypePush = Array.prototype.push;
var ArrayPrototypeJoin = Array.prototype.join;
var SymbolFor = Symbol.for;
var kInternal = SymbolFor("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__");

var {
  CSI,
  _Interface,
  symbols: { kQuestion, kQuestionCancel },
  shared: {
    kEmptyObject,
    validateAbortSignal,
    validateBoolean,
    validateInteger,
    ERR_INVALID_ARG_TYPE,
  },
} = readline[kInternal];

var { kClearToLineBeginning, kClearToLineEnd, kClearLine, kClearScreenDown } =
  CSI;

class AbortError extends Error {
  code;
  constructor() {
    super("The operation was aborted");
    this.code = "ABORT_ERR";
  }
}

export class Readline {
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
    else ArrayPrototypePush.call(this.#todo, data);

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
      else ArrayPrototypePush.call(this.#todo, data);
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

    var data =
      dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine;
    if (this.#autoCommit) process.nextTick(() => this.#stream.write(data));
    else ArrayPrototypePush.call(this.#todo, data);
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
      ArrayPrototypePush.call(this.#todo, kClearScreenDown);
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
    return new Promise((resolve) => {
      this.#stream.write(ArrayPrototypeJoin.call(this.#todo, ""), resolve);
      this.#todo = [];
    });
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

export class Interface extends _Interface {
  // eslint-disable-next-line no-useless-constructor
  constructor(input, output, completer, terminal) {
    super(input, output, completer, terminal);
  }
  question(query, options = kEmptyObject) {
    return new Promise((resolve, reject) => {
      var cb = resolve;

      if (options?.signal) {
        validateAbortSignal(options.signal, "options.signal");
        if (options.signal.aborted) {
          return reject(
            new AbortError(undefined, { cause: options.signal.reason }),
          );
        }

        var onAbort = () => {
          this[kQuestionCancel]();
          reject(new AbortError(undefined, { cause: options.signal.reason }));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        cb = (answer) => {
          options.signal.removeEventListener("abort", onAbort);
          resolve(answer);
        };
      }

      this[kQuestion](query, cb);
    });
  }
}

export function createInterface(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
}

export default {
  Readline,
  Interface,
  createInterface,

  [SymbolFor("CommonJS")]: 0,
};
