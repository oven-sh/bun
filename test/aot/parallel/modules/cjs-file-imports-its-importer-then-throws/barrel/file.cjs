say("barrel: the file runs");
module.exports = { value: 1 };
import("./module.mjs").then(() => say("barrel: module.mjs loaded"), error => say("barrel: module.mjs rejected", text(error)));
throw new Error("the file behind the barrel throws");
