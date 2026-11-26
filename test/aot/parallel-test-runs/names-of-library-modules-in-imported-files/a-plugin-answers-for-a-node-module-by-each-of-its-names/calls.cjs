const os = require("os");
const { platform } = require("os");
const flag = process.argv.length > 99;
module.exports = async () => [
  os.platform(),
  platform(),
  require(flag ? "path" : "os").platform(),
  require(["o", "s"].join("")).platform(),
  (await import("os")).platform(),
  require.resolve("os").endsWith("os.cjs"),
  typeof process.getBuiltinModule("os").arch,
];
