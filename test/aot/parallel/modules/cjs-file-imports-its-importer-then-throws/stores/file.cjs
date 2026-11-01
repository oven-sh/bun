say("stores: the file runs");
exports.value = 1;
import("./module.mjs").then(() => say("stores: module.mjs loaded"), error => say("stores: module.mjs rejected", text(error)));
throw new Error("the file that only stores throws");
