// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is
// stopped by the fact this script runs synchronously.
import { DataViewReader } from "./client/data-view";
import { decodeAndAppendServerError, onServerErrorPayload, updateErrorOverlay } from "./client/overlay";
import { initWebSocket } from "./client/websocket";
import "./debug";
import { MessageId } from "./generated";

/** Injected by DevServer */
declare const error: Uint8Array<ArrayBuffer>;

{
  const reader = new DataViewReader(new DataView(error.buffer), 0);
  while (reader.hasMoreData()) {
    try {
      decodeAndAppendServerError(reader);
    } catch (e) {
      console.error(e);
      break;
    }
  }
  updateErrorOverlay();
}

let firstVersionPacket = true;

const ws = initWebSocket({
  [MessageId.version](dv) {
    if (firstVersionPacket) {
      firstVersionPacket = false;
    } else {
      // On re-connection, the server may have restarted. The route that was
      // requested could be in unqueued state. A reload is the only way to
      // ensure this bundle is enqueued.
      location.reload();
    }
    ws.send("se"); // IncomingMessageId.subscribe with errors
  },

  [MessageId.errors]: onServerErrorPayload,
});
