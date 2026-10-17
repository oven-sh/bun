// A top-level enum that a function reads ahead of the declaration is undefined, like a `var`.
declare const console: { log(...a: unknown[]): void };
function early() { return E; }
console.log(early() === undefined);
enum E { A }
