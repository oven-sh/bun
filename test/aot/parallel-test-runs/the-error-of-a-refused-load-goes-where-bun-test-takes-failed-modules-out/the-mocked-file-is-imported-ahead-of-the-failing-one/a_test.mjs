import { test, vi } from "bun:test";

test("one door", async () => {
  const first = await import("./root.mjs").catch(error => error);
  vi.doMock("./far.mjs", () => ({ far: "mock" }));
  const second = await import("./root.mjs").catch(error => error);
  console.log("SAID " + first.name + " " + second.name + " same " + (first === second));
});
