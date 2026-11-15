import { createRequire } from "node:module";
import { basename as base } from "node:path";
createRequire(import.meta.url)("./leaf.cjs");
const p = globalThis.leaf.parent;
console.log("SAID leaf: parent " + (p === undefined ? "undefined" : p === null ? "null" : "an object with the id " + base(String(p.id)) + " whose children are [" + p.children.map(c => c === globalThis.leaf ? "LEAF" : base(String(c.id))).join("+") + "]"));
