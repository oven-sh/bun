import { test, vi } from "bun:test";
let calls = 0;
test("t", () => {
  const key = require.resolve("./part.cjs");
  const look = () => [key in require.cache, Object.keys(require.cache).includes(key), require.cache[key]?.exports?.a, calls].join();
  require("./part.cjs");
  const loaded = look();
  vi.doMock("./part.cjs", () => ({ a: "mocked " + ++calls }));
  const waits = look();
  require("./part.cjs");
  const stands = look();
  vi.doUnmock("./part.cjs");
  require("./part.cjs");
  console.log(`SAID ${loaded} | ${waits} | ${stands} | ${look()} | ${globalThis.runsOfPart}`);
});
