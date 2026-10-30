// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { editCssArray, editCssContent, fetchCssContent } from "./client/css-reloader";
import { DataViewReader } from "./client/data-view";
import { inspect } from "./client/inspect";
import { hasFatalError, onRuntimeError, onServerErrorPayload } from "./client/overlay";
import {
  addMapping,
  clearDisconnectedSourceMaps,
  configureSourceMapGCSize,
  getKnownSourceMaps,
  SourceMapURL,
} from "./client/stack-trace";
import { initWebSocket } from "./client/websocket";
import "./debug";
import { IncomingMessageId, MessageId } from "./generated";
import {
  emitEvent,
  fullReload,
  loadModuleAsync,
  onEvent,
  onServerSideReload,
  registerModules,
  replaceModules,
  setRefreshRuntime,
} from "./hmr-module";
import { td } from "./shared";

const consoleErrorWithoutInspector = console.error;

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

let isPerformingRouteReload = false;
let shouldPerformAnotherRouteReload = false;
let currentRouteIndex: number = -1;

/** False when an update since the last `onServerSideReload` call had no code for the browser. */
let everyUpdateHadClientCode = true;

async function performRouteReload(hasClientCode = false) {
  console.info("[Bun] Server-side code changed, reloading!");
  if (!hasClientCode) everyUpdateHadClientCode = false;
  if (isPerformingRouteReload) {
    shouldPerformAnotherRouteReload = true;
    return;
  }

  if (onServerSideReload) {
    try {
      isPerformingRouteReload = true;
      do {
        shouldPerformAnotherRouteReload = false;
        const clientCodeChanged = everyUpdateHadClientCode;
        everyUpdateHadClientCode = true;
        await onServerSideReload({ clientCodeChanged });
      } while (shouldPerformAnotherRouteReload);
      isPerformingRouteReload = false;
      return;
    } catch (err) {
      console.error("Failed to perform Server-side reload.");
      console.error(err);
      console.error("The page will hard-reload now.");
    }
  }

  // Fallback for when reloading fails or is not implemented by the framework is
  // to hard-reload.
  fullReload();
}

// HMR payloads are script tags that call this internal function.
// A previous version of this runtime used `eval`, but browser support around
// mapping stack traces of eval'd frames is poor (the case the error overlay).
const pendingScriptSymbol = Symbol.for("bun:hmr:pendingScripts");
type PendingHmrScript = {
  script: HTMLScriptElement;
  size: number;
  url: string;
  /** The answer to `IncomingMessageId.request_modules`: its modules are registered, not run. */
  requested: boolean;
};
type PendingHmrQueue = PendingHmrScript[];
const scriptTags: Map<string, PendingHmrQueue> =
  ((globalThis as any)[pendingScriptSymbol] as Map<string, PendingHmrQueue> | undefined) ??
  new Map<string, PendingHmrQueue>();
(globalThis as any)[pendingScriptSymbol] = scriptTags;

/** The modules that a chunk's modules import and that the chunk does not hold: `[id, graph index, ...]`. */
type Announced = (string | number)[];
const nothingAnnounced: Announced = [];
interface HotUpdate {
  modules: Record<string, UnloadedModule>;
  map: SourceMapURL;
  announced: Announced;
  /** How much of `announced` was compared with the registry. */
  compared: number;
}
/** Hot updates that have not run, in the order they came. Only the first one can wait. */
const hotUpdates: HotUpdate[] = [];
let isWaitingForModules = false;

function runHotUpdates() {
  let update: HotUpdate | undefined;
  while (!isWaitingForModules && (update = hotUpdates[0])) {
    const { modules, announced, compared } = update;
    const lacking: number[] = [];
    for (let i = compared; i < announced.length; i += 2) {
      if (!unloadedModuleRegistry[announced[i] as string]) lacking.push(announced[i + 1] as number);
    }
    // A tab that held none of the changed modules cannot reach what they import.
    if (lacking.length > 0 && (compared > 0 || Object.keys(modules).some(id => unloadedModuleRegistry[id]))) {
      // The server does not know what this tab holds: ask for the rest, then run the update.
      update.compared = announced.length;
      const request = new DataView(new ArrayBuffer(1 + lacking.length * 4));
      request.setUint8(0, IncomingMessageId.request_modules);
      for (let i = 0; i < lacking.length; i++) request.setUint32(1 + i * 4, lacking[i], true);
      isWaitingForModules = true;
      ws.send(request.buffer);
      return;
    }
    hotUpdates.shift();
    replaceModules(modules, update.map).catch(e => {
      console.error(e);
      fullReload();
    });
  }
}

