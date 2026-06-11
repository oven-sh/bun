const registryKey = Symbol.for("bun:module-federation-runtime");

type ShareScope = Record<string | symbol, unknown>;
type SharedFactory = () => unknown;
type SharedRecord = {
  name: string;
  shareKey: string;
  version: string | undefined;
  requiredVersion?: string;
  singleton: boolean;
  strictVersion: boolean;
  eager: boolean;
  from?: string;
  get: SharedFactory;
  loaded?: boolean;
  module?: unknown;
  promise?: Promise<unknown>;
};
type RemoteType = "module" | "script";
type RemoteRecord = {
  alias: string;
  entry?: string;
  manifest?: string | ModuleFederationRemoteManifest;
  type: RemoteType;
  shareScope: string;
  container?: ModuleFederationContainer;
  promise?: Promise<ModuleFederationContainer>;
  globalName?: string;
  resolved?: boolean;
};
type RuntimePluginContext = {
  remote: RemoteRecord;
  specifier?: string;
  request?: string;
  options?: unknown;
  error?: unknown;
};
type RuntimePluginHook = (context: RuntimePluginContext) => unknown;
type RuntimePlugin = {
  beforeLoadRemote?: RuntimePluginHook;
  afterLoadRemote?: RuntimePluginHook;
  errorLoadRemote?: RuntimePluginHook;
};
type RuntimePluginRecord = {
  plugin: RuntimePlugin;
  options: unknown;
};

type ModuleFederationContainer = {
  get: (request: string) => unknown;
  init: (shareScope?: ShareScope) => unknown;
};

type ModuleFederationRemoteManifest = {
  name?: string;
  remoteEntry?:
    | string
    | {
        name?: string;
        path?: string;
        entry?: string;
        type?: RemoteType;
      };
  entry?: string;
  type?: RemoteType;
  globalName?: string;
  global?: string;
  module?: string;
  moduleEntry?: string;
};

type Registry = {
  shareScopes: Map<string, ShareScope>;
  remotes: Map<string, RemoteRecord>;
  remoteEntryPromises: Map<string, Promise<unknown>>;
  runtimePlugins: RuntimePluginRecord[];
  runtimePluginKeys: Set<string>;
};

const sharedVersionsKey = Symbol.for(
  "bun:module-federation-runtime:shared-versions",
);
const registry: Registry & Record<string, unknown> = (globalThis[
  registryKey
] ??= {
  shareScopes: new Map(),
  remotes: new Map(),
  remoteEntryPromises: new Map(),
  runtimePlugins: [],
  runtimePluginKeys: new Set(),
});
registry.shareScopes ??= new Map();
registry.remotes ??= new Map();
registry.remoteEntryPromises ??= new Map();
registry.runtimePlugins ??= [];
registry.runtimePluginKeys ??= new Set();

function assertObject(value, message: string) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new TypeError(message);
  }
}

function assertNonEmptyString(value, message: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(message);
  }
}

function getShareScope(name: string): ShareScope {
  let scope = registry.shareScopes.get(name);
  if (!scope) {
    scope = {};
    registry.shareScopes.set(name, scope);
  }
  return scope;
}

function getSharedVersions(
  scope: ShareScope,
): Map<string, Map<string, SharedRecord>> {
  let versions = scope[sharedVersionsKey] as
    | Map<string, Map<string, SharedRecord>>
    | undefined;
  if (!versions) {
    versions = new Map();
    Object.defineProperty(scope, sharedVersionsKey, {
      configurable: true,
      enumerable: false,
      value: versions,
      writable: true,
    });
  }
  return versions;
}

function normalizeShareKey(name: string, shareKey?: string) {
  return shareKey || name;
}

function satisfiesVersion(
  version: string | undefined,
  range: string | undefined,
) {
  if (!range || range === "*" || range === "latest") {
    return true;
  }
  if (!version) {
    return false;
  }
  try {
    return Bun.semver.satisfies(version, range);
  } catch {
    return false;
  }
}

function compareVersions(left: string | undefined, right: string | undefined) {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  try {
    return Bun.semver.order(left, right);
  } catch {
    return left > right ? 1 : -1;
  }
}

function selectShared(
  scope: ShareScope,
  shareKey: string,
  requiredVersion: string | undefined,
) {
  const versions = getSharedVersions(scope).get(shareKey);
  if (!versions) {
    return undefined;
  }

  let selected: SharedRecord | undefined;
  for (const record of versions.values()) {
    if (!satisfiesVersion(record.version, requiredVersion)) {
      continue;
    }
    if (!selected || compareVersions(record.version, selected.version) > 0) {
      selected = record;
    }
  }
  return selected;
}

