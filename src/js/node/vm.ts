// Hardcoded module "node:vm"
const { throwNotImplemented } = require("internal/shared");

const vm = $cpp("NodeVM.cpp", "Bun::createNodeVMBinding");

const ObjectFreeze = Object.freeze;

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

const constants = {
  __proto__: null,
  USE_MAIN_CONTEXT_DEFAULT_LOADER: Symbol("vm_dynamic_import_main_context_default"),
  DONT_CONTEXTIFY: Symbol("vm_context_no_contextify"),
};

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
  constants: ObjectFreeze(constants),
};
