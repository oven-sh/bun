// Writes the source tree of the application the order file's app workloads run.
//
//   bun scaffold.js <outdir>
//
// What matters is the shape of the module graph: a large compiled CLI starts
// by linking several hundred modules out of the executable, and that is a
// different part of bun from running one script. So the app has
//   - 360 ES modules with classes, private fields, JSON imports and a chain of
//     dependencies between them,
//   - 120 CommonJS modules imported from ESM in all three forms, so the
//     bundler's interop helpers run,
//   - namespace imports of builtins and of its own modules,
//   - 40 dynamically imported chunks (with --splitting), one of which
//     re-exports a builtin with `export *`,
//   - six CommonJS files that are separate entry points, so they are embedded
//     in the executable and `require()`d at run time rather than bundled.
// The entry module then hands over to features.js, which runs whatever
// ORDERFILE_FEATURES names. main.js deliberately does not await the entry: a
// top-level await there would keep the process in the module loader's wait
// loop instead of the event loop a long-running application sits in.
import fs from "node:fs";
import path from "node:path";

const MODULES = 360;
const CHUNKS = 40;
const COMMONJS = 120;
const NAMESPACES = 40;
const EMBEDDED = 6;

const range = (n, each) => Array.from({ length: n }, (_, i) => each(i));

function commonJsModule(i) {
  const previous = i ? `require("./c${i - 1}.cjs")` : "{ depth: 0 }";
  return `"use strict";
const prev = ${previous};
const util = { id: ${i}, name: "pkg${i}" };
function helper${i}(x) { return typeof x === "number" ? x * ${(i % 5) + 1} : String(x).length; }
class Thing${i} { constructor(o) { Object.assign(this, o); } get size() { return Object.keys(this).length; } }
${range(12, k => `exports.k${k} = ${k % 3 ? `"v${i}_${k}"` : `helper${i}`};`).join("\n")}
exports.Thing = Thing${i};
exports.depth = prev.depth + 1;
exports.util = util;
Object.defineProperty(exports, "lazy", { enumerable: true, get() { return util.id; } });
${i % 4 === 0 ? `module.exports.default = helper${i};` : ""}
`;
}

const JSX = `export const Fragment = Symbol.for("frag");
export function h(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; }
export function renderToString(n) {
  if (n == null || n === false) return "";
  if (typeof n !== "object") return String(n);
  if (typeof n.type === "function") return renderToString(n.type({ ...n.props, children: n.children }));
  return n.children.map(renderToString).join(n.type === "row" ? " " : "");
}
`;

function esModule(i) {
  const deps = [i - 1, i - 7, (i * 13) % MODULES].filter(d => d >= 0 && d < i);
  const hasConfig = i % 20 === 0;
  return `${deps.map(d => `import { C${d}, f${d} } from "./m${d}.js";`).join("\n")}
${hasConfig ? `import cfg${i} from "./c${i}.json";` : ""}
import { h } from "../jsx.js";
export class C${i} ${deps.length ? `extends C${deps[0]}` : ""} {
  #p = ${i};
  static tag = "C${i}";
  constructor(x) { ${deps.length ? "super(x);" : ""} this.x${i} = x ?? ${i}; }
  get v() { return this.#p + ${deps.length ? "super.v" : "0"}; }
  m${i}(a) { return a * ${(i % 7) + 1} + this.#p; }
}
export function f${i}(n) {
  let t = ${i};
  for (let k = 0; k < n; k++) t = (t * 31 + k) % 1000003;
  if (n > 1) { ${deps.map(d => `t += f${d}(n >> 1);`).join(" ")} }
  return t;
}
export const view${i} = (props) => h("row", null, "m${i}", props.label ?? "", ${hasConfig ? `cfg${i}.list.length` : "0"});
export const table${i} = Object.freeze({ ${range(12, k => `k${k}: "${"s".repeat(k)}${i}"`).join(", ")} });
export default { i: ${i}, C: C${i}, f: f${i} };
`;
}

function chunk(j) {
  const m = (j * 9) % MODULES;
  return `import * as lib from "../lib/m${m}.js";
import { renderToString, h } from "../jsx.js";
export async function run(n) {
  const c = new lib.C${m}(n);
  return renderToString(h("row", null, lib.view${m}({ label: "feat${j}" }), c.v, lib.f${m}(8)));
}
export const meta = ${JSON.stringify({ name: "feat" + j, deps: range(10, k => "d" + k) })};
`;
}

