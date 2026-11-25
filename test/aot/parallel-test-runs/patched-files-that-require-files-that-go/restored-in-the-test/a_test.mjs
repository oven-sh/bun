import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = async (label, get) => { try { const m = await get(); console.log(label, m.n ?? m.default?.n, "run", m.run, "tries", globalThis.tries); } catch (e) { console.log(label, "threw", e.message.split("\n")[0].replaceAll(import.meta.dir, ""), "tries", globalThis.tries); } };
import "./lib-user.cjs";
test("a", async () => {
  globalThis.mid = late("mid");
  write("mid", "globalThis.runs_mid = (globalThis.runs_mid ?? 0) + 1;\nexports.run = globalThis.runs_mid;\nexports.n = require(\"../lib.cjs\").n;\n");
  await say("lib", () => require("./lib.cjs"));
  await say("mid", () => require(late("mid")));
  mock.module("./lib.cjs", () => ({ n: "mock" }));
  mock.restore();
  await say("lib", () => require("./lib.cjs"));
  await say("mid", () => require(late("mid")));
});
