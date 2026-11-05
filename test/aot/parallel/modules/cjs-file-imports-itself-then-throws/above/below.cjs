say("above: the file below runs");
import("./file.cjs").then(() => say("above: file.cjs loaded"), error => say("above: file.cjs rejected", error.message));
