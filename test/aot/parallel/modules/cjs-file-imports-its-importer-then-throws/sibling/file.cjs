say("sibling: the file runs");
import("./other.mjs").then(() => say("sibling: other.mjs loaded"), error => say("sibling: other.mjs rejected", text(error)));
throw new Error("the file beside throws");
