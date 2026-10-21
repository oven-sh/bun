import * as b from "../../codegen/bindgen-lib.ts";

export const PostgresSQLConnection = b.class({
  rustPath: "crate::postgres::PostgresSQLConnection",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform", "onnotification"],
  proto: {
    close: { rustName: "do_close", capability: "js" },
    flush: { rustName: "do_flush" },
    hold: { rustName: "do_hold" },
    inTransaction: { getter: b.bool },
    onnotification: { internalField: "onnotification", setter: true },
    ref: { rustName: "do_ref" },
    sasl: { getter: b.bool },
    unhold: { rustName: "do_unhold", capability: "js" },
  },
});
