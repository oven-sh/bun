// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is
import { decodeSerializedErrorPayload } from "./client/error-serialization";
import { int } from "./macros" with { type :"macro"};

/** Injected by DevServer */
declare const error: Uint8Array;

// stopped by the fact this script runs synchronously.
{
  const decoded = decodeSerializedErrorPayload(new DataView(error.buffer), 0);
  console.log(decoded);

  document.write(`<pre><code id='err'>${JSON.stringify(decoded, null, 2)}</code></pre>`);
}

// TODO: write a shared helper for websocket that performs reconnection
// and handling of the version packet

function initHmrWebSocket() {
  const ws = new WebSocket("/_bun/hmr");
  ws.binaryType = "arraybuffer";
  ws.onopen = ev => {
    console.log("HMR socket open!");
  };
  ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
    const { data } = ev;
    if (typeof data === "string") return data;
    const view = new DataView(data);
    switch (view.getUint8(0)) {
      case int("R"): {
        location.reload();
        break;
      }
      case int("e"): {
        const decoded = decodeSerializedErrorPayload(view, 1); 
        document.querySelector('#err')!.innerHTML = JSON.stringify(decoded, null, 2);
        break;
      }
      case int("c"): {
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
