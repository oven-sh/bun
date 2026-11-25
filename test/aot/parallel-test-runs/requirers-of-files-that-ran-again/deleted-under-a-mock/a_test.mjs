import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = async (label, get) => { try { const m = await get(); console.log(label, m.n ?? m.default?.n, "run", m.run, "tries", globalThis.tries); } catch (e) { console.log(label, "threw", e.message.split("\n")[0].replaceAll(import.meta.dir, ""), "tries", globalThis.tries); } };
import "./lib-user.cjs";
test("a", async () => {
  write("one", "globalThis.runs_one = (globalThis.runs_one ?? 0) + 1;\nexports.run = globalThis.runs_one;\nexports.n = require(\"../lib.cjs\").n;\n");
  write("two", "globalThis.runs_two = (globalThis.runs_two ?? 0) + 1;\nexports.run = globalThis.runs_two;\nexports.n = require(\"../lib.cjs\").n;\n");
  await say("one", () => require(late("one")));
  mock.module("./lib.cjs", () => ({ n: "mock" }));
  delete require.cache[require.resolve("./lib.cjs")];
  await say("two", () => require(late("two")));
  mock.module("./lib.cjs", () => ({ n: "mock" }));
});
