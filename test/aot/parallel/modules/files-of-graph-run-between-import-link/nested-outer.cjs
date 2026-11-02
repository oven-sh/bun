globalThis.log.push("nested-outer");
exports.value =
  require("./nested-inner.cjs").value + require("./nested-plain.cjs").value + require("./nested-required.mjs").value;
