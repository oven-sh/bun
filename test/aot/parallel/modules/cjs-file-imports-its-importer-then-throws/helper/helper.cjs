say("helper: the helper runs");
import("./module.mjs").then(() => say("helper: module.mjs loaded"), error => say("helper: module.mjs rejected", text(error)));
