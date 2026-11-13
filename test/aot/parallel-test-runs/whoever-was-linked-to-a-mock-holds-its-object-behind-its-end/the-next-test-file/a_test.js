import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "mocked" }));
test("a", async () => {
  const one = await import("./one.mjs");
  console.log("SAID a", one.seen());
});
