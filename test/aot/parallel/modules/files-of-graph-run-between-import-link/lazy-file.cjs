globalThis.log.push("lazy-file");
exports.late = () => require("./lazy-late.mjs").value + require("./lazy-only-late.mjs").value;
