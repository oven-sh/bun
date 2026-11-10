import { test, vi, mock } from "bun:test";
const say = (...it) => console.log("SAID", ...it, globalThis.runsOfLib ?? 0, globalThis.runsOfDep ?? 0);
const tell = async load => { try { const m = await load(); const it = m && m.default && m.default.a !== undefined ? m.default : m; return [it.a, typeof it.seen === "function" ? it.seen() : it.seen, it.n, it.added].join("/"); } catch (error) { return error.name; } };
let first;
test("one", async () => {
  vi.doMock("./dep.mjs", () => ({ d: "mocked d" }));
  first = require("./lib.mjs");
  say("loaded", first.a, first.seen(), first.n);
  vi.doMock("./lib.mjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  vi.doUnmock("./dep.mjs");
}, 9000);
test("two", async () => {
  say("import", await tell(() => import("./lib.mjs")));
  say("held", first.a, first.seen());
}, 9000);
