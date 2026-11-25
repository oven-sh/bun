// Flags: --aot-harden=proof-checks
// The record and the library's class share the place of the name, so the slot's type names the record's function. What the word asks of the slot in the library's units may not name it: the build died.
const q = { search: () => "?a=1" };
console.log(q.search(), require("node:url").resolve("http://made.up/a/b", "c"));
