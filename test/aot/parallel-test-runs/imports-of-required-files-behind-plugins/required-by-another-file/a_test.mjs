import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let asked = 0;
const said = [];
const show = m => m === undefined ? "undefined" : "n:" + (m.n ?? m.default?.n) + " run:" + (m.run ?? m.default?.run) + " default:" + typeof m.default;
const say = async (label, get) => { try { const m = await get(); said.push(label + " " + show(m) + " asked " + asked + " runs " + globalThis.runs); return m; } catch (e) { said.push(label + " threw " + e.name + " asked " + asked); } };
const lay = filter => Bun.plugin({ name: "p", setup(b) { b.onLoad({ filter }, () => { asked++; return { contents: "exports.n = 'plugin'; exports.run = 0;", loader: "js" }; }); } });
test("the file was required by an outer file", async () => {
  const outer = require("./outer.cjs");
  said.push("outer " + show(outer.inner));
  lay(/lib\.cjs$/);
  await say("import inner", () => import("./lib.cjs"));
  const o = await import("./outer.cjs");
  said.push("outer is the first " + (o.default === outer));
  await say("import through a statement", () => import("./user.mjs"));
  console.log(said.join("\n"));
});
