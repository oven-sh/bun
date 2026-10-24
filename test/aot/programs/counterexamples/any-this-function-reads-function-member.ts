// A function expression whose `this` is declared `any` reads a function out of its literal: a new one for each literal.
declare const console: { log(...a: unknown[]): void };
function make(): { m: () => number; peek: () => unknown } { return { m: () => 1, peek: function (this: any): unknown { return this.m; } }; }
console.log(make().peek() === make().peek());
