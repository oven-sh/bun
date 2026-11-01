say("bare: the file runs");
import("./module.mjs").then(() => say("bare: module.mjs loaded"), error => say("bare: module.mjs rejected", text(error)));
throw new Error("the bare file throws");
