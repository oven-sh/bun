// A text that is joined from the constants of other files runs compiled code.
// COUNTER: InterpretedFunctionCode = 0
import { COUNT, FIRST as RENAMED, HEAD, KEPT } from "./parts";
import { AGAIN, TAIL } from "./again.mjs";

const SECOND = `function twice(x) { return x * ${COUNT}; }\n`;
const TEXT = [HEAD, RENAMED, SECOND + KEPT, TAIL].join("\n");
const made = new Function("host", TEXT)({ name: "host" });
console.log(made.limit, made.first(4), made.twice(5), made.last("a"), made.name, made.receiver());


const product = new Function("a", "b", `const base = 10;\n${AGAIN}`);
console.log(product(1, 2), product(3, 4));

let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + made.first(i) + made.twice(i)) | 0;
console.log(sum);
