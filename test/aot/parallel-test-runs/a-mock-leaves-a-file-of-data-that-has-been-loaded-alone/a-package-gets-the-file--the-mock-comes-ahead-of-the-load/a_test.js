import { test, vi, jest, mock } from "bun:test";
vi.mock("data", () => ({ default: { kind: "mocked" }, kind: "mocked", added: "mocked" }));
test("t", async () => {
  const own = await import("./own.mjs"), reads = await import("reads");
  console.log("SAID while", await own.seen(), "|", await reads.seen());
  vi.doUnmock("data");
  console.log("SAID behind", await own.seen(), "|", await reads.seen());
});
