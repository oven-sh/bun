// This is an implementation of an module loader with hot-reloading support.
// Note that this aims to implement the behavior of `bun build` rather than what
// the ECMAScript Module spec says. This way, development builds function like
// the production ones from `bun build`.
//
// Some build failures from the bundler surface as runtime errors here, such as
// `require` on a module with transitive top-level await, or a missing export.
// This was done to make incremental updates as isolated as possible.
import {
  __name,
  __legacyDecorateClassTS,
  __legacyDecorateParamTS,
  __legacyMetadataTS,
  __using,
  __callDispose,
} from "../runtime.bun";

/** List of loaded modules. Every `Id` gets one HMRModule, mutated across updates. */
let registry = new Map<Id, HMRModule>();
/** Server */
export const serverManifest = {};
/** Server */
export const ssrManifest = {};
/** Client */
export let onServerSideReload: (() => Promise<void>) | null = null;
let refreshRuntime: any;
/** The expression `import(a,b)` is not supported in all browsers, most notably
 * in Mozilla Firefox in 2025. Bun lazily evaluates it, so a SyntaxError gets
 * thrown upon first usage. */
let lazyDynamicImportWithOptions;

const enum State {
  Pending,
  Stale,
  Loaded,
  Error,
}

/** Given an Id, return the module namespace object.
 * For use in other functions in the HMR runtime.
 * Registers that module as a root. */
export function loadExports<T>(id: Id): Promise<T> {
  return loadModuleAsync(id, false, null).then(m => (m.esm ? m.exports : m.cjs.exports));
}

interface HotAccept {
  modules: string[];
  cb: HotAcceptFunction;
  single: boolean;
}

/** Implementation details must remain in sync with js_parser.zig and bundle_v2.zig */
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
  cjs: any;
  /** When a module fails to load, trying to load it again
   *  should throw the same error */
  failure: any = null;
  /** Two purposes:
   * 1. HMRModule[] - List of parsed imports. indexOf is used to go from HMRModule -> updater function
   * 2. any[] - List of module namespace objects. Read by the ESM module's load function.
   * Unused for CJS
   */
  imports: HMRModule[] | any[] | null = null;
  /** Assignned by an ESM module's load function immediately */
  updateImport: ((exports: any) => void)[] | null = null;
  /** When calling `import.meta.hot.dispose` */
  onDispose: HotDisposeFunction[] | null = null;
  /** When calling `import.meta.hot.accept` to self-accept */
  selfAccept: HotAcceptFunction | null = null;
  /** When calling `import.meta.hot.accept` on another module */
  depAccepts: Record<Id, HotAccept> | null = null;
  /** All modules that have imported this module */
  importers = new Set<HMRModule>();

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

  dynamicImport(id: Id, opts?: ImportCallOptions) {
    const found = loadModuleAsync(id, true, this);
    if (found) {
      return found.then(getEsmExports);
    }
    return opts
      ? (lazyDynamicImportWithOptions ??= new Function("specifier, opts", "import(specifier, opts)"))(id, opts)
      : import(id);
  }

  /**
   * Files which only export functions (and have no other statements) are
   * implicitly `import.meta.hot.accept`ed, however it is done in a special way
   * where functions are proxied. This is special behavior to make stuff "just
   * work".
   */
  implicitlyAccept(exports) {
    if (IS_BUN_DEVELOPMENT) assert(this.esm);
    this.selfAccept ??= implicitAcceptFunction;
    const current = ((this.selfAccept as any).current ??= {});
    if (IS_BUN_DEVELOPMENT) assert(typeof exports === "object");
    const moduleExports = (this.exports = {});
    for (const exportName in exports) {
      const source = (current[exportName] = exports[exportName]);
      if (IS_BUN_DEVELOPMENT) assert(typeof source === "function");
      const proxied = (moduleExports[exportName] ??= proxyFn(current, exportName));
      Object.defineProperty(proxied, "name", { value: source.name });
      Object.defineProperty(proxied, "length", { value: source.length });
    }
  }

  get importMeta() {
    const importMeta = {
      url: `bun://${this.id}`,
      main: false,
      require: this.require.bind(this),
      // transpiler rewrites `import.meta.hot` to access `HotModule.hot`
    };
    Object.defineProperty(this, "importMeta", { value: importMeta });
    return importMeta;
  }

  get hot() {
    const hot = new Hot(this);
    Object.defineProperty(this, "hot", { value: hot });
    return hot;
  }

  /** Server-only */
  declare builtin: (id: string) => any;
}
if (side === "server") {
  HMRModule.prototype.builtin = import.meta.require;
}

