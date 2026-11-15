say("later: the file runs");
exports.value = 1;
import("./module.mjs").then(() => say("later: module.mjs loaded"), error => say("later: module.mjs rejected", text(error)));
