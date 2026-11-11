// plain.cjs says nothing of CommonJS in its text. The statements below this file have loaded it, as an ES module, by the time any code of this file runs: the require reads nothing.
import "./middle.mjs";
const again = () => require("./middle.mjs");
console.log(globalThis.seen.join(" "), typeof again);
