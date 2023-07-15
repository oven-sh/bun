// Hardcoded module "node:vm"
import { throwNotImplemented } from "../shared";

const vm = $lazy("vm");

const { createContext, isContext, Script, runInNewContext, runInThisContext } = vm;

function runInContext(code, context, options) {
  return new Script(code, options).runInContext(context);
}

function compileFunction() {
  throwNotImplemented("node:vm compileFunction", 401);
}
function measureMemory() {
  throwNotImplemented("node:vm measureMemory", 401);
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
