// An enum declared in a function is a new object for each call.
declare const console: { log(...a: unknown[]): void };
function mk() { enum E { A } return () => E; }
const a = mk(), b = mk();
console.log(a() === b());
