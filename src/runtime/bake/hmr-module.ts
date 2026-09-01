// This is an implementation of a module loader with hot-reloading support.
// Note that this aims to implement the behavior of `bun build` rather than what
// the ECMAScript Module spec says. This way, development builds function like
// the production ones from `bun build`.
//
// Some build failures from the bundler surface as runtime errors here, such as
// `require` on a module with transitive top-level await, or a missing export.
// This was done to make incremental updates as isolated as possible.
import {
  __callDispose,
  __EARLY_RETURN_SENTINEL,
  __legacyDecorateClassTS,
  __legacyDecorateParamTS,
  __legacyMetadataTS,
  __MEMO_CACHE_SENTINEL,
  __name,
  __using,
} from "../../runtime.bun";
// This import is different based on client vs server side.
// On the server, remapping is done automatically.
import { type SourceMapURL, derefMapping } from "#stack-trace";

/** List of loaded modules. Every `Id` gets one HMRModule, mutated across updates. */
const registry = new Map<Id, HMRModule>();
const registrySourceMapIds = new Map<string, SourceMapURL>();
/** Server */
export const serverManifest = {};
/** Server */
export const ssrManifest = {};
/** Client */
export let onServerSideReload: (() => Promise<void>) | null = null;
const eventHandlers: Record<HMREvent | string, HotEventHandler[] | undefined> = {};
let refreshRuntime: any;
/** The expression `import(a,b)` is not supported in all browsers, most notably
 * in Mozilla Firefox in 2025. Bun lazily evaluates it, so a SyntaxError gets
 * thrown upon first usage. */
let lazyDynamicImportWithOptions: null | Function = null;

const enum State {
  Pending,
  Stale,
  Loaded,
  Error,
}
const enum ESMProps {
  imports,
  exports,
  stars,
  load,
  isAsync,
}

/** Given an Id, return the module namespace object.
 * For use in other functions in the HMR runtime.
 * Registers that module as a root. */
export async function loadExports<T>(id: Id): Promise<T> {
  const m = await loadModuleAsync(id, false, null);
  return m.esm ? m.exports : m.cjs.exports;
}

interface HotAccept {
  modules: string[];
  cb: HotAcceptFunction;
  single: boolean;
}

interface CJSModule {
  id: Id;
  exports: unknown;
  require: (id: Id) => unknown;
}

/** Implementation details must remain in sync with the parser (src/js_parser) and bundler (src/bundler/bundle_v2.rs) */
export class HMRModule {
  /** Key in `registry` */
  id: Id;
  /** ES Modules have different semantics for `.exports` and `.cjs` */
  esm: boolean;
  state: State = State.Pending;
  /** The ESM namespace object. `null` until the module is instantiated; from
   * then on it is a live object, even while the module still evaluates. */
  exports: any = null;
  /** For ESM, this is the converted CJS exports.
   *  For CJS, this is the `module` object. */
  cjs: CJSModule | any | null;
  /** When a module fails to load, trying to load it again
   *  should throw the same error */
  failure: unknown = null;
  /** Two purposes:
   * 1. HMRModule[] - List of parsed imports. indexOf is used to go from HMRModule -> updater function
   * 2. any[] - List of module namespace objects. Read by the ESM module's load function.
   * Unused for CJS
   *
   * Stays `null` until the module evaluates, which is after its dependencies
   * load.
   */
  imports: HMRModule[] | any[] | null = null;
  /** Assigned by an ESM module's load function. A two-phase module assigns it
   * while it instantiates, which is before `imports` is filled in.
   * HTML files do not emit a store to this field */
  updateImport: ((exports: any) => void)[] | null = null;
  /** When calling `import.meta.hot.dispose` */
  onDispose: HotDisposeFunction[] | null = null;
  /** When calling `import.meta.hot.accept` to self-accept */
  selfAccept: HotAcceptFunction | null = null;
  /** When calling `import.meta.hot.accept` on another module */
  depAccepts: Record<Id, HotAccept> | null = null;
  /** All modules that have imported this module */
  importers = new Set<HMRModule>();
  /** import.meta.hot.data rewrites to this */
  data: any = {};

  constructor(id: Id, isCommonJS: boolean) {
    this.id = id;
    this.esm = !isCommonJS;
    this.cjs = isCommonJS
      ? {
          id,
          exports: {},
          require: this.require.bind(this),
        }
      : null;
  }

  // Module Ids are pre-resolved by the bundler
  requireResolve(id: Id): Id {
    return id;
  }

  require(id: Id) {
    try {
      const mod = loadModuleSync(id, true, this);
      return mod.esm ? (mod.cjs ??= toCommonJS(mod.exports)) : mod.cjs.exports;
    } catch (e: any) {
      if (e instanceof AsyncImportError) {
        e.message = `Cannot require "${id}" because "${e.asyncId}" uses top-level await, but 'require' is a synchronous operation.`;
      }
      throw e;
    }
  }

  /** Lowered from `.e_import` (import(id)) */
  dynamicImport(id: Id, opts?: ImportCallOptions) {
    const found = loadModuleAsync(id, true, this);
    if (found) {
      if ((found as HMRModule).id === id) return Promise.resolve(getEsmExports(found as HMRModule));
      return (found as Promise<HMRModule>).then(getEsmExports);
    }
    return opts
      ? (lazyDynamicImportWithOptions ??= new Function("specifier, opts", "import(specifier, opts)"))(id, opts)
      : import(id);
  }

