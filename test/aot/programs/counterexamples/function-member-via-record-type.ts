// A function read out of a literal that is seen as `Record<"m", () => number>` is a new one for each literal.
declare const console: { log(...a: unknown[]): void };
const make = () => ({ m: () => 1 }), look = (d: Record<"m", () => number>) => d.m;
console.log(look(make()) === look(make()));