function publishSelectedShared(scope: ShareScope, shareKey: string) {
  const selected = selectShared(scope, shareKey, undefined);
  if (selected) {
    scope[shareKey] = selected;
  }
}

function loadShared(record: SharedRecord) {
  if (record.loaded) {
    return record.module;
  }
  if (record.promise) {
    return record.promise;
  }

  const value = record.get();
  if (value && typeof (value as Promise<unknown>).then === "function") {
    record.promise = Promise.resolve(value).then((module) => {
      record.module = module;
      record.loaded = true;
      return module;
    });
    return record.promise;
  }

  record.module = value;
  record.loaded = true;
  return value;
}

function normalizeExposeRequest(request: string) {
  return request.startsWith("./") ? request : `./${request}`;
}

function parseRemoteSpecifier(specifier: string) {
  assertNonEmptyString(
    specifier,
    "Module Federation remote specifier must be a non-empty string",
  );

  const slash = specifier.indexOf("/");
  if (slash <= 0 || slash === specifier.length - 1) {
    throw new TypeError(
      `Invalid Module Federation remote specifier "${specifier}". Expected "remote/exposed".`,
    );
  }

  return {
    alias: specifier.slice(0, slash),
    request: normalizeExposeRequest(specifier.slice(slash + 1)),
  };
}

function validateContainer(
  container,
  alias: string,
): ModuleFederationContainer {
  const target = container?.default ?? container;
  if (
    target === null ||
    (typeof target !== "object" && typeof target !== "function")
  ) {
    throw new TypeError(
      `Module Federation remote "${alias}" did not export a container object.`,
    );
  }

  if (typeof target.get !== "function") {
    throw new TypeError(
      `Module Federation remote "${alias}" container is missing get().`,
    );
  }

  if (typeof target.init !== "function") {
    throw new TypeError(
      `Module Federation remote "${alias}" container is missing init().`,
    );
  }

  return target;
}

function hasRuntimePluginHook(plugin): boolean {
  return (
    plugin !== undefined &&
    plugin !== null &&
    (typeof plugin.beforeLoadRemote === "function" ||
      typeof plugin.afterLoadRemote === "function" ||
      typeof plugin.errorLoadRemote === "function")
  );
}

function instantiateRuntimePlugin(
  target,
  options: unknown,
): RuntimePlugin | undefined {
  if (target === undefined || target === null) {
    return undefined;
  }

  if (typeof target === "function") {
    const result = target(options);
    assertObject(
      result,
      "Module Federation runtime plugin function must return an object",
    );
    return result as RuntimePlugin;
  }

  if (hasRuntimePluginHook(target)) {
    return target as RuntimePlugin;
  }
}

function normalizeRuntimePlugin(plugin, options: unknown): RuntimePlugin {
  if (
    plugin === null ||
    (typeof plugin !== "object" && typeof plugin !== "function")
  ) {
    throw new TypeError("Module Federation runtime plugin must be an object");
  }

  for (const target of [
    plugin.default,
    plugin.runtimePlugin,
    plugin.plugin,
    plugin,
  ]) {
    const normalized = instantiateRuntimePlugin(target, options);
    if (normalized) {
      return normalized;
    }
  }

  if (typeof plugin === "object") {
    for (const target of Object.values(plugin)) {
      const normalized = instantiateRuntimePlugin(target, options);
      if (normalized) {
        return normalized;
      }
    }
  }

  return plugin as RuntimePlugin;
}

export function registerRuntimePlugin(
  plugin,
  options: unknown = undefined,
  key?: string,
) {
  if (key !== undefined) {
    assertNonEmptyString(
      key,
      "Module Federation runtime plugin key must be a non-empty string",
    );
    if (registry.runtimePluginKeys.has(key)) {
      return undefined;
    }
  }

  const normalized = normalizeRuntimePlugin(plugin, options);
  if (!hasRuntimePluginHook(normalized)) {
    throw new TypeError(
      "Module Federation runtime plugin must define beforeLoadRemote, afterLoadRemote, or errorLoadRemote.",
    );
  }

  if (key !== undefined) {
    registry.runtimePluginKeys.add(key);
  }
  registry.runtimePlugins.push({ plugin: normalized, options });
  return normalized;
}