  reactRefreshAccept() {
    if (isReactRefreshBoundary(this.exports)) {
      this.accept();
    }
  }

  get importMeta() {
    const importMeta = {
      url: `${location.origin}/${this.id}`,
      main: false,
      require: this.require.bind(this),
      // transpiler rewrites `import.meta.hot.*` to access `HMRModule.*`
      get hot() {
        throw new Error("import.meta.hot cannot be used indirectly.");
      },
    };
    Object.defineProperty(this, "importMeta", { value: importMeta });
    return importMeta;
  }

  // Bundler rewrites all import.meta.hot.* to access the corresponding methods
  // on HMRModule directly.  The following code implements that interface. Data
  // is an opaque property, which is preserved simply by the fact HMRModule is
  // not destructed.

  accept(
    arg1?: string | readonly string[] | HotAcceptFunction,
    arg2?: HotAcceptFunction | HotArrayAcceptFunction | undefined,
  ) {
    if (arg2 == undefined) {
      if (arg1 == undefined) {
        this.selfAccept = implicitAcceptFunction;
        return;
      }
      if (typeof arg1 !== "function") {
        throw new Error("import.meta.hot.accept requires a callback function");
      }
      // Self-accept function
      this.selfAccept = arg1;
    } else {
      throw new Error(
        '"import.meta.hot.accept" must be directly called with string literals for ' +
          "the specifiers. This way, the bundler can pre-process the arguments.",
      );
    }
  }

  acceptSpecifiers(specifiers: string | readonly string[], cb?: HotAcceptFunction | HotArrayAcceptFunction) {
    this.depAccepts ??= {};
    const isArray = Array.isArray(specifiers);
    const accept: HotAccept = {
      modules: isArray ? specifiers : [specifiers],
      cb: cb as HotAcceptFunction,
      single: !isArray,
    };
    if (isArray) {
      for (const specifier of specifiers) {
        this.depAccepts[specifier] = accept;
      }
    } else {
      this.depAccepts[specifiers as string] = accept;
    }
  }

  decline() {} // Vite: "This is currently a noop and is there for backward compatibility"

  dispose(cb: HotDisposeFunction) {
    (this.onDispose ??= []).push(cb);
  }

  prune(cb: HotDisposeFunction) {
    // Bun currently does not throw away detached modules yet.
    // So never calling the function technically implements this.
  }

  invalidate() {
    emitEvent("bun:invalidate", null);
    // by throwing an error right now, this will cause a page refresh
    throw new Error("TODO: implement ImportMetaHot.invalidate");
  }

  on(event: string, cb: HotEventHandler) {
    // Vite compatibility, but favor using Bun's event names.
    if (event.startsWith("vite:")) {
      event = "bun:" + event.slice(4);
    }

    (eventHandlers[event] ??= []).push(cb);
    this.dispose(() => this.off(event, cb));
  }

  off(event: string, cb: HotEventHandler) {
    const handlers = eventHandlers[event];
    if (!handlers) return;
    const index = handlers.indexOf(cb);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  send(event: string, cb: HotEventHandler) {
    throw new Error("TODO: implement ImportMetaHot.send");
  }

  declare indirectHot: any;

  /** Server-only */
  declare builtin: (id: string) => any;
}
if (side === "server") {
  HMRModule.prototype.builtin = (id: string) =>
    // @ts-expect-error
    import.meta.bakeBuiltin(import.meta.resolve(id));
}
// prettier-ignore
HMRModule.prototype.indirectHot = new Proxy({}, {
  get(_, prop) {
    if (typeof prop === "symbol") return undefined;
    throw new Error(`import.meta.hot.${prop} cannot be used indirectly.`);
  },
  set() {
    throw new Error(`The import.meta.hot object cannot be mutated.`);
  },
});

// TODO: This function is currently recursive.
export function loadModuleSync(
  id: Id,
  isUserDynamic: boolean,
  importer: HMRModule | null,
  importIndex?: number,
): HMRModule {
  // First, try and re-use an existing module.
  let mod = registry.get(id);
  if (mod) {
    if (mod.state === State.Error) throw mod.failure;
    if (mod.state === State.Stale) {
      beginEvaluation(mod);
      isUserDynamic = false;
    } else {
      if (importer) {
        mod.importers.add(importer);
      }
      bindImportOfImporterOnStack(importer, importIndex, mod);
      return mod;
    }
  }
  const loadOrEsmModule = unloadedModuleRegistry[id];
  if (!loadOrEsmModule) throwNotFound(id, isUserDynamic);

  if (typeof loadOrEsmModule === "function") {
    // CommonJS
    if (!mod) {
      mod = new HMRModule(id, true);
      registry.set(id, mod);
    } else if (mod.esm) {
      mod.esm = false;
      mod.cjs = {
        id,
        exports: {},
        require: mod.require.bind(mod),
      };
      mod.exports = null;
    }
    if (importer) {
      mod.importers.add(importer);
    }
    try {
      const cjs = mod.cjs;
      loadOrEsmModule(mod, cjs, cjs.exports);
    } catch (e) {
      mod.state = State.Stale;
      mod.cjs.exports = {};
      throw e;
    }
    mod.state = State.Loaded;
    bindImportOfImporterOnStack(importer, importIndex, mod);
  } else {
    // ESM
    if (IS_BUN_DEVELOPMENT) {
      try {
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[ESMProps.imports]));
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[ESMProps.exports]));
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[ESMProps.stars]));
        DEBUG.ASSERT(typeof loadOrEsmModule[ESMProps.load] === "function");
        DEBUG.ASSERT(typeof loadOrEsmModule[ESMProps.isAsync] === "boolean");
      } catch (e) {
        console.warn(id, loadOrEsmModule);
        throw e;
      }
    }
    const {
      [ESMProps.imports]: deps,
      [ESMProps.stars]: stars,
      [ESMProps.load]: load,
      [ESMProps.isAsync]: isAsync,
    } = loadOrEsmModule;
    if (isAsync) {
      throw new AsyncImportError(id);
    }
    if (!mod) {
      mod = new HMRModule(id, false);
      registry.set(id, mod);
    } else if (!mod.esm) {
      mod.esm = true;
      mod.cjs = null;
      mod.exports = null;
    }
    if (importer) {
      mod.importers.add(importer);
    }

    const link = instantiateEsm(mod, load, stars, importer, importIndex);
    let depsList: HMRModule[];
    try {
      ({ list: depsList } = parseEsmDependencies(mod, deps, loadModuleSync));
    } catch (e) {
      if (e instanceof AsyncImportError) {
        // A dependency needs top-level await, so this module cannot be
        // required. Its body did not run; a dynamic import can retry it.
        mod.state = State.Stale;
        throw e;
      }
      throwLoadFailure(mod, e);
    }
    evaluateEsm(mod, link, depsList);
  }

  return mod;
}

