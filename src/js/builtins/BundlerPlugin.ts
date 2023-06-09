import type {
  AnyFunction,
  BuildConfig,
  BunPlugin,
  OnLoadCallback,
  OnLoadResult,
  OnLoadResultObject,
  OnLoadResultSourceCode,
  OnResolveCallback,
  PluginBuilder,
  PluginConstraints,
} from "bun";

// This API expects 4 functions:
// It should be generic enough to reuse for Bun.plugin() eventually, too.
interface BundlerPlugin {
  onLoad: Map<string, [RegExp, OnLoadCallback][]>;
  onResolve: Map<string, [RegExp, OnResolveCallback][]>;
  onLoadAsync(
    internalID,
    sourceCode: string | Uint8Array | ArrayBuffer | DataView | null,
    loaderKey: number | null,
  ): void;
  onResolveAsync(internalID, a, b, c): void;
  addError(internalID, error, number): void;
  addFilter(filter, namespace, number): void;
}

// Extra types
type Setup = BunPlugin["setup"];
type MinifyObj = Exclude<BuildConfig["minify"], boolean>;
interface BuildConfigExt extends BuildConfig {
  // we support esbuild-style entryPoints
  entryPoints?: string[];
  // plugins is guaranteed to not be null
  plugins: BunPlugin[];
}
interface PluginBuilderExt extends PluginBuilder {
  // these functions aren't implemented yet, so we dont publicly expose them
  resolve: AnyFunction;
  onStart: AnyFunction;
  onEnd: AnyFunction;
  onDispose: AnyFunction;
  // we partially support initialOptions. it's read-only and a subset of
  // all options mapped to their esbuild names
  initialOptions: any;
  // we set this to an empty object
  esbuild: any;
}

