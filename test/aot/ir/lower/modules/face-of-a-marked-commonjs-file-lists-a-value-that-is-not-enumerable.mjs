// RUN: link
// CHECK: module {{*}}path="#{{*}}exports=[{{*}}{name="hidden" variable=

// Plain Bun lists an object without accessors by its Structure, which has every name.
const { hidden } = await import("./imports/values-that-are-not-enumerable/crate.cjs");
console.log(hidden);
