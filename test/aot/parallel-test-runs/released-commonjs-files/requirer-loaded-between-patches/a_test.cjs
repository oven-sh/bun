const { test, vi, mock, jest } = require("bun:test");
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  say("other", require("./other.cjs").read());
});
