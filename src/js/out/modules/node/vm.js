// src/js/node/vm.js
var notimpl = function(message) {
  throw new TODO(message);
};
var runInContext = function(code, context, options) {
  return new Script(code, options).runInContext(context);
};
var compileFunction = function() {
  notimpl("compileFunction");
};
var measureMemory = function() {
  notimpl("measureMemory");
};
var lazy = globalThis[Symbol.for("Bun.lazy")];
if (!lazy || typeof lazy !== "function") {
  throw new Error("Something went wrong while loading Bun. Expected 'Bun.lazy' to be defined.");
}
var vm = lazy("vm");

class TODO extends Error {
  constructor(messageName) {
    const message = messageName ? `node:vm ${messageName} is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/401` : `node:vm is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/401`;
    super(message);
    this.name = "TODO";
  }
}
var { createContext, isContext, Script, runInNewContext, runInThisContext } = vm;
var defaultObject = {
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

//# debugId=DBB0E87F0D3E47F464756e2164756e21
