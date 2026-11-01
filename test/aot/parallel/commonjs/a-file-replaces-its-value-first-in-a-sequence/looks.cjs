module.exports = make(), module.exports.marked = true;
function make() {
  return { seen: typeof module.exports + ":" + Object.keys(module.exports).length + ":" + (module.exports === exports) };
}
