import * as b from "../../codegen/bindgen-lib.ts";

export const PostgresSQLConnection = b.class({
  rustPath: "crate::postgres::PostgresSQLConnection",
  refCounted: true,
  finalize: true,
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform", "onnotification"],
  proto: {
    close: { capability: "js", rustName: "do_close" },
    flush: { rustName: "do_flush" },
    hold: { rustName: "do_hold" },
    inTransaction: { getter: b.bool },
    onnotification: { setter: true, internalField: "onnotification" },
    ref: { rustName: "do_ref" },
    sasl: { getter: b.bool },
    unhold: { capability: "js", rustName: "do_unhold" },
  },
});
