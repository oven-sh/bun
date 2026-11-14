const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "b", globalThis.runs, ...all);
test("b", async () => {
  say("next", user(), ask());
});
