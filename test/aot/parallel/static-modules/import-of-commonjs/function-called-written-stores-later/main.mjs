// A function expression that is called where it is written hands itself out, by its own name or by arguments.callee, and is called again behind the end of the body. A named import is a copy.
import { n } from "./named.cjs";
import { m } from "./callee.cjs";
console.log(n, m);
globalThis.named();
globalThis.callee();
console.log(n, m);
