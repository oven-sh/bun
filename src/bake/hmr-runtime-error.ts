// When a bundling error happens, we cannot load any of the users code, since
// that code expects the SSR step to succeed. This version of client just opens
// a websocket and listens only for error resolution events, and reloads the
// page.
//
// This is embedded in `error.template.html`. SSR is not needed
const errorPayloadElement = document.getElementById("bun-error-payload")!;
