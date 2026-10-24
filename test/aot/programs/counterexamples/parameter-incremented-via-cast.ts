// `(a as number)++` stores to the parameter.
declare const console: { log(...a: unknown[]): void };
function bump(a: number): number { (a as number)++; return a; }
console.log(bump(1));
