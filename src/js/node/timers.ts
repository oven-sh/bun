const { throwNotImplemented } = require("internal/shared");

var timersPromisesValue;

export default {
  setTimeout,
  clearTimeout,
  setInterval,
  setImmediate,
  clearInterval,
  clearImmediate,
  get promises() {
    return (timersPromisesValue ??= require("node:timers/promises"));
  },
  set promises(value) {
    timersPromisesValue = value;
  },
  active(timer) {
    if ($isCallable(timer?.refresh)) {
      timer.refresh();
    } else {
      throwNotImplemented("'timers.active'");
    }
  },
  unenroll(timer) {
    if ($isCallable(timer?.refresh)) {
      clearTimeout(timer);
      return;
    }

    throwNotImplemented("'timers.unenroll'");
  },
  enroll(timer, msecs) {
    if ($isCallable(timer?.refresh)) {
      timer.refresh();
      return;
    }

    throwNotImplemented("'timers.enroll'");
  },
};
