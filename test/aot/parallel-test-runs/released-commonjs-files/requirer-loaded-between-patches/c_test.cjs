const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "c", globalThis.runs, ...all);
test("c", async () => {
  say("next", user(), ask());
});
