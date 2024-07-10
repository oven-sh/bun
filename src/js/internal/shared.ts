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

export default {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  fileSinkSymbol,
};
