// Module scripts and import maps.
const moduleSource = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmModuleSource", 3);
const loadModule = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmLoadModule", 1);
const evaluateModule = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmEvaluateModule", 1);

type Table = [string, string | null][];
type Fetching = {
  nonce?: string;
  credentials?: string;
  referrerPolicy?: string;
  integrity?: string;
  byScript?: boolean;
};

const notFetched = "Failed to fetch dynamically imported module: ";
const isRecord = (value: unknown) => $isObject(value) && !$isArray(value);
const urlLike = (text: string, base: string) => (/^\.{0,2}[/]/.test(text) ? URL.parse(text, base) : URL.parse(text));
const descending = (a: unknown[], b: unknown[]) => (a[0]! < b[0]! ? 1 : -1);
const isPrefix = (key: string, name: string) => key.endsWith("/") && name.startsWith(key);

function tableOf(entries: any, base: string): Table {
  if (!isRecord(entries)) throw new TypeError("A specifier map of an import map has to be an object.");
  const table = new Map<string, string | null>();
  for (const key of Object.keys(entries)) {
    if (key === "") continue;
    const address = typeof entries[key] === "string" ? urlLike(entries[key], base)?.href : undefined;
    const isValid = address !== undefined && (!key.endsWith("/") || address.endsWith("/"));
    table.$set(urlLike(key, base)?.href ?? key, isValid ? address : null);
  }
  return [...table];
}

function lookUp(table: Table, name: string, url: URL | null) {
  for (const [key, target] of table) {
    if (key !== name && !(isPrefix(key, name) && (!url || /^(?:ftp|file|https?|wss?):$/.test(url.protocol)))) continue;
    const found = key === name || target === null ? target : URL.parse(name.slice(key.length), target)?.href;
    if (found == null || !found.startsWith(target!)) {
      throw new TypeError(`Failed to resolve module specifier "${name}": blocked by the import map`);
    }
    return found;
  }
}

