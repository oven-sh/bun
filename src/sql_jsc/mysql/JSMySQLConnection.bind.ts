import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export const MySQLConnection = b.class({
  rustPath: "crate::mysql::js_my_sql_connection::JSMySQLConnection",
  refCounted: true,
  finalize: true,
  /** src/js/private.d.ts declares PostgresSQLConnection as an extension of this interface. Neither class extends the other. */
  types: [table.viewType("$Bindgen.MySQLConnection")],
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform"],
  proto: {
    close: { capability: "js" },
    flush: {},
    hold: {},
    inTransaction: { getter: b.bool },
    unhold: { capability: "js" },
  },
});
