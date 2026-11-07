// an ES module calls the default of a CommonJS file with texts, the files that require it pass integers
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the face finds is held against what Link says of it
import sum from "./sum.cjs";
import "./start.cjs";
let out = "";
for (let i = 0; i < 4; i++) out += sum("d", i) + ";";
console.log(out);
