// What built ins make: programs e throw own. It prints what plain Bun prints.
// @ts-nocheck
try { throw new Error("x") } catch (e) { console.log(e.code) }
console.log("hello");
