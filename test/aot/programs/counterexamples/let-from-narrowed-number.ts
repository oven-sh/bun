// A `let` initialized with a number that a `case` clause has narrowed can be incremented.
declare const console: { log(...a: unknown[]): void };
function f(k: number) { switch (k) { case 1: let w = k; return ++w; } }
console.log(f(1));
