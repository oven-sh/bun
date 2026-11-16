// The first module of a realm that DesktopRealm.cpp makes. `env` and what comes out of it belong to the main realm.
const seal = $newCppFunction("DesktopRealm.cpp", "jsFunctionSealDesktopRealm", 2);
const disposeRealm = $newCppFunction("DesktopRealm.cpp", "jsFunctionDisposeDesktopRealm", 0);
const evaluate = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmEvaluate", 2);
const setEvalEnabled = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmSetEvalEnabled", 1);
const defineLazily = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmDefineLazily", 2);
const cacheAccessors = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmCacheAccessors", 2);
const shareGlobals = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmShareGlobals", 2);
const requireTrustedScripts = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmRequireTrustedScripts", 1);
const setPaused = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmSetPaused", 1);
const whereLastThrown = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmWhereThrown", 1);
const runCompiled = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmRunCompiled", 2);

const bridge = require("internal/desktop/electron/bridge");
const { define } = bridge;
const global: any = globalThis;
const clone = structuredClone;

const hidden = [
  "Buffer",
  "BuildError",
  "BuildMessage",
  "Bun",
  "HTMLRewriter",
  "ResolveError",
  "ResolveMessage",
  "ShadowRealm",
  "SharedArrayBuffer",
  "clearImmediate",
  "gc",
  "global",
  "module",
  "process",
  "require",
  "setImmediate",
];

const directories = new WeakSet<File>();

/** `bun compile` lets a program replace the globals that it has seen an assignment to. */
function replaceable(value: any) {
  globalThis.addEventListener = value;
  globalThis.alert = value;
  globalThis.atob = value;
  globalThis.btoa = value;
  globalThis.clearImmediate = value;
  globalThis.clearInterval = value;
  globalThis.clearTimeout = value;
  globalThis.confirm = value;
  globalThis.dispatchEvent = value;
  globalThis.fetch = value;
  globalThis.postMessage = value;
  globalThis.prompt = value;
  globalThis.removeEventListener = value;
  globalThis.reportError = value;
  globalThis.setImmediate = value;
  globalThis.setInterval = value;
  globalThis.setTimeout = value;
  globalThis.global = value;
  globalThis.navigator = value;
  globalThis.performance = value;
  globalThis.Buffer = value;
  globalThis.BuildError = value;
  globalThis.BuildMessage = value;
  globalThis.HTMLRewriter = value;
  globalThis.Request = value;
  globalThis.ResolveError = value;
  globalThis.ResolveMessage = value;
  globalThis.BroadcastChannel = value;
  globalThis.CustomEvent = value;
  globalThis.ErrorEvent = value;
  globalThis.Event = value;
  globalThis.EventTarget = value;
  globalThis.FormData = value;
  globalThis.MessageEvent = value;
  globalThis.CloseEvent = value;
  globalThis.Headers = value;
  globalThis.MessageChannel = value;
  globalThis.MessagePort = value;
  globalThis.Performance = value;
  globalThis.PerformanceEntry = value;
  globalThis.PerformanceMark = value;
  globalThis.PerformanceMeasure = value;
  globalThis.PerformanceObserver = value;
  globalThis.PerformanceObserverEntryList = value;
  globalThis.PerformanceResourceTiming = value;
  globalThis.PerformanceServerTiming = value;
  globalThis.PerformanceTiming = value;
  globalThis.Response = value;
  globalThis.queueMicrotask = value;
  globalThis.structuredClone = value;
  globalThis.URL = value;
  globalThis.WebSocket = value;
  globalThis.Worker = value;
  globalThis.console = value;
  globalThis.SharedArrayBuffer = value;
  globalThis.self = value;
}

const idl = () => require("internal/desktop/web/idl");
let scope: any;

/** `isShared`: other documents use the modules of this realm, until `release`. */
function dispose(isShared?: boolean, isReachable?: boolean) {
  scope?.dispose();
  if (!isShared) disposeRealm(isReachable);
}

const isParseError = (error: any) =>
  error instanceof SyntaxError &&
  URL.canParse(error.sourceURL) &&
  `${error.stack}`.includes(`at <parse> (${error.sourceURL}:`);

