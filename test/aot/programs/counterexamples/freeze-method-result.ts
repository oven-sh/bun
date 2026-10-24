// `Object.freeze(o.next(x))` yields what the method returned, not x.
declare const console: { log(...a: unknown[]): void };
const o = { next(p: { n: number }) { return { n: p.n + 1 }; } };
console.log(Object.freeze(o.next({ n: 1 })).n);
