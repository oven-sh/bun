say("before: the file runs");
import("./module.mjs").then(() => say("before: module.mjs loaded"), error => say("before: module.mjs rejected", text(error)));
