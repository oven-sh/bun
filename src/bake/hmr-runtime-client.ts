// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { editCssArray, editCssContent } from "./client/css-reloader";
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
import { MessageId } from "./generated";
import {
  emitEvent,
  fullReload,
  loadModuleAsync,
  onServerSideReload,
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

async function performRouteReload() {
  console.info("[Bun] Server-side code changed, reloading!");
  if (isPerformingRouteReload) {
    shouldPerformAnotherRouteReload = true;
    return;
  }

  if (onServerSideReload) {
    try {
      isPerformingRouteReload = true;
      do {
        shouldPerformAnotherRouteReload = false;
        await onServerSideReload();
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
const scriptTags = new Map<string, [script: HTMLScriptElement, size: number]>();
globalThis[Symbol.for("bun:hmr")] = (modules: any, id: string) => {
  const entry = scriptTags.get(id);
  if (!entry) throw new Error("Unknown HMR script: " + id);
  const [script, size] = entry;
  scriptTags.delete(id);
  const url = script.src;
  const map: SourceMapURL = {
    id,
    url,
    refs: Object.keys(modules).length,
    size,
  };
  addMapping(url, map);
  script.remove();
  replaceModules(modules, map).catch(e => {
    console.error(e);
    fullReload();
  });
};

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

    // The code genearting each list is annotated with equivalent "List n"
    // comments in DevServer.zig's finalizeBundle function.

    // List 1
    const serverSideRoutesUpdated = new Set();
    do {
      const routeId = reader.i32();
      if (routeId === -1 || routeId == undefined) break;
      serverSideRoutesUpdated.add(routeId);
    } while (true);
    // List 2
    let isServerSideRouteUpdate = false;
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
          editCssArray(cssArray);
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
      performRouteReload();
      return;
    }
    // JavaScript modules
    if (reader.hasMoreData()) {
      const sourceMapSize = reader.u32();
      const rest = reader.rest();
      const sourceMapId = td.decode(new Uint8Array(rest, rest.byteLength - 24, 16));
      DEBUG.ASSERT(sourceMapId.match(/[a-f0-9]{16}/));
      const blob = new Blob([rest], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const script = document.createElement("script");
      scriptTags.set(sourceMapId, [script, sourceMapSize]);
      script.className = "bun-hmr-script";
      script.src = url;
      script.onerror = onHmrLoadError;
      document.head.appendChild(script);
    } else {
      // Needed for testing.
      emitEvent("bun:afterUpdate", null);
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
