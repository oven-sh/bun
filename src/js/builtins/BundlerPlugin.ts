// `this` is the native `$Node.BundlerPlugin` (JSBundlerPlugin.h).
type AnyFunction = (...args: any[]) => any;

interface PluginConstraints {
  filter: RegExp;
  namespace?: string;
}
interface MinifyObj {
  identifiers?: boolean;
  whitespace?: boolean;
  syntax?: boolean;
}
interface NapiModule {
  $napiDlopenHandle?: number;
}
interface OnBeforeParseOptions {
  napiModule: NapiModule;
  symbol: string;
  external?: unknown;
}
interface PluginBuilderExt {
  config: $Node.BundlerPlugin.Config;
  onStart(callback: () => void | Promise<void>): PluginBuilderExt;
  onEnd(callback: $Node.BundlerPlugin.OnEndCallback): PluginBuilderExt;
  onLoad(constraints: PluginConstraints, callback: $Node.BundlerPlugin.OnLoadCallback): PluginBuilderExt;
  onResolve(constraints: PluginConstraints, callback: $Node.BundlerPlugin.OnResolveCallback): PluginBuilderExt;
  onBeforeParse(constraints: PluginConstraints, options: OnBeforeParseOptions): PluginBuilderExt;
  module: AnyFunction;
  addPreload: AnyFunction;
  resolve: AnyFunction;
  onDispose: AnyFunction;
  // we partially support initialOptions. it's read-only and a subset of
  // all options mapped to their esbuild names
  initialOptions: object;
  // we set this to an empty object
  esbuild: object;
}

/**
 * Used by Bun.serve() to resolve and load plugins: a module name from bunfig.toml, or a plugin object
 * from the `bake.config.ts` of `bun bake`.
 */
export function loadAndResolvePluginsForServe(
  this: $Node.BundlerPlugin,
  plugins: Array<string | $Node.BundlerPlugin.Plugin>,
  bunfig_folder: string,
  runSetupFn: typeof runSetupFunction,
) {
  // Same config as created in HTMLBundle.init
  let config: $Node.BundlerPlugin.Config = {
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
    plugins: Array<string | $Node.BundlerPlugin.Plugin>,
    bunfig_folder: string,
    runSetupFn: typeof runSetupFunction,
    bundlerPlugin: $Node.BundlerPlugin,
  ) => {
    let onstart_promises_array: Promise<unknown>[] | undefined = undefined;
    for (let i = 0; i < plugins.length; i++) {
      const entry = plugins[i];
      let pluginModule: $Node.BundlerPlugin.Plugin;
      if (typeof entry === "string") {
        let pluginModuleResolved = await Bun.resolve(entry, bunfig_folder);

        let pluginModuleRaw = CAN_LOAD_CODE_AT_RUN_TIME ? await import(pluginModuleResolved) : undefined;
        if (!pluginModuleRaw || !pluginModuleRaw.default) {
          throw new TypeError(`Expected "${entry}" to be a module which default exports a bundler plugin.`);
        }
        pluginModule = pluginModuleRaw.default;
        if (!pluginModule) throw new InvalidBundlerPluginError(entry, "default export is missing");
        if (pluginModule.name === undefined) throw new InvalidBundlerPluginError(entry, "name is missing");
        if (pluginModule.setup === undefined) throw new InvalidBundlerPluginError(entry, "setup() is missing");
      } else {
        // `bun bake` checked the name and setup() of each plugin in `bake.config.ts`.
        pluginModule = entry;
      }
      onstart_promises_array = await runSetupFn.$apply(bundlerPlugin, [
        pluginModule.setup,
        config,
        onstart_promises_array,
        i === plugins.length - 1,
        false,
      ] satisfies Parameters<typeof runSetupFunction>);
    }
    if (onstart_promises_array !== undefined) {
      await Promise.all(onstart_promises_array);
    }
  })(plugins, bunfig_folder, runSetupFn, bundlerPlugin);

  return promiseResult;
}

