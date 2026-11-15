import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "a" }));
  const under = await import("./dep.mjs");
  vi.doUnmock("./dep.mjs");
  const first = await import("./dep.mjs");
  const second = await import("./dep.mjs");
  console.log("| " + under.kind + " " + under.extra + " | " + first.kind + " " + first.extra + " | " + (first === second) + " " + (under === first));
});
