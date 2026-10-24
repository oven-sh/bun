// Walks over built ins: w util bun. It prints what plain Bun prints.
import util from "node:util";
console.log(util.inspect(Bun, { depth: 1 }).length > 100);
