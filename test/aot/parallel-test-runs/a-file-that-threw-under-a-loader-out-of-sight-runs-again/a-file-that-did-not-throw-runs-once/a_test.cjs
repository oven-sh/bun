const { test } = require("bun:test");
process.env.RUNS_OF_SHAKY = "1";
const through = (load, name) => load(name);
let said = "loaded";
try { through(require, ["./sha", "ky.cjs"].join("")); } catch (error) { said = error.message; }
console.log("the first load said", said, "after", process.env.RUNS_OF_SHAKY);
const shaky = require("./shaky.cjs");
console.log("the second load holds", shaky.early, shaky.late, "after", process.env.RUNS_OF_SHAKY);
test("a", () => {});
