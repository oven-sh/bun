const { mock } = require("bun:test");
see("first");
mock.module("./later.mjs", () => {
  see("factory of later");
  return { value: "the mock of later" };
});
exports.name = "first";
