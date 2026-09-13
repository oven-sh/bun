// Ported from Node.js v26.3.0 lib/readline/promises.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} };

const { Promise, SymbolDispose } = primordials;

const { Readline } = require("internal/readline/promises");

const { Interface: _Interface, kQuestion, kQuestionCancel, kQuestionReject } = require("internal/readline/interface");

const { AbortError } = require("internal/repl/node-errors");
const { validateAbortSignal } = require("internal/validators");

const { kEmptyObject } = require("internal/shared");
let addAbortListener;

class Interface extends _Interface {
  question(query, options = kEmptyObject) {
    return new Promise((resolve, reject) => {
      let cb = resolve;

      if (options?.signal) {
        validateAbortSignal(options.signal, "options.signal");
        if (options.signal.aborted) {
          return reject(new AbortError(undefined, { cause: options.signal.reason }));
        }

        const onAbort = () => {
          this[kQuestionCancel]();
          reject(new AbortError(undefined, { cause: options.signal.reason }));
        };
        addAbortListener ??= require("internal/abort_listener").addAbortListener;
        const disposable = addAbortListener(options.signal, onAbort);

        cb = answer => {
          disposable[SymbolDispose]();
          resolve(answer);
        };
      }

      this[kQuestionReject] = reject;

      this[kQuestion](query, cb);
    });
  }
}

function createInterface(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
}

__node_module__.exports = {
  Interface,
  Readline,
  createInterface,
};

export default __node_module__.exports;
