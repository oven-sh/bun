const { throwNotImplemented } = require("internal/shared");

var timersPromisesValue;

export default {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setImmediate: globalThis.setImmediate,
  clearInterval: globalThis.clearInterval,
  clearImmediate: globalThis.clearImmediate,
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
      clearTimeout(timer);
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
