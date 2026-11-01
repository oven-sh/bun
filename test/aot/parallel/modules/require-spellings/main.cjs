// Every way to write a require() of a file that the build follows.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const few = process.argv.length < 99;
const one = "one";
const two = few ? "two" : "one";
const held = require;
console.log(
  require("./data/one.cjs").n,
  require(true ? "./data/one.cjs" : "./data/two.cjs").n,
  require(few ? "./data/two.cjs" : "./data/one.cjs").n,
  require(`./data/two.cjs`).n,
  (require)("./data/one.cjs").n,
  require?.("./data/two.cjs").n,
  module.require("./data/two.cjs").n,
  require("./data/" + "one.cjs").n,
);
console.log(
  (function (require) {
    return require("./data/one.cjs");
  })(() => ({ n: "shadowed" })).n,
  (function (module) {
    return module.require("./data/one.cjs");
  })({ require: () => ({ n: "shadowed" }) }).n,
  typeof require === "function" && require("./data/one.cjs").n,
  [1].map(() => require("./data/two.cjs").n)[0],
  require("./data/one").n,
  require("./data/../data/one.cjs").n,
);
console.log(
  require("./data/" + one + ".cjs").n,
  require(`./data/${one}.cjs`).n,
  require("./data/" + two + ".cjs").n,
  require("./data/one.cjs", "extra").n,
  import.meta.require("./data/one.cjs").n,
  held("./data/one.cjs").n,
  require.call(null, "./data/one.cjs").n,
  require.apply(null, ["./data/one.cjs"]).n,
);
console.log(
  require(__dirname + "/data/one.cjs").n,
  require(`${__dirname}/data/two.cjs`).n,
  require(require("node:path").join(__dirname, "data", "one.cjs")).n,
  require("./data/" + ["o", "n", "e"].sort(() => 0).join("") + ".cjs").n,
  require.resolve(__dirname + "/data/one.cjs") === require.resolve("./data/one.cjs"),
  globalThis.runs,
);
import(__dirname + "/data/one.cjs").then(m => console.log(m.default.n, globalThis.runs));
