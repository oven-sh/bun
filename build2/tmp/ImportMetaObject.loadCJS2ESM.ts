// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ImportMetaObject.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(resolvedSpecifier) {  var loader = Loader;
  var queue = __intrinsic__createFIFO();
  var key = resolvedSpecifier;
  while (key) {
    // we need to explicitly check because state could be $ModuleFetch
    // it will throw this error if we do not:
    //    $throwTypeError("Requested module is already fetched.");
    var entry = loader.registry.__intrinsic__get(key)!;

    if ((entry?.state ?? 0) <= __intrinsic__ModuleFetch) {
      __intrinsic__fulfillModuleSync(key);
      entry = loader.registry.__intrinsic__get(key)!;
    }

    // entry.fetch is a Promise<SourceCode>
    // SourceCode is not a string, it's a JSC::SourceCode object
    // this pulls it out of the promise without delaying by a tick
    // the promise is already fullfilled by $fullfillModuleSync
    var sourceCodeObject = __intrinsic__getPromiseInternalField(entry.fetch, __intrinsic__promiseFieldReactionsOrResult);
    // parseModule() returns a Promise, but the value is already fulfilled
    // so we just pull it out of the promise here once again
    // But, this time we do it a little more carefully because this is a JSC function call and not bun source code
    var moduleRecordPromise = loader.parseModule(key, sourceCodeObject);
    var mod = entry.module;
    if (moduleRecordPromise && __intrinsic__isPromise(moduleRecordPromise)) {
      var reactionsOrResult = __intrinsic__getPromiseInternalField(moduleRecordPromise, __intrinsic__promiseFieldReactionsOrResult);
      var flags = __intrinsic__getPromiseInternalField(moduleRecordPromise, __intrinsic__promiseFieldFlags);
      var state = flags & __intrinsic__promiseStateMask;
      // this branch should never happen, but just to be safe
      if (state === __intrinsic__promiseStatePending || (reactionsOrResult && __intrinsic__isPromise(reactionsOrResult))) {
        __intrinsic__throwTypeError(`require() async module "${key}" is unsupported. use "await import()" instead.`);
      } else if (state === __intrinsic__promiseStateRejected) {
        if (!reactionsOrResult?.message) {
          __intrinsic__throwTypeError(
            `${
              reactionsOrResult + "" ? reactionsOrResult : "An error occurred"
            } occurred while parsing module \"${key}\"`,
          );
        }

        throw reactionsOrResult;
      }
      entry.module = mod = reactionsOrResult;
    } else if (moduleRecordPromise && !mod) {
      entry.module = mod = moduleRecordPromise as LoaderModule;
    }

    // This is very similar to "requestInstantiate" in ModuleLoader.js in JavaScriptCore.
    __intrinsic__setStateToMax(entry, __intrinsic__ModuleLink);
    var dependenciesMap = mod.dependenciesMap;
    var requestedModules = loader.requestedModules(mod);
    var dependencies = __intrinsic__newArrayWithSize<string>(requestedModules.length);
    for (var i = 0, length = requestedModules.length; i < length; ++i) {
      var depName = requestedModules[i];
      // optimization: if it starts with a slash then it's an absolute path
      // we don't need to run the resolver a 2nd time
      var depKey = depName[0] === "/" ? depName : loader.resolve(depName, key);
      var depEntry = loader.ensureRegistered(depKey);

      if (depEntry.state < __intrinsic__ModuleLink) {
        queue.push(depKey);
      }

      __intrinsic__putByValDirect(dependencies, i, depEntry);
      dependenciesMap.__intrinsic__set(depName, depEntry);
    }

    entry.dependencies = dependencies;
    // All dependencies resolved, set instantiate and satisfy field directly.
    entry.instantiate = Promise.__intrinsic__resolve(entry);
    entry.satisfy = Promise.__intrinsic__resolve(entry);
    entry.isSatisfied = true;

    key = queue.shift();
    while (key && (loader.registry.__intrinsic__get(key)?.state ?? __intrinsic__ModuleFetch) >= __intrinsic__ModuleLink) {
      key = queue.shift();
    }
  }

  var linkAndEvaluateResult = loader.linkAndEvaluateModule(resolvedSpecifier, undefined);
  if (linkAndEvaluateResult && __intrinsic__isPromise(linkAndEvaluateResult)) {
    // if you use top-level await, or any dependencies use top-level await, then we throw here
    // this means the module will still actually load eventually, but that's okay.
    __intrinsic__throwTypeError(
      `require() async module \"${resolvedSpecifier}\" is unsupported. use "await import()" instead.`,
    );
  }

  return loader.registry.__intrinsic__get(resolvedSpecifier);
}).$$capture_end$$;
