import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "third", kind: "third", added: "third" }));
test("c", async () => {
  const one = await import("./one.mjs"), three = await import("./three.mjs");
  console.log("SAID c", one.seen(), "|", three.seen());
  vi.doUnmock("dep");
  console.log("SAID c behind", one.seen(), "|", three.seen());
});
