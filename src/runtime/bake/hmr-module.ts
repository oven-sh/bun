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
export let onServerSideReload: ((update: { clientCodeChanged: boolean }) => Promise<void>) | null = null;
const eventHandlers: Record<HMREvent | string, HotEventHandler[] | undefined> = {};
let refreshRuntime: any;
/** The expression `import(a,b)` is not supported in all browsers, most notably
 * in Mozilla Firefox in 2025. Bun lazily evaluates it, so a SyntaxError gets
 * thrown upon first usage. */
let lazyDynamicImportWithOptions: null | Function = null;
/** How many `import()` calls are in the synchronous part of their load right now. See `loadModuleAsync`. */
let dynamicLoads = 0;
/** Client only. The modules that are held from outside the module graph: the page's entry point, a page
 *  of a router. Only a page reload evaluates such a module again, unless a module that accepts imports it. */
const roots = new Set<HMRModule>();
/** For a module, the self-accept callback that was called last and the evaluation that it got. */
const delivered = new WeakMap<HMRModule, { cb: HotAcceptFunction; evaluation: number }>();

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
 * The caller holds the module from outside the module graph. On the client that makes it a root. */
export async function loadExports<T>(id: Id): Promise<T> {
  let loaded: Promise<HMRModule> | HMRModule;
  if (side === "client") {
    try {
      loaded = loadModuleAsync(id, false, null);
    } finally {
      // Before the wait, and when the load throws: an update that comes then has to find the mark.
      const mod = registry.get(id);
      if (mod) roots.add(mod);
    }
  } else {
    loaded = loadModuleAsync(id, false, null);
  }
  const m = await loaded;
  return m.esm ? m.exports : m.cjs.exports;
}

/**
 * Returns a module's export names without evaluating it, or `null` if that requires evaluation.
 * `export * from` is lowered to a spread, so it forwards `default` too.
 */
