const { eslintReports } = require("./scan.cjs");
const src = require("fs").readFileSync("./gen-nun.cjs", "utf8");
// Reuse the operand list by evaluating the array literal.
const m = src.match(/const operands = (\[[\s\S]*?\n\]);/);
const operands = eval(m[1]);
for (const o of operands) {
  const code = `!${o} in b`;
  const r = eslintReports(code, "module");
  if (r === null) console.log("NOPARSE", JSON.stringify(code));
}
