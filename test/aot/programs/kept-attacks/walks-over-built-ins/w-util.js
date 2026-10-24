// Walks over built ins: w util. It prints what plain Bun prints.
import util from "node:util";
const text = util.inspect(globalThis, { depth: 1 });
console.log(typeof text, text.length > 100);
