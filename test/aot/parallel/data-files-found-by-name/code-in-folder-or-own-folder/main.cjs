const path = require("node:path");
const folder = process.argv[2] ?? __dirname;
console.log(require(path.join(folder, "good.cjs")).a, require(path.join(folder, "typed.ts")).a);
