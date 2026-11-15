console.log("SAID ran more.cjs");
exports.other = 5;
try { exports.seen = Object.keys(require("./second.mjs")).sort().join("+"); } catch (error) { exports.seen = error.name; }
