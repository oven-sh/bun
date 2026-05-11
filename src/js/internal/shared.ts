const { SafeArrayIterator } = require("internal/primordials");

const ObjectFreeze = Object.freeze;

class NotImplementedError extends Error {
  code: string;
  constructor(feature: string, issue?: number, extra?: string) {
    super(
      feature +
        " is not yet implemented in Bun." +
        (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : "") +
        (extra ? ". " + extra : ""),
    );
    this.name = "NotImplementedError";
    this.code = "ERR_NOT_IMPLEMENTED";

    // in the definition so that it isn't bundled unless used
    hideFromStack(NotImplementedError);
  }
  get ["constructor"]() {
    return Error;
  }
}

function throwNotImplemented(feature: string, issue?: number, extra?: string): never {
  // in the definition so that it isn't bundled unless used
  hideFromStack(throwNotImplemented);

  throw new NotImplementedError(feature, issue, extra);
}

function hideFromStack(...fns: Function[]) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::",
    });
  }
}

let warned: Set<string>;
function warnNotImplementedOnce(feature: string, issue?: number) {
  if (!warned) {
    warned = new Set();
  }

  if (warned.has(feature)) {
    return;
  }
  warned.add(feature);
  console.warn(new NotImplementedError(feature, issue));
}

let util: typeof import("node:util");
class ExceptionWithHostPort extends Error {
  errno: number;
  syscall: string;
  port?: number;
  address: string;

  constructor(err: number, syscall: string, address: string, port?: number) {
    // TODO(joyeecheung): We have to use the type-checked
    // getSystemErrorName(err) to guard against invalid arguments from users.
    // This can be replaced with [ code ] = errmap.get(err) when this method
    // is no longer exposed to user land.
    util ??= require("node:util");
    const code = util.getSystemErrorName(err);
    let details = "";
    if (port && port > 0) {
      details = ` ${address}:${port}`;
    } else if (address) {
      details = ` ${address}`;
    }

    super(`${syscall} ${code}${details}`);

    this.errno = err;
    this.code = code;
    this.syscall = syscall;
    this.address = address;
    if (port) {
      this.port = port;
    }
  }
  get ["constructor"]() {
    return Error;
  }
}

class NodeAggregateError extends AggregateError {
  constructor(errors, message) {
    super(new SafeArrayIterator(errors), message);
    this.code = errors[0]?.code;
  }
  get ["constructor"]() {
    return AggregateError;
  }
}

class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
  }
  get ["constructor"]() {
    return Error;
  }
}

class ErrnoException extends Error {
  errno: number;
  syscall: string;

  constructor(err, syscall, original) {
    util ??= require("node:util");
    const code = util.getSystemErrorName(err);
    const message = original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`;

    super(message);

    this.errno = err;
    this.code = code;
    this.syscall = syscall;
  }
  get ["constructor"]() {
    return Error;
  }
}

function once(callback, { preserveReturnValue = false } = kEmptyObject) {
  let called = false;
  let returnValue;
  return function (...args) {
    if (called) return returnValue;
    called = true;
    const result = callback.$apply(this, args);
    returnValue = preserveReturnValue ? result : undefined;
    return result;
  };
}

const kEmptyObject = ObjectFreeze(Object.create(null));

function getLazy<T>(initializer: () => T) {
  let value: T;
  let initialized = false;
  return function () {
    if (initialized) return value;
    value = initializer();
    initialized = true;
    return value;
  };
}

//

export default {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  ExceptionWithHostPort,
  NodeAggregateError,
  ConnResetException,
  ErrnoException,
  once,
  getLazy,

  kHandle: Symbol("kHandle"),
  kAutoDestroyed: Symbol("kAutoDestroyed"),
  kResistStopPropagation: Symbol("kResistStopPropagation"),
  kWeakHandler: Symbol("kWeak"),
  kGetNativeReadableProto: Symbol("kGetNativeReadableProto"),
  kEmptyObject,
};
