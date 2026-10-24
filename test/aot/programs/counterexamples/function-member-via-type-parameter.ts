// `<T>(o: T, k: keyof T) => o[k]` reads a function out of a literal: a new one for each literal.
declare const console: { log(...a: unknown[]): void };
const make = () => ({ m: () => 1 });
const get = <T>(o: T, k: keyof T) => o[k];
console.log(get(make(), "m") === get(make(), "m"));
