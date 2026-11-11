function load() {
  return require("./fails.cjs").value;
}
function tryLoad() {
  try {
    return load();
  } catch (e) {
    return e.message;
  }
}
exports.value = tryLoad();
