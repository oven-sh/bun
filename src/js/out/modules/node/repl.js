function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/repl.ts
var REPLServer = function() {
  throwNotImplemented("node:repl REPLServer");
}, Recoverable = function() {
  throwNotImplemented("node:repl Recoverable");
}, start = function() {
  throwNotImplemented("node:repl");
}, REPL_MODE_SLOPPY = 0, REPL_MODE_STRICT = 1, repl = {
  [Symbol.for("CommonJS")]: 0,
  lines: [],
  context: globalThis,
  historyIndex: -1,
  cursor: 0,
  historySize: 1000,
  removeHistoryDuplicates: !1,
  crlfDelay: 100,
  completer: () => {
    throwNotImplemented("node:repl");
  },
  history: [],
  _initialPrompt: "> ",
  terminal: !0,
  input: new Proxy({}, {
    get() {
      throwNotImplemented("node:repl");
    },
    has: () => !1,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => {
      return;
    },
    set() {
      throwNotImplemented("node:repl");
    }
  }),
  line: "",
  eval: () => {
    throwNotImplemented("node:repl");
  },
  isCompletionEnabled: !0,
  escapeCodeTimeout: 500,
  tabSize: 8,
  breakEvalOnSigint: !0,
  useGlobal: !0,
  underscoreAssigned: !1,
  last: void 0,
  _domain: void 0,
  allowBlockingCompletions: !1,
  useColors: !0,
  output: new Proxy({}, {
    get() {
      throwNotImplemented("node:repl");
    },
    has: () => !1,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => {
      return;
    },
    set() {
      throwNotImplemented("node:repl");
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
