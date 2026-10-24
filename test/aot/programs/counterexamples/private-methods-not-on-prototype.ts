// `#m in A.prototype` is false.
declare const console: { log(...a: unknown[]): void };
function make() { return class { #m() {} static has(o: object) { return #m in o; } }; }
const A = make();
console.log(A.has(A.prototype));
