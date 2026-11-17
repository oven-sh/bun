// of what a CommonJS file exports to an ES module only what some code calls is compiled: what is exported has not escaped
// STATISTIC: OperationsEmitted <= 95
import tools from "./tools.cjs";
function pick(from, n) { return from.used(n); }
let total = 0;
for (let i = 0; i < 4; i++) total += pick(tools, i);
console.log(String(total));
