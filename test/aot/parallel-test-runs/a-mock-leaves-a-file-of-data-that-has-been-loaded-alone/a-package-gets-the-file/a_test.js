import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const first = await import("./first.mjs");
  vi.doMock("data", () => ({ default: { kind: "mocked" }, kind: "mocked", added: "mocked" }));
  const own = await import("./own.mjs"), reads = await import("reads");
  console.log("SAID while", first.seen(), "|", own.seen(), "|", reads.seen());
  vi.doUnmock("data");
  console.log("SAID behind", first.seen(), "|", own.seen(), "|", reads.seen());
});
