// Node's `process.setUncaughtExceptionCaptureCallback` is exclusive: a second
// call while a callback is installed throws. node:domain and node:repl both
// need to take over fatal-exception handling, and upstream relies on an
// internal stacking variant so they can coexist. Bun only exposes the
// exclusive setter, so this module owns the single slot and dispatches to an
// ordered list. The first callback to return a truthy value handles the error;
// otherwise the regular `uncaughtException` flow runs.

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
      // A user capture callback already occupies the exclusive slot. Node's
      // stacking API coexists with it natively; without that engine support,
      // defer to the user's callback and don't push (the dispatcher isn't
      // wired, so a queued cb would never fire).
      captureCallbacks = null;
      return;
    }
  }
  captureCallbacks.push(cb);
}

export default { addUncaughtExceptionCaptureCallback };
