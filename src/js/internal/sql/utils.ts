const { hideFromStack } = require("../shared.ts");
const { PostgresError } = require("./errors");

function connectionClosedError() {
  return new PostgresError("Connection closed", {
    code: "ERR_POSTGRES_CONNECTION_CLOSED",
  });
}
hideFromStack(connectionClosedError);

function notTaggedCallError() {
  return new PostgresError("Query not called as a tagged template literal", {
    code: "ERR_POSTGRES_NOT_TAGGED_CALL",
  });
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