// Do not add the `async` keyword to this function, that way the list of
// `HMRModule`s can be created synchronously, even if evaluation is not.
// Returns `null` if the module is not found in dynamic mode, so that the caller
// can use the `import` keyword instead.
// TODO: This function is currently recursive.
export function loadModuleAsync<IsUserDynamic extends boolean>(
  id: Id,
  isUserDynamic: IsUserDynamic,
  importer: HMRModule | null,
  importIndex?: number,
): (IsUserDynamic extends true ? null : never) | Promise<HMRModule> | HMRModule {
  // First, try and re-use an existing module.
  let mod = registry.get(id)!;
  if (mod) {
    const { state } = mod;
    if (state === State.Error) throw mod.failure;
    if (state === State.Stale) {
      beginEvaluation(mod);
      isUserDynamic = false as IsUserDynamic;
    } else {
      if (importer) {
        mod.importers.add(importer);
      }
      bindImportOfImporterOnStack(importer, importIndex, mod);
      return mod;
    }
  }
  const loadOrEsmModule = unloadedModuleRegistry[id];
  if (!loadOrEsmModule) {
    if (isUserDynamic) return null!;
    throwNotFound(id, isUserDynamic);
  }

  if (typeof loadOrEsmModule === "function") {
    // CommonJS
    if (!mod) {
      mod = new HMRModule(id, true);
      registry.set(id, mod);
    } else if (mod.esm) {
      mod.esm = false;
      mod.cjs = {
        id,
        exports: {},
        require: mod.require.bind(mod),
      };
      mod.exports = null;
    }
    if (importer) {
      mod.importers.add(importer);
    }
    try {
      const cjs = mod.cjs;
      loadOrEsmModule(mod, cjs, cjs.exports);
    } catch (e) {
      mod.state = State.Stale;
      mod.cjs.exports = {};
      throw e;
    }
    mod.state = State.Loaded;
    bindImportOfImporterOnStack(importer, importIndex, mod);
    return mod;
  } else {
    // ESM
    if (IS_BUN_DEVELOPMENT) {
      try {
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[0]));
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[1]));
        DEBUG.ASSERT(Array.isArray(loadOrEsmModule[2]));
        DEBUG.ASSERT(typeof loadOrEsmModule[3] === "function");
        DEBUG.ASSERT(typeof loadOrEsmModule[4] === "boolean");
      } catch (e) {
        console.warn(id, loadOrEsmModule);
        throw e;
      }
    }
    const {
      [ESMProps.imports]: deps,
      [ESMProps.stars]: stars,
      [ESMProps.load]: load,
      [ESMProps.isAsync]: selfIsAsync,
    } = loadOrEsmModule;

    if (!mod) {
      mod = new HMRModule(id, false);
      registry.set(id, mod);
    } else if (!mod.esm) {
      mod.esm = true;
      mod.exports = null;
      mod.cjs = null;
    }
    if (importer) {
      mod.importers.add(importer);
    }

    const link = instantiateEsm(mod, load, stars, importer, importIndex);
    let list: (HMRModule | Promise<HMRModule>)[];
    let isAsync: boolean;
    try {
      ({ list, isAsync } = parseEsmDependencies(mod, deps, loadModuleAsync<false>));
    } catch (e) {
      throwLoadFailure(mod, e);
    }
    DEBUG.ASSERT(
      isAsync //
        ? list.some(x => x instanceof Promise)
        : list.every(x => x instanceof HMRModule),
    );

    // Evaluating synchronously when there are no promises is not a
    // performance optimization but a behavioral correctness issue.
    return isAsync
      ? Promise.all(list).then(
          list => evaluateEsm(mod, link, list, selfIsAsync),
          e => throwLoadFailure(mod, e),
        )
      : evaluateEsm(
          mod,
          link,
          list as HMRModule[], // no promises as by assert above
          selfIsAsync,
        );
  }
}

