const { test, vi } = require("bun:test");
const ask = () => {
  try {
    const it = require("./unit.cjs");
    return it.first + " " + it.second;
  } catch (error) {
    return "threw " + error.message;
  }
};
globalThis.neverCalled = () => {
  delete require.cache[require.resolve("./unit.cjs")];
};
test("t", () => {
  vi.doMock("./unit.cjs", () => {
    const one = ask();
    const two = ask();
    return { first: one, second: two };
  });
  console.log("SAID", ask(), "| bodies", globalThis.bodies);
});
