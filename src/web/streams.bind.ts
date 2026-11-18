import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::streams", feature: "Desktop", membersInTable: false });

const js = { capability: "js", throws: true } as const;

export const IncomingBody = b.class({
  rustPath: "crate::streams::IncomingBody",
  internalFields: ["stream"],
  proto: {
    pull: { args: { controller: b.any }, returns: b.any, ...js },
    cancel: {},
    read: { returns: b.any, ...js },
    readAll: { returns: b.any, ...js },
    body: { getter: b.any, cache: "stream", passThis: true, ...js },
  },
});
