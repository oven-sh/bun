say("itself: the file runs");
exports.value = 1;
import("./file.cjs").then(() => say("itself: file.cjs loaded"), error => say("itself: file.cjs rejected", error.message));
throw new Error("the file that imports itself throws");
