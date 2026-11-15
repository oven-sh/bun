import { test, vi } from "bun:test";
vi.mock("dep2", () => ({ value: () => "mocked" }));
vi.mock("./wrap2.mjs", () => ({ wrapped: () => "mocked wrap" }));
test("t", async () => {
  const { own } = await import("./own2.mjs");
  console.log("SAID c", own(), String(globalThis.order2.filter(it => !it.startsWith("own"))));
});
