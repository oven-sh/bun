import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let asked = 0;
const said = [];
const show = m => m === undefined ? "undefined" : "n:" + (m.n ?? m.default?.n) + " run:" + (m.run ?? m.default?.run) + " default:" + typeof m.default;
const say = async (label, get) => { try { const m = await get(); said.push(label + " " + show(m) + " asked " + asked + " runs " + globalThis.runs); return m; } catch (e) { said.push(label + " threw " + e.name + " asked " + asked); } };
const lay = filter => Bun.plugin({ name: "p", setup(b) { b.onLoad({ filter }, () => { asked++; return undefined; }); } });
test("required, then a plugin, then import() twice", async () => {
  const first = await say("require", () => require("./lib.cjs"));
  lay(/lib\.cjs$/);
  const a = await say("import", () => import("./lib.cjs"));
  const b = await say("import again", () => import("./lib.cjs"));
  said.push("same " + (a === b) + " default is the first " + (a?.default === first));
  await say("require behind", () => require("./lib.cjs"));
  console.log(said.join("\n"));
});
