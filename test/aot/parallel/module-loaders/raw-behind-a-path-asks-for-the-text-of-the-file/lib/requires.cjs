const show = value => [typeof value, Object.keys(value).join(), typeof value.default, value.v, value.a];
function inFunction() {
  return require("./in-function.cjs?raw");
}
class Loads {
  inField = require("./in-field.cjs?raw");
  inMethod() {
    return require("./in-method.cjs?raw");
  }
}
module.exports = {
  module: show(require("./code.mjs?raw")),
  commonjs: show(require("./only-required.cjs?raw")),
  json: show(require("./data.json?raw")),
  words: show(require("./words.txt?raw")),
  wordsUnderAnotherQuery: show(require("./words.txt?fresh")),
  unnamed: show(require("./data.kind-that-nothing-names?raw")),
  style: show(require("./style.css?raw")),
  inFunction: show(inFunction()),
  inField: show(new Loads().inField),
  inMethod: show(new Loads().inMethod()),
  oneOfTwo: show(require("./data.json?" + (process.argv.length > 100 ? "x" : "raw"))),
  theOtherOfTwo: show(require("./data.json?" + (process.argv.length > 100 ? "raw" : "x"))),
  sameAsImported: require("./data.json?raw").default,
  sameTwice: require("./code.mjs?raw") === require("./code.mjs?raw"),
  jsonAsItIs: show(require("./data.json")),
  resolved: require.resolve("./code.mjs?raw").replaceAll("\\", "/").replace(/.*\/lib/, "lib"),
};
