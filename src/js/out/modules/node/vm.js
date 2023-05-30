function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/vm.ts
var runInContext = function(code, context, options) {
  return new Script(code, options).runInContext(context);
}, compileFunction = function() {
  throwNotImplemented("node:vm compileFunction", 401);
}, measureMemory = function() {
  throwNotImplemented("node:vm measureMemory", 401);
}, lazy = globalThis[Symbol.for("Bun.lazy")];
if (!lazy || typeof lazy !== "function")
  throw new Error("Something went wrong while loading Bun. Expected 'Bun.lazy' to be defined.");
var vm = lazy("vm"), { createContext, isContext, Script, runInNewContext, runInThisContext } = vm, defaultObject = {
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script,
  [Symbol.for("CommonJS")]: 0
};
export {
  runInThisContext,
  runInNewContext,
  runInContext,
  measureMemory,
  isContext,
  defaultObject as default,
  createContext,
  compileFunction,
  Script
};
