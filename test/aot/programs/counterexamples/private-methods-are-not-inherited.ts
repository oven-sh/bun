// `#m in r` is false for an object whose prototype was set to the prototype object of the class.
declare const console: { log(...a: unknown[]): void };
function make() { return class { #m() {} static has(o: object) { return #m in o; } }; }
const A = make(), r = { z: 1 };
Object.setPrototypeOf(r, A.prototype);
console.log(A.has(r));