function whereThrown(error: any): [string, number, number] {
  try {
    if (!bridge.isError(error)) return whereLastThrown(error) ?? ["", 0, 0];
    const match = /[( ]((?!internal:|native:|node:)[a-z][\w+.-]*:[^\s()]*):(\d+):(\d+)\)?$/m.exec(error.stack);
    if (match && !isParseError(error)) return [match[1], +match[2], +match[3]];
    if (typeof error.sourceURL === "string" && !error.sourceURL.startsWith("internal:"))
      return [error.sourceURL, error.line | 0, error.column | 0];
  } catch {}
  return ["", 0, 0];
}

function describe(error: any) {
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.$call(error);
  }
}

/** The URLs of the scripts of other origins that have not allowed this one to read them. */
const muted = new Set<string>();

function installReporting(env: any, events: any) {
  let isReporting = false;
  const unhandled = new WeakSet<object>();
  const reportedRejections = new WeakSet<object>();
  scope.reportAt = (init: any) => {
    if (scope.disposed) return;
    if (!isReporting) {
      isReporting = true;
      try {
        if (!idl().dispatch(global, new events.ErrorEvent("error", { ...init, cancelable: true }))) return;
      } finally {
        isReporting = false;
      }
    }
    env.uncaught(init.message, init.filename, init.lineno, init.colno, init.error);
  };
  scope.report = (error: unknown, script = "") => {
    const [filename, lineno, colno] = whereThrown(error);
    if (muted.$has(filename || script)) scope.reportAt({ message: "Script error.", filename: "", error: null });
    else scope.reportAt({ message: "Uncaught " + describe(error), filename: filename || script, lineno, colno, error });
  };
  const fire = (type: string, promise: object, reason: unknown) =>
    idl().dispatchInTask(
      global,
      new events.PromiseRejectionEvent(type, { cancelable: type[0] === "u", promise, reason }),
    );
  return {
    rejected: [],
    error(reason: unknown, promise: any) {
      if (!promise) return scope.report(reason);
      const [filename, lineno, colno] = whereThrown(reason);
      if (muted.$has(filename)) return;
      unhandled.add(promise);
      idl().queueTask(() => {
        if (!unhandled.has(promise)) return;
        if (fire("unhandledrejection", promise, reason)) {
          env.uncaught("Uncaught (in promise) " + describe(reason), filename, lineno, colno, reason, true);
        }
        if (unhandled.delete(promise)) reportedRejections.add(promise);
      });
    },
    handled(promise: object, reason: unknown) {
      if (!unhandled.delete(promise) && reportedRejections.delete(promise))
        idl().queueTask(() => fire("rejectionhandled", promise, reason));
    },
  };
}

function installTimers(env: any) {
  const { tasks } = env;
  const timers = new Map<number, any>();
  let nextId = 1;
  let nesting = 0;
  function run(handler: any, args: unknown[] | undefined, depth: number) {
    nesting = depth;
    try {
      if (!$isCallable(handler)) scope.evaluate(handler, scope.baseUrl());
      else if (args === undefined) handler.$call(global);
      else handler.$apply(global, args);
    } catch (error) {
      scope.report(error);
    }
    nesting = 0;
  }
  function start(repeats: boolean, handler: any, delay: any, args: unknown[]) {
    if (!$isCallable(handler)) {
      const sink = `${scope.isWindow ? "Window" : "WorkerGlobalScope"} ${repeats ? "setInterval" : "setTimeout"}`;
      handler = scope.trusted("script", handler, sink);
      if (!env.allowsEval(handler)) return 0;
    }
    delay |= 0;
    const id = nextId++;
    if (scope.disposed) return id;
    const depth = nesting + 1;
    const rest = args.length > 0 ? args : undefined;
    const fire = () => {
      if (!repeats) timers.$delete(id);
      run(handler, rest, depth);
    };
    timers.$set(id, tasks.postDelayed(Math.max(delay, depth > 5 ? 4 : 0), repeats, fire));
    return id;
  }
  const clear = (id: any) => {
    const timer = timers.$get((id |= 0));
    if (timer === undefined) return;
    timers.$delete(id);
    tasks.cancel(timer);
  };
  scope.cleanups.add(() => timers.$forEach(tasks.cancel));
  return {
    setTimeout(handler: any, delay: any = 0, ...args: unknown[]) {
      if (arguments.length === 0) idl().need(0, 1);
      return start(false, handler, delay, args);
    },
    setInterval(handler: any, delay: any = 0, ...args: unknown[]) {
      if (arguments.length === 0) idl().need(0, 1);
      return start(true, handler, delay, args);
    },
    clearTimeout(id: any = 0) {
      clear(id);
    },
    clearInterval(id: any = 0) {
      clear(id);
    },
  };
}