export function runOnEndCallbacks(
  this: $Node.BundlerPlugin,
  promise: Promise<object>,
  buildResult: object,
  buildRejection: unknown,
): Promise<void> | void {
  const callbacks = this.$onEndCallbacks;
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
    // we return the promise here because the native bundler detects whether the
    // promise was handled by checking if this function did not return undefined
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
  this: $Node.BundlerPlugin,
  setup: $Node.BundlerPlugin.Setup,
  config: $Node.BundlerPlugin.Config,
  promises: Promise<unknown>[] | undefined,
  is_last: boolean,
  isBake: boolean,
): Promise<Promise<unknown>[] | undefined> | Promise<unknown>[] | undefined {
  type OnLoadCallback = $Node.BundlerPlugin.OnLoadCallback;
  type OnResolveCallback = $Node.BundlerPlugin.OnResolveCallback;
  this.promises = promises;
  var onLoadPlugins = new Map<string, [filter: RegExp, callback: OnLoadCallback][]>();
  var onResolvePlugins = new Map<string, [filter: RegExp, OnResolveCallback][]>();
  var onBeforeParsePlugins = new Map<
    string,
    [RegExp, napiModule: unknown, symbol: string, external?: undefined | unknown][]
  >();

  function validate(
    filterObject: PluginConstraints,
    callback: (AnyFunction | object) & NapiModule,
    map: Map<string, unknown[][]>,
    symbol: string | undefined,
    external: unknown,
  ) {
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

  function onLoad(this: PluginBuilderExt, filterObject: PluginConstraints, callback: OnLoadCallback): PluginBuilderExt {
    validate(filterObject, callback, onLoadPlugins, undefined, undefined);
    return this;
  }

  function onResolve(
    this: PluginBuilderExt,
    filterObject: PluginConstraints,
    callback: OnResolveCallback,
  ): PluginBuilderExt {
    validate(filterObject, callback, onResolvePlugins, undefined, undefined);
    return this;
  }

  function onBeforeParse(
    this: PluginBuilderExt,
    filterObject: PluginConstraints,
    { napiModule, external, symbol }: OnBeforeParseOptions,
  ): PluginBuilderExt {
    validate(filterObject, napiModule, onBeforeParsePlugins, symbol, external);
    return this;
  }

  const self = this;
  function onStart(this: PluginBuilderExt, callback: () => void | Promise<void>): PluginBuilderExt {
    if (isBake) {
      throw new TypeError("onStart() is not supported in Bake yet");
    }
    if (!$isCallable(callback)) {
      throw new TypeError("callback must be a function");
    }

    const ret = callback();
    if ($isPromise(ret)) {
      if ($peekPromiseStatus(ret) != 1) {
        // Stash the deferred promise; the aggregate handler is attached later
        // (in loadAndResolvePluginsForServe via Promise.all). Mark it as
        // handled now so a rejection that lands while it's only sitting in
        // the array doesn't fire the unhandled-rejection tracker.
        $pokePromiseAsHandled(ret);
        self.promises ??= [];
        self.promises.push(ret);
      }
    }
    return this;
  }

  function onEnd(this: PluginBuilderExt, callback: $Node.BundlerPlugin.OnEndCallback): PluginBuilderExt {
    if (!$isCallable(callback)) throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);

    if (!self.$onEndCallbacks) self.$onEndCallbacks = [];

    $arrayPush(self.$onEndCallbacks, callback);

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
    onDispose: () => {
      throw new TypeError(
        "On-dispose callbacks is not implemented yet. See https://github.com/oven-sh/bun/issues/2771",
      );
    },
    onEnd,
    onLoad,
    onResolve,
    onBeforeParse,
    onStart,
    resolve: () => {
      throw new TypeError("build.resolve() is not implemented yet. See https://github.com/oven-sh/bun/issues/2771");
    },
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
    if ($peekPromiseStatus(setupResult) === 1) {
      setupResult = $peekPromiseSettledValue(setupResult);
    } else {
      return setupResult.$then(() => {
        let selfPromises;
        if (is_last && (selfPromises = self.promises) !== undefined && selfPromises.length > 0) {
          const awaitAll = Promise.all(selfPromises);
          return awaitAll.$then(processSetupResult);
        }
        return processSetupResult();
      });
    }
  }

  let pendingPromises;
  if (is_last && (pendingPromises = this.promises) !== undefined && pendingPromises.length > 0) {
    const awaitAll = Promise.all(pendingPromises);
    return awaitAll.$then(processSetupResult);
  }

  return processSetupResult();
}

export function runOnResolvePlugins(
  this: $Node.BundlerPlugin,
  specifier: string,
  inputNamespace: string,
  importer: string,
  internalID: number,
  kindId: number,
) {
  // Must be kept in sync with ImportRecord.label
  const kind = $ImportKindIdToLabel[kindId];

  var promiseResult: Promise<null> | null | undefined = (async (
    inputPath: string,
    inputNamespace: string,
    importer: string,
    kind: string,
  ) => {
    var { onResolve, onLoad } = this;
    var results = onResolve!.$get(inputNamespace);
    if (!results) {
      this.onResolveAsync(internalID, null, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      // test() on a /g or /y filter starts at lastIndex, which the previous path's match may have advanced.
      if (filter.global || filter.sticky) filter.lastIndex = 0;
      if (filter.test(inputPath)) {
        var result: ReturnType<$Node.BundlerPlugin.OnResolveCallback> = callback({
          path: inputPath,
          importer,
          namespace: inputNamespace,
          resolveDir: inputNamespace === "file" ? require("node:path").dirname(importer) : undefined,
          kind,
          // pluginData
        });

        while (result && $isPromise(result) && $peekPromiseStatus(result) === 1) {
          result = $peekPromiseSettledValue(result);
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

  while (promiseResult && $isPromise(promiseResult) && $peekPromiseStatus(promiseResult) === 1) {
    promiseResult = $peekPromiseSettledValue(promiseResult);
  }

  if (promiseResult && $isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e);
      },
    );
  }
}

export function runOnLoadPlugins(
  this: $Node.BundlerPlugin,
  internalID: number,
  path: string,
  namespace: string,
  defaultLoaderId: number,
  isServerSide: boolean,
) {
  const LOADERS_MAP = $LoaderLabelToId;
  const loaderName = $LoaderIdToLabel[defaultLoaderId];

  const generateDefer = () => this.generateDeferPromise(internalID);
  var promiseResult: Promise<null> | null | undefined = (async (
    internalID: number,
    path: string,
    namespace: string,
    isServerSide: boolean,
    defaultLoader: string,
    generateDefer: () => Promise<void>,
  ) => {
    var results = this.onLoad!.$get(namespace);
    if (!results) {
      this.onLoadAsync(internalID, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.global || filter.sticky) filter.lastIndex = 0;
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

        while (result && $isPromise(result) && $peekPromiseStatus(result) === 1) {
          result = $peekPromiseSettledValue(result);
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

  while (promiseResult && $isPromise(promiseResult) && $peekPromiseStatus(promiseResult) === 1) {
    promiseResult = $peekPromiseSettledValue(promiseResult);
  }

  if (promiseResult && $isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e);
      },
    );
  }
}
