// RUN: link
// CHECK: module {{*}}path="#{{*}}exportRule=CommonJs{{*}}syntheticExports=[{name="hidden" variable=

// The object has the name, and whoever lists its names passes over it: the face captures, the copy stays empty, and the check throws as the link of plain Bun does.
import { hidden, alias } from "./imports/values-that-are-not-enumerable/crate-with-a-getter.cjs";
console.log(hidden, alias);
