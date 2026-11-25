import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  vi.doMock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
  const { seen } = await import("reads");
  console.log("SAID while", await seen());
  vi.doUnmock("dep");
  console.log("SAID behind doUnmock", await seen());
  mock.restore();
  console.log("SAID behind restore", await seen());
});
