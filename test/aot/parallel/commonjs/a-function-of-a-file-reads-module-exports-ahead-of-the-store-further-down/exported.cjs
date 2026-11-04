function exported() {
  return typeof module.exports + " " + (module.exports === exported);
}
var early = exported();
module.exports = exported, module.exports.early = early;
