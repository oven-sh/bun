// A read of a deferred namespace takes no step of the loader while the body of a CommonJS entry point runs either: what the deferred module asks for by import() runs when the reader has run.
// That call is no part of the graph that the require() loads: b runs behind the body of the entry point, as in `bun build --compile`. `bun run` runs it before the require() returns.
require("./a.mjs");
console.log("the entry goes on");
/* Output:
a starts
a sees c
a ends
the entry goes on
b sees a
b is in
*/
