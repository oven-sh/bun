// Synchronous module customization hooks — `module.registerHooks()`.
// Port of Node.js lib/internal/modules/customization_hooks.js, adapted to
// drive Bun's native resolver/module loader:
//   - the native resolve funnel calls `runResolveHooksBun` (via
//     `Bun__runModuleResolveHooks`) and receives back a resolved specifier
//     for Bun's pipeline, or `undefined` when the chain matched the default
//     resolution (so the native fast paths stay in charge);
//   - the native loader calls `runLoadHooksBun` (via
//     `Bun__runModuleLoadHooks`) and receives `{ source, loader, moduleType }`
//     to transpile, or `undefined` to load the module natively.
const { validateFunction } = require("internal/validators");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { isAbsolute } = require("node:path");
const { isAnyArrayBuffer, isArrayBufferView } = require("node:util/types");
const { isBuiltin } = require("node:module");

// (resolveCount: number, loadCount: number) => void — mirrors the counts into
// the native VirtualMachine so the resolver/loader can gate on an integer.
const setNativeHooksCounts = $newRustFunction("node_module_hooks_binding.rs", "setModuleHooksCounts", 2);
// (specifier: string, referrer: string, isESM: boolean, isUserRequireResolve:
// boolean) => string — Bun's default resolution, with hooks suppressed.
const nativeDefaultResolve = $newRustFunction("node_module_hooks_binding.rs", "defaultResolveForHooks", 4);

// BunLoaderType values (src/jsc/bindings/headers-handwritten.h).
const LOADER_NONE = 254;
const LOADER_JS = 2;
const LOADER_TS = 3;
const LOADER_JSON = 7;
// ModuleType override handed back to the native loader.
const MODULE_TYPE_UNKNOWN = 0;
const MODULE_TYPE_CJS = 1;
const MODULE_TYPE_ESM = 2;

// Node's default conditions, in Node's order (observed on v26.3.0).
const cjsConditions = ["require", "node", "node-addons", "module-sync"];
const esmConditions = ["node", "import", "module-sync", "node-addons"];

const resolveHooks: any[] = [];
const loadHooks: any[] = [];
const hookId = Symbol("kModuleHooksIdKey");
let nextHookId = 0;

// Formats produced by the resolve hook chain, keyed by result URL, consumed
// as `context.format` when the load stage runs for that module.
const resolvedFormats = new Map<string, string>();

class ModuleHooks {
  resolve;
  load;
  constructor(resolve, load) {
    this[hookId] = Symbol(`module-hook-${nextHookId++}`);
    this.resolve = resolve;
    this.load = load;
    if (resolve) {
      resolveHooks.push(this);
    }
    if (load) {
      loadHooks.push(this);
    }
    setNativeHooksCounts(resolveHooks.length, loadHooks.length);
    Object.freeze(this);
  }

  deregister() {
    const id = this[hookId];
    let index = resolveHooks.findIndex(hook => hook[hookId] === id);
    if (index !== -1) {
      resolveHooks.splice(index, 1);
    }
    index = loadHooks.findIndex(hook => hook[hookId] === id);
    if (index !== -1) {
      loadHooks.splice(index, 1);
    }
    setNativeHooksCounts(resolveHooks.length, loadHooks.length);
  }
}

function registerHooks(hooks) {
  const { resolve, load } = hooks;
  if (resolve) {
    validateFunction(resolve, "hooks.resolve");
  }
  if (load) {
    validateFunction(load, "hooks.load");
  }
  return new ModuleHooks(resolve, load);
}

function convertCJSFilenameToURL(filename) {
  if (!filename) return filename;
  const normalizedId = filename.startsWith("node:") ? filename.slice(5) : filename;
  if (isBuiltin(normalizedId)) {
    return `node:${normalizedId}`;
  }
  if (isAbsolute(filename)) {
    return pathToFileURL(filename).href;
  }
  return filename;
}

