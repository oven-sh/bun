say("handed: the file runs");
module.exports = { value: 1 };
import("./module.mjs").then(() => say("handed: module.mjs loaded"), error => say("handed: module.mjs rejected", text(error)));
throw new Error("the file of handed throws");
