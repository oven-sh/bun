import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = async (label, get) => { try { const m = await get(); console.log(label, m.n ?? m.default?.n, "run", m.run, "tries", globalThis.tries); } catch (e) { console.log(label, "threw", e.message.split("\n")[0].replaceAll(import.meta.dir, ""), "tries", globalThis.tries); } };
test("b", async () => {
  await say("one in b", () => require(late("one")));
  await say("two in b", () => require(late("two")));
  await say("lib in b", () => require("./lib.cjs"));
});
