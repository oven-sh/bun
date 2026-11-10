import { test, vi } from "bun:test";
test("b", () => {
  vi.doMock("./part.cjs", () => ({ a: "mocked" }));
  const gone = delete require.cache[require.resolve("./part.cjs")];
  const under = require("./part.cjs").a;
  vi.doUnmock("./part.cjs");
  const behind = require("./part.cjs");
  console.log(`SAID b ${gone} ${under} ${behind.a} ${behind === globalThis.heldByEarlierFile} ${globalThis.runsOfPart}`);
});
