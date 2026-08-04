// Stacking dispatcher over `process.setUncaughtExceptionCaptureCallback`'s
// exclusive slot so node:domain and node:repl can coexist. First truthy return
// wins. https://github.com/nodejs/node/blob/main/lib/internal/process/execution.js

let captureCallbacks: any[] | null = null;

function dispatch(err) {
  const callbacks = captureCallbacks!;
  // Indexed, not for..of: user code can delete Array.prototype[Symbol.iterator]
  // and this runs while reporting that very error, so an unsafe iteration here
  // replaces the user's exception with "{} is not iterable".
  for (let i = 0; i < callbacks.length; i++) {
    if (callbacks[i](err)) return;
  }
  // No callback claimed it: node's stacking API falls through to the regular
  // 'uncaughtException' flow (with the origin arg), then to the native fatal
  // handler.
  if (process.emit("uncaughtException", err, "uncaughtException")) return;
  try {
    const { inspect } = require("node:util");
    process.stderr.write(`Uncaught ${inspect(err)}\n`);
  } catch {}
  process.exit(1);
}

function addUncaughtExceptionCaptureCallback(cb) {
  if (!captureCallbacks) {
    captureCallbacks = [];
    try {
      process.setUncaughtExceptionCaptureCallback(dispatch);
    } catch {
      // A user capture callback already owns the exclusive slot; defer to it.
      // Don't queue — the dispatcher isn't wired, so a queued cb would never fire.
      captureCallbacks = null;
      return;
    }
  }
  captureCallbacks.push(cb);
}

export default { addUncaughtExceptionCaptureCallback };
