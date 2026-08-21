// Stacking dispatcher over the process's single uncaught-exception capture slot
// so node:domain and node:repl can coexist. First truthy return wins.
// https://github.com/nodejs/node/blob/main/lib/internal/process/execution.js

const setInternalUncaughtExceptionCaptureCallback = $newCppFunction(
  "BunProcess.cpp",
  "jsFunctionSetInternalUncaughtExceptionCaptureCallback",
  1,
);

let captureCallbacks: any[] | null = null;

// Returning false hands the exception back to the native handler, which goes on
// exactly as if no capture callback were installed ('uncaughtException'
// listeners, then the caller's own reporting).
function dispatch(err, _origin, unhandledIsFatal: boolean) {
  const callbacks = captureCallbacks!;
  // Indexed, not for..of: user code can delete Array.prototype[Symbol.iterator]
  // and this runs while reporting that very error, so an unsafe iteration here
  // replaces the user's exception with "{} is not iterable".
  for (let i = 0; i < callbacks.length; i++) {
    if (callbacks[i](err)) return true;
  }
  if (!unhandledIsFatal || process.listenerCount("uncaughtException") > 0) return false;
  // Node's fatal handler prints err.stack (`Error [CODE]: ...`), which the ported
  // REPL tests match on; Bun's native reporter lays the error out differently.
  try {
    const { inspect } = require("node:util");
    process.stderr.write(`Uncaught ${inspect(err)}\n`);
  } catch {}
  // If user code removed process.exit, the throw is caught natively and still exits 1.
  process.exit(1);
}

function addUncaughtExceptionCaptureCallback(cb) {
  if (!captureCallbacks) {
    // A user capture callback already owns the exclusive slot; defer to it.
    // Don't queue — the dispatcher isn't wired, so a queued cb would never fire.
    if (!setInternalUncaughtExceptionCaptureCallback(dispatch)) return;
    captureCallbacks = [];
  }
  captureCallbacks.push(cb);
}

export default { addUncaughtExceptionCaptureCallback };
