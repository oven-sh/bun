const key = [".", "js"].join("");
for (const loaders of [require.extensions, require("node:module")._extensions]) {
  for (const path of [Bun.main, process.argv[1]]) console.log(loaders[key](module, path), Object.keys(module.exports).join());
}
module.exports.count = "two";
module.exports.label = 7;
module.exports.double = () => "replaced";
