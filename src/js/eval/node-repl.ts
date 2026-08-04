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

  // `node -i -e`: node evaluates AFTER createInternalRepl (which starts the
  // REPL synchronously), so the REPL's globals are already in place.
  if (evalScript !== undefined) {
    evalWithNodeBindings(evalScript);
  }
}

// Mirrors node's runScriptInContext: it does NOT wrap the body as a CJS
// module — it publishes the bindings onto the global and runs the body in
// global scope, so `var`/`function` still land on globalThis while
// require/module/exports/__dirname/__filename resolve.
function evalWithNodeBindings(code: string) {
  const Module = require("node:module");
  // process.cwd() throws when the working directory has been deleted; node's
  // evalScript uses tryGetCwd() here, falling back to the executable's dir.
  let cwd: string;
  try {
    cwd = process.cwd();
  } catch {
    cwd = require("node:path").dirname(process.execPath);
  }
  const name = "[eval]";

  const mod = new Module(name);
  mod.filename = require("node:path").join(cwd, name);
  mod.paths = Module._nodeModulePaths(cwd);

  const global_ = globalThis as any;
  const origModule = global_.module;
  global_.module = mod;
  global_.exports = mod.exports;
  // node's wrapper is compiled as `${name}-wrapper`, so its __dirname is
  // dirname("[eval]-wrapper") === "." — decoupled from module.filename, which
  // stays the cwd-joined path used for require resolution.
  global_.__dirname = ".";
  global_.__filename = name;
  global_.require = Module.createRequire(mod.filename);

  try {
    require("node:vm").runInThisContext(code, { filename: name, displayErrors: true });
  } catch (e) {
    // An -e error is fatal in node even with the REPL up. Report and exit here
    // rather than rethrowing: the REPL is already live, so an uncaught throw
    // races its EOF-driven exit and the process can leave 0 with the error
    // unreported (empty stdin loses that race every time).
    try {
      process.setUncaughtExceptionCaptureCallback(null);
    } catch {}
    console.error(e);
    process.exit(1);
  } finally {
    if (origModule !== undefined) global_.module = origModule;
  }
}
