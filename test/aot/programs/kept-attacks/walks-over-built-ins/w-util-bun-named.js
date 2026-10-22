// Walks over built ins: w util bun named. It prints what plain Bun prints.
import { inspect } from "node:util";
console.log(inspect(Bun, { depth: 1 }).length > 100);
