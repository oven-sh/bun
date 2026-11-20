import { test, vi } from "bun:test";
test("t", async () => {
  const held = await import("./part.mjs");
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  const gone = delete require.cache[require.resolve("./part.mjs")];
  const { seen } = await import("./user.mjs");
  vi.doUnmock("./part.mjs");
  const behind = await import("./part.mjs");
  console.log(`SAID ${gone} ${seen} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
