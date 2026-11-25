const { test } = require("bun:test");
try { require("./b_test.ts"); } catch (error) { console.log(error.name); }
test("a", () => console.log("a"));