export function runSetupFunction(this: BundlerPlugin, setup: Setup, config: BuildConfigExt) {
  var onLoadPlugins = new Map<string, [RegExp, AnyFunction][]>();
  var onResolvePlugins = new Map<string, [RegExp, AnyFunction][]>();

  function validate(filterObject: PluginConstraints, callback, map) {
    if (!filterObject || !$isObject(filterObject)) {
      throw new TypeError('Expected an object with "filter" RegExp');
    }

    if (!callback || !$isCallable(callback)) {
      throw new TypeError("callback must be a function");
    }

    var { filter, namespace = "file" } = filterObject;

    if (!filter) {
      throw new TypeError('Expected an object with "filter" RegExp');
    }

    if (!$isRegExpObject(filter)) {
      throw new TypeError("filter must be a RegExp");
    }

    if (namespace && !(typeof namespace === "string")) {
      throw new TypeError("namespace must be a string");
    }

    if ((namespace?.length ?? 0) === 0) {
      namespace = "file";
    }

    if (!/^([/$a-zA-Z0-9_\\-]+)$/.test(namespace)) {
      throw new TypeError("namespace can only contain $a-zA-Z0-9_\\-");
    }

    var callbacks = map.$get(namespace);

    if (!callbacks) {
      map.$set(namespace, [[filter, callback]]);
    } else {
      $arrayPush(callbacks, [filter, callback]);
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
          var existing = onResolveObject.$get(namespace) as [RegExp, AnyFunction][];

          if (!existing) {
            onResolveObject.$set(namespace, callbacks);
          } else {
            onResolveObject.$set(namespace, existing.concat(callbacks));
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
          var existing = onLoadObject.$get(namespace) as [RegExp, AnyFunction][];

          if (!existing) {
            onLoadObject.$set(namespace, callbacks);
          } else {
            onLoadObject.$set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    return anyOnLoad || anyOnResolve;
  };

  var setupResult = setup({
    config: config,
    onDispose: notImplementedIssueFn(2771, "On-dispose callbacks"),
    onEnd: notImplementedIssueFn(2771, "On-end callbacks"),
    onLoad,
    onResolve,
    onStart: notImplementedIssueFn(2771, "On-start callbacks"),
    resolve: notImplementedIssueFn(2771, "build.resolve()"),
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

  if (setupResult && $isPromise(setupResult)) {
    if ($getPromiseInternalField(setupResult, $promiseFieldFlags) & $promiseStateFulfilled) {
      setupResult = $getPromiseInternalField(setupResult, $promiseFieldReactionsOrResult);
    } else {
      return setupResult.$then(processSetupResult);
    }
  }

  return processSetupResult();
}

export function runOnResolvePlugins(this: BundlerPlugin, specifier, inputNamespace, importer, internalID, kindId) {
  // Must be kept in sync with ImportRecord.label
  const kind = $ImportKindIdToLabel[kindId];

  var promiseResult: any = (async (inputPath, inputNamespace, importer, kind) => {
    var { onResolve, onLoad } = this;
    var results = onResolve.$get(inputNamespace);
    if (!results) {
      this.onResolveAsync(internalID, null, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.test(inputPath)) {
        var result = callback({
          path: inputPath,
          importer,
          namespace: inputNamespace,
          // resolveDir
          kind,
          // pluginData
        });

        while (
          result &&
          $isPromise(result) &&
          ($getPromiseInternalField(result, $promiseFieldFlags) & $promiseStateMask) === $promiseStateFulfilled
        ) {
          result = $getPromiseInternalField(result, $promiseFieldReactionsOrResult);
        }

        if (result && $isPromise(result)) {
          result = await result;
        }

        if (!result || !$isObject(result)) {
          continue;
        }

        var { path, namespace: userNamespace = inputNamespace, external } = result;
        if (!(typeof path === "string") || !(typeof userNamespace === "string")) {
          throw new TypeError("onResolve plugins must return an object with a string 'path' and string 'loader' field");
        }

        if (!path) {
          continue;
        }

        if (!userNamespace) {
          userNamespace = inputNamespace;
        }
        if (typeof external !== "boolean" && !$isUndefinedOrNull(external)) {
          throw new TypeError('onResolve plugins "external" field must be boolean or unspecified');
        }

        if (!external) {
          if (userNamespace === "file") {
            if (process.platform !== "win32") {
              if (path[0] !== "/" || path.includes("..")) {
                throw new TypeError('onResolve plugin "path" must be absolute when the namespace is "file"');
              }
            } else {
              // TODO: Windows
            }
          }
          if (userNamespace === "dataurl") {
            if (!path.startsWith("data:")) {
              throw new TypeError('onResolve plugin "path" must start with "data:" when the namespace is "dataurl"');
            }
          }

          if (userNamespace && userNamespace !== "file" && (!onLoad || !onLoad.$has(userNamespace))) {
            throw new TypeError(`Expected onLoad plugin for namespace ${userNamespace} to exist`);
          }
        }
        this.onResolveAsync(internalID, path, userNamespace, external);
        return null;
      }
    }

    this.onResolveAsync(internalID, null, null, null);
    return null;
  })(specifier, inputNamespace, importer, kind);

  while (
    promiseResult &&
    $isPromise(promiseResult) &&
    ($getPromiseInternalField(promiseResult, $promiseFieldFlags) & $promiseStateMask) === $promiseStateFulfilled
  ) {
    promiseResult = $getPromiseInternalField(promiseResult, $promiseFieldReactionsOrResult);
  }

  if (promiseResult && $isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e, 0);
      },
    );
  }
}

export function runOnLoadPlugins(this: BundlerPlugin, internalID, path, namespace, defaultLoaderId) {
  const LOADERS_MAP = $LoaderLabelToId;
  const loaderName = $LoaderIdToLabel[defaultLoaderId];

  var promiseResult = (async (internalID, path, namespace, defaultLoader) => {
    var results = this.onLoad.$get(namespace);
    if (!results) {
      this.onLoadAsync(internalID, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.test(path)) {
        var result = callback({
          path,
          namespace,
          // suffix
          // pluginData
          loader: defaultLoader,
        });

        while (
          result &&
          $isPromise(result) &&
          ($getPromiseInternalField(result, $promiseFieldFlags) & $promiseStateMask) === $promiseStateFulfilled
        ) {
          result = $getPromiseInternalField(result, $promiseFieldReactionsOrResult);
        }

        if (result && $isPromise(result)) {
          result = await result;
        }

        if (!result || !$isObject(result)) {
          continue;
        }

        var { contents, loader = defaultLoader } = result as OnLoadResultSourceCode & OnLoadResultObject;
        if (!(typeof contents === "string") && !$isTypedArrayView(contents)) {
          throw new TypeError('onLoad plugins must return an object with "contents" as a string or Uint8Array');
        }

        if (!(typeof loader === "string")) {
          throw new TypeError('onLoad plugins must return an object with "loader" as a string');
        }

        const chosenLoader = LOADERS_MAP[loader];
        if (chosenLoader === undefined) {
          throw new TypeError(`Loader ${loader} is not supported.`);
        }

        this.onLoadAsync(internalID, contents, chosenLoader);
        return null;
      }
    }

    this.onLoadAsync(internalID, null, null);
    return null;
  })(internalID, path, namespace, loaderName);

  while (
    promiseResult &&
    $isPromise(promiseResult) &&
    ($getPromiseInternalField(promiseResult, $promiseFieldFlags) & $promiseStateMask) === $promiseStateFulfilled
  ) {
    promiseResult = $getPromiseInternalField(promiseResult, $promiseFieldReactionsOrResult);
  }

  if (promiseResult && $isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e, 1);
      },
    );
  }
}
