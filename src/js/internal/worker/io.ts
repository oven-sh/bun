// Control-channel message types from node's lib/internal/worker/io.js; the values go over the wire.
const messageTypes = {
  UP_AND_RUNNING: "upAndRunning",
  COULD_NOT_SERIALIZE_ERROR: "couldNotSerializeError",
  ERROR_MESSAGE: "errorMessage",
  STDIO_PAYLOAD: "stdioPayload",
  STDIO_WANTS_MORE_DATA: "stdioWantsMoreData",
  LOAD_SCRIPT: "loadScript",
};

export default { messageTypes };
