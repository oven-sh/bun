import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("b", async () => {
  vi.doMock("./inner.js", async () => { await 0; return { inner: 'inner mock' }; });
  vi.doMock("./dep.js", async () => { await 0; return { flag: "mock" }; });
  console.log("SAID 1", now(() => import.meta.require("./dep.js").flag), globalThis.ran);
  for (let i = 0; i < 12; i++) await 0;
  console.log("SAID 2", now(() => import.meta.require("./dep.js").flag), globalThis.ran);
  for (let i = 0; i < 12; i++) await 0;
  console.log("SAID 3", now(() => import.meta.require("./dep.js").flag), await got(import("./dep.js")), globalThis.ran);
});
