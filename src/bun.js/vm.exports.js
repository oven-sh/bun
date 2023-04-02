// TODO: Implement vm module

function hideFromStack(fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::",
    });
  }
}

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

function createContext() {
  notimpl("createContext");
}
function createScript() {
  notimpl("createScript");
}
function runInContext() {
  notimpl("runInContext");
}
function runInNewContext() {
  notimpl("runInNewContext");
}
function runInThisContext() {
  notimpl("runInThisContext");
}
function isContext() {
  notimpl("isContext");
}
function compileFunction() {
  notimpl("compileFunction");
}
function measureMemory() {
  notimpl("measureMemory");
}

class Script {
  constructor() {
    notimpl("Script");
  }
}

const defaultObject = {
  createContext,
  createScript,
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
  createScript,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script,
};

hideFromStack([
  TODO.prototype.constructor,
  notimpl,
  createContext,
  createScript,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script.prototype.constructor,
]);
