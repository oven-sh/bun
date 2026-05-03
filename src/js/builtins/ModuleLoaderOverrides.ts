// Override(s) installed on the JSC `JSModuleLoader` object at Zig::GlobalObject
// construction. Each builtin in this file is installed by
// `GlobalObject::addBuiltinGlobals` via `moduleLoader->putDirectBuiltinFunction`.
//
// Why this file exists: the stock WebKit builtin `ModuleLoader.js`'s
// `requestImportModule` has a fast path that returns the module namespace
// synchronously when `entry.evaluated` is set, even though for a top-level
// await (TLA) module `entry.evaluated` is set *before* evaluation has
// actually completed. As a result, a second dynamic `import()` of the same
// module while the first is still mid-TLA resolves its promise before the
// module finishes evaluating — breaking ECMA262 ContinueDynamicImport and
// diverging from Node/Deno. See https://github.com/oven-sh/bun/issues/29221.
//
// Bun ships prebuilt WebKit, so patching the vendored `ModuleLoader.js`
// isn't enough — we install this override on top of the existing builtin.
// JSC's C++ `JSModuleLoader::requestImportModule` looks the function up
// dynamically by its public-name property (the plain string key, not an
// @-prefixed private symbol) every time, so overriding the property is
// sufficient for both C++-initiated and JS-initiated imports.
//
// The fix: cache the evaluation promise on the registry entry so concurrent
// dynamic imports can `await` it instead of taking the early-return path.

// `this` is the JSModuleLoader; `requestImportModule` is a builtin method.
$visibility = "Private";
export async function requestImportModule(
  this: any,
  moduleName: string,
  referrer: unknown,
  parameters: unknown,
  fetcher: unknown,
) {
  "use strict";

  const key = moduleName;
  let entry = this.ensureRegistered(key);
  let mod: unknown;

  // Fast path 1: entry already present with a module record.
  //
  // If evaluation is still in flight (TLA), `entry.evaluatingPromise` holds
  // the async evaluation promise — wait on it before handing the namespace
  // back. This is the key fix for issue #29221.
  if (entry.evaluated && (mod = entry.module)) {
    if (entry.evaluatingPromise) {
      await entry.evaluatingPromise;
    }
    return this.getModuleNamespaceObject(mod);
  }

  entry = await this.requestSatisfy(entry, parameters, fetcher, new $Set());

  // Fast path 2: another caller raced us through requestSatisfy and already
  // finished (or is in the middle of) evaluating.
  //
  // `entry.evaluated` and `entry.module` are both set synchronously at the
  // start of `linkAndEvaluateModule` below, so whenever `evaluatingPromise`
  // is truthy `evaluated`/`module` are already set — this path is the only
  // place concurrent TLA callers rendezvous.
  if (entry.evaluated && (mod = entry.module)) {
    if (entry.evaluatingPromise) {
      await entry.evaluatingPromise;
    }
    return this.getModuleNamespaceObject(mod);
  }

  // First call to reach evaluation for this entry. `linkAndEvaluateModule`
  // returns `moduleEvaluation(entry, fetcher)` directly, which for a TLA
  // module is the promise returned by `asyncModuleEvaluation`. Cache it on
  // the entry so any concurrent caller that slips through the fast paths
  // can observe and await the same in-flight evaluation. Use the tamper-
  // proof `$isPromise` intrinsic rather than a duck-typed `.then` check so
  // `delete Promise.prototype.then` in user code can't defeat the fix.
  const evalResult = this.linkAndEvaluateModule(entry.key, fetcher);
  if (evalResult && $isPromise(evalResult)) {
    entry.evaluatingPromise = evalResult;
    try {
      await evalResult;
    } finally {
      entry.evaluatingPromise = undefined;
    }
  }
  return this.getModuleNamespaceObject(entry.module);
}
