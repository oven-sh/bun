// A text that is joined from what namespaces hold, from an export under two names and from numbers of other files runs compiled code.
// COUNTER: InterpretedFunctionCode = 0
import * as parts from "./parts";
import { COUNT, ENABLED, NOTHING, TEXT as first, TEXT as second, TEXT } from "./parts";

console.log(new Function("a", parts.TEXT)(1), new Function("a", parts["OTHER"])(2));
console.log(new Function("a", first)(1), new Function("b", second)(2), new Function("c", TEXT + "\n")(3));
console.log(new Function("x", "return x * " + COUNT)(3), new Function("x", `return ${ENABLED} ? x : 2`)(4), new Function("x", "return x + " + NOTHING)(5));
console.log(new Function("list", `let sum = 0;\nfor (const x of list) sum += x % ${parts.COUNT};\nreturn sum;`)([5, 6, 7, 8, 9]));
console.log(new Function("a", `${parts.HEAD.trim()}\n${parts.TEXT.replace("of a", "of the")}`)(1));

function make(limit: number) {
  return new Function("x", `return x < ${limit} ? x : ${parts.COUNT};`);
}
const inside = make(COUNT);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += inside(i & 15);
console.log(sum);
