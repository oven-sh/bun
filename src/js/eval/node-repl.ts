// Entry script for `bun -i` / `bun --interactive`: starts the Node.js-compatible
// REPL (the ported node:repl) the way Node's internal/main/repl.js does, using
// only public node:repl APIs (this file runs as a regular entrypoint, so it
// cannot require internal modules).

const REPL = require("node:repl");

console.log(`Welcome to Node.js ${process.version}.\n` + 'Type ".help" for more information.');

const opts: Record<string, any> = {
  ignoreUndefined: false,
  useGlobal: true,
  breakEvalOnSigint: true,
};

if (parseInt(process.env.NODE_NO_READLINE!)) {
  opts.terminal = false;
}

if (process.env.NODE_REPL_MODE) {
  opts.replMode = {
    strict: REPL.REPL_MODE_STRICT,
    sloppy: REPL.REPL_MODE_SLOPPY,
  }[process.env.NODE_REPL_MODE.toLowerCase().trim()];
}

if (opts.replMode === undefined) {
  opts.replMode = REPL.REPL_MODE_SLOPPY;
}

const size = Number(process.env.NODE_REPL_HISTORY_SIZE);
if (!Number.isNaN(size) && size > 0) {
  opts.size = size;
} else {
  opts.size = 1000;
}

const term = "terminal" in opts ? opts.terminal : process.stdout.isTTY;
const filePath = term ? process.env.NODE_REPL_HISTORY : "";

// Standalone-REPL semantics (Node boots its CLI REPL through
// internal/repl with kStandaloneREPL set): relaxed input validation,
// repl.repl introspection, inspect.replDefaults writer wiring.
const kStandaloneREPL = (REPL as Record<symbol, symbol>)[Symbol.for("bun.repl.kStandaloneREPL")];
if (kStandaloneREPL) {
  (opts as Record<symbol, boolean>)[kStandaloneREPL] = true;
}

const replServer = REPL.start(opts);

replServer.setupHistory({
  filePath,
  size: opts.size,
  onHistoryFileLoaded: (err: Error | null) => {
    if (err) {
      throw err;
    }
  },
});

replServer.on("exit", () => {
  if (replServer.historyManager?.isFlushing) {
    replServer.once("flushHistory", () => {
      process.exit();
    });
    return;
  }
  process.exit();
});