export function staticExportNames(id: Id): string[] | null {
  const names = new Set<string>();
  const queue: Id[] = [id];
  const visited = new Set<Id>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const unloaded = unloadedModuleRegistry[current];
    if (!Array.isArray(unloaded)) return null;
    for (const name of unloaded[ESMProps.exports]) names.add(name);
    queue.push(...unloaded[ESMProps.stars]);
  }
  return [...names];
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
  /** When a module fails to load, trying to load it again
   *  should throw the same error */
  failure: unknown = null;
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
  /** All modules that have imported this module, each with its `version` at the time. An import
   *  counts until an update replaces the code of the importer. A body that runs again from the
   *  same code has the same imports, but may not have repeated a `require()` or an `import()` yet. */
  importers = new Map<HMRModule, number>();
  /** How many times an update replaced the code of this module */
  version = 0;
  /** How many times this module started an evaluation again */
  evaluation = 0;
  /** The evaluation that went on past a top-level await. While the module is Pending, `promise`
   *  settles when that evaluation ends. `asyncId` is the module that has the `await`. */
  loading: { promise: Promise<HMRModule>; asyncId: Id } | null = null;
  /** Kept across evaluations. `import.meta.hot.data` rewrites to `data`. */
  hotData: any = {};
  /** An update reached this module. From then on an importer waits for an evaluation of it that
   *  is suspended on top-level await. Before that, an importer gets the module as it is. */
  updated = false;

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

  // A body that uses `import.meta.hot.data` while it is evaluated takes its updates itself, like `accept()`.
  get data() {
    if (this.state === State.Pending) this.selfAccept ??= implicitAcceptFunction;
    return this.hotData;
  }
  set data(value: any) {
    if (this.state === State.Pending) this.selfAccept ??= implicitAcceptFunction;
    this.hotData = value;
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
    dynamicLoads++;
    let found: ReturnType<typeof loadModuleAsync<true>>;
    try {
      found = loadModuleAsync(id, true, this);
    } finally {
      dynamicLoads--;
    }
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
  // on HMRModule directly.  The following code implements that interface. `data`
  // is the accessor above. Its value is kept because HMRModule is not destructed.

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

  /** Server-only. Lowered from an `import` of a built-in module: the ESM namespace. */
  declare builtin: (id: string) => any;
  /** Server-only. Lowered from a `require()` of a built-in module: what Bun's `require()` returns. */
  declare requireBuiltin: (id: string) => any;
}
if (side === "server") {
  HMRModule.prototype.builtin = (id: string) =>
    // @ts-expect-error
    import.meta.bakeBuiltin(import.meta.resolve(id));
  HMRModule.prototype.requireBuiltin = (id: string) => import.meta.require(id);
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
      // The update that fixes `mod` finds this importer through the edge.
      if (importer) addImporter(mod, importer);
      throw mod.failure;
    }
    if (mod.state === State.Stale) {
      isUserDynamic = false;
    } else {
      if (importer) addImporter(mod, importer);
      const { loading } = mod;
      // As in `loadModuleAsync`: a load that an `import()` started gets the module as it is.
      if (loading !== null && dynamicLoads === 0 && isSuspended(mod)) throw new AsyncImportError(loading.asyncId);
      return mod;
    }
  }
  const loadOrEsmModule = unloadedModuleRegistry[id];
  if (!loadOrEsmModule) throwNotFound(id, isUserDynamic);

  if (typeof loadOrEsmModule === "function") {
    // CommonJS
    if (mod) beginEvaluation(mod);
    mod = evaluateCommonJS(id, mod, loadOrEsmModule, importer);
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
    // After the refusal above, so that the module stays Stale for the async loader.
    if (mod) beginEvaluation(mod);
    if (!mod) {
      mod = new HMRModule(id, false);
      registry.set(id, mod);
    } else if (!mod.esm) {
      mod.esm = true;
      mod.cjs = null;
      mod.exports = null;
    }
    if (importer) addImporter(mod, importer);

    let depsList: HMRModule[];
    try {
      depsList = parseEsmDependencies(mod, deps, loadModuleSync).list;
    } catch (e) {
      // A dependency threw before this module's body ran, so the next load evaluates it again.
      mod.state = State.Stale;
      throw e;
    }
    const exportsBefore = mod.exports;
    mod.imports = depsList.map(getEsmExports);
    clearHooks(mod);
    try {
      load(mod);
    } catch (e) {
      mod.state = State.Error;
      mod.failure = e;
      throw e;
    }
    mod.imports = depsList;
    finishEvaluation(mod, exportsBefore);
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
      // The update that fixes `mod` finds this importer through the edge.
      if (importer) addImporter(mod, importer);
      throw mod.failure;
    }
    if (state === State.Stale) {
      beginEvaluation(mod);
      isUserDynamic = false as IsUserDynamic;
    } else {
      if (importer) addImporter(mod, importer);
      const { loading } = mod;
      // `loading` is null for a module with no top-level await in it or below it: the common exit.
      if (loading === null || !isSuspended(mod)) return mod;
      // A load that an `import()` started gets the module as it is, as on a first load. The
      // suspended module can be the one that awaits that `import()`, and then a wait never ends.
      return importer && dynamicLoads > 0 ? mod : loading.promise;
    }
  }
  const loadOrEsmModule = unloadedModuleRegistry[id];
  if (!loadOrEsmModule) {
    if (isUserDynamic) return null!;
    throwNotFound(id, isUserDynamic);
  }

  if (typeof loadOrEsmModule === "function") {
    // CommonJS
    return evaluateCommonJS(id, mod, loadOrEsmModule, importer);
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
    if (importer) addImporter(mod, importer);
    const { evaluation } = mod;

    let list: (HMRModule | Promise<HMRModule>)[], asyncId: Id | null;
    try {
      ({ list, asyncId } = parseEsmDependencies(mod, deps, loadModuleAsync<false>));
    } catch (e) {
      // A dependency threw before this module's body ran, so the next load evaluates it again.
      mod.state = State.Stale;
      throw e;
    }
    DEBUG.ASSERT(
      asyncId !== null //
        ? list.some(x => x instanceof Promise)
        : list.every(x => x instanceof HMRModule),
    );

    // Running finishLoadModuleAsync synchronously when there are no promises is
    // not a performance optimization but a behavioral correctness issue.
    const result =
      asyncId !== null
        ? Promise.all(list).then(
            list => finishLoadModuleAsync(mod, load, list, evaluation, isAsync),
            e => {
              if (isReplaced(mod, evaluation)) return loadReplacement(mod);
              mod.state = State.Stale;
              throw e;
            },
          )
        : finishLoadModuleAsync(
            mod,
            load,
            list as HMRModule[], // no promises as by assert above
            evaluation,
            isAsync,
          );
    if (result !== mod) {
      // The sync loader names the module's own `await` before an import's. Same here.
      mod.loading = { promise: result as Promise<HMRModule>, asyncId: isAsync ? id : asyncId! };
    }
    return result;
  }
}

