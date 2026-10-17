// A generator function in a property of a literal is a new function for each literal.
declare const console: { log(...a: unknown[]): void };
function make() { return { items: function* () {} }; }
console.log(Object.getPrototypeOf(make().items()) === Object.getPrototypeOf(make().items()));
