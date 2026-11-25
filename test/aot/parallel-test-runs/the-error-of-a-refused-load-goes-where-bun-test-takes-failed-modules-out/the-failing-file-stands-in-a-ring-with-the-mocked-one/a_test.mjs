import { test, vi } from "bun:test";
const what = it => (it instanceof Error ? it.name : "loaded " + Object.keys(it).sort().join("+"));

test("one door", async () => {
  const first = await import("./root.mjs").catch(error => error);
  vi.doMock("./side.mjs", () => ({ side: "mock" }));
  const second = await import("./root.mjs").catch(error => error);
  console.log("SAID " + what(first) + " | " + what(second) + " | same " + (first === second));
  vi.doUnmock("./side.mjs");
  const third = await import("./root.mjs").catch(error => error);
  console.log("SAID ended " + what(third) + " | same " + (second === third));
  console.log("SAID bodies " + (globalThis.bodies ?? []).join());
});
