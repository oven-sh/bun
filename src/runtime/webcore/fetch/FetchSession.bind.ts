import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;

export const FetchSession = b.class({
  rustPath: "crate::webcore::fetch::FetchSession",
  refCounted: true,
  finalize: true,
  construct: { args: { init: b.any }, ...js, passStructure: true, length: 0 },
  internalFields: ["checkServerIdentity"],
  proto: {
    close: {},
    fetch: { getter: b.any, cache: true, passThis: true, ...js },
    "@@dispose": { rustName: "close" },
  },
});
