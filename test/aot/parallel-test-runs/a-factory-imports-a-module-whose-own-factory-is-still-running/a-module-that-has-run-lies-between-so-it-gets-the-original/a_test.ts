import { test, vi } from "bun:test";
test("names", async () => {
  await import("./x");
  const gate = Promise.withResolvers();
  vi.doMock("./first", async () => (await gate.promise, { name: "first" }));
  vi.doMock("./second", async () => ({ name: "second with " + (await import("./first")).name }));
  const first = import("./first");
  const root = await import("./root");
  gate.resolve();
  console.log("SAID", (await first).name, "|", root.seen);
});