/** The CommonJS arm of both loaders. */
function evaluateCommonJS(id: Id, mod: HMRModule | undefined, load: UnloadedCommonJS, importer: HMRModule | null) {
  if (!mod) {
    mod = new HMRModule(id, true);
    registry.set(id, mod);
  } else {
    // As on a first load: a new `module` object, and no ESM view of the exports of the last body.
    mod.esm = false;
    mod.cjs = {
      id,
      exports: {},
      require: mod.require.bind(mod),
    };
    mod.exports = null;
  }
  if (importer) addImporter(mod, importer);
  clearHooks(mod);
  try {
    const cjs = mod.cjs;
    load(mod, cjs, cjs.exports);
  } catch (e) {
    mod.state = State.Stale;
    mod.cjs.exports = {};
    throw e;
  }
  // A module in an import cycle can take the ESM view before the body has set `module.exports`.
  mod.exports = null;
  mod.state = State.Loaded;
  patchImporters(mod);
  return mod;
}

/** The one place where a module that was evaluated before starts again. */
function beginEvaluation(mod: HMRModule) {
  mod.evaluation++;
  mod.state = State.Pending;
  mod.loading = null;
  // The body that is replaced keeps the imports that it has. `patchImporters` is for the new body.
  mod.imports = null;
  mod.updateImport = null;
}

function addImporter(mod: HMRModule, importer: HMRModule) {
  mod.importers.set(importer, importer.version);
}

/** Right before a body runs. A module whose imports fail to load keeps the hooks of its last body. */
function clearHooks(mod: HMRModule) {
  mod.selfAccept = null;
  mod.depAccepts = null;
}

/**
 * For a module that has `loading`: whether an importer waits for it. An update reached the module,
 * and an evaluation of it is suspended on top-level await. A module that no update reached is on
 * its first load, where an importer gets it as it is.
 */
function isSuspended(mod: HMRModule) {
  return mod.state === State.Pending && mod.updated;
}

/** Whether an update marked `mod` Stale, or a new evaluation of it began, while evaluation `evaluation` waited. */
function isReplaced(mod: HMRModule, evaluation: number) {
  return mod.evaluation !== evaluation || mod.state !== State.Pending;
}

/** What a replaced evaluation hands to the ones that wait for it: the module as its new code leaves it. */
function loadReplacement(mod: HMRModule) {
  return loadModuleAsync(mod.id, false, null);
}

/** The end of the body of an ES module, in both loaders. */
function finishEvaluation(mod: HMRModule, exportsBefore: any) {
  if (mod.exports === exportsBefore) mod.exports = {};
  mod.cjs = null;
  mod.state = State.Loaded;
  patchImporters(mod);
}

const replacedHooks = new Set<PropertyKey>(["accept", "acceptSpecifiers", "on", "reactRefreshAccept"]);
function replacedHook() {}

