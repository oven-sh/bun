// RUN: lower
// DIAGNOSTIC: TS1109 node_modules/plain/index.ts:1

// FILE: main.ts
import { total } from "plain";
console.log(total(1));

// FILE: package.json
{"name":"app"}

// FILE: broken.ts
export function total(a: number) { return a +; }

// FILE: node_modules/plain/package.json
{"name":"plain","version":"1.0.0","exports":"./index.ts"}

// FILE: node_modules/plain/index.ts
export function total(a: number) { return a +; }

// FILE: node_modules/typed/package.json
{"name":"typed","version":"1.0.0","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}}}

// FILE: node_modules/typed/index.js
export function total(a) { return a; }

// FILE: node_modules/typed/index.aot.ts
export function total(a: number) { return a +; }
