// A call loads barrel.mjs, so the files below it wait for a call, and their package says that nothing is lost without them. What is taken of them out of sight keeps the way:
// `c` is a name of inner.cjs that middle.mjs hands on by a star whose names show in the run, and the link finds `e` behind the two stars of stars.mjs.
// Nothing is taken of unused.mjs, which goes.
// RUN: link
// CHECK: module [[inner]] path="{{*}}inner.cjs"
// CHECK: module [[innerFacade]] path="#{{*}}requests=[{target=[[inner]] kind=Require completes=true}] syntheticExports=[{name="c"
// CHECK: module [[middle]] path="{{*}}middle.mjs" {{*}}requests=[{target=[[innerFacade]] isDynamicStarExport=true completes=true}]
// CHECK: module [[other]] path="{{*}}other.cjs"
// CHECK: module [[otherFacade]] path="#{{*}}requests=[{target=[[other]] kind=Require completes=true}]
// CHECK: module [[stars]] path="{{*}}stars.mjs" {{*}}requests=[{target=[[innerFacade]] isDynamicStarExport=true completes=true}, {target=[[otherFacade]] isDynamicStarExport=true completes=true}]
// CHECK: module [[index]] path="{{*}}index.mjs" {{*}}requests=[{target=[[middle]] completes=true}, {target=[[stars]] completes=true}] requiredNames=
// CHECK: module {{*}}barrel.mjs" {{*}}requests=[{target=[[innerFacade]] completes=true isHoisted=true}, {target=[[otherFacade]] completes=true isHoisted=true}, {target=[[index]] completes=true}] exports=

// FILE: main.cjs
const required = require("./barrel.mjs");
console.log(required.c, required.e);

// FILE: barrel.mjs
export { c, e } from "./index.mjs";

// FILE: index.mjs
import { c } from "./middle.mjs";
import { unused } from "./unused.mjs";
export { c };
export { e } from "./stars.mjs";

// FILE: middle.mjs
export * from "./inner.cjs";

// FILE: stars.mjs
export * from "./inner.cjs";
export * from "./other.cjs";

// FILE: inner.cjs
exports.c = 1.5;

// FILE: other.cjs
exports.e = 5;

// FILE: unused.mjs
console.log("unused.mjs runs");
export const unused = 1;

// FILE: package.json
{ "name": "without-side-effects", "sideEffects": false }
