import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./lib.mjs", async original => ({ ...(await original()), extra: "more" }));
  console.log("SAID the test imports the file");
  const lib = await import("./lib.mjs");
  console.log("SAID the test has " + Object.keys(lib).sort().join());
}, 2000);
