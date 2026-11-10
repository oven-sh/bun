import { test, vi } from "bun:test";
test("cell", async () => {
  await import("./part.mjs");
  vi.doMock("./part.mjs", async () => { await null; return { get: () => "mocked" }; });
  const user = await import("./user.mjs");
  console.log("SAID", user.seen, globalThis.runsOfUser);
}, 3000);