/** The answer to `IncomingMessageId.request_modules`, with or without a chunk. */
function onRequestedModules(announced: Announced) {
  // The modules that came can import more that this tab lacks.
  const update = hotUpdates[0];
  if (update && announced.length > 0) update.announced = update.announced.concat(announced);
  isWaitingForModules = false;
  runHotUpdates();
}

globalThis[Symbol.for("bun:hmr")] = (modules: any, id: string, announced: Announced = nothingAnnounced) => {
  const queue = scriptTags.get(id);
  let entry = queue?.shift() ?? null;
  if (queue && queue.length === 0) {
    scriptTags.delete(id);
  }

  if (!entry) {
    throw new Error("Unknown HMR script: " + id);
  }

  const { script, size, url, requested } = entry;
  const map: SourceMapURL = {
    id,
    url,
    refs: requested ? 1 : Object.keys(modules).length,
    size,
  };
  addMapping(url, map);
  script.remove();
  if (requested) {
    registerModules(modules, map);
    onRequestedModules(announced);
  } else {
    hotUpdates.push({ modules, map, announced, compared: 0 });
    runHotUpdates();
  }
};

/** Loads the chunk at the end of a `hot_update` or `modules` message as a script. */
function loadChunk(reader: DataViewReader, requested: boolean) {
  const sourceMapSize = reader.u32();
  const rest = reader.rest();
  const sourceMapId = td.decode(new Uint8Array(rest, rest.byteLength - 24, 16));
  DEBUG.ASSERT(sourceMapId.match(/[a-f0-9]{16}/));
  const blob = new Blob([rest], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const script = document.createElement("script");
  const pendingScripts = scriptTags.get(sourceMapId);
  const entry: PendingHmrScript = {
    script,
    size: sourceMapSize,
    url,
    requested,
  };
  if (pendingScripts) {
    pendingScripts.push(entry);
  } else {
    scriptTags.set(sourceMapId, [entry]);
  }
  script.className = "bun-hmr-script";
  // In the order the messages came: an update relies on the modules that an earlier one asked for.
  script.async = false;
  script.src = url;
  script.onerror = onHmrLoadError;
  document.head.appendChild(script);
}

let isFirstRun = true;
const handlers = {
  [MessageId.version](view) {
    if (td.decode(view.buffer.slice(1)) !== config.version) {
      console.error("Version mismatch, hard-reloading");
      fullReload();
      return;
    }

    if (isFirstRun) {
      isFirstRun = false;
    } else {
      // It would be possible to use `performRouteReload` to do a hot-reload,
      // but the issue lies in possibly outdated client files. For correctness,
      // all client files have to be HMR reloaded or proven unchanged.
      // Configuration changes are already handled by the `config.version` data.
      fullReload();
      return;
    }

    ws.sendBuffered("she"); // IncomingMessageId.subscribe with hot_update and errors
    ws.sendBuffered("n" + location.pathname); // IncomingMessageId.set_url

    const fn = globalThis[Symbol.for("bun:loadData")];
    if (fn) {
      document.removeEventListener("visibilitychange", fn);
      ws.send("i" + config.generation);
    }
  },
  [MessageId.hot_update](view) {
    const reader = new DataViewReader(view, 1);

    // The code generating each list is annotated with equivalent "List n"
    // comments in dev_server/finalize.rs's finalize_bundle_inner function.

    // List 1
    const serverSideRoutesUpdated = new Set();
    do {
      const routeId = reader.i32();
      if (routeId === -1 || routeId == undefined) break;
      serverSideRoutesUpdated.add(routeId);
    } while (true);
    // List 2
    let isServerSideRouteUpdate = false;
    let addedCss: string[] | undefined;
    do {
      const routeId = reader.i32();
      if (routeId === -1 || routeId == undefined) break;
      if (routeId === currentRouteIndex) {
        isServerSideRouteUpdate = serverSideRoutesUpdated.has(routeId);
        const cssCount = reader.i32();
        if (cssCount !== -1) {
          const cssArray = new Array<string>(cssCount);
          for (let i = 0; i < cssCount; i++) {
            cssArray[i] = reader.stringWithLength(16);
          }
          addedCss = editCssArray(cssArray);
        }

        // Skip to the last route
        let nextRouteId = reader.i32();
        while (nextRouteId != null && nextRouteId !== -1) {
          const i = reader.i32();
          reader.cursor += 16 * Math.max(0, i);
          nextRouteId = reader.i32();
        }
        break;
      } else {
        // Skip to the next route
        const i = reader.i32();
        reader.cursor += 16 * Math.max(0, i);
      }
    } while (true);
    // List 3
    {
      let i = reader.u32();
      while (i--) {
        const identifier = reader.stringWithLength(16);
        const code = reader.string32();
        editCssContent(identifier, code);
      }
    }
    if (hasFatalError && (isServerSideRouteUpdate || reader.hasMoreData())) {
      fullReload();
      return;
    }
    if (isServerSideRouteUpdate) {
      performRouteReload(config.route !== undefined && reader.hasMoreData());
      // When the pages also run here (`config.route`), the same edit comes as JavaScript too:
      // apply it, so Fast Refresh updates the page in place.
      if (!config.route) return;
    }
    // List 3 holds no text for a stylesheet that this update did not bundle.
    if (addedCss) for (const id of addedCss) fetchCssContent(id).catch(e => console.error(e));
    // JavaScript modules
    if (reader.hasMoreData()) {
      loadChunk(reader, false);
    } else {
      // Needed for testing.
      emitEvent("bun:afterUpdate", null);
    }
  },
  [MessageId.modules](view) {
    const reader = new DataViewReader(view, 1);
    if (reader.hasMoreData()) {
      loadChunk(reader, true);
    } else {
      onRequestedModules(nothingAnnounced);
    }
  },
  [MessageId.set_url_response](view) {
    const reader = new DataViewReader(view, 1);
    currentRouteIndex = reader.u32();
  },
  [MessageId.errors]: onServerErrorPayload,
};
const ws = initWebSocket(handlers, {
  onStatusChange(connected) {
    emitEvent(connected ? "bun:ws:connect" : "bun:ws:disconnect", null);
  },
});

function onHmrLoadError(event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) {
  if (typeof event === "string") {
    console.error(event);
  } else if (error) {
    console.error(error);
  } else {
    console.error("Failed to load HMR script", event);
  }
  fullReload();
}

// Before loading user code, instrument some globals.
{
  const truePushState = History.prototype.pushState;
  History.prototype.pushState = function pushState(this: History, state: any, title: string, url?: string | null) {
    truePushState.call(this, state, title, url);
    ws.sendBuffered("n" + location.pathname);
  };
  const trueReplaceState = History.prototype.replaceState;
  History.prototype.replaceState = function replaceState(
    this: History,
    state: any,
    title: string,
    url?: string | null,
  ) {
    trueReplaceState.call(this, state, title, url);
    ws.sendBuffered("n" + location.pathname);
  };
}

window.addEventListener("error", event => {
  // In rare cases the error property might be null
  // but it's unlikely that both error and message are gone
  const value = event.error || event.message;
  if (!value) {
    console.log(
      "[Bun] The HMR client detected a runtime error, but no useful value was found. Below is the full error event:",
    );
    console.log(event);
  }
  onRuntimeError(value, true, false);
});

window.addEventListener("unhandledrejection", event => {
  onRuntimeError(event.reason, true, true);
});

{
  let reloadError: any = sessionStorage?.getItem?.("bun:hmr:message");
  if (reloadError) {
    sessionStorage.removeItem("bun:hmr:message");
    reloadError = JSON.parse(reloadError);
    if (reloadError.kind === "warn") {
      console.warn(reloadError.message);
    } else {
      console.error(reloadError.message);
    }
  }
}

// This implements streaming console.log and console.error from the browser to the server.
//
//   Bun.serve({
//     development: {
//       console: true,
//       ^^^^^^^^^^^^^^^^
//     },
//   })
//

if (config.console) {
  // Ensure it only runs once, and avoid the extra noise in the HTML.
  const originalLog = console.log;

  function websocketInspect(logLevel: "l" | "e", values: any[]) {
    let str = "l" + logLevel;
    let first = true;
    for (const value of values) {
      if (first) {
        first = false;
      } else {
        str += " ";
      }

      if (typeof value === "string") {
        str += value;
      } else {
        str += inspect(value);
      }
    }

    ws.sendBuffered(str);
  }

  if (typeof originalLog === "function") {
    console.log = function log(...args: any[]) {
      originalLog(...args);
      websocketInspect("l", args);
    };
  }

  if (typeof consoleErrorWithoutInspector === "function") {
    console.error = function error(...args: any[]) {
      consoleErrorWithoutInspector(...args);
      websocketInspect("e", args);
    };
  }
}

// The following API may be altered at any point.
// Thankfully, you can just call `import.meta.hot.on`
let testingHook = globalThis[Symbol.for("bun testing api, may change at any time")];
testingHook?.({
  configureSourceMapGCSize,
  clearDisconnectedSourceMaps,
  getKnownSourceMaps,
  onEvent,
});

try {
  const { refresh } = config;
  if (refresh) {
    const refreshRuntime = await loadModuleAsync(refresh, false, null);
    setRefreshRuntime(refreshRuntime);
  }

  await loadModuleAsync(config.main, false, null);

  emitEvent("bun:ready", null);
} catch (e) {
  // Use consoleErrorWithoutInspector to avoid double-reporting errors.
  consoleErrorWithoutInspector(e);

  onRuntimeError(e, true, false);
}
