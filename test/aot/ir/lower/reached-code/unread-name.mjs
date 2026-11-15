// RUN: link
// CHECK: displayPath="helper.mjs"{{*}}body=[[body]] positions=

// FILE: main.mjs
import { made } from "./helper.mjs";
console.log(made);
await import("./free.mjs");

// FILE: helper.mjs
import { free } from "./free.mjs";
export const made = 1;

// FILE: free.mjs
console.log("free runs");
export const free = 1;

// FILE: package.json
{ "name": "z", "sideEffects": false }
