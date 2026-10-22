import * as b from "../../codegen/bindgen-lib.ts";

export const MySQLConnection = b.class({
  rustPath: "crate::mysql::js_my_sql_connection::JSMySQLConnection",
  refCounted: true,
  finalize: true,
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform"],
  proto: {
    close: { capability: "js", rustName: "do_close" },
    flush: { rustName: "do_flush" },
    hold: { rustName: "do_hold" },
    inTransaction: { getter: b.bool },
    unhold: { capability: "js", rustName: "do_unhold" },
  },
});