async function callRuntimePluginHook(
  hookName: keyof RuntimePlugin,
  context: RuntimePluginContext,
) {
  const plugins = registry.runtimePlugins;
  for (const record of plugins) {
    const hook = record.plugin[hookName];
    if (typeof hook !== "function") {
      continue;
    }

    try {
      const result = await hook({ ...context, options: record.options });
      if (result instanceof Error) {
        throw result;
      }
    } catch (error) {
      if (hookName === "errorLoadRemote") {
        throw new Error(
          `Module Federation runtime plugin ${hookName} failed while handling remote "${context.remote.alias}": ${error?.message ?? error}`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

function getGlobalContainer(remote: RemoteRecord) {
  const globalName = remote.globalName || remote.alias;
  return globalThis[globalName];
}

function resolveManifestUrl(path: string, manifestUrl?: string) {
  if (!manifestUrl) {
    return path;
  }

  try {
    return new URL(path, manifestUrl).href;
  } catch {
    return path;
  }
}

async function loadRemoteManifest(remote: RemoteRecord) {
  const manifest = remote.manifest;
  if (!manifest) {
    return undefined;
  }

  if (typeof manifest === "string") {
    const response = await fetch(manifest);
    if (!response.ok) {
      throw new Error(
        `Module Federation remote "${remote.alias}" failed to fetch manifest "${manifest}": ${response.status} ${response.statusText}`,
      );
    }
    return {
      manifest: await response.json(),
      manifestUrl: manifest,
    };
  }

  return { manifest, manifestUrl: undefined };
}

async function resolveRemoteFromManifest(remote: RemoteRecord) {
  if (remote.resolved) {
    return remote;
  }
  remote.resolved = true;

  const loaded = await loadRemoteManifest(remote);
  if (!loaded) {
    if (!remote.entry) {
      throw new TypeError(
        `Module Federation remote "${remote.alias}" entry must be a non-empty string`,
      );
    }
    return remote;
  }

  const manifest = loaded.manifest;
  assertObject(
    manifest,
    `Module Federation remote "${remote.alias}" manifest must be an object`,
  );

  const remoteEntry = manifest.remoteEntry;
  let entry =
    typeof remoteEntry === "string"
      ? remoteEntry
      : remoteEntry?.path || remoteEntry?.entry;
  let type = remoteEntry && typeof remoteEntry === "object"
    ? remoteEntry.type
    : undefined;
  const moduleEntry = manifest.moduleEntry || manifest.module;
  if (!entry && typeof moduleEntry === "string") {
    entry = moduleEntry;
    type ??= "module";
  }
  entry ||= manifest.entry;
  type ||= manifest.type;

  if (typeof entry !== "string" || entry.length === 0) {
    throw new TypeError(
      `Module Federation remote "${remote.alias}" manifest is missing remoteEntry.path or entry.`,
    );
  }
  if (type !== undefined && type !== "module" && type !== "script") {
    throw new TypeError(
      `Module Federation remote "${remote.alias}" manifest has unsupported type "${type}". Supported types are "module" and "script".`,
    );
  }

  remote.entry = resolveManifestUrl(entry, loaded.manifestUrl);
  remote.type = type || remote.type;
  remote.globalName ||=
    (remoteEntry && typeof remoteEntry === "object" && remoteEntry.name) ||
    manifest.globalName ||
    manifest.global ||
    manifest.name;
  return remote;
}

function loadScriptRemote(remote: RemoteRecord) {
  const entry = remote.entry!;
  const existing = registry.remoteEntryPromises.get(entry);
  if (existing) {
    return existing;
  }

  let promise: Promise<unknown>;
  if (typeof document !== "undefined" && document?.createElement) {
    promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = entry;
      script.async = true;
      script.dataset.bunModuleFederationRemote = remote.alias;
      script.onload = () => resolve(getGlobalContainer(remote));
      script.onerror = () => {
        reject(
          new Error(
            `Module Federation remote "${remote.alias}" failed to load script "${entry}".`,
          ),
        );
      };
      (document.head || document.documentElement).appendChild(script);
    });
  } else if (typeof fetch === "function") {
    promise = (async () => {
      const response = await fetch(entry);
      if (!response.ok) {
        throw new Error(
          `Module Federation remote "${remote.alias}" failed to fetch script "${entry}": ${response.status} ${response.statusText}`,
        );
      }
      const source = await response.text();
      const currentScriptUrlKey =
        "__bunModuleFederationCurrentScriptUrl";
      const previousScriptUrl = globalThis[currentScriptUrlKey];
      globalThis[currentScriptUrlKey] = entry;
      try {
        (0, eval)(`${source}\n//# sourceURL=${entry}`);
        return getGlobalContainer(remote);
      } finally {
        if (previousScriptUrl === undefined) {
          delete globalThis[currentScriptUrlKey];
        } else {
          globalThis[currentScriptUrlKey] = previousScriptUrl;
        }
      }
    })();
  } else {
    promise = Promise.reject(
      new Error(
        `Module Federation remote "${remote.alias}" cannot load script "${entry}" without document or fetch.`,
      ),
    );
  }

  registry.remoteEntryPromises.set(entry, promise);
  return promise;
}

async function loadRemoteContainer(remote: RemoteRecord) {
  if (remote.container) {
    return remote.container;
  }

  if (!remote.promise) {
    remote.promise = resolveRemoteFromManifest(remote)
      .then((remote) =>
        remote.type === "script"
          ? loadScriptRemote(remote).then(() => getGlobalContainer(remote))
          : import(remote.entry!),
      )
      .then((module) => {
        const container = validateContainer(module, remote.alias);
        const shareScope = getShareScope(remote.shareScope);
        container.init(shareScope);
        remote.container = container;
        return container;
      });
  }

  return remote.promise;
}

export function initShareScope(scope = "default", shared = {}) {
  assertNonEmptyString(
    scope,
    "Module Federation share scope name must be a non-empty string",
  );
  assertObject(
    shared,
    `Module Federation share scope "${scope}" must be an object`,
  );

  const current = getShareScope(scope);
  Object.assign(current, shared);
  return current;
}

export function registerShared(name, options = {}) {
  assertNonEmptyString(
    name,
    "Module Federation shared name must be a non-empty string",
  );
  assertObject(
    options,
    `Module Federation shared "${name}" options must be an object`,
  );

  const shareScope = options.shareScope || "default";
  assertNonEmptyString(
    shareScope,
    `Module Federation shared "${name}" share scope must be a non-empty string`,
  );
  const shareKey = normalizeShareKey(name, options.shareKey);
  assertNonEmptyString(
    shareKey,
    `Module Federation shared "${name}" share key must be a non-empty string`,
  );

  const get = options.get ?? options.factory;
  if (typeof get !== "function") {
    throw new TypeError(
      `Module Federation shared "${name}" factory must be a function.`,
    );
  }

  const scope = options.scope;
  if (scope !== undefined) {
    assertObject(
      scope,
      `Module Federation shared "${name}" scope must be an object`,
    );
  }
  const currentScope =
    (scope as ShareScope | undefined) ?? getShareScope(shareScope);
  const versions = getSharedVersions(currentScope);
  let packageVersions = versions.get(shareKey);
  if (!packageVersions) {
    packageVersions = new Map();
    versions.set(shareKey, packageVersions);
  }

  const version = options.version || "0.0.0";
  const existing = packageVersions.get(version);
  if (existing) {
    publishSelectedShared(currentScope, shareKey);
    return existing;
  }

  const record: SharedRecord = {
    name,
    shareKey,
    version,
    requiredVersion: options.requiredVersion,
    singleton: !!options.singleton,
    strictVersion: !!options.strictVersion,
    eager: !!options.eager,
    from: options.from,
    get,
  };
  packageVersions.set(version, record);
  publishSelectedShared(currentScope, shareKey);
  if (record.eager) {
    loadShared(record);
  }
  return record;
}

export function consumeShared(name, options = {}) {
  assertNonEmptyString(
    name,
    "Module Federation shared name must be a non-empty string",
  );
  assertObject(
    options,
    `Module Federation shared "${name}" options must be an object`,
  );

  const shareScope = options.shareScope || "default";
  assertNonEmptyString(
    shareScope,
    `Module Federation shared "${name}" share scope must be a non-empty string`,
  );
  const shareKey = normalizeShareKey(name, options.shareKey);
  assertNonEmptyString(
    shareKey,
    `Module Federation shared "${name}" share key must be a non-empty string`,
  );

  const scope = getShareScope(shareScope);
  const record = selectShared(scope, shareKey, options.requiredVersion);
  if (record) {
    return loadShared(record);
  }

  const fallback = options.fallback ?? options.get ?? options.factory;
  if (
    !options.strictVersion &&
    typeof fallback === "function" &&
    options.import !== false
  ) {
    return fallback();
  }

  const versions = getSharedVersions(scope).get(shareKey);
  const available = versions ? Array.from(versions.keys()).join(", ") : "none";
  throw new Error(
    `Module Federation shared "${shareKey}" does not satisfy required version "${options.requiredVersion || "*"}" in share scope "${shareScope}". Available versions: ${available}.`,
  );
}

export function registerRemote(
  alias,
  entry,
  type: RemoteType = "module",
  shareScope = "default",
  globalName,
) {
  assertNonEmptyString(
    alias,
    "Module Federation remote alias must be a non-empty string",
  );

  let manifest;
  if (entry !== null && typeof entry === "object") {
    assertObject(
      entry,
      `Module Federation remote "${alias}" options must be an object`,
    );
    manifest = entry.manifest;
    globalName ??= entry.name ?? entry.globalName;
    shareScope = entry.shareScope ?? shareScope;
    type = entry.type ?? type;
    entry = entry.entry ?? undefined;
  }

  if (manifest !== undefined) {
    if (typeof manifest !== "string") {
      assertObject(
        manifest,
        `Module Federation remote "${alias}" manifest must be a string or an object`,
      );
    }
  } else {
    assertNonEmptyString(
      entry,
      `Module Federation remote "${alias}" entry must be a non-empty string`,
    );
  }

  if (typeof entry === "string") {
    const at = entry.indexOf("@");
    if (at > 0 && at + 1 < entry.length) {
      globalName ??= entry.slice(0, at);
      entry = entry.slice(at + 1);
      if (arguments.length < 3) {
        type = "script";
      }
    }
  } else if (entry !== undefined && entry !== null) {
    throw new TypeError(
      `Module Federation remote "${alias}" entry must be a non-empty string`,
    );
  }
  assertNonEmptyString(
    shareScope,
    `Module Federation remote "${alias}" share scope must be a non-empty string`,
  );

  if (type !== "module" && type !== "script") {
    throw new TypeError(
      `Module Federation remote "${alias}" has unsupported type "${type}". Supported types are "module" and "script".`,
    );
  }
  if (globalName !== undefined && globalName !== null) {
    assertNonEmptyString(
      globalName,
      `Module Federation remote "${alias}" global name must be a non-empty string`,
    );
  } else {
    globalName = undefined;
  }

  const existing = registry.remotes.get(alias);
  if (
    existing &&
    existing.entry === entry &&
    existing.manifest === manifest &&
    existing.type === type &&
    existing.shareScope === shareScope &&
    existing.globalName === globalName
  ) {
    return existing;
  }

  const remote = { alias, entry, manifest, type, shareScope, globalName };
  registry.remotes.set(alias, remote);
  return remote;
}

export async function loadRemote(specifier: string) {
  const { alias, request } = parseRemoteSpecifier(specifier);
  const remote = registry.remotes.get(alias);
  if (!remote) {
    throw new Error(`Module Federation remote "${alias}" is not registered.`);
  }

  const context = { remote, specifier, request };
  try {
    await callRuntimePluginHook("beforeLoadRemote", context);
    const container = await loadRemoteContainer(remote);
    const factory = await container.get(request);
    if (typeof factory !== "function") {
      throw new TypeError(
        `Module Federation remote "${alias}" get("${request}") did not return a factory function.`,
      );
    }

    const module = await factory();
    await callRuntimePluginHook("afterLoadRemote", context);
    return module;
  } catch (error) {
    await callRuntimePluginHook("errorLoadRemote", { ...context, error });
    throw error;
  }
}

export function createContainer(options) {
  assertObject(
    options,
    "Module Federation container options must be an object",
  );
  if (typeof options.get !== "function") {
    throw new TypeError(
      "Module Federation container options.get must be a function.",
    );
  }

  if (
    typeof options.init !== "undefined" &&
    typeof options.init !== "function"
  ) {
    throw new TypeError(
      "Module Federation container options.init must be a function.",
    );
  }

  let initialized = false;
  let initResult;

  return {
    get(request: string) {
      assertNonEmptyString(
        request,
        "Module Federation exposed request must be a non-empty string",
      );
      return options.get(normalizeExposeRequest(request));
    },
    init(shareScope = getShareScope("default")) {
      if (initialized) {
        return initResult;
      }

      initialized = true;
      initResult = options.init?.(shareScope);
      return initResult;
    },
  };
}

registry.initShareScope = initShareScope;
registry.registerShared = registerShared;
registry.consumeShared = consumeShared;
registry.registerRemote = registerRemote;
registry.loadRemote = loadRemote;
registry.createContainer = createContainer;
registry.registerRuntimePlugin = registerRuntimePlugin;

export const __registry = registry;
