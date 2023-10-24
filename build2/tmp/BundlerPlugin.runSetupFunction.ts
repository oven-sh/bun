// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/BundlerPlugin.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(setup,config) {  var onLoadPlugins = new Map<string, [RegExp, AnyFunction][]>();
  var onResolvePlugins = new Map<string, [RegExp, AnyFunction][]>();

  function validate(filterObject: PluginConstraints, callback, map) {
    if (!filterObject || !__intrinsic__isObject(filterObject)) {
      __intrinsic__throwTypeError('Expected an object with "filter" RegExp');
    }

    if (!callback || !__intrinsic__isCallable(callback)) {
      __intrinsic__throwTypeError("callback must be a function");
    }

    var { filter, namespace = "file" } = filterObject;

    if (!filter) {
      __intrinsic__throwTypeError('Expected an object with "filter" RegExp');
    }

    if (!__intrinsic__isRegExpObject(filter)) {
      __intrinsic__throwTypeError("filter must be a RegExp");
    }

    if (namespace && !(typeof namespace === "string")) {
      __intrinsic__throwTypeError("namespace must be a string");
    }

    if ((namespace?.length ?? 0) === 0) {
      namespace = "file";
    }

    if (!/^([/__intrinsic__a-zA-Z0-9_\\-]+)$/.test(namespace)) {
      __intrinsic__throwTypeError("namespace can only contain $a-zA-Z0-9_\\-");
    }

    var callbacks = map.__intrinsic__get(namespace);

    if (!callbacks) {
      map.__intrinsic__set(namespace, [[filter, callback]]);
    } else {
      __intrinsic__arrayPush(callbacks, [filter, callback]);
    }
  }

  function onLoad(filterObject, callback) {
    validate(filterObject, callback, onLoadPlugins);
  }

  function onResolve(filterObject, callback) {
    validate(filterObject, callback, onResolvePlugins);
  }

  const processSetupResult = () => {
    var anyOnLoad = false,
      anyOnResolve = false;

    for (var [namespace, callbacks] of onLoadPlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 1);
        anyOnLoad = true;
      }
    }

    for (var [namespace, callbacks] of onResolvePlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 0);
        anyOnResolve = true;
      }
    }

    if (anyOnResolve) {
      var onResolveObject = this.onResolve;
      if (!onResolveObject) {
        this.onResolve = onResolvePlugins;
      } else {
        for (var [namespace, callbacks] of onResolvePlugins.entries()) {
          var existing = onResolveObject.__intrinsic__get(namespace) as [RegExp, AnyFunction][];

          if (!existing) {
            onResolveObject.__intrinsic__set(namespace, callbacks);
          } else {
            onResolveObject.__intrinsic__set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    if (anyOnLoad) {
      var onLoadObject = this.onLoad;
      if (!onLoadObject) {
        this.onLoad = onLoadPlugins;
      } else {
        for (var [namespace, callbacks] of onLoadPlugins.entries()) {
          var existing = onLoadObject.__intrinsic__get(namespace) as [RegExp, AnyFunction][];

          if (!existing) {
            onLoadObject.__intrinsic__set(namespace, callbacks);
          } else {
            onLoadObject.__intrinsic__set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    return anyOnLoad || anyOnResolve;
  };

  var setupResult = setup({
    config: config,
    onDispose: () => __intrinsic__throwTypeError(`__intrinsic__{__intrinsic__2} is not implemented yet. See https://github.com/oven-sh/bun/issues/__intrinsic__1`),
    onEnd: () => __intrinsic__throwTypeError(`__intrinsic__{__intrinsic__2} is not implemented yet. See https://github.com/oven-sh/bun/issues/__intrinsic__1`),
    onLoad,
    onResolve,
    onStart: () => __intrinsic__throwTypeError(`__intrinsic__{__intrinsic__2} is not implemented yet. See https://github.com/oven-sh/bun/issues/__intrinsic__1`),
    resolve: () => __intrinsic__throwTypeError(`__intrinsic__{__intrinsic__2} is not implemented yet. See https://github.com/oven-sh/bun/issues/__intrinsic__1`),
    module: () => {
      __intrinsic__throwTypeError("module() is not supported in Bun.build() yet. Only via Bun.plugin() at runtime");
    },
    // esbuild's options argument is different, we provide some interop
    initialOptions: {
      ...config,
      bundle: true,
      entryPoints: config.entrypoints ?? config.entryPoints ?? [],
      minify: typeof config.minify === "boolean" ? config.minify : false,
      minifyIdentifiers: config.minify === true || (config.minify as MinifyObj)?.identifiers,
      minifyWhitespace: config.minify === true || (config.minify as MinifyObj)?.whitespace,
      minifySyntax: config.minify === true || (config.minify as MinifyObj)?.syntax,
      outbase: config.root,
      platform: config.target === "bun" ? "node" : config.target,
    },
    esbuild: {},
  } satisfies PluginBuilderExt as PluginBuilder);

  if (setupResult && __intrinsic__isPromise(setupResult)) {
    if (__intrinsic__getPromiseInternalField(setupResult, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateFulfilled) {
      setupResult = __intrinsic__getPromiseInternalField(setupResult, __intrinsic__promiseFieldReactionsOrResult);
    } else {
      return setupResult.__intrinsic__then(processSetupResult);
    }
  }

  return processSetupResult();
}).$$capture_end$$;
