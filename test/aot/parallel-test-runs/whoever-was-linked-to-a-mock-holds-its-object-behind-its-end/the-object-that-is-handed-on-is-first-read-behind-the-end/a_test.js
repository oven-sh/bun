import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.cjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  const own = await import("./own.mjs");
  vi.doUnmock("./dep.cjs");
  console.log("SAID behind doUnmock", own.seen(), "|", own.same());
});
