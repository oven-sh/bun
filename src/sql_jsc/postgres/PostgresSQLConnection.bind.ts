import * as b from "../../codegen/bindgen-lib.ts";

export const PostgresSQLConnection = b.class({
  rustPath: "crate::postgres::PostgresSQLConnection",
  refCounted: true,
  finalize: true,
  internalFields: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform", "onnotification"],
  proto: {
    close: { capability: "js", rustName: "do_close" },
    flush: {},
    hold: { passVm: true },
    inTransaction: { getter: b.bool },
    onnotification: { setter: true, internalField: "onnotification" },
    ref: { passVm: true },
    sasl: { getter: b.bool },
    unhold: { capability: "js" },
  },
});