function embeddedCommonJs(i) {
  const next = i < EMBEDDED - 1 ? `require("./r${i + 1}.cjs")` : "{ depth: 0, names: [] }";
  return `"use strict";
const next = ${next};
const os = require("node:os");
module.exports = {
  depth: next.depth + 1,
  names: next.names.concat("r${i}"),
  dir: __dirname.length + __filename.length,
  platform: os.platform(),
  run(x) { return x * ${i + 2}; },
};
`;
}

const REEXPORTS = `export * from "node:os";
export * from "./lib/m3.js";
export * as nsx from "./lib/m4.js";
export { default as fsDefault } from "node:fs";
export * from "./jsx.js";
`;

function commonJsImport(i) {
  if (i % 3 === 0) return `import * as cjs${i} from "./cjs/c${i}.cjs";`;
  if (i % 3 === 1) return `import cjs${i} from "./cjs/c${i}.cjs";`;
  return `import { k0 as cjs${i}_k0, Thing as cjs${i}_Thing } from "./cjs/c${i}.cjs";`;
}

function entry(featuresModule) {
  return `${range(MODULES, i => `import m${i} from "./lib/m${i}.js";`).join("\n")}
${range(COMMONJS, commonJsImport).join("\n")}
${range(NAMESPACES, i => `import * as ns${i} from "./lib/m${i * 7}.js";`).join("\n")}
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeUtil from "node:util";
import { renderToString, h } from "./jsx.js";
const mods = [${range(MODULES, i => `m${i}`).join(", ")}];
let acc = 0;
for (const m of mods) { const o = new m.C(3); acc += o.v + o["m" + m.i](2) + m.f(4); }
const nsList = [${range(NAMESPACES, i => `ns${i}`).join(", ")}];
for (const ns of nsList) acc += Object.keys(ns).length + (typeof ns.default).length;
const cjsList = [${range(COMMONJS, i => (i % 3 === 2 ? `{ k0: cjs${i}_k0, Thing: cjs${i}_Thing }` : `cjs${i}`)).join(", ")}];
for (const c of cjsList) {
  const T = c.Thing ?? c.default?.Thing;
  if (T) acc += new T({ a: 1 }).size;
  acc += typeof c.k0 === "function" ? c.k0(3) : 0;
  acc += c.lazy | 0;
}
for (const ns of [nodePath, nodeOs, nodeUtil]) acc += Object.keys(ns).length;
const dynNs = await Promise.all([import("./reexp.js"), import("./lib/m7.js"), import("./jsx.js"), import("./cjs/c3.cjs")]);
for (const ns of dynNs) for (let k = 0; k < 400; k++) acc += Object.keys(ns).length + (typeof ns.default === "object" ? 1 : 0) + (ns.h ? 1 : 0) + (ns.f7 ? ns.f7(1) : 0);
const feats = await Promise.all([${range(CHUNKS, j => `import("./feat/feat${j}.js")`).join(", ")}]);
for (const f of feats) acc += (await f.run(5)).length + f.meta.deps.length;
console.log("app: " + mods.length + " modules, " + feats.length + " chunks, checksum " + (acc % 9973));
await (await import(${JSON.stringify(featuresModule)})).main();
`;
}

/** Writes the app under `out`. `here` is this directory: the entry imports features.js and net-server.js from it. */
function writeApp(out, here) {
  const src = path.join(out, "src");
  for (const dir of ["lib", "feat", "cjs", "rt"]) fs.mkdirSync(path.join(src, dir), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(src, file), text);

  for (let i = 0; i < COMMONJS; i++) write(`cjs/c${i}.cjs`, commonJsModule(i));
  write("jsx.js", JSX);
  for (let i = 0; i < MODULES; i++) {
    if (i % 20 === 0) {
      const list = range(30, k => ({ k, v: "value" + k }));
      write(`lib/c${i}.json`, JSON.stringify({ id: i, name: "config" + i, list }));
    }
    write(`lib/m${i}.js`, esModule(i));
  }
  for (let j = 0; j < CHUNKS; j++) write(`feat/feat${j}.js`, chunk(j));
  for (let i = 0; i < EMBEDDED; i++) write(`rt/r${i}.cjs`, embeddedCommonJs(i));
  write("reexp.js", REEXPORTS);
  // The same executable is also the workloads' server process (servers.js).
  const server = JSON.stringify(path.join(here, "net-server.js"));
  write("main.js", `if (process.argv[2] === "netserver") import(${server});\nelse import("./entry.js");\n`);
  write("entry.js", entry(path.join(here, "features.js")));
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: bun scaffold.js <outdir>");
  writeApp(path.resolve(out), import.meta.dir);
}
