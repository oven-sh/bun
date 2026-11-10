import { test, vi } from "bun:test";
let calls = 0;
test("t", () => {
  const key = require.resolve("./part.mjs");
  const look = () => [key in require.cache, Object.keys(require.cache).includes(key), require.cache[key]?.exports?.a, calls].join();
  require("./part.mjs");
  const loaded = look();
  vi.doMock("./part.mjs", () => ({ a: "mocked " + ++calls }));
  const waits = look();
  require("./part.mjs");
  const stands = look();
  vi.doUnmock("./part.mjs");
  require("./part.mjs");
  console.log(`SAID ${loaded} | ${waits} | ${stands} | ${look()} | ${globalThis.runsOfPart}`);
});
