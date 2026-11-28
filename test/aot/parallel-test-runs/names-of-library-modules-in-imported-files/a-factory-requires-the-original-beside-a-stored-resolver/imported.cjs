const { mock } = require("bun:test");
exports.lay = () => {
  mock.module("os", () => ({ of: typeof require("os").platform }));
  return require("os").of;
};
