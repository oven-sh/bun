import * as b from "../../codegen/bindgen-lib.ts";

/** A matcher call waiting on a promise. */
export const ExpectDeferred = b.class({
  rustPath: "crate::test_runner::expect_core::expect_deferred::ExpectDeferred",
  internalFields: ["expect", "call", "promise", "callSite", "awaited", "journal"],
});
