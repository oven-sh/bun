// Ported from Node.js v26.3.0 lib/readline/promises.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
type InputStream = $Node.ReadlineInput;
type InterfaceOptions = $Node.ReadlineOptions;
type OutputStream = $Node.ReadlineOutput;

const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} as Exports };

const { Promise, SymbolDispose } = primordials;

const { Readline } = require("internal/readline/promises");

const { Interface: _Interface, kQuestion, kQuestionCancel, kQuestionReject } = require("internal/readline/interface");

const { AbortError } = require("internal/repl/node-errors");
const { validateAbortSignal } = require("internal/validators");

const { kEmptyObject } = require("internal/shared");
let addAbortListener: $BunModules["internal/abort_listener"]["addAbortListener"] | undefined;

class Interface extends _Interface {
  question(query: string, options: { signal?: AbortSignal } = kEmptyObject) {
    return new Promise<string>((resolve, reject) => {
      let cb: (answer: string) => void = resolve;

      if (options?.signal) {
        validateAbortSignal(options.signal, "options.signal");
        if (options.signal.aborted) {
          return reject(new AbortError(undefined, { cause: options.signal.reason }));
        }

        const onAbort = () => {
          (this[kQuestionCancel] as () => void)();
          reject(new AbortError(undefined, { cause: options.signal!.reason }));
        };
        addAbortListener ??= require("internal/abort_listener").addAbortListener;
        const disposable = addAbortListener(options.signal, onAbort);

        cb = answer => {
          (disposable[SymbolDispose] as () => void)();
          resolve(answer);
        };
      }

      this[kQuestionReject] = reject;

      (this[kQuestion] as (query: string, cb: (answer: string) => void) => void)(query, cb);
    });
  }
}

function createInterface(
  input: InputStream | InterfaceOptions,
  output?: OutputStream | null,
  completer?: InterfaceOptions["completer"],
  terminal?: boolean,
) {
  return new Interface(input, output, completer, terminal);
}

interface Exports {
  Interface: typeof Interface;
  Readline: typeof Readline;
  createInterface: typeof createInterface;
}

__node_module__.exports = {
  Interface,
  Readline,
  createInterface,
};

export default __node_module__.exports;
