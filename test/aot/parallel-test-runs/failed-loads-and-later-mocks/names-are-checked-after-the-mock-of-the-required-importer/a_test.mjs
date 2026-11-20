import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("a", async () => {
  vi.doMock("./lamp.mjs", () => ({ height: "mock" }));
  console.log("SAID under", now(() => JSON.stringify(import.meta.require("./desk.mjs"))), globalThis.ran);
  jest.unmock('./lamp.mjs');
  console.log("SAID ended", now(() => JSON.stringify(import.meta.require("./desk.mjs"))), globalThis.ran);
  vi.doMock("./lamp.mjs", () => ({ height: "mock" }));
  console.log("SAID again", now(() => JSON.stringify(import.meta.require("./desk.mjs"))), globalThis.ran);
  jest.unmock('./lamp.mjs');
  console.log("SAID end", now(() => JSON.stringify(import.meta.require("./desk.mjs"))), globalThis.ran);
});
