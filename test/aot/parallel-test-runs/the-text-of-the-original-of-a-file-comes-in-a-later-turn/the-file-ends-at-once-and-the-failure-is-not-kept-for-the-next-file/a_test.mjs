import { test, vi } from "bun:test";

// The tests of this file are done before the text comes. The load fails all the same.
test("the call is made", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  globalThis.behind = import("./part.mjs");
  vi.doMock("./part.mjs", () => ({ second: 2 }));
  globalThis.behind.catch(() => {});
});
