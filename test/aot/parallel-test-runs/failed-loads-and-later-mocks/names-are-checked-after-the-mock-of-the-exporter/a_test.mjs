import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("a", async () => {
  vi.doMock("./parts.cjs", () => ({ watts: "mock" }));
  console.log("SAID under", await got(import("./desk.mjs")), globalThis.ran);
  vi.doUnmock('./parts.cjs');
  console.log("SAID ended", await got(import("./desk.mjs")), globalThis.ran);
  vi.doMock("./parts.cjs", () => ({ watts: "mock" }));
  console.log("SAID again", await got(import("./desk.mjs")), globalThis.ran);
  vi.doUnmock('./parts.cjs');
  console.log("SAID end", await got(import("./desk.mjs")), globalThis.ran);
});
