// Hardcoded module "node:vm"
const { SafePromiseAllReturnArrayLike } = require("internal/primordials");
const {
  validateObject,
  validateString,
  validateUint32,
  validateBoolean,
  validateInt32,
  validateBuffer,
  validateFunction,
  validateArray,
  validateOneOf,
} = require("internal/validators");
const util = require("node:util");

const vm = $cpp("NodeVM.cpp", "Bun::createNodeVMBinding");

const ObjectFreeze = Object.freeze;
const ObjectDefineProperty = Object.defineProperty;
const ArrayPrototypeMap = Array.prototype.map;
const PromisePrototypeThen = $Promise.prototype.$then;
const PromiseResolve = Promise.$resolve.bind(Promise);
const PromiseReject = Promise.$reject.bind(Promise);
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
  createContext: createContextNative,
  isContext,
  compileFunction,
  isModuleNamespaceObject,
  kLinked,
  kEvaluated,
  kErrored,
  DONT_CONTEXTIFY,
  USE_MAIN_CONTEXT_DEFAULT_LOADER,
} = vm;

// Live vm contexts, tracked so measureMemory({ mode: "detailed" }) can report
// one entry per context like Node. WeakRefs so tracking doesn't keep contexts
// alive; dead entries are pruned on each measurement and, amortized, on
// creation (so a process that never measures doesn't accumulate dead refs).
const trackedContexts: WeakRef<object>[] = [];
let trackedContextsPruneAt = 64;

function pruneTrackedContexts() {
  let alive = 0;
  for (let i = 0; i < trackedContexts.length; i++) {
    const ref = trackedContexts[i];
    if (ref.deref() !== undefined) {
      trackedContexts[alive++] = ref;
    }
  }
  trackedContexts.length = alive;
  return alive;
}

function createContext(contextObject?, options?) {
  if (typeof options === "object" && options !== null) {
    validateOneOf(options.microtaskMode, "options.microtaskMode", ["afterEvaluate", undefined]);
  }
  const alreadyContextified = $isObject(contextObject) && isContext(contextObject);
  const context = createContextNative(contextObject, options);
  if (!alreadyContextified) {
    if (trackedContexts.length >= trackedContextsPruneAt) {
      const alive = pruneTrackedContexts();
      trackedContextsPruneAt = alive * 2 < 64 ? 64 : alive * 2;
    }
    trackedContexts.push(new WeakRef(context));
  }
  return context;
}

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

let emittedExperimentalWarnings: Set<string> | undefined;
function emitExperimentalWarning(feature: string) {
  emittedExperimentalWarnings ??= new Set();
  if (emittedExperimentalWarnings.$has(feature)) return;
  emittedExperimentalWarnings.$add(feature);
  process.emitWarning(`${feature} is an experimental feature and might change at any time`, "ExperimentalWarning");
}

