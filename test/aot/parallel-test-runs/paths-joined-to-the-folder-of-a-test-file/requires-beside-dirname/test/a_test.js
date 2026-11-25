const { expect, test } = require("bun:test");
const path = require("node:path");

const load = file => require(path.join(__dirname, "..", "tools", file));

test("a function joins the path", () => {
  expect(load("saw.js").name).toBe("saw");
  expect(load(["a", "xe.js"].join("")).name).toBe("axe");
});

test("the call names the file in one text", () => {
  expect(require(path.join(__dirname, "../tools/saw.js")).name).toBe("saw");
});
