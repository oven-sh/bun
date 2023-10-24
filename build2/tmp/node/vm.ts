var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/vm.ts


// Hardcoded module "node:vm"
const { throwNotImplemented } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 6/*internal/shared.ts*/) || __intrinsic__createInternalModuleById(6/*internal/shared.ts*/));

const vm = __intrinsic__lazy("vm");

const { createContext, isContext, Script, runInNewContext, runInThisContext } = vm;

function runInContext(code, context, options) {
  return new Script(code, options).runInContext(context);
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

$ = {
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
};
$$EXPORT$$($).$$EXPORT_END$$;
