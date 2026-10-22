// What built ins make: programs w function to string known. It prints what plain Bun prints.
// @ts-nocheck
const other = function other() {};
try { Function.prototype.toString = other; console.log(Function.prototype.toString === other ? "REPLACED" : "ignored"); } catch (e) { console.log("refused", e.message); }
