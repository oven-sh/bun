import { test, vi } from "bun:test";
const gate = vi.hoisted(() => Promise.withResolvers());
vi.mock("./first", async () => (await gate.promise, { name: "first" }));
vi.mock("./second", async () => ({ name: "second with " + (await import("./through")).name }));
test("names", async () => {
  const first = import("./first");
  const second = await import("./second");
  gate.resolve();
  console.log("SAID", (await first).name, "|", second.name);
});
