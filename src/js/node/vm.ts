// Hardcoded module "node:vm"
const { SafePromiseAllReturnArrayLike } = require("internal/primordials");
const { throwNotImplemented } = require("internal/shared");
const {
  validateObject,
  validateString,
  validateUint32,
  validateBoolean,
  validateInt32,
  validateBuffer,
  validateFunction,
} = require("internal/validators");
const util = require("node:util");

const vm = $cpp("NodeVM.cpp", "Bun::createNodeVMBinding");

const ObjectFreeze = Object.freeze;
const ObjectDefineProperty = Object.defineProperty;
const ArrayPrototypeMap = Array.prototype.map;
const PromisePrototypeThen = $Promise.prototype.$then;
const PromiseResolve = Promise.$resolve.bind(Promise);
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const SymbolToStringTag = Symbol.toStringTag;
const ArrayIsArray = Array.isArray;
const ArrayPrototypeSome = Array.prototype.some;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;

const kPerContextModuleId = Symbol("kPerContextModuleId");
const kNative = Symbol("kNative");
const kContext = Symbol("kContext");
const kLink = Symbol("kLink");
const kDependencySpecifiers = Symbol("kDependencySpecifiers");
const kNoError = Symbol("kNoError");

const kEmptyObject = Object.freeze(Object.create(null));

const {
  Script,
  Module: ModuleNative,
  createContext,
  isContext,
  compileFunction,
  isModuleNamespaceObject,
  kUnlinked,
  kLinked,
  kEvaluated,
  kErrored,
  DONT_CONTEXTIFY,
  USE_MAIN_CONTEXT_DEFAULT_LOADER,
} = vm;

function runInContext(code, context, options) {
  validateContext(context);
  if (typeof options === "string") {
    options = { filename: options };
  }
  return new Script(code, options).runInContext(context, options);
}

function runInThisContext(code, options) {
  if (typeof options === "string") {
    options = { filename: options };
  }
  return new Script(code, options).runInThisContext(options);
}

function runInNewContext(code, context, options) {
  if (context !== undefined && (typeof context !== "object" || context === null)) {
    validateContext(context);
  }
  if (typeof options === "string") {
    options = { filename: options };
  }
  context = createContext(context, options);
  return createScript(code, options).runInNewContext(context, options);
}

function createScript(code, options) {
  return new Script(code, options);
}

function measureMemory() {
  throwNotImplemented("node:vm measureMemory");
}

function validateContext(contextifiedObject) {
  if (contextifiedObject !== constants.DONT_CONTEXTIFY && !isContext(contextifiedObject)) {
    const error = new Error('The "contextifiedObject" argument must be an vm.Context');
    error.code = "ERR_INVALID_ARG_TYPE";
    error.name = "TypeError";
    throw error;
  }
}

function validateModule(module, typename = "Module") {
  if (!isModule(module)) {
    const error = new Error('The "this" argument must be an instance of ' + typename);
    error.code = "ERR_INVALID_ARG_TYPE";
    error.name = "TypeError";
    throw error;
  }
}

let globalModuleId = 0;
const defaultModuleName = "vm:module";

class Module {
  constructor(options) {
    if (new.target === Module) {
      throw new TypeError("Module is not a constructor");
    }

    const { context, sourceText, syntheticExportNames, syntheticEvaluationSteps } = options;

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

    if (sourceText !== undefined) {
      this[kNative] = new ModuleNative(
        identifier,
        context,
        sourceText,
        options.lineOffset,
        options.columnOffset,
        options.cachedData,
        options.initializeImportMeta,
        this,
        options.importModuleDynamically ? importModuleDynamicallyWrap(options.importModuleDynamically) : undefined,
      );
    } else {
      $assert(syntheticEvaluationSteps);
      this[kNative] = new ModuleNative(identifier, context, syntheticExportNames, syntheticEvaluationSteps, this);
    }

    this[kContext] = context;
  }

  get identifier() {
    validateModule(this);
    return this[kNative].identifier;
  }

  get context() {
    validateModule(this);
    return this[kContext];
  }

  get status() {
    validateModule(this);
    return this[kNative].getStatus();
  }

