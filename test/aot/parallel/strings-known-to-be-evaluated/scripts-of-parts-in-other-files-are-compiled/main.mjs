// A script that is joined from the constants of other files runs compiled code.
// COUNTER: InterpretedFunctionCode = 0
// COUNTER: InterpretedEvalCode = 0
import { FIRST, STRICT } from "./parts.mjs";

(0, eval)("(function () {" + STRICT + FIRST + "globalThis.fromScript = [first(1), typeof this].join(); })()");
console.log(globalThis.fromScript);
(0, eval)(["(function () {", FIRST, "globalThis.again = first(2); })()"].join(""));
console.log(globalThis.again);
