say("module: the file runs");
import("./module.mjs").then(() => say("module: module.mjs loaded"), error => say("module: module.mjs rejected", text(error)));
