// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";
import { onErrorClearedMessage, onErrorMessage } from "./client/overlay";
import { Bake } from "bun";
import { td } from "./shared";
import { DataViewReader } from "./client/reader";
import { routeMatch } from "./client/route";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./generated";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

async function performRouteReload() {
  console.info("[Bun] Server-side code changed, reloading!");
  if (onServerSideReload) {
    try {
      await onServerSideReload();
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

let main;

try {
  main = loadModule<Bake.ClientEntryPoint>(config.main, LoadModuleType.AssertPresent);
  var { onServerSideReload, ...rest } = main.exports;
  if (Object.keys(rest).length > 0) {
    console.warn(
      `Framework client entry point (${config.main}) exported unknown properties, found: ${Object.keys(rest).join(", ")}`,
    );
  }
} catch (e) {
  // showErrorOverlay(e);
  console.error(e);
}

/**
 * Map between CSS identifier and its style tag.
 * If a file is not present in this map, it might exist as a link tag in the HTML.
 */
const cssStore = new Map<string, CSSStyleSheet>();

let isFirstRun = true;
initWebSocket({
  [MessageId.version](view, ws) {
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

    ws.send('she'); // IncomingMessageId.subscribe with hot_update and route_update
    ws.send('n' + location.pathname); // IncomingMessageId.set_url
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
    do {
      const routeId = reader.i32();
      if (routeId === -1 || routeId == undefined) break;
      const routePattern = reader.string32();
      if (routeMatch(routeId, routePattern)) {
        const isServerSide = serverSideRoutesUpdated.has(routeId);
        const cssCount = reader.u32();
        const cssArray = new Array<string>(cssCount);
        for (let i = 0; i < cssCount; i++) {
          cssArray[i] = reader.stringWithLength(16);
        }
        console.log('oh shit', { routePattern, cssArray, isServerSide });

        // Skip to the last route
        const nextRouteId = reader.i32();
        while(nextRouteId != -1) {
          reader.string32();
          reader.cursor += 16 * reader.u32();
        }
        break;
      } else {
        // Skip to the next route
        reader.cursor += 16 * reader.u32();
      }
    } while(true);
    // List 3
    {
      let i = reader.u32();
      while (i--) { 
        const identifier = reader.stringWithLength(16);
        const code = reader.string32();
        console.log('css mutation', { code, identifier });
      }
    }
    // JavaScript modules
    if (reader.hasMoreData()) {
      const code = td.decode(reader.rest());
      const modules = (0, eval)(code);
      replaceModules(modules);
    }
  },
  // [MessageId.route_update](view) {
  //   const reader = new DataViewReader(view, 1);
  //   let routeCount = reader.u32();

  //   while (routeCount > 0) {
  //     routeCount -= 1;
  //     const routeId = reader.u32();
  //     const routePattern = reader.string32();
  //     if (routeMatch(routeId, routePattern)) {
  //       performRouteReload();
  //       break;
  //     }
  //   }
  // },
  [MessageId.errors]: onErrorMessage,
});

function reloadCss(id: string, newContent: string) {
  console.log(`[Bun] Reloading CSS: ${id}`);

  // TODO: can any of the following operations throw?
  let sheet = cssStore.get(id);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replace(newContent);
    document.adoptedStyleSheets.push(sheet);
    cssStore.set(id, sheet);

    // Delete the link tag if it exists
    document.querySelector(`link[href="/_bun/css/${id}.css"]`)?.remove();
    return;
  }

  sheet.replace(newContent);
}
