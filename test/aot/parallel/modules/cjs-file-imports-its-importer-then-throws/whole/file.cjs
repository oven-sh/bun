say("whole: the file runs");
module.exports = { value: 1 };
import("./module.mjs").then(() => say("whole: module.mjs loaded"), error => say("whole: module.mjs rejected", text(error)));
throw new Error("the whole file throws");