function formatConsole(args: any[]) {
  let index = 0;
  const parts: string[] = [];
  if (typeof args[0] === "string" && args.length > 1) {
    index = 1;
    parts.push(
      args[0].replace(/%([sdifoOc%])/g, (whole, kind) => {
        if (kind === "%") return "%";
        if (index >= args.length) return whole;
        const value = args[index++];
        if (kind === "c") return "";
        if (kind === "d" || kind === "i") return String(typeof value === "symbol" ? NaN : parseInt(value, 10));
        if (kind === "f") return String(typeof value === "symbol" ? NaN : parseFloat(value));
        return describe(value);
      }),
    );
  }
  for (; index < args.length; index++) {
    const value = args[index];
    parts.push(bridge.isError(value) && typeof value.stack === "string" ? value.stack : describe(value));
  }
  return parts.join(" ");
}

function installConsole(env: any) {
  const write = (level: string, type: string, args: unknown[]) => {
    if (!env.wantsConsole()) return;
    const [source, line] = whereThrown(new Error());
    env.console(level, formatConsole(args), line, source, type, args);
  };
  const counts = new Map<string, number>();
  const times = new Map<string, number>();
  const elapsed = (label: string, more: unknown[]) => {
    const start = times.$get(label);
    if (start !== undefined) write("info", "timeEnd", [`${label}: ${performance.now() - start} ms`, ...more]);
  };
  const console: any = {
    __proto__: {},
    assert(condition: unknown = false, ...args: unknown[]) {
      if (!condition) write("error", "assert", ["Assertion failed:", ...(args.length ? args : ["console.assert"])]);
    },
    count(label = "default") {
      label = `${label}`;
      counts.$set(label, (counts.$get(label) ?? 0) + 1);
      write("info", "count", [`${label}: ${counts.$get(label)}`]);
    },
    countReset(label = "default") {
      counts.$delete(`${label}`);
    },
    time(label = "default") {
      if (!times.$has((label = `${label}`))) times.$set(label, performance.now());
    },
    timeLog(label = "default", ...more: unknown[]) {
      elapsed(`${label}`, more);
    },
    timeEnd(label = "default") {
      elapsed((label = `${label}`), []);
      times.$delete(label);
    },
  };
  for (const [name, level, type = name] of [
    ["log", "info"],
    ["info", "info"],
    ["debug", "debug"],
    ["warn", "warning", "warning"],
    ["error", "error"],
    ["trace", "info"],
    ["dir", "info"],
    ["dirxml", "info"],
    ["table", "info"],
    ["group", "info", "startGroup"],
    ["groupCollapsed", "info", "startGroupCollapsed"],
  ]) {
    console[name] = bridge.named(name, (...args: unknown[]) => write(level, type, args));
  }
  for (const name of ["groupEnd", "clear", "profile", "profileEnd", "timeStamp"]) {
    console[name] = bridge.named(name, () => {});
  }
  Object.defineProperty(console, Symbol.toStringTag, { value: "console", configurable: true });
  define(global, { console });
}

const files = () => require("internal/desktop/web/files");
const fileSystem = () => require("internal/desktop/web/file_system");
const indexedDB = () => require("internal/desktop/electron/indexeddb");
const messaging = () => require("internal/desktop/web/messaging");
const network = () => require("internal/desktop/web/fetch");
const permissions = () => require("internal/desktop/web/permissions");
const timeline = () => require("internal/desktop/web/performance");
const trustedTypes = () => require("internal/desktop/web/trusted_types");
const reporting = () => require("internal/desktop/web/reporting");
const locks = () => require("internal/desktop/web/locks");
const scheduler = () => require("internal/desktop/web/scheduler");
const machine = () => require("internal/desktop/web/navigator");
const workers = () => require("internal/desktop/web/workers");
const caches = () => require("internal/desktop/web/cache_storage");
const cookieStore = () => require("internal/desktop/web/cookie_store");