function create(env: any, baseUrl: () => string, createSheet?: (text: string, url: string) => object) {
  const inline = new Map<string, { source?: object; base: string }>();
  /** Where a module was redirected to. */
  const finalUrls = new Map<string, string>();
  const fetching = new Map<string, Fetching & { referrer?: string }>();
  /** So that those who ask at the same time get the same. */
  const inFlight = new Map<string, Promise<any>>();
  const preloaded = new Map<string, Promise<unknown>>();
  const wasPreloaded = new Map<string, Promise<unknown>>();
  const blobs = new Map<string, Blob>();
  let imports: Table = [];
  let scopes: [string, Table][] = [];
  const integrity = new Map<string, string>();
  /** The URL of the importer, the specifier, and whether a prefix can match it. */
  const resolved: [string, string, boolean][] = [];
  const urlOf = (key: string) => inline.$get(key)?.base ?? finalUrls.$get(key) ?? key;

  function resolve(specifier: string, referrer: unknown) {
    const base = typeof referrer === "string" && URL.canParse(referrer) ? urlOf(referrer) : baseUrl();
    const url = urlLike(specifier, base);
    const name = url?.href ?? specifier;
    let found: string | undefined;
    for (const [scope, table] of scopes) {
      if (scope === base || isPrefix(scope, base)) found ??= lookUp(table, name, url);
    }
    found ??= lookUp(imports, name, url) ?? url?.href;
    if (found === undefined) {
      throw new TypeError(
        `Failed to resolve module specifier "${specifier}". Relative references must start with either "/", "./", or "../".`,
      );
    }
    if (createSheet) resolved.push([base, name, !url || /^(?:ftp|file|https?|wss?):$/.test(url.protocol)]);
    return found;
  }

  /** What has been resolved, and what has a rule, stays as it is. */
  function merge(old: Table, added: Table, scope?: string): Table {
    const isSettled = (key: string) =>
      old.some(rule => rule[0] === key) ||
      resolved.some(
        ([base, name, mayBePrefixed]) =>
          (scope === undefined || scope === base || isPrefix(scope, base)) &&
          (key === name || (mayBePrefixed && isPrefix(key, name))),
      );
    return [...old, ...added.filter(rule => !isSettled(rule[0]))].sort(descending);
  }

  function addImportMap(json: string, base: string) {
    const map = JSON.parse(json);
    if (!isRecord(map)) throw new TypeError("An import map has to be an object.");
    const { imports: given = {}, scopes: givenScopes = {}, integrity: hashes = {} } = map;
    if (!isRecord(givenScopes) || !isRecord(hashes)) throw new TypeError("scopes and integrity have to be objects.");
    const added = tableOf(given, base);
    const merged = new Map(scopes);
    for (const prefix of Object.keys(givenScopes)) {
      const table = tableOf(givenScopes[prefix], base);
      const scope = URL.parse(prefix, base)?.href;
      if (scope !== undefined) merged.$set(scope, merge(merged.$get(scope) ?? [], table, scope));
    }
    for (const key of Object.keys(hashes)) {
      const url = urlLike(key, base)?.href;
      if (url !== undefined && typeof hashes[key] === "string" && !integrity.$has(url))
        integrity.$set(url, hashes[key]);
    }
    scopes = [...merged].sort(descending);
    imports = merge(imports, added);
  }

  function fetchModule(key: string, type: string) {
    const own = inline.$get(key);
    if (own?.source) {
      const { source } = own;
      own.source = undefined;
      return Promise.$resolve(source);
    }
    if (type !== "" && type !== "json" && type !== "text" && !(type === "css" && createSheet)) {
      return Promise.$reject(new TypeError(`"${type}" is not a valid module type.`));
    }
    const options = fetching.$get(key);
    const id = type + " " + key;
    const early = preloaded.$get(id);
    if (early) return (preloaded.$delete(id), early);
    let loading = inFlight.$get(id);
    if (!loading) {
      const blob = blobs.$get(key);
      blobs.$delete(key);
      loading = env.loadScript(key, type, { ...options, integrity: options?.integrity ?? integrity.$get(key), blob });
      inFlight.$set(id, loading);
    }
    return new Promise((resolve, reject) =>
      loading
        .finally(() => inFlight.$delete(id))
        .then(
          ({ url, source, referrerPolicy }) => {
            if (url !== key) finalUrls.$set(key, url);
            if (referrerPolicy) fetching.$set(key, { ...options, referrerPolicy });
            if (type === "css") resolve(createSheet!(source, url));
            else resolve(type === "text" ? source : moduleSource(source, url, type === "json"));
          },
          () => reject(new TypeError(notFetched + key)),
        ),
    );
  }

  /** The result runs it. It is rejected if something could not be fetched. */
  function prepare(key: string, options: Fetching, mustParse = false): Promise<() => Promise<unknown>> {
    if (!fetching.$has(key) || !wasPreloaded.$has(" " + key)) fetching.$set(key, options);
    return loadModule(key).then(
      () => async () => evaluateModule(key),
      error => {
        if (mustParse || (error instanceof TypeError && error.message.startsWith(notFetched))) throw error;
        return () => Promise.$reject(error);
      },
    );
  }

  return {
    hooks: {
      resolve(specifier: string, referrer: any) {
        if (inline.$has(specifier) || (referrer === undefined && fetching.$has(specifier))) return specifier;
        const url = resolve(specifier, referrer);
        const compiled = env.compiledPath(url);
        if (compiled !== undefined) return compiled;
        if (!fetching.$has(url)) {
          const blob = url.startsWith("blob:") && env.resolveBlob(url);
          if (blob) blobs.$set(url, blob);
          const isInline = inline.$has(referrer);
          const inherited = { ...fetching.$get(referrer), integrity: undefined };
          fetching.$set(url, {
            ...inherited,
            referrer: isInline || !URL.canParse(referrer) ? undefined : urlOf(referrer),
          });
        }
        return url;
      },
      fetch: fetchModule,
      importMeta(key: string) {
        const resolver = { resolve: (specifier: string) => resolve(`${specifier}`, key) };
        return { __proto__: null, url: urlOf(key), ...resolver };
      },
    },
    prepare,
    /** Without what it imports. */
    preload(key: string, type: string, options: Fetching) {
      const id = type + " " + key;
      if (wasPreloaded.$has(id)) return wasPreloaded.$get(id);
      if (!fetching.$has(key)) fetching.$set(key, options);
      const loading = fetchModule(key, type);
      for (const it of [preloaded, wasPreloaded]) it.$set(id, loading);
      loading.then(undefined, () => [preloaded, wasPreloaded].forEach(it => it.$delete(id)));
      return loading;
    },
    prepareInline(text: string, url: string, base: string, options: Fetching, line = 0, column = 0, mustParse = false) {
      const key = `inline-module:${inline.$size}`;
      inline.$set(key, { source: moduleSource(text, url, false, key, line, column), base });
      return prepare(key, options, mustParse);
    },
    /** For what a classic script imports. */
    setFetching: (url: string, options: Fetching) => void fetching.$set(url, options),
    addImportMap,
  };
}

export default { create };
