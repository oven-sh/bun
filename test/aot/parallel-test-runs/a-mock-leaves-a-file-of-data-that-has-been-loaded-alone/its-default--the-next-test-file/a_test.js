import { test, vi, jest, mock } from "bun:test";
test("a", async () => {
  const one = await import("./one.mjs");
  vi.doMock("./dep.json", () => ({ default: { kind: "mocked" }, kind: "mocked", added: "mocked" }));
  const two = await import("./two.mjs");
  console.log("SAID a", await one.seen(), "|", await two.seen());
});
