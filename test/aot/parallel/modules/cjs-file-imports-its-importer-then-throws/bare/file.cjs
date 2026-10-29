say("bare: the file runs");
import("./module.mjs").then(() => say("bare: loaded"), error => say("bare: rejected", error.message));
throw new Error("the bare file throws");
