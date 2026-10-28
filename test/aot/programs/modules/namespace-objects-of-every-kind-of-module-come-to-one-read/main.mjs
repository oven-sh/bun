// One read, `node.wanted`, of code that does not know what it is handed, meets the namespace objects of modules of every kind: ES modules that export the name and that do not, one that calls require(),
// one that exports everything of another, a file of data, a CommonJS file, a module whose evaluation is put off until it is read, and objects that are no namespace object but look like one.
import { createRequire } from "node:module";
import * as first from "./first.mjs";
import * as second from "./second.mjs";
import * as without from "./without.mjs";
import * as requiring from "./requiring.mjs";
import * as starred from "./starred.mjs";
import * as data from "./data.json";
import * as file from "./file.cjs";
const require = createRequire(import.meta.url);
const lines = [];
const read = node => node.wanted;
const readOther = node => node.other;
const asked = node => ("wanted" in node) + " " + Object.hasOwn(node, "wanted") + " " + Object.keys(node).join();
const late = await import("./late.mjs");
const again = await import("./first.mjs");
const required = require("./first.mjs");
const nodes = { first, second, without, requiring, starred, data, file, late, again, required, plain: { wanted: "of a plain object" }, heir: Object.create(first), copy: { ...first }, bare: Object.assign(Object.create(null), { wanted: "of a bare object" }), proxy: new Proxy(second, {}) };
for (let turn = 0; turn < 3; turn++) {
  const said = [];
  for (const name in nodes) said.push(name + " " + String(read(nodes[name])) + " " + String(readOther(nodes[name])));
  if (turn === 2) lines.push(said.join(" | "));
}
for (const name in nodes) lines.push(name + ": " + asked(nodes[name]));
lines.push([again === first, required === first, late === first, nodes.copy === first].join());
first.change("changed");
lines.push(Object.keys(nodes).map(name => String(read(nodes[name]))).join(" | "));
let seen = 0;
const list = Object.values(nodes);
for (let turn = 0; turn < 3000; turn++) for (const node of list) if (read(node) !== undefined) seen++;
lines.push("rounds " + seen);
console.log(lines.join("\n"));
