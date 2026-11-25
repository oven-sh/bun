// RUN: link
// CHECK: module {{*}}path="#{{*}}exports=[{{*}}{name="alias" variable=
// RUN(HIDDEN): link
// HIDDEN-NOT: {name="hidden" variable=

// Plain Bun asks an object that has an accessor for its names, and the object of a marked file for the enumerable ones alone.
const { hidden, alias } = await import("./imports/values-that-are-not-enumerable/crate-with-a-getter.cjs");
console.log(hidden, alias);