/**
 * What a body with top-level await gets as `hmr`. After an await, an update can have replaced the
 * evaluation that the body belongs to. The body still ends with a write to `exports`, and it can
 * still call the hooks. What it writes and registers then must not get to the module, which the
 * new evaluation owns. Its `dispose()` calls still register, because what the body made after the
 * await has to be released too.
 */
function evaluationView(mod: HMRModule, evaluation: number): HMRModule {
  const isBodyReplaced = () => mod.evaluation !== evaluation || mod.state === State.Stale;
  return new Proxy(mod, {
    get(target, key) {
      if (isBodyReplaced()) {
        if (key === "data") return target.hotData;
        if (replacedHooks.has(key)) return replacedHook;
      }
      const value = target[key as keyof HMRModule];
      // The methods take the module itself, not this view, as the importer and as the owner of the hooks.
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (isBodyReplaced()) {
        if (key === "exports") return true;
        if (key === "data") {
          target.hotData = value;
          return true;
        }
      }
      return Reflect.set(target, key, value);
    },
  });
}

function finishLoadModuleAsync(
  mod: HMRModule,
  load: UnloadedESM[3],
  modules: HMRModule[],
  evaluation: number,
  isAsync: boolean,
) {
  if (isReplaced(mod, evaluation)) return loadReplacement(mod);
  try {
    const exportsBefore = mod.exports;
    mod.imports = modules.map(getEsmExports);
    clearHooks(mod);
    // A Proxy, so only for the bodies that can be replaced while they run.
    const p = load(isAsync ? evaluationView(mod, evaluation) : mod);
    mod.imports = modules;
    if (p) {
      return p.then(
        () => {
          if (isReplaced(mod, evaluation)) return loadReplacement(mod);
          finishEvaluation(mod, exportsBefore);
          return mod;
        },
        e => {
          if (isReplaced(mod, evaluation)) return loadReplacement(mod);
          mod.state = State.Error;
          mod.failure = e;
          throw e;
        },
      );
    }
    finishEvaluation(mod, exportsBefore);
    return mod;
  } catch (e) {
    mod.state = State.Error;
    mod.failure = e;
    throw e;
  }
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
  /** The module with the top-level await that the first import to return a promise waits on. */
  let asyncId: Id | null = null;
  const { length } = deps;
  while (i < length) {
    const dep = deps[i] as string;
    DEBUG.ASSERT(typeof dep === "string");
    let expectedExportKeyEnd = i + 2 + (deps[i + 1] as number);
    DEBUG.ASSERT(typeof deps[i + 1] === "number");
    let promiseOrModule: any;
    try {
      promiseOrModule = enqueueModuleLoad(dep, false, parent);
    } catch (e) {
      // Nothing waits for the imports before this one any more. One of them can still reject.
      for (const earlier of list as unknown[]) {
        if (earlier instanceof Promise) earlier.catch(() => {});
      }
      throw e;
    }
    list.push(promiseOrModule);

    const unloadedModule = unloadedModuleRegistry[dep];
    if (!unloadedModule) {
      throwNotFound(dep, false);
    }
    if (typeof unloadedModule !== "function") {
      i += 2;
      while (i < expectedExportKeyEnd) {
        const key = deps[i] as string;
        DEBUG.ASSERT(typeof key === "string");
        i++;
      }
      if (promiseOrModule instanceof Promise) asyncId ??= registry.get(dep)!.loading!.asyncId;
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

  /** Server only. What failed in this update. See `attempt`. */
  const errors: unknown[] = [];

  attempt(errors, emitEvent, "bun:beforeUpdate", null);

  const keys = Object.keys(modules);
  for (const key of keys) {
    // Unref old source maps, and track new ones
    if (side === "client") {
      DEBUG.ASSERT(sourceMapId);
      const existingSourceMapId = registrySourceMapIds.get(key);
      if (existingSourceMapId) derefMapping(existingSourceMapId);
      registrySourceMapIds.set(key, sourceMapId);
    }
  }

  /** Every module that the update reaches, with the module the walk came from. Each of them is replaced. */
  const reached = new Map<HMRModule, HMRModule | null>();
  /** Where the loads start, each with the self-accept callback of the body that is replaced. */
  const boundaries = new Map<HMRModule, HotAcceptFunction | null>();
  /** The `accept(dep)` registrations that the walk found, each with the accepted modules that are replaced. */
  const toAccept = new Map<HotAccept, { importer: HMRModule; keys: Set<Id> }>();
  /** Client only. A changed module, with the path from it to a root that does not accept. */
  let failures: Map<Id, Id[]> | null = null;
  /** Client only. The roots that pass the update to their importers. */
  let importedRoots: HMRModule[] | null = null;
  /** The importers that did not load, of the modules that take the update themselves. */
  let revive: HMRModule[] | null = null;

  // Discover all HMR boundaries
  for (const key of keys) {
    const existing = registry.get(key);
    if (!existing || reached.has(existing)) continue;

    reached.set(existing, null);
    const queue: HMRModule[] = [existing];
    while (true) {
      const mod = queue.shift();
      if (!mod) break;

      // A self-accepting module takes the update. Every other module passes it to its importers.
      const propagates = !mod.selfAccept;
      if (!propagates) boundaries.set(mod, mod.selfAccept);

      let hasImporter = false;
      for (const [importer, version] of mod.importers) {
        if (version !== importer.version) {
          mod.importers.delete(importer);
          continue;
        }
        hasImporter = true;
        // Like Vite, an importer accepts the module that it imports, not only the file that changed.
        const accept = importer.depAccepts?.[mod.id];
        // An importer in State.Error or State.Stale did not load. It has no body that can take the callback.
        const didNotLoad = importer.state === State.Error || importer.state === State.Stale;
        if (accept && !didNotLoad) {
          let entry = toAccept.get(accept);
          if (!entry) toAccept.set(accept, (entry = { importer, keys: new Set() }));
          entry.keys.add(mod.id);
        } else if (propagates) {
          if (!reached.has(importer)) {
            reached.set(importer, mod);
            queue.push(importer);
          }
        } else if (didNotLoad) {
          (revive ??= []).push(importer);
        }
      }

      // A server has no page to reload. What the update reaches there and no module accepts stays
      // Stale, and the next request that needs it evaluates it, as on a first load.
      if (side === "client" && propagates && roots.has(mod)) {
        if (hasImporter) {
          (importedRoots ??= []).push(mod);
        } else {
          const path: Id[] = [];
          for (let m: HMRModule | null | undefined = mod; m; m = reached.get(m)) path.unshift(m.id);
          (failures ??= new Map()).set(key, path);
        }
      }
    }
  }

  // A module that did not load, above a module that takes the update itself, can have failed with
  // the old code of that module. Its next load evaluates it again, and so for the modules that did
  // not load above it. A loaded module above them does not have to accept that.
  if (revive) {
    for (let i = 0; i < revive.length; i++) {
      const mod = revive[i];
      if (reached.has(mod)) continue;
      reached.set(mod, null);
      for (const [importer, version] of mod.importers) {
        if (version !== importer.version) continue;
        if (importer.state === State.Error || importer.state === State.Stale) revive.push(importer);
      }
    }
  }

  // An `accept(dep)` counts when the update does not evaluate its importer again. The loads then
  // start at the accepted module, as at a self-accepting module.
  for (const [accept, { importer, keys }] of toAccept) {
    if (reached.has(importer)) {
      toAccept.delete(accept);
      continue;
    }
    for (const key of keys) {
      const accepted = registry.get(key)!;
      if (!boundaries.has(accepted)) boundaries.set(accepted, null);
    }
  }

  // Only a reload evaluates a root again, unless a boundary imports it. A root can have importers
  // and no boundary above it: the modules that it imports can import it back.
  if (importedRoots) {
    for (const root of importedRoots) {
      if (!boundaries.has(root) && !isBelowBoundary(root, boundaries)) {
        (failures ??= new Map()).set(root.id, [root.id]);
      }
    }
    // A boundary can import a root from a function that runs later. The new body of the boundary
    // does not load the root then, so the loads start at the root too.
    if (!failures) {
      for (const root of importedRoots) {
        if (!boundaries.has(root)) boundaries.set(root, null);
      }
    }
  }

  // If roots were hit, print a nice message before reloading.
  if (side === "client" && failures) {
    let message =
      "[Bun] Hot update was not accepted because it or its importers do not call `import.meta.hot.accept`. To prevent full page reloads, call `import.meta.hot.accept` in one of the following files to handle the update:\n\n";

    for (const [boundary, path] of failures) {
      DEBUG.ASSERT(!boundary.endsWith(".html")); // caller should have already reloaded
      if (path.length === 1) {
        message += `Module "${boundary}" is a root module that does not self-accept.\n`;
        continue;
      }
      message += `Module "${boundary}" is not accepted by ${path[1]}${path.length > 2 ? "," : "."}\n`;
      for (let i = 2, len = path.length; i < len; i++) {
        const isLast = i === len - 1;
        message += `${isLast ? "└" : "├"} imported by "${path[i]}"${isLast ? "." : ","}\n`;
      }
    }
    message = message.trim();
    sessionStorage?.setItem?.(
      "bun:hmr:message",
      JSON.stringify?.({
        message,
        kind: "warn",
      }),
    );
    // Nothing is disposed of or evaluated in the page that is left.
    fullReload();
    return;
  }

  let disposing: HMRModule[] = [];
  for (const mod of reached.keys()) {
    if (mod.onDispose) disposing.push(mod);
  }
  if (disposing.length > 1) {
    // A module is disposed of before the modules that it imports. The importer entries have every
    // kind of import, so the order comes from them: a module goes after its importers.
    const inOrder: HMRModule[] = (disposing = []);
    const ordered = new Set<HMRModule>();
    const order = (mod: HMRModule) => {
      ordered.add(mod);
      for (const importer of mod.importers.keys()) {
        if (reached.has(importer) && !ordered.has(importer)) order(importer);
      }
      if (mod.onDispose) inOrder.push(mod);
    };
    for (const mod of reached.keys()) {
      if (!ordered.has(mod)) order(mod);
    }
  }

  const disposePromises: Promise<void>[] = [];
  for (const mod of disposing) {
    const onDispose = mod.onDispose!;
    mod.onDispose = null;
    for (const fn of onDispose) {
      const p = attempt(errors, fn, mod.hotData);
      if (p && p instanceof Promise) {
        disposePromises.push(p);
      }
    }
  }

  // Every reached module is Stale after the callbacks ran and before the wait for their promises.
  // A callback that loads a reached module gets the copy that is disposed of. A load that comes
  // during the wait evaluates the new code.
  for (const mod of reached.keys()) {
    mod.state = State.Stale;
    mod.updated = true;
  }
  // The imports that the old code of a saved module made stop counting here. See `importers`. In
  // the walk and in the dispose order they still count: the body that is replaced made them.
  for (const key of keys) {
    const existing = registry.get(key);
    if (existing) existing.version++;
  }
  if (disposePromises.length > 0) {
    await settle(disposePromises, errors);
  }

  // Reload all modules. The loads start at the boundaries, so the loader evaluates the Stale
  // imports of a boundary before the boundary, as on a first load. The boundary that loaded first
  // goes first: in an import cycle it is where the first load entered the cycle.
  let starts: Iterable<HMRModule> = boundaries.keys();
  if (boundaries.size > 1) {
    const inLoadOrder: HMRModule[] = (starts = []);
    for (const mod of registry.values()) {
      if (boundaries.has(mod)) inLoadOrder.push(mod);
    }
  }
  const promises: Promise<HMRModule>[] = [];
  for (const mod of starts) {
    const selfAccept = boundaries.get(mod);
    let modOrPromise: HMRModule | Promise<HMRModule>;
    try {
      modOrPromise = loadModuleAsync(mod.id, false, null);
    } catch (e) {
      // The rest of the update still loads, or those modules would keep their old code.
      promises.push(Promise.reject(e));
      continue;
    }
    if (modOrPromise === mod) {
      if (selfAccept) deliver(errors, mod, selfAccept);
    } else {
      DEBUG.ASSERT(modOrPromise instanceof Promise);
      promises.push(
        (modOrPromise as Promise<HMRModule>).then(mod => {
          if (selfAccept) deliver(errors, mod, selfAccept);
          return mod;
        }),
      );
    }
  }
  if (promises.length > 0) {
    await settle(promises, errors);
  }

  // Call all accept callbacks, once for each accepted module that was replaced.
  for (const [{ cb, modules: accepted, single }, { keys }] of toAccept) {
    for (const key of keys) {
      // Server only: the load of the accepted module can have failed.
      if (registry.get(key)!.state !== State.Loaded) continue;
      attempt(errors, cb, single ? getEsmExports(registry.get(key)!) : createAcceptArray(accepted, key));
    }
  }

  if (refreshRuntime) {
    refreshRuntime.performReactRefresh();
  }

  attempt(errors, emitEvent, "bun:afterUpdate", null);

  if (errors.length > 0) {
    throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Errors in a hot update");
  }
}

/** Calls a self-accept callback. An update that overlaps this one can have given it this evaluation already. */
function deliver(errors: unknown[], mod: HMRModule, cb: HotAcceptFunction) {
  const { evaluation } = mod;
  const last = delivered.get(mod);
  if (last && last.cb === cb && last.evaluation === evaluation) return;
  delivered.set(mod, { cb, evaluation });
  attempt(errors, cb, getEsmExports(mod));
}

/**
 * Calls a callback of a hot update. On the client an error ends the update, because the page
 * reloads for it. A server has no page to reload: it keeps the error and applies the rest.
 */
function attempt<A, B>(errors: unknown[], fn: (a: A, b: B) => unknown, a: A, b?: B) {
  try {
    return fn(a, b as B);
  } catch (error) {
    if (side === "client") throw error;
    errors.push(error);
  }
}

/** The same rule as `attempt`, for promises: the client rejects with the first rejection, the server waits for all. */
function settle(promises: Promise<unknown>[], errors: unknown[]): Promise<unknown> {
  if (side === "client") return Promise.all(promises);
  return Promise.allSettled(promises).then(results => {
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason);
    }
  });
}

