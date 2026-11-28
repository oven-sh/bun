import { test, mock } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const late = name => import.meta.dir + "/late/" + name + ".cjs";
const write = (name, text) => { mkdirSync(import.meta.dir + "/late", { recursive: true }); writeFileSync(late(name), text); };
const say = (label, get) => { try { const m = get(); console.log(label, m.n, "run", m.run, "tries", globalThis.tries); } catch (e) { console.log(label, "threw", e.message, "tries", globalThis.tries); } };
test("b", () => {
  say("two in b", () => require(late("two")));
  say("one in b", () => require(late("one")));
  say("lib in b", () => require("./lib.cjs"));
});