const everywhere: [() => any, string][] = [
  [files, "FileReader"],
  [
    indexedDB,
    `IDBCursor IDBCursorWithValue IDBDatabase IDBFactory IDBIndex IDBKeyRange IDBObjectStore IDBOpenDBRequest IDBRecord
    IDBRequest IDBTransaction IDBVersionChangeEvent`,
  ],
  [machine, "NavigatorUAData NetworkInformation Origin QuotaExceededError"],
  [messaging, "BroadcastChannel MessageChannel MessageEvent MessagePort"],
  [network, "Headers Request Response"],
  [permissions, "Notification PermissionStatus Permissions"],
  [reporting, "ReportingObserver SecurityPolicyViolationEvent"],
  [scheduler, "Scheduler TaskController TaskPriorityChangeEvent TaskSignal"],
  [
    timeline,
    `Performance PerformanceEntry PerformanceMark PerformanceMeasure PerformanceObserver PerformanceObserverEntryList
    PerformanceResourceTiming PerformanceServerTiming`,
  ],
  [trustedTypes, "TrustedHTML TrustedScript TrustedScriptURL TrustedTypePolicy TrustedTypePolicyFactory"],
  [workers, "Worker"],
  [() => require("internal/desktop/web/event_source"), "EventSource"],
  [() => require("internal/desktop/web/web_socket"), "CloseEvent WebSocket"],
  [() => require("internal/desktop/web/xhr"), "XMLHttpRequest XMLHttpRequestEventTarget XMLHttpRequestUpload"],
];
const whereSecure: typeof everywhere = [
  [caches, "Cache CacheStorage"],
  [fileSystem, "FileSystemDirectoryHandle FileSystemFileHandle FileSystemHandle FileSystemWritableFileStream"],
  [locks, "Lock LockManager"],
  [permissions, "StorageManager"],
];
const audio = () => require("internal/desktop/web/audio");
const inWindows: typeof everywhere = [
  [
    audio,
    `AnalyserNode AudioBuffer AudioBufferSourceNode AudioContext AudioDestinationNode AudioNode AudioParam AudioProcessingEvent
    AudioScheduledSourceNode BaseAudioContext BiquadFilterNode ChannelMergerNode ChannelSplitterNode ConstantSourceNode
    ConvolverNode DelayNode DynamicsCompressorNode GainNode MediaElementAudioSourceNode MediaStream
    MediaStreamAudioDestinationNode MediaStreamAudioSourceNode MediaStreamTrack OscillatorNode OverconstrainedError
    PeriodicWave ScriptProcessorNode StereoPannerNode WaveShaperNode`,
  ],
  [
    timeline,
    `EventCounts LargestContentfulPaint PerformanceElementTiming PerformanceEventTiming PerformanceNavigation PerformanceNavigationTiming PerformancePaintTiming PerformanceTiming
    VisibilityStateEntry`,
  ],
  [machine, "External Scheduling WebKitMutationObserver chrome external webkitURL"],
  [workers, "SharedWorker"],
];

let canvas = () => require("internal/desktop/web/dom").loader.canvas();

function once<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

function deserialize(record: any) {
  if (/^(?:MessagePort|\w+Stream)$/.test(record.kind)) return messaging().deserialize(record);
  if (record.kind.startsWith("FileSystem")) return fileSystem().deserialize(record);
  if (record.kind.startsWith("DOM")) return require("internal/desktop/web/dom").geometry.deserialize(record);
  return canvas().deserialize(record);
}

/** The native one shares its prototype with `Blob`. The result is for DesktopRealm.cpp. */
function installFile() {
  const NativeFile = File;
  const own = function (parts: unknown, name: unknown, options: unknown = undefined) {
    if (!new.target) throw new TypeError("Failed to construct 'File': Please use the 'new' operator.");
    idl().need(arguments.length, 2);
    const given = files().partsOf(parts);
    name = idl().usv(name);
    const converted = files().convert(given, options);
    return Reflect.construct(NativeFile, [converted[0], name, converted[1]], new.target);
  };
  const inherited = (name: string) => ({
    ...Object.getOwnPropertyDescriptor(Blob.prototype, name),
    set: undefined,
    configurable: true,
  });
  const prototype = Object.create(Blob.prototype, {
    constructor: { value: own, writable: true, configurable: true },
    name: inherited("name"),
    lastModified: inherited("lastModified"),
    [Symbol.toStringTag]: { value: "File", configurable: true },
  });
  Object.defineProperties(own, { name: { value: "File" }, prototype: { value: prototype, writable: false } });
  Object.setPrototypeOf(own, Blob);
  idl().attribute(own, "webkitRelativePath", () => "");
  define(global, { File: own });
  return prototype;
}

