// Ported from Node.js v26.3.0 lib/internal/repl.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} as Exports };

const { Number, NumberIsNaN, NumberParseInt } = primordials;

const REPL = require("node:repl");
const { kStandaloneREPL } = require("internal/repl/utils");

type Exports = typeof REPL & { createInternalRepl: typeof createRepl };

__node_module__.exports = { __proto__: REPL } as unknown as Exports;
__node_module__.exports.createInternalRepl = createRepl;

type OnLoaded = (err: Error | null, repl: $Node.REPLServer) => void;
interface Options extends $Node.REPLOptions, $Node.ReadlineHistoryOptions {}

function createRepl(env: Record<string, string | undefined>, opts?: Options | OnLoaded | null, cb?: OnLoaded) {
  if (typeof opts === "function") {
    cb = opts;
    opts = null;
  }
  opts = {
    [kStandaloneREPL]: true,
    ignoreUndefined: false,
    useGlobal: true,
    breakEvalOnSigint: true,
    ...opts,
  };

  if (NumberParseInt(env.NODE_NO_READLINE!)) {
    opts.terminal = false;
  }

  if (env.NODE_REPL_MODE) {
    opts.replMode = {
      "strict": REPL.REPL_MODE_STRICT,
      "sloppy": REPL.REPL_MODE_SLOPPY,
    }[env.NODE_REPL_MODE.toLowerCase().trim()];
  }

  if (opts.replMode === undefined) {
    opts.replMode = REPL.REPL_MODE_SLOPPY;
  }

  const size = Number(env.NODE_REPL_HISTORY_SIZE);
  if (!NumberIsNaN(size) && size > 0) {
    opts.size = size;
  } else {
    opts.size = 1000;
  }

  const term = "terminal" in opts ? opts.terminal : process.stdout.isTTY;
  opts.filePath = term ? env.NODE_REPL_HISTORY : "";

  const repl = REPL.start(opts);

  repl.setupHistory({
    filePath: opts.filePath,
    size: opts.size,
    onHistoryFileLoaded: cb,
  });
}

export default __node_module__.exports;
