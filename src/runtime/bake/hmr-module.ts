// This is an implementation of a module loader with hot-reloading support.
// Note that this aims to implement the behavior of `bun build` rather than what
// the ECMAScript Module spec says. This way, development builds function like
// the production ones from `bun build`.
//
// Some build failures from the bundler surface as runtime errors here, such as
// `require` on a module with transitive top-level await, or a missing export.
// This was done to make incremental updates as isolated as possible.
import * as runtimeHelpers from "../../runtime.bun";
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
  /** The ESM namespace object. `null` if not yet initialized. */
  exports: any = null;
  /** For ESM, this is the converted CJS exports.
   *  For CJS, this is the `module` object. */
  cjs: CJSModule | any | null;
  /** Rethrown by later loads, until a hot update has the module evaluated again */
  failure: unknown = null;
  /** Bumped when an evaluation starts; a superseded evaluation must not publish its outcome. */
  generation = 0;
  /** Set while the load is suspended on top-level await; a Pending module without it is a cycle back-edge. */
  loading: { promise: Promise<HMRModule>; asyncId: Id } | null = null;
  /** Two purposes:
   * 1. HMRModule[] - List of parsed imports. indexOf is used to go from HMRModule -> updater function
   * 2. any[] - List of module namespace objects. Read by the ESM module's load function.
   * Unused for CJS
   */
  imports: HMRModule[] | any[] | null = null;
  /** Assignned by an ESM module's load function immediately.
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
  /** Persists across evaluations; `import.meta.hot.data` reads it through `data`. */
  hotData: any = {};
  /** The current evaluation touched `import.meta.hot.data`, so it takes the update itself. */
  usesData = false;

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

  get data() {
    this.usesData = true;
    return this.hotData;
  }

  // Module Ids are pre-resolved by the bundler
  requireResolve(id: Id): Id {
    return id;
  }

  require(id: Id) {
    try {
      const mod = loadModuleSync(id, true, this);
      return mod.esm ? (mod.cjs ??= toCommonJS(mod.exports)) : mod.cjs.exports;
    } catch (e) {
      if (e instanceof AsyncImportError) {
        throw new Error(
          `Cannot require "${id}" because "${e.asyncId}" uses top-level await, but 'require' is a synchronous operation.`,
        );
      }
      throw e;
    }
  }

  /** Lowered from `.e_import` (import(id)). `async` so a failed load rejects instead of throwing, like import() */
  async dynamicImport(id: Id, opts?: ImportCallOptions) {
    const found = loadModuleAsync(id, true, this);
    if (found) {
      if ((found as HMRModule).id === id) return getEsmExports(found as HMRModule);
      return (found as Promise<HMRModule>).then(getEsmExports);
    }
    return opts
      ? (lazyDynamicImportWithOptions ??= new Function("specifier, opts", "return import(specifier, opts)"))(id, opts)
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
    event = normalizeEventName(event);
    (eventHandlers[event] ??= []).push(cb);
    this.dispose(() => this.off(event, cb));
  }

  off(event: string, cb: HotEventHandler) {
    const handlers = eventHandlers[normalizeEventName(event)];
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
export function loadModuleSync(id: Id, isUserDynamic: boolean, importer: HMRModule | null): HMRModule {
  // First, try and re-use an existing module.
  let mod = registry.get(id);
  if (mod) {
    if (mod.state === State.Error) {
      // The importer fails too and must be reachable from here when this module is replaced.
      if (importer) mod.importers.add(importer);
      throw mod.failure;
    }
    if (mod.state === State.Stale) {
      isUserDynamic = false;
    } else {
      if (mod.loading) throw new AsyncImportError(mod.loading.asyncId);
      if (importer) {
        mod.importers.add(importer);
      }
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
    beginEvaluation(mod);
    try {
      const cjs = mod.cjs;
      loadOrEsmModule(mod, cjs, cjs.exports);
    } catch (e) {
      mod.state = State.Stale;
      mod.cjs.exports = {};
      throw e;
    }
    mod.state = State.Loaded;
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
    const { [ESMProps.imports]: deps, [ESMProps.load]: load, [ESMProps.isAsync]: isAsync } = loadOrEsmModule;
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

    const generation = beginEvaluation(mod);
    const { list: depsList } = parseEsmDependencies(mod, deps, loadModuleSync);
    const exportsBefore = mod.exports;
    mod.imports = depsList.map(getEsmExports);
    try {
      load(mod);
    } catch (e) {
      throwLoadFailure(mod, generation, e);
    } finally {
      mod.imports = depsList;
    }
    if (mod.exports === exportsBefore) mod.exports = {};
    mod.cjs = null;
    mod.state = State.Loaded;
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
): (IsUserDynamic extends true ? null : never) | Promise<HMRModule> | HMRModule {
  // First, try and re-use an existing module.
  let mod = registry.get(id)!;
  if (mod) {
    const { state } = mod;
    if (state === State.Error) {
      if (importer) mod.importers.add(importer);
      throw mod.failure;
    }
    if (state === State.Stale) {
      isUserDynamic = false as IsUserDynamic;
    } else {
      if (importer) {
        mod.importers.add(importer);
      }
      return mod.loading ? mod.loading.promise : mod;
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
    beginEvaluation(mod);
    try {
      const cjs = mod.cjs;
      loadOrEsmModule(mod, cjs, cjs.exports);
    } catch (e) {
      mod.state = State.Stale;
      mod.cjs.exports = {};
      throw e;
    }
    mod.state = State.Loaded;
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
    const [deps /* exports */ /* stars */, , , load, isAsync] = loadOrEsmModule;

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

    const generation = beginEvaluation(mod);
    const { list, asyncId: depAsyncId } = parseEsmDependencies(mod, deps, loadModuleAsync<false>);
    const hasAsyncDep = depAsyncId !== null;
    DEBUG.ASSERT(
      hasAsyncDep //
        ? list.some(x => x instanceof Promise)
        : list.every(x => x instanceof HMRModule),
    );

    // Running finishLoadModuleAsync synchronously when there are no promises is
    // not a performance optimization but a behavioral correctness issue.
    const result = hasAsyncDep
      ? Promise.all(list).then(
          list => finishLoadModuleAsync(mod, generation, load, list),
          e => throwLoadFailure(mod, generation, e),
        )
      : finishLoadModuleAsync(
          mod,
          generation,
          load,
          list as HMRModule[], // no promises as by assert above
        );
    if (result instanceof Promise) {
      // Same blame order as loadModuleSync: the module's own await before a dependency's.
      mod.loading = { promise: result, asyncId: isAsync ? id : depAsyncId! };
    }
    return result;
  }
}

/** Stale→Pending, new generation, no in-flight load, hooks cleared for the body to register anew: the one place an evaluation begins. */
function beginEvaluation(mod: HMRModule): number {
  // The load re-adds the edges the new body still has.
  for (const dep of (mod.imports as HMRModule[] | null) ?? []) dep.importers.delete(mod);
  mod.state = State.Pending;
  mod.loading = null;
  mod.selfAccept = null;
  mod.depAccepts = null;
  mod.onDispose = null;
  mod.usesData = false;
  return ++mod.generation;
}

function finishLoadModuleAsync(mod: HMRModule, generation: number, load: UnloadedESM[3], modules: HMRModule[]) {
  if (mod.generation !== generation) return mod;
  try {
    const exportsBefore = mod.exports;
    mod.imports = modules.map(getEsmExports);
    let p;
    try {
      p = load(mod);
    } finally {
      mod.imports = modules;
    }
    if (p) {
      return p.then(
        () => {
          if (mod.generation !== generation) return mod;
          if (mod.exports === exportsBefore) mod.exports = {};
          mod.cjs = null;
          mod.state = State.Loaded;
          mod.loading = null;
          patchImporters(mod);
          return mod;
        },
        e => throwLoadFailure(mod, generation, e),
      );
    }
    if (mod.exports === exportsBefore) mod.exports = {};
    mod.cjs = null;
    mod.state = State.Loaded;
    mod.loading = null;
    patchImporters(mod);
    return mod;
  } catch (e) {
    throwLoadFailure(mod, generation, e);
  }
}

/** Records the failure unless a newer evaluation of `mod` has started since. */
function throwLoadFailure(mod: HMRModule, generation: number, e: unknown): never {
  if (mod.generation === generation) {
    mod.state = State.Error;
    mod.failure = e;
    mod.loading = null;
  }
  throw e;
}

type GenericModuleLoader<R> = (id: Id, isUserDynamic: false, importer: HMRModule) => R;
// TODO: This function is currently recursive.
function parseEsmDependencies<T extends GenericModuleLoader<any>>(
  parent: HMRModule,
  deps: (string | number)[],
  enqueueModuleLoad: T,
) {
  let i = 0;
  let list: ReturnType<T>[] = [];
  /** What the first dependency that came back as a promise is suspended on. */
  let asyncId: Id | null = null;
  const { length } = deps;
  while (i < length) {
    const dep = deps[i] as string;
    DEBUG.ASSERT(typeof dep === "string");
    let expectedExportKeyEnd = i + 2 + (deps[i + 1] as number);
    DEBUG.ASSERT(typeof deps[i + 1] === "number");
    let promiseOrModule;
    try {
      promiseOrModule = enqueueModuleLoad(dep, false, parent);
    } catch (e) {
      // Refused to load synchronously (as opposed to failed): `parent` still loads via import().
      if (e instanceof AsyncImportError) {
        parent.state = State.Stale;
        throw e;
      }
      for (const p of list) if (p instanceof Promise) p.catch(() => {});
      throwLoadFailure(parent, parent.generation, e);
    }
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
      if (promiseOrModule instanceof Promise) {
        asyncId ??= registry.get(dep)!.loading!.asyncId;
      }
    } else {
      DEBUG.ASSERT(!registry.get(dep)?.esm);
      i = expectedExportKeyEnd;

      if (IS_BUN_DEVELOPMENT) {
        DEBUG.ASSERT((list[list.length - 1] as any) instanceof HMRModule);
      }
    }
  }
  return { list, asyncId };
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

  /** Every module this update replaces with a new copy: disposed of, then evaluated again. */
  const toReload = new Set<HMRModule>();
  /** Importers accepting a module the walk went through, with every such module of theirs this update replaces. */
  const toAccept = new Map<HotAccept, { importer: HMRModule; keys: Set<Id> }>();
  let failures: Set<Id> | null = null;

  // Discover all HMR boundaries
  for (const key of Object.keys(modules)) {
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
      let propagates = true;
      if (mod.selfAccept) {
        toReload.add(mod);
        visited.add(mod);
        propagates = false;
      }
      // Modules that use `import.meta.hot.data` are implied to handle updates by reusing it
      else if (mod.usesData) {
        toReload.add(mod);
        visited.add(mod);
        propagates = false;
      }

      if (propagates) {
        // Nothing to patch in a failed module: its next load evaluates it again.
        if (mod.state === State.Error) {
          mod.state = State.Stale;
          mod.failure = null;
        }
        if (mod.importers.size === 0) {
          // The server applies the update anyway, so the other importers of `key` are still walked.
          failures ??= new Set();
          failures.add(key);
        } else {
          // Its body ran against the previous version of `key`.
          toReload.add(mod);
        }
      }

      // Like Vite, an importer accepts the module being propagated, not only the file that changed.
      for (const importer of mod.importers) {
        const cb = importer.depAccepts?.[mod.id];
        if (cb) {
          let entry = toAccept.get(cb);
          if (!entry) toAccept.set(cb, (entry = { importer, keys: new Set() }));
          entry.keys.add(mod.id);
        } else if (propagates) {
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
      DEBUG.ASSERT(current);
      DEBUG.ASSERT(current.selfAccept === null);
      if (current.importers.size === 0) {
        // Only a route's own .html file is a root module, and the caller already reloads for those.
        DEBUG.ASSERT(!boundary.endsWith(".html"));
        message += `Module "${boundary}" is a root module that does not self-accept.\n`;
        continue;
      }
      outer: while (current.importers.size > 0) {
        path.push(current.id);
        inner: for (const importer of current.importers) {
          if (importer.selfAccept) continue inner;
          if (importer.depAccepts?.[current.id]) continue inner;
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
      return;
    }
    // The server has no page to reload; the update is applied as far as it goes.
    console.warn(message);
  }

  // Hooks stay until beginEvaluation clears them, so a module a failing update never reaches keeps them; a load arriving during a pending dispose evaluates the new version and the reload loop then finds it Loaded or in flight.
  const selfAccepts = new Map<HMRModule, HotAcceptFunction | null>();
  const disposePromises: Promise<void>[] = [];
  // One throwing dispose callback must not skip the others; the first failure still fails the update.
  let disposeError: { error: unknown } | null = null;
  for (const mod of toReload) {
    mod.state = State.Stale;
    selfAccepts.set(mod, mod.selfAccept);
    const { onDispose } = mod;
    if (!onDispose) continue;
    mod.onDispose = null;
    for (const fn of onDispose) {
      try {
        const p = fn(mod.hotData);
        if (p && p instanceof Promise) {
          disposePromises.push(p);
        }
      } catch (error) {
        disposeError ??= { error };
      }
    }
  }
  if (disposePromises.length > 0) {
    for (const r of await Promise.allSettled(disposePromises)) {
      if (r.status === "rejected") disposeError ??= { error: r.reason };
    }
  }
  if (disposeError) throw disposeError.error;

  const promises: Promise<HMRModule>[] = [];
  const acceptsAfterLoad: [HMRModule, HotAcceptFunction][] = [];
  // Like dispose: every accept callback runs, the first failure fails the update once it is applied.
  let acceptError: { error: unknown } | null = null;
  const runAccept = (cb: HotAcceptFunction | HotArrayAcceptFunction, arg: any) => {
    try {
      cb(arg);
    } catch (error) {
      acceptError ??= { error };
    }
  };
  let syncError: { error: unknown } | null = null;
  try {
    for (const [mod, selfAccept] of selfAccepts) {
      const modOrPromise = loadModuleAsync(mod.id, false, null);
      if (modOrPromise !== mod) {
        DEBUG.ASSERT(modOrPromise instanceof Promise);
        promises.push(
          (modOrPromise as Promise<HMRModule>).then(mod => {
            if (selfAccept) runAccept(selfAccept, getEsmExports(mod));
            return mod;
          }),
        );
      } else if (selfAccept) {
        if (mod.state === State.Loaded) {
          runAccept(selfAccept, getEsmExports(mod));
        } else {
          acceptsAfterLoad.push([mod, selfAccept]);
        }
      }
    }
  } catch (error) {
    syncError = { error };
  }
  if (promises.length > 0) {
    // A sync throw above must not leave the in-flight loads unobserved.
    const settled = await Promise.allSettled(promises);
    if (syncError) throw syncError.error;
    for (const r of settled) {
      if (r.status === "rejected") throw r.reason;
    }
  } else if (syncError) {
    throw syncError.error;
  }
  for (const [mod, selfAccept] of acceptsAfterLoad) {
    if (mod.state === State.Loaded) runAccept(selfAccept, getEsmExports(mod));
  }
  for (const mod of toReload) {
    const { selfAccept } = mod;
    if (selfAccept && selfAccept !== implicitAcceptFunction) continue;
    patchImporters(mod);
  }

  // Call all accept callbacks
  for (const [{ cb, modules, single }, { importer, keys }] of toAccept) {
    // The importer was itself re-evaluated in this update, so its old callback is stale.
    if (toReload.has(importer)) continue;
    runAccept(cb, single ? getEsmExports(registry.get(modules[0])!) : createAcceptArray(modules, keys));
  }

  if (refreshRuntime) {
    refreshRuntime.performReactRefresh();
  }

  emitEvent("bun:afterUpdate", null);
  if (acceptError) throw acceptError.error;
}

function patchImporters(mod: HMRModule) {
  const { importers } = mod;
  const exports = getEsmExports(mod);
  for (const importer of importers) {
    if (!importer.esm || !importer.updateImport) continue;
    const index = importer.imports!.indexOf(mod);
    if (index === -1) continue; // require or dynamic import
    importer.updateImport![index](exports);
  }
}

function createAcceptArray(modules: string[], keys: Set<Id>) {
  return modules.map(id => (keys.has(id) ? getEsmExports(registry.get(id)!) : undefined));
}

/** `vite:*` is an alias of `bun:*`; both `on` and `off` go through this. */
function normalizeEventName(event: string): string {
  return event.startsWith("vite:") ? "bun:" + event.slice("vite:".length) : event;
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
    const desc = Object.getOwnPropertyDescriptor(esmExports, key);
    if (desc && desc.get) {
      // Don't invoke getters as they may have side effects.
      return false;
    }
    const exportValue = esmExports[key];
    if (!isLikelyComponentType(exportValue)) {
      areAllExportsComponents = false;
    }
  }
  return hasExports && areAllExportsComponents;
}

function implicitAcceptFunction() {}

// bun:bake/server, bun:bake/client, and bun:wrap are
// provided by this file instead of the bundler
registerSynthetic("bun:wrap", runtimeHelpers);

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
