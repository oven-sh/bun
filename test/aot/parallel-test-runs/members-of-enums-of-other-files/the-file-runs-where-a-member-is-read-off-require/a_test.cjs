const { test } = require("bun:test");
test("the file runs where a member of its enum is read off require", () => {
  console.log("before");
  console.log(require("./levels.ts").Level.High);
  console.log("after");
});
