// Entry script for `bun --interactive` (`-i` is taken by `--install=fallback`): starts the Node.js-compatible
// REPL (the ported node:repl) the way Node's internal/main/repl.js does. This
// file runs as a regular entrypoint (not a builtin), so it reaches
// createInternalRepl via a Symbol.for hook on node:repl and never re-implements
// the NODE_REPL_* env parsing that internal/repl.js already owns.

// exec_node_repl injects the user's `-e` script as a JSON string literal here
// (data, not code — a syntax error or unterminated token in `-e` cannot bleed
// into this bootstrap). Read and clear it before any user code runs.
declare const __BUN_EVAL_SCRIPT__: string | undefined;
const evalScript: string | undefined = typeof __BUN_EVAL_SCRIPT__ === "string" ? __BUN_EVAL_SCRIPT__ : undefined;

const ext = process.env.NODE_REPL_EXTERNAL_MODULE;
if (ext) {
  // Node loads this in place of the built-in REPL (lib/internal/main/repl.js).
  require(require("node:path").resolve(ext));
} else {
  const REPL = require("node:repl");
  const createInternalRepl = (REPL as Record<symbol, Function>)[Symbol.for("bun.repl.createInternalRepl")];

  console.log(
    `Welcome to Bun v${(globalThis as any).Bun.version} (Node.js-compatible REPL, node:repl ${process.version}).\n` +
      'Type ".help" for more information.',
  );

  // `node -i -e`: an -e error is fatal (uncaught, exit 1), not caught by the
  // REPL. Runs before REPL.start so the shim's process-wide capture callback
  // isn't installed yet; `var`/`function` still land on globalThis.
  if (evalScript !== undefined) {
    require("node:vm").runInThisContext(evalScript, { filename: "[eval]", displayErrors: true });
  }

  createInternalRepl(process.env, (err: Error | null, replServer: any) => {
    if (err) throw err;

    replServer.on("exit", () => {
      if (replServer.historyManager?.isFlushing) {
        replServer.once("flushHistory", () => process.exit());
        return;
      }
      process.exit();
    });
  });
}