  get namespace() {
    validateModule(this);
    if (this[kNative].getStatusCode() < kLinked) {
      throw $ERR_VM_MODULE_STATUS("must not be unlinked or linking");
    }

    return this[kNative].getNamespace();
  }

  get error() {
    validateModule(this);
    if (this[kNative].getStatusCode() !== kErrored) {
      throw $ERR_VM_MODULE_STATUS("must be errored");
    }

    return this[kNative].getError();
  }

  async link(linker) {
    validateModule(this);
    validateFunction(linker, "linker");

    if (this[kNative].getStatusCode() === kLinked) {
      throw $ERR_VM_MODULE_ALREADY_LINKED();
    }

    if (this[kNative].getStatusCode() !== kUnlinked) {
      throw $ERR_VM_MODULE_STATUS("must be unlinked");
    }

    await this[kLink](linker);
    this[kNative].instantiate();
  }

  async evaluate(options = kEmptyObject) {
    validateModule(this);
    validateObject(options, "options");

    let timeout = options.timeout;
    if (timeout === undefined) {
      timeout = -1;
    } else {
      validateUint32(timeout, "options.timeout", true);
    }
    const { breakOnSigint = false } = options;
    validateBoolean(breakOnSigint, "options.breakOnSigint");
    const status = this[kNative].getStatusCode();
    if (status !== kLinked && status !== kEvaluated && status !== kErrored) {
      throw $ERR_VM_MODULE_STATUS("must be one of linked, evaluated, or errored");
    }
    await this[kNative].evaluate(timeout, breakOnSigint);
  }

  [util.inspect.custom](depth, options) {
    validateModule(this);
    if (typeof depth === "number" && depth < 0) return this;

    const constructor = getConstructorOf(this) || Module;
    const o: any = { __proto__: { constructor } };
    o.status = this.status;
    o.identifier = this.identifier;
    o.context = this.context;

    ObjectSetPrototypeOf(o, ObjectGetPrototypeOf(this));
    ObjectDefineProperty(o, SymbolToStringTag, {
      __proto__: null,
      value: constructor.name,
      configurable: true,
    });

    return util.inspect(o, { ...options, customInspect: false });
  }
}

class SourceTextModule extends Module {
  #error: any = kNoError;
  #statusOverride: any;

  constructor(sourceText, options = kEmptyObject) {
    validateString(sourceText, "sourceText");
    validateObject(options, "options");

    const {
      lineOffset = 0,
      columnOffset = 0,
      initializeImportMeta,
      importModuleDynamically,
      context,
      identifier,
      cachedData,
    } = options;

    validateInt32(lineOffset, "options.lineOffset");
    validateInt32(columnOffset, "options.columnOffset");

    if (initializeImportMeta !== undefined) {
      validateFunction(initializeImportMeta, "options.initializeImportMeta");
    }

    if (importModuleDynamically !== undefined) {
      validateFunction(importModuleDynamically, "options.importModuleDynamically");
    }

    if (cachedData !== undefined) {
      validateBuffer(cachedData, "options.cachedData");
    }

    super({
      sourceText,
      context,
      identifier,
      lineOffset,
      columnOffset,
      cachedData,
      initializeImportMeta,
      importModuleDynamically,
    });

    this[kDependencySpecifiers] = undefined;
  }

  async [kLink](linker) {
    validateModule(this, "SourceTextModule");

    if (this[kNative].getStatusCode() >= kLinked) {
      throw $ERR_VM_MODULE_ALREADY_LINKED();
    }

    this.#statusOverride = "linking";
    const moduleRequests = this[kNative].createModuleRecord();

    // Iterates the module requests and links with the linker.
    // Specifiers should be aligned with the moduleRequests array in order.
    const specifiers = Array(moduleRequests.length);
    const modulePromises = Array(moduleRequests.length);
    // Iterates with index to avoid calling into userspace with `Symbol.iterator`.
    for (let idx = 0; idx < moduleRequests.length; idx++) {
      const { specifier, attributes } = moduleRequests[idx];

      const linkerResult = linker(specifier, this, {
        attributes,
        assert: attributes,
      });

      const modulePromise = PromisePrototypeThen.$call(PromiseResolve(linkerResult), async mod => {
        if (!isModule(mod)) {
          throw $ERR_VM_MODULE_NOT_MODULE();
        }
        if (mod.context !== this.context) {
          throw $ERR_VM_MODULE_DIFFERENT_CONTEXT();
        }
        if (mod.status === "errored") {
          throw $ERR_VM_MODULE_LINK_FAILURE(`request for '${specifier}' resolved to an errored mod`, mod.error);
        }
        if (mod.status === "unlinked") {
          await mod[kLink](linker);
        }
        return mod[kNative];
      });
      modulePromises[idx] = modulePromise;
      specifiers[idx] = specifier;
    }

    try {
      const moduleNatives = await SafePromiseAllReturnArrayLike(modulePromises);
      this[kNative].link(specifiers, moduleNatives, 0);
    } catch (e) {
      this.#error = e;
      throw e;
    } finally {
      this.#statusOverride = undefined;
    }
  }

