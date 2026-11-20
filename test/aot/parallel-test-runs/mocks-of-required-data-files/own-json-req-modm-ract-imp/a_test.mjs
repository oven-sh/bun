const show = it => it === null || typeof it !== "object" ? typeof it + " " + String(it).trim() : Object.keys(it).sort().join() + " " + [it.v, it.n, typeof it.default].join();
import { test } from "bun:test"; import { createRequire } from "node:module"; const m = createRequire(import.meta.url)("./m.json"); test("p", () => console.log("SAID pre", show(m)));
