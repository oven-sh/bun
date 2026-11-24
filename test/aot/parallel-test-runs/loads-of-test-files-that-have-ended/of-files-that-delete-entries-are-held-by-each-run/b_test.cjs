const { test } = require("bun:test");
const { cost } = require("./cost.cjs");
const readers = (globalThis.readers ??= []);
readers.push(() => `b ${cost()}`);

test("b", () => {
  for (const read of readers) console.log(read());
});
