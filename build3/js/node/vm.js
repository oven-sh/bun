(function (){"use strict";// build3/tmp/node/vm.ts
var runInContext = function(code, context, options) {
  return new Script(code, options).runInContext(context);
};
var compileFunction = function() {
  throwNotImplemented("node:vm compileFunction");
};
var measureMemory = function() {
  throwNotImplemented("node:vm measureMemory");
};
var $;
var { throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
var vm = @lazy("vm");
var { createContext, isContext, Script, runInNewContext, runInThisContext } = vm;

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
  SyntheticModule
};
return $})
