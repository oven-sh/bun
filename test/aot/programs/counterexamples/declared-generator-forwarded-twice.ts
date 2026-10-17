// One declared generator function has one prototype object however often it is handed on, and each activation has its own.
declare const console: { log(...a: unknown[]): void };
function run(g: () => object) { return Object.getPrototypeOf(g()); }
function once(x: number) { function* inner() { yield x; } return run(inner) === run(inner); }
function each() { function* inner() {} return run(inner); }
console.log(once(1), each() === each());
