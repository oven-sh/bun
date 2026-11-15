const routes = (exports.routes = { home: "./one.cjs" });
require("./change.cjs")(exports);
console.log("SAID", require(routes.home));
