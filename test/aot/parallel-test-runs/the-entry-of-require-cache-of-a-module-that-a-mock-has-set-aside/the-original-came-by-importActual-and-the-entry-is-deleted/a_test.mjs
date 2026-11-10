import { test, vi } from "bun:test";
test("t", async () => {
  const held = await vi.importActual("./part.mjs");
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  const gone = delete require.cache[require.resolve("./part.mjs")];
  const under = require("./part.mjs").a;
  vi.doUnmock("./part.mjs");
  console.log(`SAID ${gone} ${under} ${require("./part.mjs").a} ${held.a} ${globalThis.runsOfPart}`);
});
