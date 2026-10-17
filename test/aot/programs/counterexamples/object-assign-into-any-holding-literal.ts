// `Object.assign({} as any, outer).inner.m` reads the function of that inner literal.
declare const console: { log(...a: unknown[]): void };
function make() { return { inner: { m: () => 1 } }; }
console.log(Object.assign({} as any, make()).inner.m === Object.assign({} as any, make()).inner.m);
