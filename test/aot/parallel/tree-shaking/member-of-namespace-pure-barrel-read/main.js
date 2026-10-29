// "sideEffects": false. The barrel is reached in four ways that each read one name: a member of a namespace import, a member of require(), a member of an awaited import(), and a pattern on an awaited import(). Every file behind the barrels prints when it is evaluated. `bun run` evaluates wanted.js and other.js behind each barrel. `bun build --compile` evaluates wanted.js alone, in all four.
// Reference: bun build --compile
import * as first from "four-barrels/first/index.js";

console.log(first.wanted());
console.log(require("four-barrels/second/index.js").wanted());
console.log((await import("four-barrels/third/index.js")).wanted());
const { wanted } = await import("four-barrels/fourth/index.js");
console.log(wanted());
