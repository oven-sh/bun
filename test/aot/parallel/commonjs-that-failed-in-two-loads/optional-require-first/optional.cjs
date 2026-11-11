try {
  exports.value = require("./fails.cjs").value;
} catch {
  exports.value = 0;
}
