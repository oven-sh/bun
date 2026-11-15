import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  const own = await import("./own.mjs");
  vi.doUnmock("./dep.mjs");
  console.log("SAID the real one", (await import("./dep.mjs")).value());
  console.log("SAID behind", own.reflected(), "|", own.byKey("d"), "|", own.byName(), "|", own.same());
});
