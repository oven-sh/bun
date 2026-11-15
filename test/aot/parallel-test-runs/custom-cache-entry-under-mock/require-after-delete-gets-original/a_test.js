import { test, vi, mock } from "bun:test";
const key = require.resolve("./lib.mjs");
const say = (...it) => console.log("SAID", ...it, globalThis.runsOfLib ?? 0, globalThis.runsOfDep ?? 0);
const tell = async load => { try { const m = await load(); const it = m && m.default && m.default.a !== undefined ? m.default : m; return [it.a, typeof it.seen === "function" ? it.seen() : it.seen, it.n, it.added].join("/"); } catch (error) { return error.name; } };
test("t", async () => {
  vi.doMock("./dep.mjs", () => ({ d: "mocked d" }));
  say("loaded", await tell(async () => require("./lib.mjs")));
  vi.doMock("./lib.mjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  vi.doUnmock("./dep.mjs");
  say("in front");
  require.cache[key] = { exports: { a: "fake" } };
  say("stored");
  delete require.cache[key];
  say("require", await tell(async () => require("./lib.mjs")));
}, 9000);
