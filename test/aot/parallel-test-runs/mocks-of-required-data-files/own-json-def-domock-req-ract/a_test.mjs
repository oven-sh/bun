const show = it => it === null || typeof it !== "object" ? typeof it + " " + String(it).trim() : Object.keys(it).sort().join() + " " + [it.v, it.n, typeof it.default].join();
import m from "./m.json"; import { test } from "bun:test"; test("p", () => console.log("SAID pre", show(m)));