function convertURLToCJSFilename(url) {
  if (!url) return url;
  if (url.startsWith("node:")) {
    return url;
  }
  if (isBuiltin(url)) {
    return url;
  }
  if (url.startsWith("file://")) {
    return fileURLToPath(url);
  }
  return url;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/customization_hooks.js#L171
function buildHooks(hooks, name, defaultStep, validate, mergedContext) {
  let lastRunIndex = hooks.length;
  function wrapHook(index, userHookOrDefault, next) {
    return function nextStep(arg0, context) {
      lastRunIndex = index;
      if (context && context !== mergedContext) {
        Object.assign(mergedContext, context);
      }
      const hookResult = userHookOrDefault(arg0, mergedContext, next);
      if (lastRunIndex > 0 && lastRunIndex === index && !hookResult.shortCircuit) {
        throw $ERR_INVALID_RETURN_PROPERTY_VALUE("true", name, "shortCircuit", hookResult.shortCircuit);
      }
      return validate(arg0, mergedContext, hookResult);
    };
  }
  const chain = [wrapHook(0, defaultStep)];
  for (let i = 0; i < hooks.length; ++i) {
    const wrappedHook = wrapHook(i + 1, hooks[i][name], chain[i]);
    chain.push(wrappedHook);
  }
  return chain[chain.length - 1];
}

function validateResolve(specifier, context, result) {
  const { url, format, importAttributes } = result;
  if (typeof url !== "string") {
    throw $ERR_INVALID_RETURN_PROPERTY_VALUE("a URL string", "resolve", "url", url);
  }
  if (format && typeof format !== "string") {
    throw $ERR_INVALID_RETURN_PROPERTY_VALUE("a string", "resolve", "format", format);
  }
  if (importAttributes && typeof importAttributes !== "object") {
    throw $ERR_INVALID_RETURN_PROPERTY_VALUE("an object", "resolve", "importAttributes", importAttributes);
  }
  return {
    __proto__: null,
    url,
    format,
    importAttributes,
  };
}

function validateSourceStrict(url, context, result) {
  const { source, format } = result;
  // To align with module.register(), the load hooks are still invoked for
  // the builtins even though the default load step only provides null as
  // source, and any source content for builtins provided by the user hooks
  // is ignored.
  if (
    !url.startsWith("node:") &&
    typeof result.source !== "string" &&
    !isAnyArrayBuffer(source) &&
    !isArrayBufferView(source) &&
    format !== "addon"
  ) {
    throw $ERR_INVALID_RETURN_PROPERTY_VALUE("a string, an ArrayBuffer, or a TypedArray", "load", "source", source);
  }
}

function validateSourcePermissive(url, context, result) {
  const { source, format } = result;
  if (format === "commonjs" && source == null) {
    // The default load step for the ES module loader produces a null source
    // for commonjs modules; see nodejs/node#57327.
    return;
  }
  validateSourceStrict(url, context, result);
}

function validateFormat(url, context, result) {
  const { format } = result;
  if (typeof format !== "string" && format !== undefined) {
    throw $ERR_INVALID_RETURN_PROPERTY_VALUE("a string", "load", "format", format);
  }
}

function validateLoadStrict(url, context, result) {
  validateSourceStrict(url, context, result);
  validateFormat(url, context, result);
  return result;
}

function validateLoadSloppy(url, context, result) {
  validateSourcePermissive(url, context, result);
  validateFormat(url, context, result);
  return result;
}

class ModuleResolveContext {
  parentURL;
  importAttributes;
  conditions;
  constructor(parentURL, importAttributes, conditions) {
    this.parentURL = parentURL;
    this.importAttributes = importAttributes;
    this.conditions = conditions;
  }
}

class ModuleLoadContext {
  format;
  importAttributes;
  conditions;
  constructor(format, importAttributes, conditions) {
    this.format = format;
    this.importAttributes = importAttributes;
    this.conditions = conditions;
  }
}

let decoder;
function loadWithHooks(url, originalFormat, importAttributes, conditions, defaultLoad, validateLoad) {
  const context = new ModuleLoadContext(originalFormat, importAttributes, conditions);
  if (loadHooks.length === 0) {
    return defaultLoad(url, context);
  }

  const runner = buildHooks(loadHooks, "load", defaultLoad, validateLoad, context);

  const result = runner(url, context);
  const { source, format } = result;
  if (!isAnyArrayBuffer(source) && !isArrayBufferView(source)) {
    return result;
  }

  switch (format) {
    // Text formats:
    case undefined:
    case "module":
    case "commonjs":
    case "json":
    case "module-typescript":
    case "commonjs-typescript":
    case "typescript": {
      decoder ??= new TextDecoder();
      result.source = decoder.decode(source);
      break;
    }
    default:
      break;
  }
  return result;
}

function resolveWithHooks(specifier, parentURL, importAttributes, conditions, defaultResolve) {
  const context = new ModuleResolveContext(parentURL, importAttributes, conditions);
  if (resolveHooks.length === 0) {
    return defaultResolve(specifier, context);
  }

  const runner = buildHooks(resolveHooks, "resolve", defaultResolve, validateResolve, context);

  return runner(specifier, context);
}

// Formats Node's ES module resolution reports for a resolved path, derived
// from the extension (Bun's native loader re-derives package.json semantics
// itself, so this only feeds the hooks' `context`/result observability).
function defaultEsmFormat(filename) {
  if (filename.startsWith("node:")) return "builtin";
  if (filename.endsWith(".mjs")) return "module";
  if (filename.endsWith(".cjs")) return "commonjs";
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".wasm")) return "wasm";
  if (filename.endsWith(".node")) return "addon";
  return null;
}

