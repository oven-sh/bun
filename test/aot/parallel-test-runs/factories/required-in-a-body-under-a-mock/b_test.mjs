import { test, vi, mock, jest } from "bun:test";
const word = it => { try { return JSON.stringify(it); } catch (e) { return e.name; } };
const got = load => load.then(it => word(it), error => error.name);
const now = deed => { try { return word(deed()); } catch (e) { return "threw " + e.name; } };
const say = (...words) => console.log("SAID", ...words, globalThis.ran);
test("b", async () => {
  vi.doMock("./dep.mjs", () => ({ dep: "mock" }));
  say("1", await got(import("./mid.mjs")));
  vi.doUnmock("./dep.mjs");
  say("2", await got(import("./mid.mjs")));
  vi.doMock("./dep.mjs", () => ({ dep: "mock 2" }));
  say("3", await got(import("./mid.mjs")), await got(import("./dep.mjs")));
});
