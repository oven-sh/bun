import * as b from "../../codegen/bindgen-lib.ts";
import { PostgresSQLConnection } from "./PostgresSQLConnection.bind.ts";

const js = { capability: "js", throws: true } as const;

export const PostgresSQLQuery = b.class({
  rustPath: "crate::postgres::PostgresSQLQuery",
  refCounted: true,
  finalize: true,
  estimatedSize: true,
  internalFields: ["pendingValue", "target", "binding", "copy"],
  proto: {
    cancel: { capability: "js" },
    copyDone: { capability: "js" },
    copyFail: { args: { message: b.string.loose.utf8 }, capability: "js" },
    copyResume: {},
    copyWrite: { ...js, args: { chunk: b.any }, returns: b.bool },
    describeResult: { ...js, args: { number: b.any }, returns: b.any.returning("object", "null") },
    run: { ...js, args: { connection: PostgresSQLConnection, query: b.any }, passThis: true },
    setCopy: { args: { callback: b.any, writable: b.bool.loose }, capability: "js", passThis: true },
    setMode: { ...js, args: { mode: b.any } },
    setPendingValue: {
      args: { value: b.any },
      capability: "js",
      passThis: true,
    },
  },
});
