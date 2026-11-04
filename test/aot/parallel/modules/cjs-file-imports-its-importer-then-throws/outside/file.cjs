say("outside: the file runs");
import("./above.mjs").then(() => say("outside: above.mjs loaded"), error => say("outside: above.mjs rejected", text(error)));
throw new Error("the file below throws");
