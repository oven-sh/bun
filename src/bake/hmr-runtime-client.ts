// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import {
  loadModuleAsync,
  replaceModules,
  onServerSideReload,
  setRefreshRuntime,
  emitEvent,
  fullReload,
} from "./hmr-module";
import { hasFatalError, onServerErrorPayload, onRuntimeError } from "./client/overlay";
import { DataViewReader } from "./client/data-view";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./generated";
import { editCssContent, editCssArray } from "./client/css-reloader";
import { td } from "./shared";

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

    ws.send("she"); // IncomingMessageId.subscribe with hot_update and errors
    ws.send("n" + location.pathname); // IncomingMessageId.set_url
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
      const code = td.decode(reader.rest());
      try {
        // TODO: This functions in all browsers, but WebKit browsers do not
        // provide stack traces to errors thrown in eval, meaning client-side
        // errors from hot-reloaded modules cannot be mapped back to their
        // source.
        const modules = (0, eval)(code);
        replaceModules(modules).catch(e => {
          console.error(e);
          fullReload();
        });
      } catch (e) {
        if (IS_BUN_DEVELOPMENT) {
          console.error(e, "Failed to parse HMR payload", { code });
          onRuntimeError(e, true, false);
          return;
        }
        throw e;
      }
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

// Before loading user code, instrument some globals.
{
  const truePushState = History.prototype.pushState;
  History.prototype.pushState = function pushState(this: History, state: any, title: string, url?: string | null) {
    truePushState.call(this, state, title, url);
    ws.send("n" + location.pathname);
  };
  const trueReplaceState = History.prototype.replaceState;
  History.prototype.replaceState = function replaceState(
    this: History,
    state: any,
    title: string,
    url?: string | null,
  ) {
    trueReplaceState.call(this, state, title, url);
    ws.send("n" + location.pathname);
  };
}

window.addEventListener("error", event => {
  onRuntimeError(event.error, true, false);
});
window.addEventListener("unhandledrejection", event => {
  onRuntimeError(event.reason, true, true);
});

{
  let reloadError: any = sessionStorage.getItem("bun:hmr:message");
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

try {
  const { refresh } = config;
  if (refresh) {
    const refreshRuntime = await loadModuleAsync(refresh, false, null);
    setRefreshRuntime(refreshRuntime);
  }

  await loadModuleAsync(config.main, false, null);
} catch (e) {
  console.error(e);
  onRuntimeError(e, true, false);
}
