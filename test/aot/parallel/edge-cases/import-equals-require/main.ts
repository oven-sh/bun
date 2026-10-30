// `import x = require(..)` of CommonJS files, TypeScript modules and JSON.
declare const console: { log(...values: unknown[]): void };
console.log("main starts");
import lib = require("./lib.cjs");
import m = require("./esm");
import fn = require("./fn.cjs");
import data = require("./data.json");
import n = require("./named");
console.log(lib.k, lib.f(), m.k, m.twice(4), fn(1), (fn as any).extra, data.name, data.list.length);
m.bump(); console.log(m.count, Object.keys(m).sort().join());
const held = m; console.log(held.k, typeof held.twice);
console.log((m as any).__esModule, "__esModule" in m, Object.keys(m).sort().join());
declare function require(name: string): any;
const r = require("./named"); console.log(Object.keys(n).join(), Object.keys(r).join(), (n as unknown) === r);
