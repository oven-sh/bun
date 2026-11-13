const run = ++globalThis.runs;
import("./thrower.cjs").then(() => globalThis.settled.push("the call of run " + run + " loaded"), (error) => globalThis.settled.push("the call of run " + run + " rejected: " + error.message));
throw new Error("throws " + run);
