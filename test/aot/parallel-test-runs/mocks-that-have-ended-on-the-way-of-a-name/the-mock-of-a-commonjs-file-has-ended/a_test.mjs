import { test, vi } from "bun:test";
vi.mock("./rates.cjs", () => ({ rate: "the rate of the mock" }));
test("whoever was linked under a mock goes on seeing it when it has ended", async () => {
  const till = await import("./till.mjs");
  console.log(till.line("rate"));
  vi.doUnmock("./rates.cjs");
  console.log(till.line("rate"));
});
