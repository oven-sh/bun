const lazy = globalThis[Symbol.for("Bun.lazy")];
if (!lazy || typeof lazy !== "function") {
  throw new Error("Something went wrong while loading Bun. Expected 'Bun.lazy' to be defined.");
}
const vm = lazy("vm");

class TODO extends Error {
  constructor(messageName) {
    const message = messageName
      ? `node:vm ${messageName} is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/401`
      : `node:vm is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/401`;
    super(message);
    this.name = "TODO";
  }
}

function notimpl(message) {
  throw new TODO(message);
}

const createContext = vm.createContext;
const isContext = vm.isContext;
const Script = vm.Script;

Script.prototype.runInNewContext = function (contextObject, options) {
  if (contextObject === undefined) {
    contextObject = {};
  }
  const context = createContext(contextObject);
  return this.runInContext(context, options);
};

function runInContext(code, context, options) {
  return new Script(code).runInContext(context, options);
}
function runInNewContext(code, contextObject, options) {
  return new Script(code).runInNewContext(contextObject, options);
}
function runInThisContext(code, options) {
  return new Script(code).runInNewContext(options);
}
function compileFunction() {
  notimpl("compileFunction");
}
function measureMemory() {
  notimpl("measureMemory");
}

const defaultObject = {
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script,
  [Symbol.for("CommonJS")]: 0,
};

export {
  defaultObject as default,
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script,
};
