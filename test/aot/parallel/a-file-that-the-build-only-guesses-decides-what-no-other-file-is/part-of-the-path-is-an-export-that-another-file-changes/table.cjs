const routes = (exports.routes = { home: "one" });
require("./change.cjs")(exports);
function load(go, start) {
  if (!go) return;
  return require(start + routes.home + ".cjs");
}
load(false, "./");
