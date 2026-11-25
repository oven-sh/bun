import { test, vi } from "bun:test";
import * as first from "../src/svc.mjs";

test("a", async () => {
  console.log("SAID", first.load());
  vi.doMock("../src/api.mjs", () => ({ get: () => "test", other: () => "none" }));
  const again = await import("../src/svc.mjs");
  console.log("SAID", again.load(), again === first, globalThis.runs);
});
