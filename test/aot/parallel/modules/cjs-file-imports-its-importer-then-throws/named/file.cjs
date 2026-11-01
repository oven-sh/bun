say("named: the file runs");
exports.value = 1;
import("./module.mjs").then(() => say("named: module.mjs loaded"), error => say("named: module.mjs rejected", text(error)));
throw new Error("the named file throws");
