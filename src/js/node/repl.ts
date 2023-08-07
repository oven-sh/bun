// Hardcoded module "node:repl"
// This is a stub! None of this is actually implemented yet.
// It only exists to make some packages which import this module work.
const { throwNotImplemented } = require("$shared");

function REPLServer() {
  throwNotImplemented("node:repl REPLServer");
}

function Recoverable() {
  throwNotImplemented("node:repl Recoverable");
}

var REPL_MODE_SLOPPY = 0,
  REPL_MODE_STRICT = 1;

function start() {
  throwNotImplemented("node:repl");
}

export default {
  lines: [],
  context: globalThis,
  historyIndex: -1,
  cursor: 0,
  historySize: 1000,
  removeHistoryDuplicates: false,
  crlfDelay: 100,
  completer: () => {
    throwNotImplemented("node:repl");
  },
  history: [],
  _initialPrompt: "> ",
  terminal: true,
  input: new Proxy(
    {},
    {
      get() {
        throwNotImplemented("node:repl");
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throwNotImplemented("node:repl");
      },
    },
  ),
  line: "",
  eval: () => {
    throwNotImplemented("node:repl");
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
        throwNotImplemented("node:repl");
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throwNotImplemented("node:repl");
      },
    },
  ),
};
