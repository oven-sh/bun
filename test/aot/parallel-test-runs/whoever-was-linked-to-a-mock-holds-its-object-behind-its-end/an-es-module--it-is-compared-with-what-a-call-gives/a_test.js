import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  const { seen } = await import("./own.mjs");
  console.log("SAID while", await seen());
  vi.doUnmock("./dep.mjs");
  console.log("SAID behind doUnmock", await seen());
  mock.restore();
  console.log("SAID behind restore", await seen());
});
