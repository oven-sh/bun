// each run of the file calls import() of the file and throws: three calls of require() run it three times, and the calls' job a fourth
// The order in which the four calls are rejected is the loader's own: the lines are sorted.
globalThis.runs = 0;
globalThis.settled = [];
for (const round of [1, 2, 3]) {
  try { console.log("required", round, require("./thrower.cjs")); } catch (error) { console.log("require threw", round, error.message); }
}
process.on("beforeExit", () => { if (globalThis.settled.length) console.log(globalThis.settled.sort().join("\n") + "\nruns in all: " + globalThis.runs); globalThis.settled = []; });
