import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID before", one.seen());
  vi.doMock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "mocked" }));
  const two = await import("./two.mjs");
  const under = two.held();
  console.log("SAID while", two.seen(), under === two.held());
  vi.doUnmock("./dep.mjs");
  const behind = two.held();
  console.log("SAID behind", two.seen(), under === behind, behind === two.held(), new Set([under, behind, two.kept]).size);
});
