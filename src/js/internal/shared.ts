class NotImplementedError extends Error {
  code: string;
  constructor(feature: string, issue?: number) {
    super(
      feature +
        " is not yet implemented in Bun." +
        (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""),
    );
    this.name = "NotImplementedError";
    this.code = "ERR_NOT_IMPLEMENTED";

    // in the definition so that it isn't bundled unless used
    hideFromStack(NotImplementedError);
  }
}

function throwNotImplemented(feature: string, issue?: number): never {
  // in the definition so that it isn't bundled unless used
  hideFromStack(throwNotImplemented);

  throw new NotImplementedError(feature, issue);
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

const fileSinkSymbol = Symbol("fileSink");

//

let util;
class ExceptionWithHostPort extends Error {
  errno: number;
  syscall: string;
  port?: number;

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

//

export default {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  fileSinkSymbol,
  ExceptionWithHostPort,
  kHandle: Symbol("kHandle"),
  kAutoDestroyed: Symbol("kAutoDestroyed"),
};
