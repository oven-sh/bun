// RUN(MODULES): link
// MODULES: module [[owner]] path="{{*}}/owner.cjs"
// MODULES-NEXT: module [[h1]] path="{{*}}/h1.cjs" {{*}}requests=[{target=[[owner]] kind=Require completes=true}]
// MODULES-NEXT: module [[h2]] path="{{*}}/h2.mjs" {{*}}requests=[{target=[[h1]] completes=true isHoisted=true}, {target=[[h1]] completes=true}]
// MODULES-NEXT: module [[h3]] path="{{*}}/h3.cjs" {{*}}requests=[{target=[[h2]] kind=Require completes=true}]

// FILE: main.cjs
// `x` of h3.cjs stands for `x` of owner.cjs, which nothing loads but h1.cjs. h2.mjs shows the name of h1.cjs, not that of owner.cjs: it hands on what the getter of h1.cjs returns all the same, so its statement runs.
var { x } = require("./h3.cjs");
console.log("x is " + x);

// FILE: h1.cjs
var dep_1 = require("./owner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return dep_1.x; } });

// FILE: h2.mjs
export { x } from "./h1.cjs";

// FILE: h3.cjs
var dep_1 = require("./h2.mjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return dep_1.x; } });

// FILE: owner.cjs
exports.x = "five";

// FILE: package.json
{ "name": "app", "version": "1.0.0", "sideEffects": false }
