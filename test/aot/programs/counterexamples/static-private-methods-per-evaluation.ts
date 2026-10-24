// The static private methods of two evaluations of a class are two functions.
declare const console: { log(...a: unknown[]): void };
function make() { return class P { static #u() {} static u() { return P.#u; } }; }
console.log(make().u() === make().u());
