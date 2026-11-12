import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  vi.doMock("dep", () => ({ value: () => "first", kind: "first", added: "first" }));
  const one = await import("./one.mjs");
  console.log("SAID under the first", one.seen());
  vi.doUnmock("dep");
  console.log("SAID behind the first", one.seen());
  vi.doMock("dep", () => ({ value: () => "second", kind: "second", added: "second" }));
  const two = await import("./two.mjs");
  console.log("SAID under the second", one.seen(), "|", two.seen());
  vi.doUnmock("dep");
  const three = await import("./three.mjs");
  console.log("SAID behind both", one.seen(), "|", two.seen(), "|", three.seen(), "|", one.held() === two.held(), two.held() === three.held());
});
