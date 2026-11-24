const { test, vi, jest } = require("bun:test");
test("asks again", async () => {
  const said = [];
  require("./outer.js");
  { const m = require("./outer.js"); said.push("outer", m.run, m.sees || "-"); }
  { const m = require("./late.js"); said.push("late", m.run, m.sees || "-"); }
  { const m = require("./resetter.js"); said.push("resetter", m.run, m.sees || "-"); }
  { const m = require("./counter.js"); said.push("counter", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
