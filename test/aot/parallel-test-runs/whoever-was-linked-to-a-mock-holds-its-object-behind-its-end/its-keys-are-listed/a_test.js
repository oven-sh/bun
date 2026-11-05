import { test, vi, jest, mock } from "bun:test";
mock.module("./dep.cjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  const { seen } = await import("./own.mjs");
  console.log("SAID while", await seen());
  vi.doUnmock("./dep.cjs");
  console.log("SAID behind doUnmock", await seen());
  mock.restore();
  console.log("SAID behind restore", await seen());
});
