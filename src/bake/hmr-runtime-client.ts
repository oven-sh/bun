// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";
import { showErrorOverlay } from "./client/overlay";
import { Bake } from "bun";
import { int } from "./macros" with { type: "macro" };
import { td } from "./text-decoder";
import { DataViewReader } from "./client/reader";
import { routeMatch } from "./client/route";

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
        return showErrorOverlay(err);
      }
    }
  }

  // Fallback for when reloading fails or is not implemented by the framework is
  // to hard-reload.
  location.reload();
}

try {
  const main = loadModule<Bake.ClientEntryPoint>(config.main, LoadModuleType.AssertPresent);

  var { onServerSideReload, ...rest } = main.exports;
  if (Object.keys(rest).length > 0) {
    console.warn(
      `Framework client entry point (${config.main}) exported unknown properties, found: ${Object.keys(rest).join(", ")}`,
    );
  }

  const enum SocketState {
    Connecting,
    Connected,
  }

  let state = SocketState.Connecting;

  function initHmrWebSocket() {
    const ws = new WebSocket("/_bun/hmr");
    ws.binaryType = "arraybuffer";
    ws.onopen = ev => {
      console.log("HMR socket open!");
      state = SocketState.Connected;
    };
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      const { data } = ev;
      if (typeof data === "string") return data;
      const view = new DataView(data);
      // See hmr-protocol.md
      switch (view.getUint8(0)) {
        case int("V"): {
          console.log("VERSION", data);
          break;
        }
        case int("("): {
          const code = td.decode(data);
          const modules = (0, eval)(code);
          replaceModules(modules);
          break;
        }
        case int("R"): {
          const reader = new DataViewReader(view, 1);
          let routeCount = reader.u32();

          while (routeCount > 0) {
            routeCount -= 1;
            const routeId = reader.u32();
            const routePattern = reader.string(reader.u16());
            if (routeMatch(routeId, routePattern)) {
              performRouteReload();
              break;
            }
          }

          break;
        }
        default: {
          if (IS_BUN_DEVELOPMENT) {
            return showErrorOverlay(
              new Error("Unknown WebSocket Payload ID: " + String.fromCharCode(view.getUint8(0))),
            );
          }
          location.reload();
          break;
        }
      }
    };
    ws.onclose = ev => {
      // TODO: visual feedback in overlay.ts
      // TODO: reconnection
    };
    ws.onerror = ev => {
      console.error(ev);
    };
  }

  initHmrWebSocket();
} catch (e) {
  if (side !== "client") throw e;
  showErrorOverlay(e);
}
