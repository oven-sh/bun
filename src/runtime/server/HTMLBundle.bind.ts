import * as b from "../../codegen/bindgen-lib.ts";

export const HTMLBundle = b.class({
  rustPath: "crate::server::html_bundle::HTMLBundle",
  refCounted: true,
  configurable: false,
  proto: {
    index: { getter: b.string.utf8, cache: true },
  },
});
