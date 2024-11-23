// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { loadModule, LoadModuleType, onServerSideReload, replaceModules } from "./hmr-module";
import { hasFatalError, onErrorMessage, onRuntimeError, RuntimeErrorType } from "./client/overlay";
import { Bake } from "bun";
import { DataViewReader } from "./client/reader";
import { routeMatch } from "./client/route";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./generated";
import { editCssContent, editCssArray } from "./client/css-reloader";
import { td } from "./shared";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

let isPerformingRouteReload = false;
let shouldPerformAnotherRouteReload = false;

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
      if (IS_BUN_DEVELOPMENT) {
        // return showErrorOverlay(err);
      }
    }
  }

  // Fallback for when reloading fails or is not implemented by the framework is
  // to hard-reload.
  location.reload();
}

let isFirstRun = true;
const ws = initWebSocket({
  [MessageId.version](view) {
    if (td.decode(view.buffer.slice(1)) !== config.version) {
      console.error("Version mismatch, hard-reloading");
      location.reload();
      return;
    }

    if (isFirstRun) {
      isFirstRun = false;
    } else {
      // It would be possible to use `performRouteReload` to do a hot-reload,
      // but the issue lies in possibly outdated client files. For correctness,
      // all client files have to be HMR reloaded or proven unchanged.
      // Configuration changes are already handled by the `config.version` data.
      location.reload();
      return;
    }

    ws.send("she"); // IncomingMessageId.subscribe with hot_update and route_update
    ws.send("n" + location.pathname); // IncomingMessageId.set_url
  },
  [MessageId.hot_update](view) {
    console.log(view);
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
      const routePattern = reader.string32();
      if (routeMatch(routeId, routePattern)) {
        isServerSideRouteUpdate = serverSideRoutesUpdated.has(routeId);
        const cssCount = reader.i32();
        if (cssCount !== -1) {
          const cssArray = new Array<string>(cssCount);
          for (let i = 0; i < cssCount; i++) {
            cssArray[i] = reader.stringWithLength(16);
          }
          editCssArray(cssArray);
          console.log("oh shit", { routePattern, cssArray });
        }

        // Skip to the last route
        let nextRouteId = reader.i32();
        while (nextRouteId != null && nextRouteId !== -1) {
          reader.string32();
          reader.cursor += 16 * reader.u32();
          nextRouteId = reader.i32();
        }
        break;
      } else {
        // Skip to the next route
        reader.cursor += 16 * reader.u32();
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
      location.reload();
      return;
    }
    // JavaScript modules
    if (reader.hasMoreData()) {
      const code = td.decode(reader.rest());
      const modules = (0, eval)(code);
      replaceModules(modules);
    }
    if (isServerSideRouteUpdate) {
      performRouteReload();
    }
  },
  [MessageId.errors]: onErrorMessage,
});

// Before loading user code, instrument some globals.
{
  const truePushState = History.prototype.pushState;
  History.prototype.pushState = function pushState(this: History, state: any, title: string, url?: string | null) {
    truePushState.call(this, state, title, url);
    ws.send("n" + location.pathname);
  }
  const trueReplaceState = History.prototype.replaceState;
  History.prototype.replaceState = function replaceState(this: History, state: any, title: string, url?: string | null) {
    trueReplaceState.call(this, state, title, url);
    ws.send("n" + location.pathname);
  }
}

try {
  loadModule<Bake.ClientEntryPoint>(config.main, LoadModuleType.AssertPresent);
} catch (e) {
  onRuntimeError(e, RuntimeErrorType.fatal);
}