// ── Bun native loader entry points ──────────────────────────────────────────

// Called by the native resolve funnel when at least one resolve hook is
// registered. Returns the resolved specifier for Bun's pipeline, or
// `undefined` when the chain produced exactly the default resolution.
function runResolveHooksBun(specifier, referrer, isESM, isUserRequireResolve) {
  const parentURL = referrer ? convertCJSFilenameToURL(referrer) : undefined;
  const conditions = isESM ? esmConditions : cjsConditions;
  const importAttributes = isESM ? {} : undefined;

  let defaultUrl;
  function defaultResolve(spec, context) {
    if (context.conditions !== undefined && context.conditions !== conditions && !Array.isArray(context.conditions)) {
      throw $ERR_INVALID_ARG_VALUE("context.conditions", context.conditions, "expected an array");
    }
    const filename = nativeDefaultResolve(spec, referrer, isESM, isUserRequireResolve);
    const url = convertCJSFilenameToURL(filename);
    if (spec === specifier) {
      defaultUrl = url;
    }
    return { __proto__: null, url, format: isESM ? defaultEsmFormat(filename) : undefined };
  }

  const result = resolveWithHooks(specifier, parentURL, importAttributes, conditions, defaultResolve);
  const { url, format } = result;
  if (format != null) {
    resolvedFormats.set(url, format);
  }
  if (defaultUrl !== undefined && url === defaultUrl) {
    // The chain settled on the default resolution; let the native pipeline
    // keep its own result (preserves require.resolve()'s bare builtin ids).
    return undefined;
  }
  if (isUserRequireResolve && url.startsWith("node:") && isBuiltin(url)) {
    // require.resolve() reports redirected builtins by their bare id, like
    // Node's convertURLToCJSFilename().
    return url.slice(5);
  }
  return convertURLToCJSFilename(url);
}

function defaultLoadImplCJS(filename, format) {
  switch (format) {
    case undefined:
    case null:
    case "module":
    case "commonjs":
    case "json":
    case "module-typescript":
    case "commonjs-typescript":
    case "typescript": {
      return require("node:fs").readFileSync(filename, "utf8");
    }
    case "builtin":
      return null;
    default:
      throw $ERR_UNKNOWN_MODULE_FORMAT(format, convertCJSFilenameToURL(filename));
  }
}

