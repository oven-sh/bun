// Hardcoded module "node:vm"
const { throwNotImplemented } = require("internal/shared");

const vm = $lazy("vm");

const { createContext, isContext, Script, runInNewContext, runInThisContext } = vm;

function runInContext(code, context, options) {
  return new Script(code, options).runInContext(context);
}

function createScript(code, options) {
  return new Script(code, options);
}

function compileFunction() {
  throwNotImplemented("node:vm compileFunction");
}
function measureMemory() {
  throwNotImplemented("node:vm measureMemory");
}

class Module {
  constructor() {
    throwNotImplemented("node:vm Module");
  }
}

class SourceTextModule {
  constructor() {
    throwNotImplemented("node:vm Module");
  }
}

class SyntheticModule {
  constructor() {
    throwNotImplemented("node:vm Module");
  }
}

export default {
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
  Script,
  Module,
  SourceTextModule,
  SyntheticModule,
  createScript,
};
