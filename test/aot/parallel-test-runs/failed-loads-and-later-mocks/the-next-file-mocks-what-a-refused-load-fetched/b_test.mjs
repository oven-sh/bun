import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("b", async () => {
  const one = await err(import("./door.mjs"));
  vi.doMock("./between.mjs", async () => ({ between: 'mock' }));
  const two = await err(import("./door.mjs"));
  console.log("SAID b", one?.name, two?.name, one === two, globalThis.ran);
  console.log("SAID other", await got(import("./other.mjs")), globalThis.ran);
  vi.doUnmock('./between.mjs');
  const three = await err(import("./door.mjs"));
  console.log("SAID end", three?.name, three === two, await got(import("./between.mjs")), globalThis.ran);
});
