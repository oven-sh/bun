say("exported: the file runs");
module.exports = { value: 1 };
import("./module.mjs").then(() => say("exported: module.mjs loaded"), error => say("exported: module.mjs rejected", text(error)));
throw new Error("the file of exported throws");
