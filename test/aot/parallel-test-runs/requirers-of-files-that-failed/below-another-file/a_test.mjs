import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = (label, get) => { try { const m = get(); console.log(label, m.n, "run", m.run, "tries", globalThis.tries, "other", globalThis.otherTries); } catch (e) { console.log(label, "threw", e.message, "tries", globalThis.tries); } };
test("a", () => {
  write("one", "globalThis.runs_one = (globalThis.runs_one ?? 0) + 1;\nexports.run = globalThis.runs_one;\ntry { exports.n = require(\"./mid.cjs\").n; } catch { exports.n = \"caught\"; }\n");
  write("mid", "globalThis.runs_mid = (globalThis.runs_mid ?? 0) + 1;\nexports.run = globalThis.runs_mid;\nexports.n = require(\"../lib.cjs\").n;\n");
  require("./lib-user.cjs");
  say("one", () => require(late("one")));
  say("mid", () => require(late("mid")));
  mock.module("./lib.cjs", () => ({ n: "mock" }));
});
