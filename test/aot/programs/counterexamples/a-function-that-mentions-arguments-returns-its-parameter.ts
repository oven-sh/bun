// A function that mentions `arguments` and returns its first parameter returns that parameter.
declare const console: { log(...a: unknown[]): void };
function same(a: number[]): number[] { arguments; return a; }
console.log(same([7, 8, 9]).length);
