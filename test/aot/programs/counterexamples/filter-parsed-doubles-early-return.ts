// `filter` over an array of doubles that JSON.parse made, in a typed function with an early return.
declare const console: { log(...a: unknown[]): void };
function f(R: number[]) { if (!R.length) return []; return R.filter(v => Math.sqrt(v) + Math.sqrt(v + 1) + Math.sqrt(v + 2) > 0); }
const g: any[] = [f];
for (let b = 0; b < 1; b++) console.log(g[0](JSON.parse("[1.5,4]")).join());