/** Stale -> Pending: the bindings of the previous evaluation take no part in
 * this one. */
function beginEvaluation(mod: HMRModule) {
  mod.imports = null;
  mod.updateImport = null;
  mod.state = State.Pending;
}

/** Records the failure, so that the next import of this id throws it again
 * instead of handing out a module that never finished. */
function throwLoadFailure(mod: HMRModule, e: unknown): never {
  mod.state = State.Error;
  mod.failure = e;
  throw e;
}

/** The state of an ESM module between its two link phases. */
interface EsmLink {
  gen: ModuleLoadGenerator;
  /** The promise of the first resume of an async generator (a module with
   * top-level await). It settles after the instantiate statements ran, and
   * the body may only be resumed after it. `null` for a sync generator. */
  instantiated: Promise<unknown> | null;
  /** Star re-exports whose names are only known after the dependencies load. */
  lateStars: Id[] | null;
}

/** Phase one of the ESM link. The load function is a generator: the first
 * resume instantiates the module (hoisted function declarations, the import
 * variables, `hmr.updateImport` and the `hmr.exports` object exist after it),
 * and no statement of the body runs. Instantiation happens before the
 * dependencies load, so a module in an import cycle reads this module's
 * namespace object, not `null`.
 *
 * A module with top-level await is an async generator. Its first resume still
 * runs the instantiate statements synchronously; only the promise settles
 * later. */
function instantiateEsm(
  mod: HMRModule,
  load: UnloadedESM[ESMProps.load],
  stars: Id[],
  importer: HMRModule | null,
  importIndex: number | undefined,
): EsmLink {
  try {
    const gen = load(mod);
    const exportsBefore = mod.exports;
    const first = gen.next();
    let instantiated: Promise<unknown> | null = null;
    if (first instanceof Promise) {
      // A module with top-level await. A rejection surfaces through
      // `evaluateEsm`; this handler only keeps it from being reported as
      // unhandled before then.
      first.catch(noop);
      instantiated = first;
    }
    if (mod.exports === exportsBefore) mod.exports = {};
    const lateStars = mergeStarExports(mod, stars);
    bindImportOfImporterOnStack(importer, importIndex, mod);
    return { gen, instantiated, lateStars };
  } catch (e) {
    throwLoadFailure(mod, e);
  }
}

/** The importer is on the stack while its dependency loads: the body of the
 * importer has not bound its imports yet. A function of the importer that
 * the body of a later dependency calls, as happens in an import cycle, must
 * already see the namespace object. So the binding is made here, as soon as
 * the dependency instantiates or, for a dependency that is already in the
 * registry, as soon as the importer requests it. An import later in the list
 * of the importer binds when its own module instantiates, after this
 * dependency evaluated; webpack and the Vite module runner behave the same
 * way. A CommonJS importer has no `updateImport` and binds its imports
 * itself. */
function bindImportOfImporterOnStack(
  importer: HMRModule | null,
  importIndex: number | undefined,
  dependency: HMRModule,
) {
  if (importer === null || importIndex === undefined) return;
  // A CommonJS module that is still evaluating in a require cycle is
  // skipped: converting its namespace now would cache a partial snapshot.
  // The importer binds it when the importer evaluates, like Node.
  if (!dependency.esm && dependency.state !== State.Loaded) return;
  const exports = getEsmExports(dependency);
  if (exports) importer.updateImport?.[importIndex](exports);
}

/** Phase two of the ESM link, after the dependencies loaded: the second
 * resume runs the body. A module with top-level await settles later, so this
 * returns a promise for it. */
function evaluateEsm(mod: HMRModule, link: EsmLink, modules: HMRModule[], isAsync: true): Promise<HMRModule>;
function evaluateEsm(mod: HMRModule, link: EsmLink, modules: HMRModule[], isAsync?: false): HMRModule;
function evaluateEsm(
  mod: HMRModule,
  link: EsmLink,
  modules: HMRModule[],
  isAsync?: boolean,
): HMRModule | Promise<HMRModule>;
function evaluateEsm(
  mod: HMRModule,
  link: EsmLink,
  modules: HMRModule[],
  isAsync?: boolean,
): HMRModule | Promise<HMRModule> {
  const { gen, instantiated, lateStars } = link;
  const shouldPatchImporters = !mod.selfAccept || mod.selfAccept === implicitAcceptFunction;
  // The body reads `hmr.imports` as its first statement, synchronously within
  // the resume, so the list of modules can replace the namespaces right after.
  const resume = () => {
    mod.imports = modules.map(getEsmExports);
    const step = gen.next();
    mod.imports = modules;
    return step;
  };
  const finish = () => {
    mod.cjs = null;
    mod.state = State.Loaded;
    if (shouldPatchImporters) patchImporters(mod);
    return mod;
  };
  try {
    if (lateStars) mergeLateStarExports(mod, lateStars);
    if (isAsync) {
      DEBUG.ASSERT(instantiated !== null);
      return instantiated!.then(resume).then(finish, e => throwLoadFailure(mod, e));
    }
    resume();
    return finish();
  } catch (e) {
    throwLoadFailure(mod, e);
  }
}

