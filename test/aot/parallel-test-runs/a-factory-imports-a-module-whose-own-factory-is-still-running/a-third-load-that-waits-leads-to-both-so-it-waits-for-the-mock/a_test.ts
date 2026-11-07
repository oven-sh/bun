import { test, vi } from "bun:test";
const gate = vi.hoisted(() => Promise.withResolvers());
vi.mock("./first", async () => (await gate.promise, { name: "first" }));
vi.mock("./second", async () => {
  await import("./one");
  await import("./two");
  const first = import("./first");
  gate.resolve();
  return { name: "second with " + (await first).name };
});
test("names", async () => {
  const first = import("./first");
  const second = import("./second");
  const both = import("./both");
  console.log("SAID", (await first).name, "|", (await second).name, "|", (await both).names);
});
