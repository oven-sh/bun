import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID before", one.seen());
  vi.doMock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "mocked" }));
  const two = await import("./two.mjs");
  console.log("SAID while", two.byName());
  vi.doUnmock("./dep.mjs");
  console.log("SAID behind", two.byKey("kind"), "|", two.byName(), "|", two.has("only"), "|", two.byKey("only"));
});
