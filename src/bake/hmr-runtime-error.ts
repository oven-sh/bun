// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is
// stopped by the fact this script runs synchronously.
import { decodeAndAppendError, onErrorMessage, updateErrorOverlay } from "./client/overlay";
import { DataViewReader } from "./client/reader";
import { initWebSocket } from "./client/websocket";
import { MessageId } from "./generated";

/** Injected by DevServer */
declare const error: Uint8Array<ArrayBuffer>;

{
  const reader = new DataViewReader(new DataView(error.buffer), 0);
  while (reader.hasMoreData()) {
    decodeAndAppendError(reader);
  }
  updateErrorOverlay();
}

let firstVersionPacket = true;

const ws = initWebSocket(
  {
    [MessageId.version](dv) {
      if (firstVersionPacket) {
        firstVersionPacket = false;
      } else {
        // On re-connection, the server may have restarted. The route that was
        // requested could be in unqueued state. A reload is the only way to
        // ensure this bundle is enqueued.
        location.reload();
      }
      ws.send("se"); // IncomingMessageId.subscribe with route_update
    },

    [MessageId.errors]: onErrorMessage,
  },
  { displayMessage: "Live-reloading socket" },
);