function noop() {}

/** Implements `export * from`, from the star-import list of the module
 * tuple. Runs in the instantiate phase, before the dependencies load, so a
 * module in an import cycle sees the star re-exported names. The names of an
 * ESM dependency come from the static export list in the unloaded module
 * registry. Every name except "default" that the module does not declare
 * itself is re-exported through a getter, which keeps the binding live.
 *
 * Returns the ids whose export names are not statically known (CommonJS
 * modules, and chains through them). The loader merges those after the
 * dependencies load, in `mergeLateStarExports`. */
function mergeStarExports(mod: HMRModule, stars: Id[]): Id[] | null {
  if (stars.length === 0) return null;
  const exp = mod.exports;
  // The module's own exports always win. Snapshot them so a later star
  // dependency can overwrite a key added by an earlier one (matching the
  // last-wins order of the object spread this replaces).
  const ownKeys = new Set(Object.keys(exp));
  let lateIds: Id[] | null = null;

  // The getter reads the module that declares the name, not the star
  // dependency that forwards it. A name declared by a module is an own
  // property of its namespace object, so the read ends there. A getter that
  // read the star dependency instead would loop when two barrels star each
  // other and a third module provides the name.
  const defineForward = (ownerId: Id, key: string) => {
    if (key === "default" || ownKeys.has(key)) return;
    Object.defineProperty(exp, key, {
      // HMRModule instances are mutated across hot updates, never replaced,
      // so resolving through the registry reads the latest exports.
      get: () => {
        const m = registry.get(ownerId);
        return m && getEsmExports(m)[key];
      },
      enumerable: true,
      configurable: true,
    });
  };

  const starNamesMemo = new Map<Id, StarNames>();
  for (const starId of stars) {
    const unloaded = unloadedModuleRegistry[starId];
    if (Array.isArray(unloaded)) {
      // ESM: resolve every name the dependency provides to the module that
      // declares it. The walk starts with this module on the stack, so a
      // star chain that comes back here contributes nothing.
      const { names, sawDynamic } = resolveStarNames(starId, [mod.id], starNamesMemo);
      for (const [key, ownerId] of names) {
        defineForward(ownerId, key);
      }
      // A nested star through a CommonJS module: its names are only known
      // after it runs, so re-merge this dependency late.
      if (sawDynamic) (lateIds ??= []).push(starId);
    } else if (typeof unloaded === "function") {
      // CommonJS: the export names are only known after the module runs.
      (lateIds ??= []).push(starId);
    } else if (registry.get(starId)) {
      // A synthetic module (`registerSynthetic`), already loaded.
      (lateIds ??= []).push(starId);
    } else if (side === "server") {
      // A builtin, for example `export * from "node:path"` on the server.
      const ns = mod.builtin(starId);
      for (const key of Object.keys(ns)) {
        if (key === "default" || ownKeys.has(key)) continue;
        Object.defineProperty(exp, key, {
          get: () => ns[key],
          enumerable: true,
          configurable: true,
        });
      }
    }
  }
  return lateIds;
}

/** The names an ESM module provides: every key maps to the module that
 * declares it. */
interface StarNames {
  names: Map<string, Id>;
  /** A CommonJS module was met; its names are only known after it runs. */
  sawDynamic: boolean;
  /** The walk was cut by a cycle through an ancestor other than the root,
   * so this map depends on the path and must not be cached. */
  cut: boolean;
}

/** Maps every name that the ESM module `id` provides to the module that
 * declares it, with the precedence of a namespace object: an own name wins
 * over a star, and a later star wins over an earlier one. `stack` holds the
 * modules whose stars are being resolved, so a circular star re-export is cut
 * where it closes. `memo` caches the finished map of a module and replays it
 * for every star edge, so a shared subtree of a diamond-shaped barrel graph
 * is walked once without a loss of the edge order. */
function resolveStarNames(id: Id, stack: Id[], memo: Map<Id, StarNames>): StarNames {
  const cached = memo.get(id);
  if (cached) return cached;
  const result: StarNames = { names: new Map(), sawDynamic: false, cut: false };
  const unloaded = unloadedModuleRegistry[id];
  if (!Array.isArray(unloaded)) {
    result.sawDynamic = true;
    memo.set(id, result);
    return result;
  }
  stack.push(id);
  for (const nested of unloaded[ESMProps.stars]) {
    if (stack.includes(nested)) {
      // The root is on every stack of this walk, so only a cycle through
      // another ancestor makes the result path-dependent.
      if (nested !== stack[0]) result.cut = true;
      continue;
    }
    const sub = resolveStarNames(nested, stack, memo);
    if (sub.sawDynamic) result.sawDynamic = true;
    if (sub.cut) result.cut = true;
    for (const [key, ownerId] of sub.names) {
      result.names.set(key, ownerId);
    }
  }
  stack.pop();
  for (const key of unloaded[ESMProps.exports]) {
    result.names.set(key, id);
  }
  if (!result.cut) memo.set(id, result);
  return result;
}

/** Second half of `mergeStarExports`, after the dependencies load. Only adds
 * names the static merge could not define. */
