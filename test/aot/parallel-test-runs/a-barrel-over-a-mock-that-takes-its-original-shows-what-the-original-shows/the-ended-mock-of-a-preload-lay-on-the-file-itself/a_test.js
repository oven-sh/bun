import { test, vi } from "bun:test";
import * as early from "./porch.js";
test("one", async () => {
  vi.doMock("./gauge.cjs", () => ({ default: 1, held: 10 }));
  vi.doMock("./shelf.js", async original => ({ ...(await original()), added: 1 }));
  vi.resetModules();
  console.log("SAID", (await import("./reader.js")).look());
  console.log("SAID early", Object.keys(early).sort().join());
});