// Called by the native module loader when any hooks are registered, right
// before it would read the module off disk. Returns `undefined` to let the
// native loader proceed, or `{ source, loader, moduleType }` overrides.
function runLoadHooksBun(path, loaderHint, moduleTypeHint, isCommonJSRequire) {
  const url = convertCJSFilenameToURL(path);
  let format = resolvedFormats.get(url);
  if (format === undefined && url.startsWith("node:")) {
    format = "builtin";
  }
  if (format === undefined && !isCommonJSRequire) {
    format =
      moduleTypeHint === MODULE_TYPE_ESM && url.endsWith(".js")
        ? "module"
        : moduleTypeHint === MODULE_TYPE_CJS && url.endsWith(".js")
          ? "commonjs"
          : defaultEsmFormat(path);
  }
  const conditions = isCommonJSRequire ? cjsConditions : esmConditions;
  const importAttributes = isCommonJSRequire ? undefined : {};

  function defaultLoad(urlFromHook, context) {
    const isLoadingOriginalModule = urlFromHook === url;
    const filenameFromHook = isLoadingOriginalModule ? path : convertURLToCJSFilename(urlFromHook);
    if (isCommonJSRequire) {
      const source = defaultLoadImplCJS(filenameFromHook, context.format);
      return { source, format: context.format };
    }
    // ES module pipeline.
    if (context.format === "builtin" || urlFromHook.startsWith("node:")) {
      return { source: null, format: "builtin" };
    }
    if (context.format === "commonjs") {
      // See nodejs/node#57327: the ESM loader's default load step delegates
      // commonjs to the CJS loader and reports a null source.
      return { source: null, format: context.format };
    }
    const source = require("node:fs").readFileSync(filenameFromHook, "utf8");
    // A null format means "not determined yet" (Node resolves it via syntax
    // detection); report undefined so the chain's format validation passes
    // and Bun's native loader performs its own detection on the source.
    return { source, format: context.format ?? undefined };
  }

  const result = loadWithHooks(
    url,
    format,
    importAttributes,
    conditions,
    defaultLoad,
    isCommonJSRequire ? validateLoadStrict : validateLoadSloppy,
  );

  let { source } = result;
  const finalFormat = result.format;
  if (source == null) {
    // builtin, addon, or the ESM commonjs delegation quirk: load natively.
    return undefined;
  }
  if (typeof source !== "string") {
    // Binary source with a non-text format (e.g. wasm): let the native
    // loader read the module itself.
    return undefined;
  }

  switch (finalFormat) {
    case undefined:
    case null:
      return {
        source,
        loader: loaderHint === LOADER_NONE ? LOADER_JS : loaderHint,
        moduleType: MODULE_TYPE_UNKNOWN,
      };
    case "module":
      return { source, loader: LOADER_JS, moduleType: MODULE_TYPE_ESM };
    case "commonjs":
      return { source, loader: LOADER_JS, moduleType: MODULE_TYPE_CJS };
    case "json":
      return { source, loader: LOADER_JSON, moduleType: MODULE_TYPE_UNKNOWN };
    case "module-typescript":
      return { source, loader: LOADER_TS, moduleType: MODULE_TYPE_ESM };
    case "commonjs-typescript":
      return { source, loader: LOADER_TS, moduleType: MODULE_TYPE_CJS };
    case "typescript":
      return { source, loader: LOADER_TS, moduleType: MODULE_TYPE_UNKNOWN };
    case "builtin":
    case "addon":
      return undefined;
    default:
      throw $ERR_UNKNOWN_MODULE_FORMAT(finalFormat, url);
  }
}

// DEP0205 — `module.register()`. Bun does not implement the off-thread hooks
// thread behind module.register(); the deprecated API stays a no-op, but it
// emits Node's deprecation pointing at the supported module.registerHooks().
let registerDeprecationWarned = false;
function emitRegisterDeprecation() {
  if (registerDeprecationWarned) return;
  registerDeprecationWarned = true;
  process.emitWarning(
    "`module.register()` is deprecated. Use `module.registerHooks()` instead.",
    "DeprecationWarning",
    "DEP0205",
  );
}

export default {
  registerHooks,
  emitRegisterDeprecation,
  runResolveHooksBun,
  runLoadHooksBun,
};