/** What windows and workers have in common. The result are hooks for DesktopRealm.cpp. */
function installShared(env: any, page: any, members: object, Navigator: Function, more: typeof everywhere) {
  const core = require("internal/desktop/web/dom").core;
  const { attribute, internal, need, native, replaceable } = idl();
  Object.assign(scope, {
    page,
    timeOrigin: page.timeOrigin,
    evaluate,
    dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      for (const cleanup of [...scope.cleanups]) cleanup();
    },
  });
  const hooks = installReporting(env, require("internal/desktop/web/dom").events);
  installConsole(env);

  const loaders = new Map<string, () => any>();
  for (const [load, names] of [...everywhere, ...(env.secure ? whereSecure : []), ...more]) {
    for (const name of core.splitTokens(names)) loaders.$set(name, load);
  }
  defineLazily([...loaders.$keys()], (name: string) => loaders.$get(name)!()[name]);

  const operations = {
    ...installTimers(env),
    fetch(input: unknown, init: unknown = undefined) {
      return network().fetch(...arguments);
    },
    structuredClone(value: unknown, options: unknown = undefined) {
      if (arguments.length === 1) return native.structuredClone(value);
      return messaging().structuredClone(...arguments);
    },
    reportError(error: unknown) {
      need(arguments.length, 1);
      scope.report(error);
    },
  };
  if (members !== global)
    define(members, { atob: global.atob, btoa: global.btoa, queueMicrotask: global.queueMicrotask });
  define(members, operations);
  replaceable(members, "origin", () => env.origin);
  replaceable(
    members,
    "performance",
    once(() => timeline().performance),
  );
  replaceable(
    members,
    "scheduler",
    once(() => new (scheduler().Scheduler)(internal)),
  );
  core.accessor(members, "isSecureContext", () => env.secure);
  core.accessor(members, "crossOriginIsolated", () => env.isIsolated);
  core.accessor(
    members,
    "indexedDB",
    once(() => indexedDB().indexedDB),
  );
  core.accessor(
    members,
    "trustedTypes",
    once(() => trustedTypes().trustedTypes),
  );
  attribute(
    Navigator,
    "connection",
    once(() => new (machine().NetworkInformation)(internal)),
  );
  attribute(
    Navigator,
    "permissions",
    once(() => new (permissions().Permissions)(internal)),
  );
  if (env.secure) {
    attribute(
      Navigator,
      "userAgentData",
      once(() => new (machine().NavigatorUAData)(internal)),
    );
    core.accessor(
      members,
      "caches",
      once(() => new (caches().CacheStorage)(internal)),
    );
    attribute(
      Navigator,
      "locks",
      once(() => new (locks().LockManager)(internal)),
    );
    attribute(
      Navigator,
      "storage",
      once(() => new (permissions().StorageManager)(internal)),
    );
  }

  const objectUrls = new Set<string>();
  scope.cleanups.add(() => objectUrls.$forEach(url => env.revokeObjectUrl(url)));
  return {
    ...hooks,
    deserialize,
    filePrototype: installFile(),
    /** For `WebAssembly.compileStreaming()`. */
    nativeResponse(response: any) {
      if (!(response instanceof network().Response)) throw new TypeError("The argument has to be a Response.");
      const { list, status, type } = network().responseParts(response);
      if (list.get("content-type")?.toLowerCase() !== "application/wasm")
        throw new TypeError("Incorrect response MIME type. Expected 'application/wasm'.");
      if (type.startsWith("opaque") || status < 200 || status > 299) throw new TypeError("The response is not ok.");
      if (response.bodyUsed || response.body?.locked)
        throw new TypeError("The body is locked, or it has already been read.");
      return new Response(response.body, { headers: { "content-type": "application/wasm" } });
    },
    objectUrlCreated(url: string) {
      objectUrls.$add((url = `blob:${env.origin}/${url.slice(-36)}`));
      return url;
    },
    revokeObjectUrl(given: unknown) {
      const url = String(given);
      if (!url.startsWith(`blob:${env.origin}/`) || url.length !== env.origin.length + 42) return;
      objectUrls.$delete(url);
      env.revokeObjectUrl(url);
    },
    refusedEval: (code: string) => void env.allowsEval(code),
    codeForEval: (value: any) => (value.$impl?.trustedAs === "script" ? value.$impl.data : undefined),
    mayCompile: (code: string, parts?: unknown[]) =>
      (!checksTypes || trustedTypes().mayCompile(code, parts)) && env.allowsEval(code),
  };
}

