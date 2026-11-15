import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./lib.mjs", async original => ({ ...(await original()), extra: "more" }));
  const lib = await import("./lib.mjs");
  console.log("SAID the test has " + Object.keys(lib).sort().join());
}, 2000);
