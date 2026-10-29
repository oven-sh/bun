say("named: the file runs");
exports.value = 1;
import("./module.mjs").then(() => say("named: loaded"), error => say("named: rejected", error.message));
throw new Error("the named file throws");
