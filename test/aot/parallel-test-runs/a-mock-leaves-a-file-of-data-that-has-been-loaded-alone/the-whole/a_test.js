import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID before", await one.seen());
  vi.doMock("./dep.json", () => ({ default: { kind: "mocked" }, kind: "mocked", added: "mocked" }));
  const two = await import("./two.mjs");
  console.log("SAID while", await one.seen(), "|", await two.seen());
  vi.doUnmock("./dep.json");
  const three = await import("./three.mjs");
  console.log("SAID behind", await one.seen(), "|", await two.seen(), "|", await three.seen());
});
