// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is
// stopped by the fact this script runs synchronously.
import { DataViewReader, DataViewWriter } from "./client/data-view";
import { decodeAndAppendServerError, onServerErrorPayload, updateErrorOverlay } from "./client/overlay";
import { initWebSocket } from "./client/websocket";
import "./debug";
import { IncomingMessageId, MessageId } from "./generated";

/** Injected by DevServer */
declare const error: Uint8Array<ArrayBuffer>;

/** The owner of every failure this page was rendered with. */
const embeddedOwners: number[] = [];
{
  const reader = new DataViewReader(new DataView(error.buffer), 0);
  while (reader.hasMoreData()) {
    try {
      embeddedOwners.push(decodeAndAppendServerError(reader));
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
    // A build that finished between this page being rendered and the
    // subscribe above published its `errors` frame to nobody. Ask which of
    // the embedded failures are already resolved; the reply is an `errors`
    // frame that removes them.
    const check = DataViewWriter.initCapacity(1 + 4 * embeddedOwners.length);
    check.u8(IncomingMessageId.check_errors);
    for (const owner of embeddedOwners) {
      check.u32(owner);
    }
    ws.send(check.view.buffer);
  },

  [MessageId.errors]: onServerErrorPayload,
});