function measureMemory(options = kEmptyObject) {
  emitExperimentalWarning("vm.measureMemory");
  validateObject(options, "options");
  const { mode = "summary", execution = "default" } = options as { mode?: string; execution?: string };
  validateOneOf(mode, "options.mode", ["summary", "detailed"]);
  validateOneOf(execution, "options.execution", ["default", "eager"]);

  // JSC has no per-context memory accounting like V8's
  // performance.measureMemory, so report the whole heap as the total and
  // attribute the heap range to each context. The result shape matches Node.
  const { memoryUsage } = require("bun:jsc");
  const { current, peak } = memoryUsage();
  const upperBound = peak > current ? peak : current;

  const measurement = () => ({ jsMemoryEstimate: current, jsMemoryRange: [current, upperBound] });

  // Node always includes a WebAssembly: { code, metadata } entry (both modes).
  // JSC exposes no equivalent wasm byte accounting, so report zeros for shape parity.
  const result: any = { total: measurement(), WebAssembly: { code: 0, metadata: 0 } };
  if (mode === "detailed") {
    result.current = measurement();
    const other: object[] = [];
    let aliveCount = 0;
    for (let i = 0; i < trackedContexts.length; i++) {
      const ref = trackedContexts[i];
      if (ref.deref() !== undefined) {
        trackedContexts[aliveCount++] = ref;
        other.push(measurement());
      }
    }
    trackedContexts.length = aliveCount;
    result.other = other;
  }

  return PromiseResolve(result);
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
    throw $ERR_INVALID_THIS(typename);
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

    // Check the JS-level status (it reflects the "linking" override while a
    // link() is in flight), not the native status which stays unlinked until
    // instantiate().
    if (this.status === "linked") {
      throw $ERR_VM_MODULE_ALREADY_LINKED();
    }

    if (this.status !== "unlinked") {
      throw $ERR_VM_MODULE_STATUS("must be unlinked");
    }

    await this[kLink](linker);
    this[kNative].instantiate();
  }

  // Not async: a synchronously-completed evaluation must return an
  // already-settled promise (util.inspect shows `Promise { undefined }`
  // immediately), matching Node where evaluate() forwards ModuleWrap's
  // promise and maps sync throws to a rejected promise.
  evaluate(options = kEmptyObject) {
    try {
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
      // Always call into native, even when already evaluated: Node re-enters
      // ModuleWrap::Evaluate, which performs the afterEvaluate microtask
      // checkpoint for contexts with their own microtask queue.
      const result = this[kNative].evaluate(timeout, breakOnSigint);
      if (status === kEvaluated) {
        // Re-evaluating a settled module resolves synchronously with
        // undefined (a then-chain on the cached promise would be pending).
        return PromiseResolve(undefined);
      }
      if ($isPromise(result)) {
        // Spec-style module evaluation capability: already settled (with
        // undefined) for synchronous modules, pending for top-level await.
        // Return it directly like Node returns ModuleWrap's promise — a
        // then-chain would make a synchronously-settled result look pending.
        return result;
      }
      return PromiseResolve(undefined);
    } catch (e) {
      return PromiseReject(e);
    }
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
  #moduleRequests: any;

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

    // Parse eagerly so a SyntaxError surfaces from the constructor and
    // moduleRequests is available immediately, matching Node where ModuleWrap
    // compiles the module during construction. JSC has no source-phase
    // imports, so every request is an evaluation-phase request.
    const requests = this[kNative].createModuleRecord();
    this.#moduleRequests = ObjectFreeze(
      ArrayPrototypeMap.$call(requests, request =>
        ObjectFreeze({
          __proto__: null,
          specifier: request.specifier,
          attributes: request.attributes,
          phase: "evaluation",
        }),
      ),
    );

    this[kDependencySpecifiers] = undefined;
  }

  async [kLink](linker) {
    validateModule(this, "SourceTextModule");

    if (this[kNative].getStatusCode() >= kLinked) {
      throw $ERR_VM_MODULE_ALREADY_LINKED();
    }

    this.#statusOverride = "linking";
    const moduleRequests = this.#moduleRequests;

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

  linkRequests(modules) {
    validateModule(this, "SourceTextModule");
    if (this.status !== "unlinked") {
      throw $ERR_VM_MODULE_STATUS("must be unlinked");
    }
    validateArray(modules, "modules");
    const moduleRequests = this.#moduleRequests;
    const requestCount = moduleRequests.length;
    const moduleCount = modules.length;
    if (moduleCount !== requestCount) {
      throw $ERR_MODULE_LINK_MISMATCH(`Expected ${requestCount} modules, got ${moduleCount}`);
    }
    const specifiers = Array(moduleCount);
    const moduleNatives = Array(moduleCount);
    for (let idx = 0; idx < moduleCount; idx++) {
      const mod = modules[idx];
      if (!isModule(mod)) {
        throw $ERR_VM_MODULE_NOT_MODULE();
      }
      if (mod.context !== this.context) {
        throw $ERR_VM_MODULE_DIFFERENT_CONTEXT();
      }
      specifiers[idx] = moduleRequests[idx].specifier;
      moduleNatives[idx] = mod[kNative];
    }
    this[kNative].link(specifiers, moduleNatives, 0);
  }

  instantiate() {
    validateModule(this, "SourceTextModule");
    if (this.status !== "unlinked") {
      throw $ERR_VM_MODULE_STATUS("must be unlinked");
    }
    this[kNative].instantiate();
  }

  get moduleRequests() {
    validateModule(this, "SourceTextModule");
    return this.#moduleRequests;
  }

  hasAsyncGraph() {
    validateModule(this, "SourceTextModule");
    if (this[kNative].getStatusCode() < kLinked) {
      throw $ERR_VM_MODULE_STATUS("must be instantiated");
    }
    return this[kNative].hasAsyncGraph();
  }

  hasTopLevelAwait() {
    validateModule(this, "SourceTextModule");
    return this[kNative].hasTopLevelAwait();
  }

  get dependencySpecifiers() {
    validateModule(this, "SourceTextModule");
    this[kDependencySpecifiers] ??= ObjectFreeze(
      ArrayPrototypeMap.$call(this.#moduleRequests, request => request.specifier),
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
    // A synthetic module does not have dependencies; Node instantiates it
    // directly in the constructor so setExport()/evaluate() work right away.
    this[kNative].instantiate();
  }

  link() {
    validateModule(this, "SyntheticModule");
    // No-op for synthetic modules; do not invoke super.link() as the module
    // is already linked from the constructor and it would throw.
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
  const importModuleDynamicallyWrapper = async (specifier, referrer, attributes, phase) => {
    // JSC has no source-phase imports, so every dynamic import is an
    // evaluation-phase request (Node passes the phase name as 4th argument).
    const m: any = await importModuleDynamically.$call(this, specifier, referrer, attributes, phase ?? "evaluation");
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
    if (descriptor !== undefined) {
      const value = descriptor.value;
      if (typeof value === "function" && value.name !== "") {
        return value;
      }
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
