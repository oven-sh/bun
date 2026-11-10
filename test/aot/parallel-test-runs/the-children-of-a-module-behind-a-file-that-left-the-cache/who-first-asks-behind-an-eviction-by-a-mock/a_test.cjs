const { test, vi } = require("bun:test");
const key = require.resolve("made-up-lib");
const user = require("./user.cjs");
const evict = () => {
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 }));
  require.cache[key] = { exports: { a: "fake", n: 0 } };
  delete require.cache[key];
  vi.doUnmock("made-up-lib");
};
test("a", () => {
  evict();
  console.log("SAID", user.ask().a, user.children(), globalThis.runsOfLib);
});