export function loadModuleSync(id: Id, isUserDynamic: boolean, importer: HMRModule | null): HMRModule {
  // First, try and re-use an existing module.
  let mod = registry.get(id);
  if (mod) {
    if (mod.state === State.Error) throw mod.failure;
    if (mod.state === State.Stale) {
      mod.state = State.Pending;
      isUserDynamic = false;
    } else {
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
    }
    if (importer) {
      mod.importers.add(importer);
    }
    try {
      loadOrEsmModule(mod, mod.cjs);
    } catch (e) {
      mod.state = State.Error;
      mod.failure = e;
      throw e;
    }
    mod.state = State.Loaded;
  } else {
    // ESM
    if (IS_BUN_DEVELOPMENT) {
      try {
        assert(Array.isArray(loadOrEsmModule[0]));
        assert(Array.isArray(loadOrEsmModule[1]));
        assert(Array.isArray(loadOrEsmModule[2]));
        assert(typeof loadOrEsmModule[3] === "function");
        assert(typeof loadOrEsmModule[4] === "boolean");
      } catch (e) {
        console.warn(id, loadOrEsmModule);
        throw e;
      }
    }
    const [deps /* exports */ /* stars */, , , load, isAsync] = loadOrEsmModule;
    if (isAsync) {
      throw new AsyncImportError(id);
    }
    if (!mod) {
      mod = new HMRModule(id, false);
      registry.set(id, mod);
    }
    if (importer) {
      mod.importers.add(importer);
    }

    const depsList = parseEsmDependencies(mod, deps, loadModuleSync);
    mod.imports = depsList.map(getEsmExports);
    load(mod);
    mod.imports = depsList;
    mod.state = State.Loaded;
  }

  return mod;
}

// Do not add the `async` keyword to this function, that way the list of
// `HotModule`s can be created synchronously, even if evaluation is not.
// Returns `null` if the module is not found in dynamic mode, so that the caller
// can use the `import` keyword instead.
export function loadModuleAsync<IsUserDynamic extends boolean>(
  id: Id,
  isUserDynamic: IsUserDynamic,
  importer: HMRModule | null,
): (IsUserDynamic extends true ? null : never) | Promise<HMRModule> {
  // First, try and re-use an existing module.
  let mod = registry.get(id)!;
  if (mod) {
    if (mod.state === State.Error) throw mod.failure;
    if (mod.state === State.Stale) {
      mod.state = State.Pending;
      isUserDynamic = false as IsUserDynamic;
    } else {
      if (importer) {
        mod.importers.add(importer);
      }
      return Promise.resolve(mod);
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
    }
    if (importer) {
      mod.importers.add(importer);
    }
    try {
      loadOrEsmModule(mod, mod.cjs);
    } catch (e) {
      mod.state = State.Error;
      mod.failure = e;
      throw e;
    }
    mod.state = State.Loaded;

    return Promise.resolve(mod);
  } else {
    // ESM
    if (IS_BUN_DEVELOPMENT) {
      try {
        assert(Array.isArray(loadOrEsmModule[0]));
        assert(Array.isArray(loadOrEsmModule[1]));
        assert(Array.isArray(loadOrEsmModule[2]));
        assert(typeof loadOrEsmModule[3] === "function");
        assert(typeof loadOrEsmModule[4] === "boolean");
      } catch (e) {
        console.warn(id, loadOrEsmModule);
        throw e;
      }
    }
    const [deps /* exports */ /* stars */, , , load /* isAsync */] = loadOrEsmModule;

    if (!mod) {
      mod = new HMRModule(id, false);
      registry.set(id, mod);
    }
    if (importer) {
      mod.importers.add(importer);
    }

    const parsedImportModules = parseEsmDependencies(mod, deps, loadModuleAsync<false>);
    return Promise.all(parsedImportModules)
      .then(modules => {
        mod.imports = modules.map(getEsmExports);
        const p = load(mod);
        mod.imports = modules;
        if (p) {
          return p.then(() => {
            mod.state = State.Loaded;
            return mod;
          });
        }
        mod.state = State.Loaded;
        return mod;
      })
      .catch(e => {
        mod.state = State.Error;
        mod.failure = e;
        throw e;
      });
  }
}

