import { test, vi } from "bun:test";
import * as first from "../src/svc.mjs";

test("b", async () => {
  console.log("SAID", first.load(), globalThis.runs);
  vi.doMock("../src/api.mjs", () => ({ get: () => "next", other: () => "none" }));
  const again = await import("../src/svc.mjs");
  console.log("SAID", again.load(), again === first, globalThis.runs);
});
