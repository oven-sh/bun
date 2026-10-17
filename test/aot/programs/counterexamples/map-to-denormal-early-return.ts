// `map` to a very small number in a typed function with an early return, called through `any`.
declare const console: { log(...a: unknown[]): void };
function f(R: string[]) { if (!R.length) return []; return R.map(v => +v); }
for (const h of [f] as any[]) console.log(h(["4e-323"])[0]);
