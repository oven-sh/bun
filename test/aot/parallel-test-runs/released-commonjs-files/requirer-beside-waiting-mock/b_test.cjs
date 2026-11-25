const { test, vi, mock, jest } = require("bun:test");
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "b", globalThis.runs, ...all);
test("b", async () => {
  delete require.cache[require.resolve("./lib.cjs")];
  say("next", user());
});