type GenericModuleLoader<R> = (id: Id, isUserDynamic: false, importer: HMRModule) => R;
function parseEsmDependencies<T extends GenericModuleLoader<any>>(
  mod: HMRModule,
  deps: (string | number)[],
  enqueueModuleLoad: T,
) {
  let i = 0;
  let loadedDeps: ReturnType<T>[] = [];
  let dedupeSet: Set<Id> | null = null;
  while (i < deps.length) {
    const dep = deps[i] as string;
    if (IS_BUN_DEVELOPMENT) assert(typeof dep === "string");
    let expectedExportKeyEnd = i + 2 + (deps[i + 1] as number);
    if (IS_BUN_DEVELOPMENT) assert(typeof deps[i + 1] === "number");
    loadedDeps.push(enqueueModuleLoad(dep, false, mod));

    const unloadedModule = unloadedModuleRegistry[dep];
    if (!unloadedModule) {
      throwNotFound(dep, false);
    }
    if (typeof unloadedModule !== "function") {
      const availableExportKeys = unloadedModule[1];
      i += 2;
      while (i < expectedExportKeyEnd) {
        const key = deps[i] as string;
        if (IS_BUN_DEVELOPMENT) assert(typeof key === "string");
        if (!availableExportKeys.includes(key)) {
          dedupeSet ??= new Set<Id>();
          if (!findExportStar(unloadedModule[2], key, dedupeSet)) {
            throw new SyntaxError(`Module "${dep}" does not export key "${key}"`);
          }
          dedupeSet.clear();
        }
        i++;
      }
    } else {
      if (IS_BUN_DEVELOPMENT) assert(!registry.get(dep)?.esm);
      i = expectedExportKeyEnd;
    }
  }
  return loadedDeps;
}

function findExportStar(starImports: Id[], key: string, dedupeSet: Set<Id>) {
  for (const starImport of starImports) {
    if (dedupeSet.has(starImport)) continue;
    dedupeSet.add(starImport);
    const mod = unloadedModuleRegistry[starImport];
    if (typeof mod === "function") {
      // CommonJS has dynamic keys (can export anything, even a Proxy)
      return true;
    }
    const availableExportKeys = mod[1];
    if (availableExportKeys.includes(key)) {
      return true; // Found
    }
    // Recurse to further star imports.
    if (findExportStar(mod[2], key, dedupeSet)) {
      return true;
    }
  }
  return false;
}

function getEsmExports(m: HMRModule) {
  return m.esm ? m.exports : (m.exports ??= toESM(m.cjs.exports));
}

type HotAcceptFunction = (esmExports: any | void) => void;
type HotArrayAcceptFunction = (esmExports: (any | void)[]) => void;
type HotDisposeFunction = (data: any) => void | Promise<void>;
type HotEventHandler = (data: any) => void;

/** `import.meta.hot` */
class Hot {
  #module: HMRModule;
  data = {};

  constructor(module: HMRModule) {
    this.#module = module;
  }

  accept(
    arg1: string | readonly string[] | HotAcceptFunction,
    arg2: HotAcceptFunction | HotArrayAcceptFunction | undefined,
  ) {
    if (arg2 == undefined) {
      arg1 ??= () => {};
      if (typeof arg1 !== "function") {
        throw new Error("import.meta.hot.accept requires a callback function");
      }
      // Self-accept function
      this.#module.selfAccept = arg1;
    } else {
      throw new Error(
        '"import.meta.hot.accept" must be directly called with string literals for ' +
          "the specifiers. This way, the bundler can pre-process the arguments.",
      );
    }
  }

  acceptSpecifiers(specifiers: string | readonly string[], cb?: HotAcceptFunction | HotArrayAcceptFunction) {
    this.#module.depAccepts ??= {};
    const isArray = Array.isArray(specifiers);
    const accept: HotAccept = {
      modules: isArray ? specifiers : [specifiers],
      cb: cb as HotAcceptFunction,
      single: isArray,
    };
    if (isArray) {
      for (const specifier of specifiers) {
        this.#module.depAccepts[specifier] = accept;
      }
    } else {
      this.#module.depAccepts[specifiers as string] = accept;
    }
  }

  decline() {} // Vite: "This is currently a noop and is there for backward compatibility"

