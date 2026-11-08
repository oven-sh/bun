const { test } = require("bun:test");
test("a variable that holds nothing throws", () => {
  if (JSON.parse("false")) { var held = require("./levels.ts"); }
  try { console.log(held.Level.High); } catch (error) { console.log(error.name); }
});
