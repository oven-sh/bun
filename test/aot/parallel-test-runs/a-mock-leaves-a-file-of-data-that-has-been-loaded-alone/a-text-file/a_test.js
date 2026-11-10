import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID before", one.seen());
  vi.doMock("./dep.txt", () => ({ default: { kind: "mocked" }, kind: "mocked", added: "mocked" }));
  const two = await import("./two.mjs");
  console.log("SAID while", one.seen(), "|", two.seen());
  vi.doUnmock("./dep.txt");
  const three = await import("./three.mjs");
  console.log("SAID behind", one.seen(), "|", two.seen(), "|", three.seen(), "|", one.held() === three.held(), two.held() === three.held());
});