  dispose(cb: HotDisposeFunction) {
    (this.#module.onDispose ??= []).push(cb);
  }

  prune(cb: HotDisposeFunction) {
    (this.#module.onDispose ??= []).push(cb);
  }

  invalidate() {
    throw new Error("TODO: implement ImportMetaHot.invalidate");
  }

  on(event: string, cb: HotEventHandler) {
    if (isUnsupportedViteEventName(event)) {
      throw new Error(`Unsupported event name: ${event}`);
    }

    throw new Error("TODO: implement ImportMetaHot.on");
  }

  off(event: string, cb: HotEventHandler) {
    throw new Error("TODO: implement ImportMetaHot.off");
  }

  send(event: string, cb: HotEventHandler) {
    throw new Error("TODO: implement ImportMetaHot.send");
  }
}

/** Called when modules are replaced. */
export async function replaceModules(modules: Record<Id, UnloadedModule>) {
  Object.assign(unloadedModuleRegistry, modules);

  type ToAccept = {
    cb: HotAccept;
    key: Id;
  };
  const toReload = new Set<HMRModule>();
  const toAccept: ToAccept[] = [];
  let failures: Set<Id> | null = null;
  const toDispose: HMRModule[] = [];

  // Discover all HMR boundaries
  outer: for (const key in modules) {
    if (!modules.hasOwnProperty(key)) continue;
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
      if (mod.selfAccept) {
        toReload.add(mod);
        visited.add(mod);
        continue;
      }

      if (mod.onDispose) {
        toDispose.push(mod);
      }

      // All importers will be visited
      if (mod.importers.size === 0) {
        failures ??= new Set();
        failures.add(key);
        continue outer;
      }

      for (const importer of mod.importers) {
        const cb = importer.depAccepts?.[key];
        if (cb) {
          toAccept.push({ cb, key });
        } else {
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
      if (IS_BUN_DEVELOPMENT) {
        assert(!boundary.endsWith(".html")); // caller should have already reloaded
        assert(current);
        assert(current.selfAccept === null);
      }
      if (!current!.importers) {
        message += `Module "${boundary}" is a root module that does not self-accept.\n`;
        continue;
      }
      while (current.importers.size > 0) {
        path.push(current.id);
        for (const importer of current!.importers) {
          if (importer.selfAccept) continue;
          if (importer.depAccepts?.[boundary]) continue;
          current = importer;
          break;
        }
      }
      path.push(current.id);
      if (IS_BUN_DEVELOPMENT) {
        assert(path.length > 0);
      }
      message += `Module "${boundary}" is not accepted by ${path[0]}${path.length > 1 ? "," : "."}\n`;
      for (let i = 1, len = path.length; i < len; i++) {
        const isLast = i === len - 1;
        message += `${isLast ? "└" : "├"} imported by "${path[i]}"${isLast ? "." : ","}\n`;
      }
    }
    message = message.trim();
    if (side === "client") {
      sessionStorage.setItem(
        "bun:hmr:message",
        JSON.stringify({
          message,
          kind: "warn",
        }),
      );
      location.reload();
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
        const p = fn(mod.hot.data);
        if (p && p instanceof Promise) {
          disposePromises.push(p);
        }
      }
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

    promises.push(
      loadModuleAsync(mod.id, false, null).then(mod => {
        if (selfAccept) {
          selfAccept(getEsmExports(mod));
        }
        return mod;
      }),
    );
  }
  for (const mod of await Promise.all(promises)) {
    const { importers } = mod;
    const exports = getEsmExports(mod);
    for (const importer of importers) {
      if (!importer.esm) continue;
      const index = importer.imports!.indexOf(mod);
      if (index === -1) {
        if (IS_BUN_DEVELOPMENT) assert(false);
        continue;
      }
      importer.updateImport![index](exports);
    }
  }

  // Call all accept callbacks
  for (const { cb: cbEntry, key } of toAccept) {
    const { cb: cbFn, modules, single } = cbEntry;
    cbFn(single ? getEsmExports(registry.get(key)!) : createAcceptArray(modules, key));
  }
}

function createAcceptArray(modules: string[], key: Id) {
  const arr = new Array(modules.length);
  arr.fill(undefined);
  const i = modules.indexOf(key);
  if (IS_BUN_DEVELOPMENT) assert(i !== -1);
  arr[i] = getEsmExports(registry.get(key)!);
  return arr;
}

function isUnsupportedViteEventName(str: string) {
  return (
    str === "vite:beforeUpdate" ||
    str === "vite:afterUpdate" ||
    str === "vite:beforeFullReload" ||
    str === "vite:beforePrune" ||
    str === "vite:invalidate" ||
    str === "vite:error" ||
    str === "vite:ws:disconnect" ||
    str === "vite:ws:connect"
  );
}

function throwNotFound(id: Id, isUserDynamic: boolean) {
  if (isUserDynamic) {
    throw new Error(
      `Failed to resolve dynamic import '${id}'. With Bun's bundler, all imports must be statically known at build time so that the bundler can trace everything.`,
    );
  }
  throw new Error(
    `Failed to load bundled module '${id}'. This is not a dynamic import, and therefore is a bug in Bun's bundler.`,
  );
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
}

function assert(condition: any): asserts condition {
  if (!condition) throw new Error("Debug assertion failed");
}

export function setRefreshRuntime(runtime: any) {
  refreshRuntime = runtime;
}

function implicitAcceptFunction() {}

const apply = Function.prototype.apply;
function proxyFn(target: any, key: string) {
  const f = function () {
    return apply.call(target[key], this, arguments);
  };
  return f;
}

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
