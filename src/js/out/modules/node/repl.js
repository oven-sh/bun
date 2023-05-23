// src/js/node/repl.js
var REPLServer = function() {
  throw new NotImplementedYet("REPLServer is not implemented yet in Bun");
};
var Recoverable = function() {
  throw new NotImplementedYet("Recoverable is not implemented yet in Bun");
};
var start = function() {
  throw new NotImplementedYet;
};

class NotImplementedYet extends Error {
  constructor(message = "node:repl is not implemented yet in Bun") {
    super(message);
    this.name = "NotImplementedYet";
  }
}
var REPL_MODE_SLOPPY = 0;
var REPL_MODE_STRICT = 1;
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
    throw new NotImplementedYet;
  },
  history: [],
  _initialPrompt: "> ",
  terminal: true,
  input: new Proxy({}, {
    get() {
      throw new NotImplementedYet;
    },
    has: () => false,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => {
      return;
    },
    set() {
      throw new NotImplementedYet;
    }
  }),
  line: "",
  eval: () => {
    throw new NotImplementedYet;
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
  output: new Proxy({}, {
    get() {
      throw new NotImplementedYet;
    },
    has: () => false,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => {
      return;
    },
    set() {
      throw new NotImplementedYet;
    }
  })
};
export {
  start,
  repl,
  repl as default,
  Recoverable,
  REPL_MODE_STRICT,
  REPL_MODE_SLOPPY,
  REPLServer
};

//# debugId=9E18BA9D403C7F2564756e2164756e21
