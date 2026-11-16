const other = require("./other.cjs");
exports.secret = function secret() { return "secret of inner, " + other.hidden(); };
exports.ask = async function ask() {
  const outside = require("outside-package");
  const lines = outside.look();
  const esm = await import("outside-esm");
  return lines.concat(esm.look(), await esm.lookLater(), outside.lookFromCallee(function calledBack() { return outside.frames(); }), outside.ownFiles());
};
