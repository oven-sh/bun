const { createRequire } = require("node:module");
const made = createRequire(__filename);
const constant = "fs";
let variable = "fs";
function name() {
  return "fs";
}
const own = require;
const early = require("fs");
exports.ask = () =>
  [
    early,
    require("fs"),
    module.require("fs"),
    (0, require)("fs"),
    require(constant),
    require("f" + "s"),
    require(`fs`),
    require(Math.random() < 2 ? "fs" : "os"),
    require(Math.random() < 2 ? constant : "os"),
    "|",
    require(variable),
    require(name()),
    module.require(variable),
    require.call(null, "fs"),
    require.apply(null, ["fs"]),
    own("fs"),
    made("fs"),
    "|",
    require("node:fs"),
    process.getBuiltinModule("fs"),
  ]
    .map(it => (it === "|" ? it : typeof it.readFileSync))
    .concat(typeof require("path").join);
