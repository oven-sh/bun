const ObjectFreeze = Object.freeze;

class NotImplementedError extends Error {
  code: string;
  constructor(feature: string, issue?: number, extra?: string) {
    super(
      feature +
        " is not yet implemented in Bun." +
        (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : "") +
        (!!extra ? ". " + extra : ""),
    );
    this.name = "NotImplementedError";
    this.code = "ERR_NOT_IMPLEMENTED";

    // in the definition so that it isn't bundled unless used
    hideFromStack(NotImplementedError);
  }
}

function throwNotImplemented(feature: string, issue?: number, extra?: string): never {
  // in the definition so that it isn't bundled unless used
  hideFromStack(throwNotImplemented);

  throw new NotImplementedError(feature, issue, extra);
}

function hideFromStack(...fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::",
    });
  }
}

let warned;
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

//

let util: typeof import("node:util");
class ExceptionWithHostPort extends Error {
  errno: number;
  syscall: string;
  port?: number;
  address;

  constructor(err, syscall, address, port) {
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

const kEmptyObject = ObjectFreeze({ __proto__: null });

//

export default {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  ExceptionWithHostPort,
  once,

  kHandle: Symbol("kHandle"),
  kAutoDestroyed: Symbol("kAutoDestroyed"),
  kResistStopPropagation: Symbol("kResistStopPropagation"),
  kWeakHandler: Symbol("kWeak"),
  kGetNativeReadableProto: Symbol("kGetNativeReadableProto"),
  kEmptyObject,
};
