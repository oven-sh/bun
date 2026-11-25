const routes = (exports.routes = { home: "one" });
require("./change.cjs")(exports);
function load(start) {
  return require(start + routes.home + ".cjs");
}
console.log("SAID", load("./"));
