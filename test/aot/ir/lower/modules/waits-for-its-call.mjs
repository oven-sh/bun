// Calls load four files that say nothing is lost without them. Until a call is made, only a statement that takes something of such a file runs it:
// taken.mjs, whose name comes through the index that is left out, and used.mjs. Nothing is taken of beside.mjs behind the same index, nor by the imports of bare.mjs.
// RUN: link
// CHECK: module [[definer]] path="{{*}}definer.mjs"
// CHECK: module [[taken]] path="{{*}}taken.mjs"
// CHECK: module [[used]] path="{{*}}used.mjs"
// CHECK: module {{*}}page.mjs" {{*}}requests=[{target=[[definer]] completes=true}, {target=[[taken]] completes=true}, {target=[[used]] completes=true}] positions=

// FILE: main.mjs
export { later } from "./page.mjs";

// FILE: page.mjs
import { a, taken } from "./index.mjs";
import "./bare.mjs";
import { unused } from "./bare.mjs";
import { used } from "./used.mjs";
export const later = () => [import("./beside.mjs"), import("./taken.mjs"), import("./bare.mjs"), import("./used.mjs")];
console.log(a(), taken(), used());

// FILE: index.mjs
export * from "./definer.mjs";
export * from "./beside.mjs";
export * from "./taken.mjs";

// FILE: definer.mjs
console.log("definer.mjs runs");
export function a() {
  return "a";
}

// FILE: beside.mjs
console.log("beside.mjs runs");
export function beside() {
  return "beside";
}

// FILE: taken.mjs
console.log("taken.mjs runs");
export function taken() {
  return "taken";
}

// FILE: bare.mjs
console.log("bare.mjs runs");
export function unused() {
  return "unused";
}

// FILE: used.mjs
console.log("used.mjs runs");
export function used() {
  return "used";
}

// FILE: package.json
{ "name": "without-side-effects", "sideEffects": false }
