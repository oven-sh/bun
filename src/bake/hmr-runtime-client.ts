// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";
import { onErrorClearedMessage, onErrorMessage } from "./client/overlay";
import { Bake } from "bun";
import { td } from "./shared";
import { DataViewReader } from "./client/reader";
import { routeMatch } from "./client/route";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./enums";

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

initWebSocket({
  [MessageId.version](view) {
    // TODO: config.version and verify everything is sane
    console.log("VERSION: ", td.decode(view.buffer.slice(1)));
  },
  [MessageId.hot_update](view) {
    const code = td.decode(view.buffer);
    const modules = (0, eval)(code);
    replaceModules(modules);
  },
  [MessageId.errors]: onErrorMessage,
  [MessageId.errors_cleared]: onErrorClearedMessage,
  [MessageId.route_update](view) {
    const reader = new DataViewReader(view, 1);
    let routeCount = reader.u32();

    while (routeCount > 0) {
      routeCount -= 1;
      const routeId = reader.u32();
      const routePattern = reader.stringWithLength(reader.u16());
      if (routeMatch(routeId, routePattern)) {
        performRouteReload();
        break;
      }
    }
  },
});