function mergeLateStarExports(mod: HMRModule, lateIds: Id[]) {
  const exp = mod.exports;
  // Snapshot the keys the static merge defined (own exports and ESM star
  // names) so they win, while a later late star can still overwrite a key
  // an earlier one added (last-wins, like the static merge).
  const preKeys = new Set(Object.keys(exp));
  for (const starId of lateIds) {
    const starMod = registry.get(starId);
    if (!starMod) continue;
    const ns = getEsmExports(starMod);
    for (const key of Object.keys(ns)) {
      if (key === "default" || preKeys.has(key)) continue;
      Object.defineProperty(exp, key, {
        get: () => getEsmExports(starMod)[key],
        enumerable: true,
        configurable: true,
      });
    }
  }
}

type GenericModuleLoader<R> = (id: Id, isUserDynamic: false, importer: HMRModule, importIndex: number) => R;
// TODO: This function is currently recursive.
function parseEsmDependencies<T extends GenericModuleLoader<any>>(
  parent: HMRModule,
  deps: (string | number)[],
  enqueueModuleLoad: T,
) {
  let i = 0;
  let list: ReturnType<T>[] = [];
  let isAsync = false;
  const { length } = deps;
  while (i < length) {
    const dep = deps[i] as string;
    DEBUG.ASSERT(typeof dep === "string");
    let expectedExportKeyEnd = i + 2 + (deps[i + 1] as number);
    DEBUG.ASSERT(typeof deps[i + 1] === "number");
    const promiseOrModule = enqueueModuleLoad(dep, false, parent, list.length);
    list.push(promiseOrModule);

    const unloadedModule = unloadedModuleRegistry[dep];
    if (!unloadedModule) {
      throwNotFound(dep, false);
    }
    if (typeof unloadedModule !== "function") {
      const availableExportKeys = unloadedModule[ESMProps.exports];
      i += 2;
      while (i < expectedExportKeyEnd) {
        const key = deps[i] as string;
        DEBUG.ASSERT(typeof key === "string");
        // TODO: there is a bug in the way exports are verified. Additionally a
        // possible performance issue. For the meantime, this is disabled since
        // it was not shipped in the initial 1.2.3 HMR, and real issues will
        // just throw 'undefined is not a function' or so on.

        // if (!availableExportKeys.includes(key)) {
        //   if (!hasExportStar(unloadedModule[ESMProps.stars], key)) {
        //     throw new SyntaxError(`Module "${dep}" does not export key "${key}"`);
        //   }
        // }
        i++;
      }
      isAsync ||= promiseOrModule instanceof Promise;
    } else {
      DEBUG.ASSERT(!registry.get(dep)?.esm);
      i = expectedExportKeyEnd;

      if (IS_BUN_DEVELOPMENT) {
        DEBUG.ASSERT((list[list.length - 1] as any) instanceof HMRModule);
      }
    }
  }
  return { list, isAsync };
}

function hasExportStar(starImports: Id[], key: string) {
  if (starImports.length === 0) return false;
  const queue: Id[] = [...starImports];
  const visited = new Set<Id>();
  while (queue.length > 0) {
    const starImport = queue.shift()!;
    if (visited.has(starImport)) continue;
    visited.add(starImport);
    const mod = unloadedModuleRegistry[starImport];
    DEBUG.ASSERT(mod, `Module "${starImport}" not found`);
    if (typeof mod === "function") {
      return true;
    }
    const availableExportKeys = mod[ESMProps.exports];
    if (availableExportKeys.includes(key)) {
      return true; // Found
    }
    const nestedStarImports = mod[ESMProps.stars];
    for (const nestedImport of nestedStarImports) {
      if (!visited.has(nestedImport)) {
        queue.push(nestedImport);
      }
    }
  }

  return false;
}

function getEsmExports(m: HMRModule) {
  return m.esm ? m.exports : (m.exports ??= toESM(m.cjs.exports));
}

type HotAcceptFunction = (esmExports?: any | void) => void;
type HotArrayAcceptFunction = (esmExports: (any | void)[]) => void;
type HotDisposeFunction = (data: any) => void | Promise<void>;
type HotEventHandler = (data: any) => void;

// If updating this, make sure the `devserver.d.ts` types are
// kept in sync.
type HMREvent =
  | "bun:ready"
  | "bun:beforeUpdate"
  | "bun:afterUpdate"
  | "bun:beforeFullReload"
  | "bun:beforePrune"
  | "bun:invalidate"
  | "bun:error"
  | "bun:ws:disconnect"
  | "bun:ws:connect";

