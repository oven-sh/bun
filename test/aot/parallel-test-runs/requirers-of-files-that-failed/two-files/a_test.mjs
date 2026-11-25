import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = (label, get) => { try { const m = get(); console.log(label, m.n, "run", m.run, "tries", globalThis.tries, "other", globalThis.otherTries); } catch (e) { console.log(label, "threw", e.message, "tries", globalThis.tries); } };
test("a", () => {
  write("one", "globalThis.runs_one = (globalThis.runs_one ?? 0) + 1;\nexports.run = globalThis.runs_one;\ntry { exports.n = require(\"../lib.cjs\").n; } catch { exports.n = \"caught\"; }\n");
  write("two", "globalThis.runs_two = (globalThis.runs_two ?? 0) + 1;\nexports.run = globalThis.runs_two;\ntry { exports.n = require(\"../other.cjs\").n; } catch { exports.n = \"caught other\"; }\n");
  require("./lib-user.cjs");
  say("one", () => require(late("one")));
  say("two", () => require(late("two")));
  mock.module("./lib.cjs", () => ({ n: "mock" }));
});
