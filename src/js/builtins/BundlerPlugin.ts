import type { BuildConfig, BunPlugin, OnLoadCallback, OnResolveCallback, PluginBuilder, PluginConstraints } from "bun";
type AnyFunction = (...args: any[]) => any;

/**
 * @see `JSBundlerPlugin.h`
 */
interface BundlerPlugin {
  onLoad: Map<string, [RegExp, OnLoadCallback][]>;
  onResolve: Map<string, [RegExp, OnResolveCallback][]>;
  onEndCallbacks: Array<(build: Bun.BuildOutput) => void | Promise<void>> | undefined;
  /** Binding to `JSBundlerPlugin__onLoadAsync` */
  onLoadAsync(
    internalID,
    sourceCode: string | Uint8Array | ArrayBuffer | DataView | null,
    loaderKey: number | null,
  ): void;
  /** Binding to `JSBundlerPlugin__onResolveAsync` */
  onResolveAsync(internalID, a, b, c): void;
  /** Binding to `JSBundlerPlugin__addError` */
  addError(internalID: number, error: any, which: number): void;
  addFilter(filter, namespace, number): void;
  generateDeferPromise(id: number): Promise<void>;
  promises: Array<Promise<any>> | undefined;

  onBeforeParse: (filter: RegExp, namespace: string, addon: unknown, symbol: string, external?: unknown) => void;
  $napiDlopenHandle: number;
}

// Extra types
type Setup = BunPlugin["setup"];
type MinifyObj = Exclude<BuildConfig["minify"], boolean>;
interface BuildConfigExt extends BuildConfig {
  // we support esbuild-style 'entryPoints' capitalization
  entryPoints?: string[];
  // plugins is guaranteed to not be null
  plugins: BunPlugin[];
}
interface PluginBuilderExt extends PluginBuilder {
  resolve: AnyFunction;
  onEnd: AnyFunction;
  onDispose: AnyFunction;
  // we partially support initialOptions. it's read-only and a subset of
  // all options mapped to their esbuild names
  initialOptions: any;
  // we set this to an empty object
  esbuild: any;
}

/**
 * Used by Bun.serve() to resolve and load plugins.
 */
export function loadAndResolvePluginsForServe(
  this: BundlerPlugin,
  plugins: string[],
  bunfig_folder: string,
  runSetupFn: typeof runSetupFunction,
) {
  // Same config as created in HTMLBundle.init
  let config: BuildConfigExt = {
    experimentalCss: true,
    experimentalHtml: true,
    target: "browser",
    root: bunfig_folder,
  };

  class InvalidBundlerPluginError extends TypeError {
    pluginName: string;
    constructor(pluginName: string, reason: string) {
      super(`"${pluginName}" is not a valid bundler plugin: ${reason}`);
      this.pluginName = pluginName;
    }
  }

  let bundlerPlugin = this;
  let promiseResult = (async (
    plugins: string[],
    bunfig_folder: string,
    runSetupFn: typeof runSetupFunction,
    bundlerPlugin: BundlerPlugin,
  ) => {
    let onstart_promises_array: Array<Promise<any>> | undefined = undefined;
    for (let i = 0; i < plugins.length; i++) {
      let pluginModuleResolved = await Bun.resolve(plugins[i], bunfig_folder);

      let pluginModuleRaw = await import(pluginModuleResolved);
      if (!pluginModuleRaw || !pluginModuleRaw.default) {
        throw new TypeError(`Expected "${plugins[i]}" to be a module which default exports a bundler plugin.`);
      }
      let pluginModule = pluginModuleRaw.default;
      if (!pluginModule) throw new InvalidBundlerPluginError(plugins[i], "default export is missing");
      if (pluginModule.name === undefined) throw new InvalidBundlerPluginError(plugins[i], "name is missing");
      if (pluginModule.setup === undefined) throw new InvalidBundlerPluginError(plugins[i], "setup() is missing");
      onstart_promises_array = await runSetupFn.$apply(bundlerPlugin, [
        pluginModule.setup,
        config,
        onstart_promises_array,
        i === plugins.length - 1,
        false,
      ]);
    }
    if (onstart_promises_array !== undefined) {
      await Promise.all(onstart_promises_array);
    }
  })(plugins, bunfig_folder, runSetupFn, bundlerPlugin);

  return promiseResult;
}

