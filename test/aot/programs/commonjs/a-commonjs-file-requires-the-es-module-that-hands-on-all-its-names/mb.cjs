console.log("mb begins");
exports.first = 1;
let m; try { m = require("./ma.mjs"); console.log("mb: required", Object.keys(m).join()); } catch (e) { console.log("mb:", e.name); }
exports.second = 2;
console.log("mb ends");
