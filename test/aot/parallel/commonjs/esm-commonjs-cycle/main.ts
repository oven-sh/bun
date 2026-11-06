// ES modules and CommonJS modules importing each other.
import * as a from "./cjs/a.js"
import aDefault, { name, twice, Counter } from "./cjs/a.js"
import b from "./cjs/b.js"
import c, { named } from "./cjs/c.js"
import area from "./cjs/fn.js"
import umd from "./cjs/umd.js"
import data, { title } from "./cjs/data.json"
import { seen, late } from "./cjs/cycle1.js"
declare const require: (name: string) => any
console.log(name, twice(4), a.fromB, a.self, aDefault === (a as any).default, Object.keys(a).sort().join())
console.log(new (Counter as any)(1).bump().bump().count, Counter.create(5).bump().count, a.kinds)
console.log(b.value, b.later, b.computed, (globalThis as any).order.join())
console.log(typeof c, JSON.stringify(Object.keys(c as any)), named)
console.log(area(2, 3), (area as any).unit, umd.kind, data.title, title, data.list.length, data.nested.ok)
console.log(seen, late)
function lazy(): string { const esm = require("./cjs/esm.ts"); return esm.fromEsm + " " + esm.shout("x") + " " + esm.default }
console.log(lazy(), require("./cjs/b.js") === b, require("./cjs/data.json").list[2])
// So that the type checker, which does not look at `require` in TypeScript, loads the file.
function never() { return import("./cjs/esm.ts") }
import("./cjs/fn.js").then(ns => console.log(typeof ns.default, ns.default(3, 3), (ns as any).unit))