  get dependencySpecifiers() {
    validateModule(this, "SourceTextModule");
    this[kDependencySpecifiers] ??= ObjectFreeze(
      ArrayPrototypeMap.$call(this[kNative].getModuleRequests(), request => request[0]),
    );
    return this[kDependencySpecifiers];
  }

  get status() {
    validateModule(this, "SourceTextModule");
    if (this.#error !== kNoError) {
      return "errored";
    }
    if (this.#statusOverride) {
      return this.#statusOverride;
    }
    return super.status;
  }

  get error() {
    validateModule(this, "SourceTextModule");
    if (this.#error !== kNoError) {
      return this.#error;
    }
    return super.error;
  }

  createCachedData() {
    validateModule(this, "SourceTextModule");
    const { status } = this;
    if (status === "evaluating" || status === "evaluated" || status === "errored") {
      throw $ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA();
    }
    return this[kNative].createCachedData();
  }
}

class SyntheticModule extends Module {
  constructor(exportNames, evaluateCallback, options = kEmptyObject) {
    if (!ArrayIsArray(exportNames) || ArrayPrototypeSome.$call(exportNames, e => typeof e !== "string")) {
      throw $ERR_INVALID_ARG_TYPE("exportNames", "Array of unique strings", exportNames);
    } else {
      ArrayPrototypeForEach.$call(exportNames, (name, i) => {
        if (ArrayPrototypeIndexOf.$call(exportNames, name, i + 1) !== -1) {
          throw $ERR_INVALID_ARG_VALUE(`exportNames.${name}`, name, "is duplicated");
        }
      });
    }
    validateFunction(evaluateCallback, "evaluateCallback");

    validateObject(options, "options");

    const { context, identifier } = options;

    super({
      syntheticExportNames: exportNames,
      syntheticEvaluationSteps: evaluateCallback,
      context,
      identifier,
    });
  }

  [kLink]() {
    /** nothing to do for synthetic modules */
  }

  setExport(name, value) {
    validateModule(this, "SyntheticModule");
    validateString(name, "name");
    if (this[kNative].getStatusCode() < kLinked) {
      throw $ERR_VM_MODULE_STATUS("must be linked");
    }
    this[kNative].setExport(name, value);
  }
}

const constants = {
  __proto__: null,
  USE_MAIN_CONTEXT_DEFAULT_LOADER,
  DONT_CONTEXTIFY,
};

function isModule(object) {
  return typeof object === "object" && object !== null && ObjectPrototypeHasOwnProperty.$call(object, kNative);
}

function importModuleDynamicallyWrap(importModuleDynamically) {
  const importModuleDynamicallyWrapper = async (...args) => {
    const m: any = await importModuleDynamically.$apply(this, args);
    if (isModuleNamespaceObject(m)) {
      return m;
    }
    if (!isModule(m)) {
      throw $ERR_VM_MODULE_NOT_MODULE();
    }
    if (m.status === "errored") {
      throw m.error;
    }
    return m.namespace;
  };
  return importModuleDynamicallyWrapper;
}

function getConstructorOf(obj) {
  while (obj) {
    const descriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
    if (descriptor !== undefined && typeof descriptor.value === "function" && descriptor.value.name !== "") {
      return descriptor.value;
    }

    obj = ObjectGetPrototypeOf(obj);
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
  constants: ObjectFreeze(constants),
};
