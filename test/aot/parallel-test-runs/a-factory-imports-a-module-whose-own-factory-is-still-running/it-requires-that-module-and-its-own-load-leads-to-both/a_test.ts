import { test, vi } from "bun:test";
const gate = vi.hoisted(() => Promise.withResolvers());
vi.mock("./first", async () => (await gate.promise, { name: "first" }));
vi.mock("./second", () => ({ name: "second with " + require("./first").name }));
test("names", async () => {
  const first = import("./first");
  const both = import("./both");
  await 0; await 0; await 0;
  gate.resolve();
  console.log("SAID", (await first).name, "|", (await both).names);
});
