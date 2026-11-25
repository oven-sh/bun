import { test, mock, jest } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let asked = 0;
const said = [];
const show = m => (m === undefined ? "undefined" : "n:" + (m.n ?? m.default?.n) + " run:" + (m.run ?? m.default?.run) + " default:" + typeof m.default);
const say = async (label, get) => {
  try {
    const m = await get();
    said.push(label + " " + show(m) + " asked " + asked + " runs " + globalThis.runs);
    return m;
  } catch (e) {
    said.push(label + " threw " + e.name + " asked " + asked + " runs " + globalThis.runs);
  }
};
const lay = give => Bun.plugin({ name: "p", setup(b) { b.onLoad({ filter: /lib\.cjs$/ }, args => { asked++; return give(args); }); } });
test("t", async () => {
  await say("require", () => require("./lib.cjs"));
  let fail;
  const gate = new Promise((resolve, reject) => { fail = reject; });
  lay(async () => { await gate; return { contents: "export const n = 'plugin'; export const run = 0; export default { n: 'plugin' };", loader: "js" }; });
  const one = import("./lib.cjs").catch(e => ({ n: e.name, run: -1 }));
  Bun.plugin.clearAll();
  const b = await say("two", () => import("./lib.cjs"));
  fail(new RangeError("no"));
  const a = await say("one", () => one);
  said.push("same " + (a === b));
  await say("import again", () => import("./lib.cjs"));
  await say("require behind", () => require("./lib.cjs"));
  console.log(said.join("\n"));
});
