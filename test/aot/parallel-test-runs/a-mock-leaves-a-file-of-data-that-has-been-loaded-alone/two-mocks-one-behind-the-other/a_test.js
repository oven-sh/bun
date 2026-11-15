import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const one = await import("./one.mjs");
  vi.doMock("./dep.json", () => ({ default: { kind: "first" }, kind: "first", added: "first" }));
  const two = await import("./two.mjs");
  vi.doUnmock("./dep.json");
  vi.doMock("./dep.json", () => ({ default: { kind: "second" }, kind: "second", added: "second" }));
  const three = await import("./three.mjs");
  console.log("SAID under the second", one.seen(), "|", two.seen(), "|", three.seen());
  vi.doUnmock("./dep.json");
  const four = await import("./four.mjs");
  console.log("SAID behind both", one.seen(), "|", two.seen(), "|", three.seen(), "|", four.seen());
});
