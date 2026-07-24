// The control-channel message-type table from node's lib/internal/worker/io.js.
// Exposed as `internal/worker/io` (gated like `internal/test/binding`) for the
// vendored node test suite; values must match node's exactly — they travel over
// the wire to the hub in internal/worker/messaging.ts.
const messageTypes = {
  UP_AND_RUNNING: "upAndRunning",
  COULD_NOT_SERIALIZE_ERROR: "couldNotSerializeError",
  ERROR_MESSAGE: "errorMessage",
  STDIO_PAYLOAD: "stdioPayload",
  STDIO_WANTS_MORE_DATA: "stdioWantsMoreData",
  LOAD_SCRIPT: "loadScript",
};

export default { messageTypes };
