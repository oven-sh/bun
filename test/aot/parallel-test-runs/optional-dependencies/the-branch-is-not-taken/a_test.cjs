const { test, expect } = require("bun:test");
if (JSON.parse("false")) {
  var absent = require("./tools.mjs");
}
if (JSON.parse("true")) {
  var present = require("./spare.mjs");
}
test("an optional link on a var that holds nothing leaves for undefined", () => {
  console.log(absent?.name, absent?.describe(), absent?.["name"], typeof absent?.name, absent?.nope, absent?.name ?? "fallback");
  expect(absent?.name).toBe(undefined);
});
test("on a var that holds the module it reads the module", () => {
  console.log(present?.name, present?.describe(), present?.["name"], typeof present?.name, present?.nope, present?.uses);
  expect(present?.name).toBe("spare");
});
