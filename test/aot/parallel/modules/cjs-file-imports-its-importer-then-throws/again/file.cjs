say("again: the file runs");
exports.value = 1;
import("./module.mjs").then(() => say("again: module.mjs loaded"), error => say("again: module.mjs rejected", text(error)));
throw new Error("the file asked for again throws");
