// @module "node:repl"
// This is a stub! None of this is actually implemented yet.
// It only exists to make some packages which import this module work.

class NotImplementedYet extends Error {
  constructor(message = "node:repl is not implemented yet in Bun") {
    super(message);
    this.name = "NotImplementedYet";
  }
}

function REPLServer() {
  throw new NotImplementedYet("REPLServer is not implemented yet in Bun");
}

function Recoverable() {
  throw new NotImplementedYet("Recoverable is not implemented yet in Bun");
}

var REPL_MODE_SLOPPY = 0,
  REPL_MODE_STRICT = 1;

function start() {
  throw new NotImplementedYet();
}

var repl = {
  [Symbol.for("CommonJS")]: 0,
  lines: [],
  context: globalThis,
  historyIndex: -1,
  cursor: 0,
  historySize: 1000,
  removeHistoryDuplicates: false,
  crlfDelay: 100,
  completer: () => {
    throw new NotImplementedYet();
  },
  history: [],
  _initialPrompt: "> ",
  terminal: true,
  input: new Proxy(
    {},
    {
      get() {
        throw new NotImplementedYet();
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throw new NotImplementedYet();
      },
    },
  ),
  line: "",
  eval: () => {
    throw new NotImplementedYet();
  },
  isCompletionEnabled: true,
  escapeCodeTimeout: 500,
  tabSize: 8,
  breakEvalOnSigint: true,
  useGlobal: true,
  underscoreAssigned: false,
  last: undefined,
  _domain: undefined,
  allowBlockingCompletions: false,
  useColors: true,
  output: new Proxy(
    {},
    {
      get() {
        throw new NotImplementedYet();
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throw new NotImplementedYet();
      },
    },
  ),
};

export { repl as default, repl, REPLServer, Recoverable, REPL_MODE_SLOPPY, REPL_MODE_STRICT, start };
