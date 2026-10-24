// The members of a `declare enum` that merges with an enum are not on the object.
declare const console: { log(...a: unknown[]): void };
enum E { A }
declare enum E { B = 1 }
console.log(Object.keys(E).join());
