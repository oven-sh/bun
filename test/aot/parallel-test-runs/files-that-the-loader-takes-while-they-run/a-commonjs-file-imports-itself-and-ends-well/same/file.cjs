say("same: the file runs");
exports.before = 1;
import("./file.cjs").then(it => settle("same: file.cjs loaded " + Object.keys(it).join() + " " + JSON.stringify(it.default)), error => settle("same: file.cjs rejected " + error.message));
exports.after = 2;
