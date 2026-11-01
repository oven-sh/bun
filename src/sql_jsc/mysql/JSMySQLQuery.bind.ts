import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { MySQLConnection } from "./JSMySQLConnection.bind.ts";

const js = { capability: "js", throws: true } as const;

export const MySQLQuery = b.class({
  rustPath: "crate::mysql::js_my_sql_query::JSMySQLQuery",
  refCounted: true,
  finalize: true,
  estimatedSize: true,
  /** As for MySQLConnection. */
  types: [table.viewType("$Bindgen.MySQLQuery")],
  internalFields: ["pendingValue", "target", "binding"],
  proto: {
    cancel: { capability: "js" },
    describeResult: { ...js, args: { number: b.any }, returns: b.any.returning("object", "null") },
    run: { ...js, args: { connection: MySQLConnection, query: b.any }, passThis: true, rustName: "do_run" },
    setMode: { ...js, args: { mode: b.any } },
    setPendingValue: { args: { value: b.any }, rustName: "set_pending_value_from_js" },
  },
});
