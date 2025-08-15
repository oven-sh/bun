const { hideFromStack } = require("../shared.ts");
const { PostgresError } = require("./errors");

function connectionClosedError() {
  return new PostgresError("Connection closed", {
    code: "ERR_POSTGRES_CONNECTION_CLOSED",
    detail: "",
    hint: "",
    severity: "ERROR",
  });
}
hideFromStack(connectionClosedError);

function notTaggedCallError() {
  return new PostgresError("Query not called as a tagged template literal", {
    code: "ERR_POSTGRES_NOT_TAGGED_CALL",
    detail: "",
    hint: "",
    severity: "ERROR",
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
