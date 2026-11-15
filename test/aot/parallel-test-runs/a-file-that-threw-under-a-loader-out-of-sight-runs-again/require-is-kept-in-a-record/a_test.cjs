const { test } = require("bun:test");
const kept = { load: require };
let said = "loaded";
try { kept.load(["./sha", "ky.cjs"].join("")); } catch (error) { said = error.message; }
console.log("the first load said", said, "after", process.env.RUNS_OF_SHAKY);
const shaky = require("./shaky.cjs");
console.log("the second load holds", shaky.early, shaky.late, "after", process.env.RUNS_OF_SHAKY);
test("a", () => {});
