let n = "the fallback";
try { n = require("./leaf.mjs").name; } catch {}
exports.name = "store(" + n + ")";
