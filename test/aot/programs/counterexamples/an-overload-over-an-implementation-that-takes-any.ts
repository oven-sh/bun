// An overload `look(r: R)` over an implementation `look(r: any)` reads a function out of each literal.
declare const console: { log(...a: unknown[]): void };
function make() { return { m: () => 1 }; }
function look(r: { m: () => number }): unknown;
function look(r: any): unknown { return r.m; }
console.log(look(make()) === look(make()));