export function runOnEndCallbacks(
  this: BundlerPlugin,
  promise: Promise<Bun.BuildOutput>,
  buildResult: Bun.BuildOutput,
  buildRejection: AggregateError | undefined,
): Promise<void> | void {
  const callbacks = this.onEndCallbacks;
  if (!callbacks) return;
  const promises: PromiseLike<unknown>[] = [];

  for (const callback of callbacks) {
    try {
      const result = callback(buildResult);

      if (result && $isPromise(result)) {
        $arrayPush(promises, result);
      }
    } catch (e) {
      $arrayPush(promises, Promise.$reject(e));
    }
  }

  if (promises.length > 0) {
    // we return the promise here because detecting if the promise was handled or not
    // in bundle_v2.zig is done by checking if this function did not return undefined
    return Promise.all(promises).then(
      () => {
        if (buildRejection !== undefined) {
          $rejectPromise(promise, buildRejection);
        } else {
          $resolvePromise(promise, buildResult);
        }
      },
      e => {
        $rejectPromise(promise, e);
      },
    );
  }
}

/**
 * This function runs the given `setup` function.
 * The `setup` function may define `onLoad`, `onResolve`, `onBeforeParse`, `onStart` callbacks.
 * Those callbacks will be added to the `BundlerPlugin` via cpp functions like `.addFilter()` (see JSBundlerPlugin.cpp)
 *
 * Any `onStart()` callbacks are invoked here and their promises appended to the `promises` array parameter.
 * The `promises` parameter remains undefined if no `onStart()` callbacks are defined.
 */
