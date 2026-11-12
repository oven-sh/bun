// What a file makes for itself is kept for the files that import it only where the real createRequire made it: that is asked of the maker when the program runs.
// In `createRequire.call(undefined, import.meta.url)` the function that is called is Function.prototype.call; the maker is what it was called on.
// RUN: lower
// CHECK: [[receiver]] = CheckInitialized {{*}} name="createRequire"
// CHECK-NEXT: [[called]] = PropGet [[receiver]] key="call"
// CHECK: [[call]] = Builtin builtin=FunctionPrototypeCall
// CHECK-NEXT: [[isCall]] = StrictEq [[called]], [[call]]
// CHECK-NEXT: Branch [[isCall]] -> taken [[byCall]](), notTaken [[held]]([[called]])
// CHECK: [[byCall]]():
// CHECK-NEXT: Jump -> next [[held]]([[receiver]])
// CHECK: [[held]]([[maker]]):
// CHECK-NEXT: [[made]] = Call [[called]], [[receiver]],
// CHECK-NEXT: [[real]] = Builtin builtin=NodeModuleCreateRequire
// CHECK-NEXT: = StrictEq [[maker]], [[real]]
// CHECK: = Builtin builtin=WeakSetPrototypeAdd
// CHECK-NEXT: = Call {{*}}, {{*}}, [[made]]

// FILE: main.mjs
import { createRequire } from "node:module";
import "./asks.mjs";
export const first = createRequire.call(undefined, import.meta.url);

// FILE: asks.mjs
import { first } from "./main.mjs";
export const ask = () => first("./value.cjs");

// FILE: value.cjs
module.exports = "the value";
