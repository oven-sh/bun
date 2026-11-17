import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("x", async () => {
  console.log("SAID 1", (await import("./user.mjs")).user(), globalThis.ran);
  vi.doMock('./part.mjs', () => ({ part: 2 }));
  console.log("SAID 2", (await import("./user.mjs")).user(), await got(import("./part.mjs")), globalThis.ran);
  vi.doUnmock('./part.mjs');
  console.log("SAID 3", (await import("./user.mjs")).user(), await got(import("./part.mjs")), globalThis.ran);
});
