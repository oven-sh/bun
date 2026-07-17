// Entry script for `bun --interactive` (`-i` is taken by `--install=fallback`): starts the Node.js-compatible
// REPL (the ported node:repl) the way Node's internal/main/repl.js does. This
// file runs as a regular entrypoint (not a builtin), so it reaches
// createInternalRepl via a Symbol.for hook on node:repl and never re-implements
// the NODE_REPL_* env parsing that internal/repl.js already owns.

// exec_node_repl stashes the user's `-e` bytes on `process._eval` (undefined
// when no `-e`), so no source splicing — a syntax error or unterminated
// token in `-e` cannot bleed into this bootstrap.
const evalScript: string | undefined = (process as { _eval?: string })._eval;

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
  // Diverges from node, which evaluates AFTER createInternalRepl and via
  // runScriptInContext, so `-e` there also sees require/module/__filename.
  // Node can order it that way because its REPL installs no capture callback;
  // ours does, so moving the eval later would let the REPL swallow the error.
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
