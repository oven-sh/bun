// Hardcoded module "node:vm"
const { throwNotImplemented } = require("internal/shared");
const { validateObject, validateString } = require("internal/validators");
const vm = $cpp("NodeVM.cpp", "Bun::createNodeVMBinding");

const ObjectFreeze = Object.freeze;
const ObjectDefineProperty = Object.defineProperty;

const kPerContextModuleId = Symbol("kPerContextModuleId");

const { createContext, isContext, Script, runInNewContext, runInThisContext, compileFunction } = vm;

function runInContext(code, context, options) {
  return new Script(code, options).runInContext(context);
}

function createScript(code, options) {
  return new Script(code, options);
}

function measureMemory() {
  throwNotImplemented("node:vm measureMemory");
}

let globalModuleId = 0;
const defaultModuleName = "vm:module";

class Module {
  constructor(options) {
    if (new.target === Module) {
      throw new TypeError("Module is not a constructor");
    }

    const { context } = options;

    if (context !== undefined) {
      validateObject(context, "context");
      if (!isContext(context)) {
        throw $ERR_INVALID_ARG_TYPE("options.context", "vm.Context", context);
      }
    }

    let { identifier } = options;
    if (identifier !== undefined) {
      validateString(identifier, "options.identifier");
    } else if (context === undefined) {
      identifier = `${defaultModuleName}(${globalModuleId++})`;
    } else if (context[kPerContextModuleId] !== undefined) {
      const curId = context[kPerContextModuleId];
      identifier = `${defaultModuleName}(${curId})`;
      context[kPerContextModuleId] += 1;
    } else {
      identifier = `${defaultModuleName}(0)`;
      ObjectDefineProperty(context, kPerContextModuleId, {
        __proto__: null,
        value: 1,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

class SourceTextModule {
  constructor() {
    throwNotImplemented("node:vm.SourceTextModule");
  }
}

class SyntheticModule {
  constructor() {
    throwNotImplemented("node:vm.SyntheticModule");
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
