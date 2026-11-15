const { jest, test, vi } = require("bun:test");
test("t", async () => {
  let calls = 0;
  vi.doMock("./lib.cjs", async original => { calls++; return { ...(await original()), b: calls }; });
  const under = await import("./lib.cjs");
  const first = await vi.importActual("./lib.cjs");
  console.log("SAID", under.a, under.b, first.a, globalThis.runs);
  vi.resetModules();
  const second = await vi.importActual("./lib.cjs");
  const again = await import("./lib.cjs");
  console.log("SAID", second.a, first === second, again.a, again.b, calls, globalThis.runs);
});