let checksTypes = false;

function watchEval(requiresTypes: boolean) {
  requireTrustedScripts(true);
  if (!(checksTypes = requiresTypes)) return;
  scope.trusted = scope.page.trusted = trustedTypes().compliant;
  trustedTypes().enforce();
}

const hiddenFrom = (env: any) => [
  ...hidden.filter(name => name !== "SharedArrayBuffer" || !env.isIsolated),
  ...(env.secure ? [] : ["CryptoKey", "SubtleCrypto"]),
];

/** Whatever the Content Security Policy says. */
function withEval(run: () => unknown) {
  const before = setEvalEnabled(true);
  try {
    return run();
  } finally {
    setEvalEnabled(before);
  }
}

function documentChanged() {
  cacheAccessors(global, isSameForDocument);
}

const world = {
  documentChanged,
  global,
  bridge,
  evaluate,
  runCompiled,
  withEval,
  dispose,
  setPaused,
  clone: (value: unknown, transfer?: any[]) => clone(value, { transfer }),
};

const policies = {
  disableEval: () => setEvalEnabled(false),
  disableWebAssembly: () => setEvalEnabled(false, true),
  watchEval,
  whereNow: () => whereThrown(new Error()),
  tellScripts: (type: string, body: object, element?: object) =>
    idl().runTask(() => reporting().deliver(type, body, element)),
};

const isSameForDocument = `customElements document frames history indexedDB isSecureContext localStorage
  location navigation navigator origin performance scheduler screen self sessionStorage visualViewport window`.split(
  /\s+/,
);

function page(env: any) {
  if (env.never) replaceable(env.never);
  const { createPage } = env.shared ?? require("internal/desktop/dom/page");
  const mirror = env.shared && new (require("internal/desktop/dom/mirror").Mirror)(env.shared);
  if (mirror) require("internal/desktop/web/dom").share(mirror.module);
  scope = Object.assign(idl().scope, { env, isWindow: true, baseUrl: () => controller.document.baseURI });
  const report = (error: unknown) => scope.report(error);
  const loader = require("internal/desktop/web/modules").create(env, scope.baseUrl, (text: string, baseURL: string) => {
    const sheet = new global.CSSStyleSheet({ baseURL });
    sheet.replaceSync(text);
    return sheet;
  });
  const reported = (run: () => Promise<unknown>) => () => void run().then(undefined, report);
  const controller = createPage(
    {
      __proto__: env.dom,
      reportError: report,
      runsScripts: env.javascript,
      allowsInlineScript: env.allowsInlineScript,
      /** `base` is what its imports are relative to. */
      runClassicScript(source: string, url: string, { base, isMuted, line, column, ...fetching }: any = {}) {
        try {
          const compiled = base === undefined ? env.compiledPath(url) : undefined;
          if (compiled) return runCompiled(compiled, true);
          if (isMuted) muted.$add(url);
          if (fetching.nonce || fetching.referrerPolicy || fetching.credentials)
            loader.setFetching(base ?? url, fetching);
          return evaluate(source, url, false, isMuted ? "about:blank" : base, line, column);
        } catch (error) {
          scope.report(error, url);
        }
      },
      prepareModule(url: string, options: object) {
        const compiled = env.compiledPath(url);
        if (compiled) return Promise.$resolve(reported(() => runCompiled(compiled, false)));
        return loader.prepare(url, options).then(reported);
      },
      preloadModule: (url: string, type: string, options: object) =>
        env.compiledPath(url) ? Promise.$resolve() : loader.preload(url, type, options),
      prepareInlineModule(...args: unknown[]) {
        try {
          return loader.prepareInline(...args).then(reported);
        } catch (error) {
          return Promise.$resolve(() => report(error));
        }
      },
      addImportMap: loader.addImportMap,
      createPlayer: (media: object, fire: Function, fetch: Function) => new (audio().Player)(media, fire, fetch),
      compileHandler: (body: string, line?: number) =>
        evaluate(`(function(){${body}})`, env.url, false, scope.baseUrl(), line),
      messaging,
      network,
      error: idl().error,
      transfers: env.transfers,
      serialize: (value: unknown) => require("bun:jsc").serialize(value, { binaryType: "nodebuffer" }),
      deserialize: (bytes: Uint8Array) => require("bun:jsc").deserialize(bytes),
      originOf: env.originOf,
      describeError(error: unknown) {
        const [filename, lineno, colno] = whereThrown(bridge.isError(error) ? error : new Error());
        return { error, message: describe(error), filename: filename || env.url, lineno, colno };
      },
      fileFromPath(path: string) {
        const { bytes, name, type, lastModified, isDirectory } = env.readFile(path);
        const file = new File([bytes], name, { type, lastModified });
        env.rememberPath(file, path);
        if (isDirectory) directories.add(file);
        return file;
      },
      isDirectory: (file: File) => directories.has(file),
    },
    { global, mirror, baseUrl: env.baseUrl },
  );
  const { Navigator } = global;
  const secure: typeof everywhere = env.secure
    ? [
        [audio, "MediaDeviceInfo MediaDevices"],
        [cookieStore, "CookieChangeEvent CookieStore"],
        [network, "FetchLaterResult fetchLater"],
        [machine, "Keyboard"],
      ]
    : [];
  const hooks = installShared(env, global.$impl.x, global, Navigator, [...inWindows, ...secure]);
  scope.encoding = () => scope.page.doc.encoding;
  define(Navigator.prototype, {
    sendBeacon(url: string, data: unknown = null) {
      return network().sendBeacon(...arguments);
    },
  });
  if (env.secure)
    idl().attribute(
      Navigator,
      "keyboard",
      once(() => new (machine().Keyboard)(idl().internal)),
    );
  idl().attribute(
    Navigator,
    "scheduling",
    once(() => new (machine().Scheduling)(idl().internal)),
  );
  if (env.secure) {
    idl().attribute(
      Navigator,
      "mediaDevices",
      once(() => new (audio().MediaDevices)(idl().internal)),
    );
    const get = once(() => new (cookieStore().CookieStore)(idl().internal));
    Object.defineProperty(global, "cookieStore", { get, enumerable: true, configurable: true });
  }
  const preload = env.sharesWorldWithPreload && require("internal/desktop/electron/preload");
  seal({ ...hooks, ...loader.hooks, origin: env.originOf }, hiddenFrom(env));
  documentChanged();
  return { ...world, ...policies, release: () => disposeRealm(), env, controller, preload, report, hooks, messaging };
}