/**
 * Whether a boundary imports `root`, directly or through other modules. The walk of the update
 * reached every module that this looks at, so their expired importer entries are gone.
 */
function isBelowBoundary(root: HMRModule, boundaries: Map<HMRModule, unknown>) {
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length > 0) {
    for (const importer of stack.pop()!.importers.keys()) {
      if (boundaries.has(importer)) return true;
      if (!seen.has(importer)) {
        seen.add(importer);
        stack.push(importer);
      }
    }
  }
  return false;
}

function patchImporters(mod: HMRModule) {
  for (const importer of mod.importers.keys()) {
    // A Stale importer still has the `updateImport` of the body that is replaced. That body keeps its imports.
    if (!importer.esm || !importer.updateImport || importer.state === State.Stale) continue;
    const index = importer.imports!.indexOf(mod);
    if (index === -1) continue; // require or dynamic import
    importer.updateImport![index](getEsmExports(mod));
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
  // A handler that throws does not skip the others. The first error is thrown when all have run.
  let first: { error: unknown } | undefined;
  for (const handler of handlers) {
    try {
      handler(data);
    } catch (error) {
      first ??= { error };
    }
  }
  if (first) throw first.error;
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
  const { route } = config;
  registerSynthetic("bun:bake/client", {
    onServerSideReload: cb => (onServerSideReload = cb),
    // For a router whose pages also run in the browser: the modules of the current route.
    route: route
      ? {
          page: () => (route.page ? loadExports(route.page) : Promise.resolve(null)),
          layouts: () => Promise.all(route.layouts.map(id => loadExports(id))),
        }
      : null,
  });
}
