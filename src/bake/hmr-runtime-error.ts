// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is

import { decodeSerializedErrorPayload } from "./client/error";

// stopped by the fact this script runs synchronously.
const errorPayloadElement = document.getElementById("bun-error-payload")!;
const arrayBuffer = new ArrayBuffer(0);
const decoded = decodeSerializedErrorPayload(new DataView(arrayBuffer), 0);
console.log(decoded);
