const routes = (exports.routes = { home: "one" });
require("./change.cjs")(exports);
function load(go) {
  if (!go) return;
  return [routes.home, require("./one.cjs")];
}
load(false);
