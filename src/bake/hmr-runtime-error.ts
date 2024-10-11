// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `DevServer.sendSerializedFailures`. SSR is
// left unused for simplicity; a flash of unstyled content is

/** Injected by DevServer */
declare const error: Uint8Array;

console.log(error);

import { decodeSerializedErrorPayload } from "./client/error-serialization";

// stopped by the fact this script runs synchronously.
const decoded = decodeSerializedErrorPayload(new DataView(error.buffer), 0);
console.log(decoded);

document.write(`<pre><code>${JSON.stringify(decoded, null, 2)}</code></pre>`);