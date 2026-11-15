// Flags: --aot-harden=proof-checks
// The record and the library's class share the place of the name, so the slot's type names the record's function. What the word asks of the slot in the library's units may not name it: the build died.
const o = { pattern: () => "x" };
console.log(o.pattern(), require("node:fs").globSync("nothing-*").length);
