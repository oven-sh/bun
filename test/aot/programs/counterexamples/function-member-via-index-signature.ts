// A function read out of a literal that is seen as `{ [k: string]: () => number }` is a new one for each literal.
declare const console: { log(...a: unknown[]): void };
function make() { return { m: () => 1 }; }
function read(d: { [k: string]: () => number }) { return d.m; }
console.log(read(make()) === read(make()));
