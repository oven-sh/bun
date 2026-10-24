// `map` whose callback returns `arguments[1]`, in a typed function with an early return.
declare const console: { log(...a: unknown[]): void };
function f(R: number[]) { if (R.length) return R.map(function (v) { return arguments[1]; }); return []; }
for (const h of [f, f] as any[]) console.log(h([3, 4]).join());