/** Called when modules are replaced. */
export async function replaceModules(modules: Record<Id, UnloadedModule>, sourceMapId?: SourceMapURL) {
  Object.assign(unloadedModuleRegistry, modules);

  emitEvent("bun:beforeUpdate", null);

  type ToAccept = {
    cb: HotAccept;
    key: Id;
  };
  const toReload = new Set<HMRModule>();
  const toAccept: ToAccept[] = [];
  let failures: Set<Id> | null = null;
  const toDispose: HMRModule[] = [];

  // Discover all HMR boundaries
  outer: for (const key of Object.keys(modules)) {
    // Unref old source maps, and track new ones
    if (side === "client") {
      DEBUG.ASSERT(sourceMapId);
      const existingSourceMapId = registrySourceMapIds.get(key);
      if (existingSourceMapId) derefMapping(existingSourceMapId);
      registrySourceMapIds.set(key, sourceMapId);
    }

    const existing = registry.get(key);
    if (!existing) continue;

    toReload.add(existing);

    // Discover all HMR boundaries
    const visited = new Set<HMRModule>();
    const queue: HMRModule[] = [existing];
    visited.add(existing);
    while (true) {
      const mod = queue.shift();
      if (!mod) break;

      // Stop propagation if the module is self-accepting
      let hadSelfAccept = true;
      if (mod.selfAccept) {
        toReload.add(mod);
        visited.add(mod);
        hadSelfAccept = false;
        if (mod.onDispose) {
          toDispose.push(mod);
        }
      }
      // Modules that mutate data are implied to handle updates via reusing their `data` property
      else if (Object.keys(mod.data).length > 0) {
        mod.selfAccept ??= implicitAcceptFunction;
        toReload.add(mod);
        visited.add(mod);
        hadSelfAccept = false;
        if (mod.onDispose) {
          toDispose.push(mod);
        }
      }

      // All importers will be visited
      if (hadSelfAccept && mod.importers.size === 0) {
        failures ??= new Set();
        failures.add(key);
        continue outer;
      }

      for (const importer of mod.importers) {
        const cb = importer.depAccepts?.[key];
        if (cb) {
          toAccept.push({ cb, key });
        } else if (hadSelfAccept) {
          if (visited.has(importer)) continue;
          visited.add(importer);
          queue.push(importer);
        }
      }
    }
  }

  // If roots were hit, print a nice message before reloading.
  if (failures) {
    let message =
      "[Bun] Hot update was not accepted because it or its importers do not call `import.meta.hot.accept`. To prevent full page reloads, call `import.meta.hot.accept` in one of the following files to handle the update:\n\n";

    // For each failed boundary, re-compute the path to the root.
    for (const boundary of failures) {
      const path: Id[] = [];
      let current = registry.get(boundary)!;
      DEBUG.ASSERT(!boundary.endsWith(".html")); // caller should have already reloaded
      DEBUG.ASSERT(current);
      DEBUG.ASSERT(current.selfAccept === null);
      if (current.importers.size === 0) {
        message += `Module "${boundary}" is a root module that does not self-accept.\n`;
        continue;
      }
      outer: while (current.importers.size > 0) {
        path.push(current.id);
        inner: for (const importer of current.importers) {
          if (importer.selfAccept) continue inner;
          if (importer.depAccepts?.[boundary]) continue inner;
          current = importer;
          continue outer;
        }
        DEBUG.ASSERT(false);
        break;
      }
      path.push(current.id);
      DEBUG.ASSERT(path.length > 0);
      message += `Module "${boundary}" is not accepted by ${path[1]}${path.length > 1 ? "," : "."}\n`;
      for (let i = 2, len = path.length; i < len; i++) {
        const isLast = i === len - 1;
        message += `${isLast ? "└" : "├"} imported by "${path[i]}"${isLast ? "." : ","}\n`;
      }
    }
    message = message.trim();
    if (side === "client") {
      sessionStorage?.setItem?.(
        "bun:hmr:message",
        JSON.stringify?.({
          message,
          kind: "warn",
        }),
      );
      fullReload();
    } else {
      console.warn(message);
    }
  }

  // Dispose all modules
  if (toDispose.length > 0) {
    const disposePromises: Promise<void>[] = [];
    for (const mod of toDispose) {
      mod.state = State.Stale;
      for (const fn of mod.onDispose!) {
        const p = fn(mod.data);
        if (p && p instanceof Promise) {
          disposePromises.push(p);
        }
      }
      mod.onDispose = null;
    }
    if (disposePromises.length > 0) {
      await Promise.all(disposePromises);
    }
  }

  // Reload all modules
  const promises: Promise<HMRModule>[] = [];
  for (const mod of toReload) {
    mod.state = State.Stale;
    const selfAccept = mod.selfAccept;
    mod.selfAccept = null;
    mod.depAccepts = null;

    const modOrPromise = loadModuleAsync(mod.id, false, null);
    if (modOrPromise === mod) {
      if (selfAccept) {
        selfAccept(getEsmExports(mod));
      }
    } else {
      DEBUG.ASSERT(modOrPromise instanceof Promise);
      promises.push(
        (modOrPromise as Promise<HMRModule>).then(mod => {
          if (selfAccept) {
            selfAccept(getEsmExports(mod));
          }
          return mod;
        }),
      );
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  for (const mod of toReload) {
    const { selfAccept } = mod;
    if (selfAccept && selfAccept !== implicitAcceptFunction) continue;
    patchImporters(mod);
  }

  // Call all accept callbacks
  for (const { cb: cbEntry, key } of toAccept) {
    const { cb: cbFn, modules, single } = cbEntry;
    cbFn(single ? getEsmExports(registry.get(key)!) : createAcceptArray(modules, key));
  }

  if (refreshRuntime) {
    refreshRuntime.performReactRefresh();
  }

  emitEvent("bun:afterUpdate", null);
}

function patchImporters(mod: HMRModule) {
  const { importers } = mod;
  const exports = getEsmExports(mod);
  for (const importer of importers) {
    // `updateImport` is assigned during instantiation, `imports` only just
    // before evaluation, so an importer can be instantiated but not linked
    // yet. It reads the namespace object when it evaluates.
    if (!importer.esm || !importer.updateImport || !importer.imports) continue;
    const index = importer.imports.indexOf(mod);
    if (index === -1) continue; // require or dynamic import
    importer.updateImport[index](exports);
  }
}

function createAcceptArray(modules: string[], key: Id) {
  const arr = new Array(modules.length);
  arr.fill(undefined);
  const i = modules.indexOf(key);
  DEBUG.ASSERT(i !== -1);
  arr[i] = getEsmExports(registry.get(key)!);
  return arr;
}

export function emitEvent(event: HMREvent, data: any) {
  const handlers = eventHandlers[event];
  if (!handlers) return;
  for (const handler of handlers) {
    handler(data);
  }
}

export function onEvent(event: HMREvent, cb) {
  (eventHandlers[event] ??= [])!.push(cb);
}

function throwNotFound(id: Id, isUserDynamic: boolean) {
  if (isUserDynamic) {
    throw new Error(
      `Failed to resolve dynamic import '${id}'. With Bun's bundler, all imports must be statically known at build time so that the bundler can trace everything.`,
    );
  }
  if (IS_BUN_DEVELOPMENT) {
    console.warn("Available modules:", Object.keys(unloadedModuleRegistry));
  }
  throw new Error(
    `Failed to load bundled module '${id}'. This is not a dynamic import, and therefore is a bug in Bun's bundler.`,
  );
}

export function fullReload() {
  try {
    emitEvent("bun:beforeFullReload", null);
  } catch {}
  location.reload();
}

class AsyncImportError extends Error {
  asyncId: string;
  constructor(asyncId: string) {
    super(`Cannot load async module "${asyncId}" synchronously because it uses top-level await.`);
    this.asyncId = asyncId;
    Object.defineProperty(this, "name", { value: "Error" });
  }
}

/** See `runtime.js`'s `__toCommonJS`. This omits the cache. */
function toCommonJS(from: any) {
  var desc,
    entry = Object.defineProperty({}, "__esModule", { value: true });
  if ((from && typeof from === "object") || typeof from === "function")
    Object.getOwnPropertyNames(from).map(
      key =>
        !Object.prototype.hasOwnProperty.call(entry, key) &&
        Object.defineProperty(entry, key, {
          get: () => from[key],
          enumerable: !(desc = Object.getOwnPropertyDescriptor(from, key)) || desc.enumerable,
        }),
    );
  return entry;
}

function toESM(mod: any) {
  const to = Object.defineProperty(Object.create(null), "default", { value: mod, enumerable: true });
  if ((mod && typeof mod === "object") || typeof mod === "function")
    for (let key of Object.getOwnPropertyNames(mod))
      if (!Object.prototype.hasOwnProperty.call(to, key))
        Object.defineProperty(to, key, {
          get: () => mod[key],
          enumerable: true,
        });
  return to;
}

function registerSynthetic(id: Id, esmExports) {
  const module = new HMRModule(id, false);
  module.exports = esmExports;
  registry.set(id, module);
  unloadedModuleRegistry[id] = true as any;
}

export function setRefreshRuntime(runtime: HMRModule) {
  refreshRuntime = getEsmExports(runtime);

  if (typeof refreshRuntime.injectIntoGlobalHook === "function") {
    refreshRuntime.injectIntoGlobalHook(window);
  } else {
    console.warn(
      "refreshRuntime.injectIntoGlobalHook is not a function. " +
        "Something is wrong with the React Fast Refresh runtime.",
    );
  }
}

// react-refresh/runtime does not provide this function for us
// https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L748-L774
function isReactRefreshBoundary(esmExports): boolean {
  const { isLikelyComponentType } = refreshRuntime;
  if (!isLikelyComponentType) return true;
  if (isLikelyComponentType(esmExports)) {
    return true;
  }
  if (esmExports == null || typeof esmExports !== "object") {
    // Exit if we can't iterate over exports.
    return false;
  }
  let hasExports = false;
  let areAllExportsComponents = true;
  for (const key in esmExports) {
    hasExports = true;
    // Every getter on this object is a side-effect-free binding read that
    // the HMR runtime generated itself, so read through it. A read that
    // throws (temporal dead zone in an import cycle) is not a boundary.
    let exportValue;
    try {
      exportValue = esmExports[key];
    } catch {
      return false;
    }
    if (!isLikelyComponentType(exportValue)) {
      areAllExportsComponents = false;
    }
  }
  return hasExports && areAllExportsComponents;
}

function implicitAcceptFunction() {}

declare global {
  interface Error {
    asyncId?: string;
  }
}

// bun:bake/server, bun:bake/client, and bun:wrap are
// provided by this file instead of the bundler
registerSynthetic("bun:wrap", {
  __name,
  __legacyDecorateClassTS,
  __legacyDecorateParamTS,
  __legacyMetadataTS,
  __using,
  __callDispose,
  __MEMO_CACHE_SENTINEL,
  __EARLY_RETURN_SENTINEL,
});

if (side === "server") {
  registerSynthetic("bun:bake/server", {
    serverManifest,
    ssrManifest,
    actionManifest: null,
  });
}

if (side === "client") {
  registerSynthetic("bun:bake/client", {
    onServerSideReload: cb => (onServerSideReload = cb),
  });
}
