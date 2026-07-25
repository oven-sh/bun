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
      require("internal/shared").throwNotImplemented("'timers.active'");
    }
  },
  unenroll(timer) {
    if ($isCallable(timer?.refresh)) {
      clearTimeout(timer);
      return;
    }

    require("internal/shared").throwNotImplemented("'timers.unenroll'");
  },
  enroll(timer, _msecs) {
    if ($isCallable(timer?.refresh)) {
      timer.refresh();
      return;
    }

    require("internal/shared").throwNotImplemented("'timers.enroll'");
  },
};
