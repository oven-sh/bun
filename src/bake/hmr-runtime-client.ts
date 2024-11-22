// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { Bake } from "bun";
import { onErrorClearedMessage, onErrorMessage } from "./client/overlay";
import { DataViewReader } from "./client/reader";
import { routeMatch } from "./client/route";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./generated";
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";
import { td } from "./shared";

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
  [MessageId.version](view) {
    if (td.decode(view.buffer.slice(1)) !== config.version) {
      console.error("Version mismatch, hard-reloading");
      location.reload();
    }

    if (isFirstRun) {
      isFirstRun = false;
      return;
    }

    // It would be possible to use `performRouteReload` to do a hot-reload,
    // but the issue lies in possibly outdated client files. For correctness,
    // all client files have to be HMR reloaded or proven unchanged.
    // Configuration changes are already handled by the `config.version` data.
    location.reload();
  },
  [MessageId.hot_update](view) {
    const reader = new DataViewReader(view, 1);

    const cssCount = reader.u32();
    if (cssCount > 0) {
      for (let i = 0; i < cssCount; i++) {
        const moduleId = reader.stringWithLength(16);
        const content = reader.string32();
        reloadCss(moduleId, content);
      }
    }

    if (reader.hasMoreData()) {
      const code = td.decode(reader.rest());
      const modules = (0, eval)(code);
      replaceModules(modules);
    }
  },
  [MessageId.route_update](view) {
    const reader = new DataViewReader(view, 1);
    let routeCount = reader.u32();

    while (routeCount > 0) {
      routeCount -= 1;
      const routeId = reader.u32();
      const routePattern = reader.string32();
      if (routeMatch(routeId, routePattern)) {
        performRouteReload();
        break;
      }
    }
  },
  [MessageId.errors]: onErrorMessage,
  [MessageId.errors_cleared]: onErrorClearedMessage,
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
