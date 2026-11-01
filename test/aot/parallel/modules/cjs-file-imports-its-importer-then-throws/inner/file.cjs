say("inner: the file runs");
import("./between.mjs").then(() => say("inner: between.mjs loaded"), error => say("inner: between.mjs rejected", text(error)));
throw new Error("the inner file throws");
