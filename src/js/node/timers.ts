const { throwNotImplemented } = require("internal/shared");

var timersPromisesValue;

// Bun's own functions, which script cannot replace. globalThis starts with the same ones, as in Node.
export default {
  setTimeout: $natives.setTimeout,
  clearTimeout: $natives.clearTimeout,
  setInterval: $natives.setInterval,
  setImmediate: $natives.setImmediate,
  clearInterval: $natives.clearInterval,
  clearImmediate: $natives.clearImmediate,
  get promises() {
    return (timersPromisesValue ??= require("node:timers/promises"));
  },
  set promises(value) {
    timersPromisesValue = value;
  },
  active(timer: NodeJS.Timeout) {
    if ($isCallable(timer?.refresh)) {
      timer.refresh();
    } else {
      throwNotImplemented("'timers.active'");
    }
  },
  unenroll(timer: NodeJS.Timeout) {
    if ($isCallable(timer?.refresh)) {
      $natives.clearTimeout(timer);
      return;
    }

    throwNotImplemented("'timers.unenroll'");
  },
  enroll(timer: NodeJS.Timeout, _msecs?: number) {
    if ($isCallable(timer?.refresh)) {
      timer.refresh();
      return;
    }

    throwNotImplemented("'timers.enroll'");
  },
};
