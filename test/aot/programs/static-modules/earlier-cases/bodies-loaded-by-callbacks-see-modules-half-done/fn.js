const dep = require("./dep_fn");
module.exports = function fn() { return "fn called"; };
module.exports.fromHook = dep.fromHook;