const ofEachRealm = `AggregateError Array ArrayBuffer AsyncDisposableStack Atomics BigInt BigInt64Array BigUint64Array Boolean
  DataView Date DisposableStack Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array Function
  Infinity Int16Array Int32Array Int8Array Intl Iterator JSON Map Math NaN Number Object Promise Proxy RangeError
  ReferenceError Reflect RegExp Set String SuppressedError Symbol SyntaxError Temporal TextDecoder TextEncoder TypeError
  URIError URL URLPattern URLSearchParams Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet
  WebAssembly atob btoa crypto decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval globalThis isFinite
  isNaN parseFloat parseInt queueMicrotask structuredClone undefined unescape`;

/** Another global object for the same document. */
function isolated(env: any, main: any) {
  const preload = require("internal/desktop/electron/preload");
  const window = main.global;
  const isOwn: any = { __proto__: null };
  const windows = ["frames", "opener", "parent", "self", "top", "window"];
  for (const name of [...hidden, ...windows, ...ofEachRealm.split(/\s+/)]) isOwn[name] = true;
  shareGlobals(window, isOwn);
  for (const name of windows) {
    const { get, set, configurable } = Object.getOwnPropertyDescriptor(window, name)!;
    const inPage = () => {
      const value = get!.$call(window);
      return value === window ? global : value;
    };
    Object.defineProperty(global, name, { get: inPage, set, configurable, enumerable: true });
  }
  for (
    let from = Object.getPrototypeOf(window);
    from !== main.bridge.objectPrototype;
    from = Object.getPrototypeOf(from)
  ) {
    for (const name of Object.getOwnPropertyNames(from)) {
      if (name === "constructor" || Object.hasOwn(global, name)) continue;
      Object.defineProperty(global, name, Object.getOwnPropertyDescriptor(from, name)!);
    }
  }
  // The modules of Node.js that preload scripts get use `Bun`.
  const { hooks } = require("internal/desktop/web/modules").create(env, () => window.document.baseURI);
  seal(
    { ...main.hooks, ...hooks, rejected: [], origin: env.originOf },
    hidden.filter(name => name !== "Bun"),
  );
  documentChanged();
  return { ...world, preload };
}

