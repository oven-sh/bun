import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", async () => { await 0; return { value: () => "mocked" }; });
test("t", async () => {
  const first = import("dep"); const { own } = await import("./own.mjs"); await first;
  console.log("SAID", own(), String(globalThis.order.filter(it => it !== "own")));
});
