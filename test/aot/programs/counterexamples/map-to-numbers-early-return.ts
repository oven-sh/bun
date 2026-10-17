// `map` to numbers in a typed function that is called often and has an early return.
declare const console: { log(...a: unknown[]): void };
function f(R: string[]) { if (!R.length) return []; return R.map(v => +v); }
for (let i = 0; i < 2; i++) f(["3"]);
console.log(f(["5"])[0]);