function worker(env: any) {
  const core = require("internal/desktop/web/dom").core;
  const events = require("internal/desktop/web/dom").events;
  scope = Object.assign(idl().scope, { env, baseUrl: () => env.url });
  const target = new events.EventTarget().$impl;
  const page: any = {
    target,
    window: global,
    event: undefined,
    mirror: null,
    timeOrigin: performance.now(),
    reportError: (error: unknown) => scope.report(error),
    host: { messaging, transfers: env.transfers, fetchResource: env.fetchResource },
  };
  canvas = once(() => {
    const loaded = require("internal/desktop/dom/canvas");
    const inherited = { ...loaded.hooks.inherited(), fontScope: env.fontScope };
    loaded.setNative(env.native());
    loaded.hooks.inherited = () => inherited;
    return loaded;
  });
  const fonts = once(() => {
    const doc = Object.assign(core.createDoc(), { url: env.url, baseUrl: env.url });
    const { fontScope } = env;
    Object.assign(page, {
      doc,
      fontScope,
      native: env.native(),
      queueTask: idl().queueTask,
      delayLoad() {},
      allowLoad() {},
    });
    return { loader: require("internal/desktop/dom/loader"), ...core.interfaces };
  });
  target.js = global;
  $putByIdDirectPrivate(global, "impl", target);
  core.realm.page = core.realm.root = page;
  const workerScope = require("internal/desktop/web/worker_scope");
  const { interfaces, Navigator } = workerScope.install();
  const geometry = once(() => {
    const loaded = require("internal/desktop/dom/geometry");
    loaded.removeStrings();
    return loaded;
  });
  const more: typeof everywhere = [
    [() => require("internal/desktop/dom/observable"), "Observable Subscriber"],
    [files, "FileReaderSync"],
    [fonts, "FontFace FontFaceSet"],
    [
      canvas,
      `CanvasGradient CanvasPattern ImageBitmap ImageBitmapRenderingContext ImageData OffscreenCanvas
      OffscreenCanvasRenderingContext2D Path2D TextMetrics`,
    ],
    [
      () => events,
      "CustomEvent DOMStringList ErrorEvent Event EventTarget FontFaceSetLoadEvent ProgressEvent PromiseRejectionEvent",
    ],
    [geometry, "DOMMatrix DOMMatrixReadOnly DOMPoint DOMPointReadOnly DOMQuad DOMRect DOMRectReadOnly"],
  ];
  if (env.secure && !env.isShared) more.push([fileSystem, "FileSystemSyncAccessHandle"]);
  const hooks = installShared(env, page, interfaces[0].prototype, Navigator, more);
  for (const name of Object.getOwnPropertyNames(interfaces[0].prototype))
    if (Object.hasOwn(global, name)) workerScope.inherit(name);
  for (const it of interfaces) define(global, { [it.name]: it });
  core.accessor(interfaces[0].prototype, "fonts", () => fonts().loader.fontsOf(page).js);
  define(interfaces[0].prototype, {
    createImageBitmap(_image: unknown) {
      return canvas().createImageBitmap(...arguments);
    },
  });
  const loader = require("internal/desktop/web/modules").create(env, scope.baseUrl);
  seal({ ...hooks, ...loader.hooks, origin: env.originOf }, [
    ...hiddenFrom(env),
    "alert",
    "confirm",
    "prompt",
    "Navigator",
    "PerformanceTiming",
    ...(env.isShared ? ["Worker"] : []),
  ]);

  /** The result runs the script. */
  async function prepare(compiled: string | undefined) {
    const credentials = env.credentials;
    const run: () => unknown = compiled
      ? () => runCompiled(compiled, false)
      : env.isModule
        ? await loader.prepareInline(env.source, env.url, env.url, { credentials }, 0, 0, true)
        : () => void evaluate(env.source, env.url);
    return () => {
      try {
        Promise.$resolve(run()).then(undefined, page.reportError);
      } catch (error) {
        if (env.isShared && isParseError(error) && error.sourceURL === env.url) throw error;
        scope.report(error, env.url);
      }
      workerScope.started();
    };
  }
  return { ...policies, prepare, connect: workerScope.connect };
}

export default { page, isolated, worker };
