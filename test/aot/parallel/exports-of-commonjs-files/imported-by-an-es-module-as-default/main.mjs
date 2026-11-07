// an ES module imports the default of a CommonJS file and passes texts where the files that require it pass integers
// Under: --aot-testing=CheckProofsAtRunTime: what a read of the exports variable finds is held against what Link says of it
import sum from "./sum.cjs";
import "./start.cjs";
let out = "";
for (let i = 0; i < 3; i++) out += sum("d", i) + ";";
console.log(out);
