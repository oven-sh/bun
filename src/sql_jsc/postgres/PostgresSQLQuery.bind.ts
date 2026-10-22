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
    cancel: { capability: "js", rustName: "do_cancel" },
    copyDone: { capability: "js" },
    copyFail: { args: { message: b.string.loose.utf8 }, capability: "js" },
    copyResume: {},
    copyWrite: { ...js, args: { chunk: b.any }, returns: b.bool },
    describeResult: { ...js, args: { number: b.any }, returns: b.any },
    run: { ...js, args: { connection: PostgresSQLConnection, query: b.any }, passThis: true, rustName: "do_run" },
    setCopy: { args: { callback: b.any, writable: b.bool.loose }, capability: "js", passThis: true },
    setMode: { ...js, args: { mode: b.any }, rustName: "set_mode_from_js" },
    setPendingValue: {
      args: { value: b.any },
      capability: "js",
      passThis: true,
      rustName: "set_pending_value_from_js",
    },
  },
});
