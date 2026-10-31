const cut = path => path.replaceAll("\\", "/").replace(/.*\/lib/, "lib");
const first = require("./required.cjs?first");
const second = require("./required.cjs?second");
const plain = require("./required.cjs");
module.exports = {
  first,
  second,
  plain,
  same: [require("./required.cjs?first") === first, require("./required?first") === first, first === second, first === plain],
  resolved: cut(require.resolve("./required.cjs?first")),
  esModule: require("./counter.mjs?required").url,
  ofPackage: [require("counted?cjs"), require("counted"), require("counted/part?cjs")],
  data: require("./data.json?required"),
};
