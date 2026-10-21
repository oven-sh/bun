import * as b from "../../codegen/bindgen-lib.ts";

export const MySQLConnection = b.class({
  rustPath: "crate::mysql::js_my_sql_connection::JSMySQLConnection",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform"],
  proto: {
    close: { rustName: "do_close", capability: "js" },
    flush: { rustName: "do_flush" },
    hold: { rustName: "do_hold" },
    inTransaction: { getter: b.bool },
    unhold: { rustName: "do_unhold", capability: "js" },
  },
});
