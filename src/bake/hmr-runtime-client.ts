// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";
import { showErrorOverlay } from "./client/overlay";
import { Bake } from "bun";
import { int } from "./macros" with { type: "macro" };

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

try {
  const main = loadModule<Bake.ClientEntryPoint>(config.main, LoadModuleType.AssertPresent);

  const { onServerSideReload, ...rest } = main.exports;
  if (Object.keys(rest).length > 0) {
    console.warn(
      `Framework client entry point (${config.main}) exported unknown properties, found: ${Object.keys(rest).join(", ")}`,
    );
  }

  const td = new TextDecoder();

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
          try {
            if (onServerSideReload) {
              onServerSideReload();
            } else {
              location.reload();
            }
          } catch (err) {
            if (IS_BUN_DEVELOPMENT) {
              return showErrorOverlay(err);
            }

            location.reload();
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