export function runSetupFunction(
  this: BundlerPlugin,
  setup: Setup,
  config: BuildConfigExt,
  promises: Array<Promise<any>> | undefined,
  is_last: boolean,
  isBake: boolean,
): Promise<Promise<any>[]> | Promise<any>[] | undefined {
  this.promises = promises;
  var onLoadPlugins = new Map<string, [filter: RegExp, callback: OnLoadCallback][]>();
  var onResolvePlugins = new Map<string, [filter: RegExp, OnResolveCallback][]>();
  var onBeforeParsePlugins = new Map<
    string,
    [RegExp, napiModule: unknown, symbol: string, external?: undefined | unknown][]
  >();

  function validate(filterObject: PluginConstraints, callback, map, symbol, external) {
    if (!filterObject || !$isObject(filterObject)) {
      throw new TypeError('Expected an object with "filter" RegExp');
    }

    let isOnBeforeParse = false;
    if (map === onBeforeParsePlugins) {
      isOnBeforeParse = true;
      // TODO: how to check if it a napi module here?
      if (!callback || !$isObject(callback) || !callback.$napiDlopenHandle) {
        throw new TypeError(
          "onBeforeParse `napiModule` must be a Napi module which exports the `BUN_PLUGIN_NAME` symbol.",
        );
      }

      if (typeof symbol !== "string") {
        throw new TypeError("onBeforeParse `symbol` must be a string");
      }
    } else {
      if (!callback || !$isCallable(callback)) {
        throw new TypeError("lmao callback must be a function");
      }
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
      map.$set(namespace, [isOnBeforeParse ? [filter, callback, symbol, external] : [filter, callback]]);
    } else {
      $arrayPush(callbacks, isOnBeforeParse ? [filter, callback, symbol, external] : [filter, callback]);
    }
  }

  function onLoad(this: PluginBuilder, filterObject: PluginConstraints, callback: OnLoadCallback): PluginBuilder {
    validate(filterObject, callback, onLoadPlugins, undefined, undefined);
    return this;
  }

  function onResolve(this: PluginBuilder, filterObject: PluginConstraints, callback): PluginBuilder {
    validate(filterObject, callback, onResolvePlugins, undefined, undefined);
    return this;
  }

  function onBeforeParse(
    this: PluginBuilder,
    filterObject: PluginConstraints,
    { napiModule, external, symbol }: { napiModule: unknown; symbol: string; external?: undefined | unknown },
  ): PluginBuilder {
    validate(filterObject, napiModule, onBeforeParsePlugins, symbol, external);
    return this;
  }

  const self = this;
  function onStart(this: PluginBuilder, callback): PluginBuilder {
    if (isBake) {
      throw new TypeError("onStart() is not supported in Bake yet");
    }
    if (!$isCallable(callback)) {
      throw new TypeError("callback must be a function");
    }

    const ret = callback();
    if ($isPromise(ret)) {
      if (($getPromiseInternalField(ret, $promiseFieldFlags) & $promiseStateMask) != $promiseStateFulfilled) {
        self.promises ??= [];
        self.promises.push(ret);
      }
    }
    return this;
  }

  function onEnd(this: PluginBuilder, callback: Function): PluginBuilder {
    if (!$isCallable(callback)) throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);

    if (!self.onEndCallbacks) self.onEndCallbacks = [];

    $arrayPush(self.onEndCallbacks, callback);

    return this;
  }

  const processSetupResult = () => {
    var anyOnLoad = false,
      anyOnResolve = false;

    for (let [namespace, callbacks] of onLoadPlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 1);
        anyOnLoad = true;
      }
    }

    for (let [namespace, callbacks] of onResolvePlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 0);
        anyOnResolve = true;
      }
    }

    for (let [namespace, callbacks] of onBeforeParsePlugins.entries()) {
      for (let [filter, addon, symbol, external] of callbacks) {
        this.onBeforeParse(filter, namespace, addon, symbol, external);
      }
    }

    if (anyOnResolve) {
      var onResolveObject = this.onResolve;
      if (!onResolveObject) {
        this.onResolve = onResolvePlugins;
      } else {
        for (let [namespace, callbacks] of onResolvePlugins.entries()) {
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
        for (let [namespace, callbacks] of onLoadPlugins.entries()) {
          var existing = onLoadObject.$get(namespace) as [RegExp, AnyFunction][];

          if (!existing) {
            onLoadObject.$set(namespace, callbacks);
          } else {
            onLoadObject.$set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    if (is_last) {
      this.promises = undefined;
    }

    return this.promises;
  };

  var setupResult = setup({
    config: config,
    onDispose: notImplementedIssueFn(2771, "On-dispose callbacks"),
    onEnd,
    onLoad,
    onResolve,
    onBeforeParse,
    onStart,
    resolve: notImplementedIssueFn(2771, "build.resolve()"),
    module: () => {
      throw new TypeError("module() is not supported in Bun.build() yet. Only via Bun.plugin() at runtime");
    },
    addPreload: () => {
      throw new TypeError("addPreload() is not supported in Bun.build() yet.");
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
  } as PluginBuilderExt);

  if (setupResult && $isPromise(setupResult)) {
    if ($getPromiseInternalField(setupResult, $promiseFieldFlags) & $promiseStateFulfilled) {
      setupResult = $getPromiseInternalField(setupResult, $promiseFieldReactionsOrResult);
    } else {
      return setupResult.$then(() => {
        if (is_last && self.promises !== undefined && self.promises.length > 0) {
          const awaitAll = Promise.all(self.promises);
          return awaitAll.$then(processSetupResult);
        }
        return processSetupResult();
      });
    }
  }

  if (is_last && this.promises !== undefined && this.promises.length > 0) {
    const awaitAll = Promise.all(this.promises);
    return awaitAll.$then(processSetupResult);
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
          resolveDir: inputNamespace === "file" ? require("node:path").dirname(importer) : undefined,
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
        if (path !== undefined && typeof path !== "string") {
          throw new TypeError("onResolve plugins 'path' field must be a string if provided");
        }

        if (result.namespace !== undefined && typeof result.namespace !== "string") {
          throw new TypeError("onResolve plugins 'namespace' field must be a string if provided");
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
              if (require("node:path").isAbsolute(path) === false || path.includes("..")) {
                throw new TypeError('onResolve plugin "path" must be absolute when the namespace is "file"');
              }
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

export function runOnLoadPlugins(
  this: BundlerPlugin,
  internalID,
  path,
  namespace,
  defaultLoaderId,
  isServerSide: boolean,
) {
  const LOADERS_MAP = $LoaderLabelToId;
  const loaderName = $LoaderIdToLabel[defaultLoaderId];

  const generateDefer = () => this.generateDeferPromise(internalID);
  var promiseResult = (async (internalID, path, namespace, isServerSide, defaultLoader, generateDefer) => {
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
          defer: generateDefer,
          side: isServerSide ? "server" : "client",
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

        var { contents, loader = defaultLoader } = result as any;
        if ((loader as any) === "object") {
          if (!("exports" in result)) {
            throw new TypeError('onLoad plugin returning loader: "object" must have "exports" property');
          }
          try {
            contents = JSON.stringify(result.exports);
            loader = "json";
          } catch (e) {
            throw new TypeError("When using Bun.build, onLoad plugin must return a JSON-serializable object: " + e);
          }
        }

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

        this.onLoadAsync(internalID, contents as any, chosenLoader);
        return null;
      }
    }

    this.onLoadAsync(internalID, null, null);
    return null;
  })(internalID, path, namespace, isServerSide, loaderName, generateDefer);

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
