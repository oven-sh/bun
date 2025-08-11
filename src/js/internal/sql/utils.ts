const { hideFromStack } = require("../shared.ts");

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}
hideFromStack(connectionClosedError);

function notTaggedCallError() {
  return $ERR_POSTGRES_NOT_TAGGED_CALL("Query not called as a tagged template literal");
}
hideFromStack(notTaggedCallError);

function escapeIdentifier(str: string) {
  return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
}

export default {
  connectionClosedError,
  notTaggedCallError,
  escapeIdentifier,
};
