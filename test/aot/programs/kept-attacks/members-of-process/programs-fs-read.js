// Members of process: programs fs read. It prints what plain Bun prints.
const K = process.argv[2];
if (process.argv.length > 99) require("node:fs").readFileSync(K);
console.log("hello");
