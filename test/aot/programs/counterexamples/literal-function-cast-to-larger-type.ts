// A function in a literal that is cast to a type with more members is a new function for each literal.
declare const console: { log(...a: unknown[]): void };
interface B { m: () => number; extra: number }
function make(): B { const b = { m: () => 1 } as B; b.extra = 1; return b; }
console.log(make().m === make().m);
