import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;

export const FetchSession = b.class({
  rustPath: "crate::webcore::fetch::FetchSession",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["checkServerIdentity"],
  construct: { args: { options: b.any }, ...js, passStructure: true, length: 0 },
  proto: {
    close: {},
    fetch: { getter: b.any, cache: true, passThis: true, ...js },
    "@@dispose": { rustName: "close" },
  },
});
