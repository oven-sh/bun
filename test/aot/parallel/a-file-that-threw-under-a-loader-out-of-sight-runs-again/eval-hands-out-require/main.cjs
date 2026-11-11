// Entry points: ./shaky.cjs
// Env: WHICH=./shaky.cjs
// Env: THROWS_AT=1
let said = "loaded";
try { eval("require")(process.env.WHICH); } catch (error) { said = error.message; }
console.log("the first load said", said, "after", process.env.RUNS_OF_SHAKY);
const shaky = require("./shaky.cjs");
console.log("the second load holds", shaky.early, shaky.late, "after", process.env.RUNS_OF_SHAKY);
