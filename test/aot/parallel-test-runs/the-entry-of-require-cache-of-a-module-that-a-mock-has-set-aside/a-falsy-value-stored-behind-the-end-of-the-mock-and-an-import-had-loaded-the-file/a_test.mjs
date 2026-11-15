import { test, vi } from "bun:test";
test("t", async () => {
  const held = await import("./part.cjs");
  vi.doMock("./part.cjs", () => ({ a: "mocked" }));
  const under = (await import("./part.cjs")).a;
  vi.doUnmock("./part.cjs");
  require.cache[require.resolve("./part.cjs")] = undefined;
  const behind = await import("./part.cjs");
  console.log(`SAID ${under} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
