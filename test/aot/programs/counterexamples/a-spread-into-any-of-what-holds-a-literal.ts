// `const a: any = { ...outer }; a.inner.m` reads the function of that inner literal.
declare const console: { log(...a: unknown[]): void };
const make = () => ({ inner: { m: () => 1 } });
const a: any = { ...make() }, b: any = { ...make() };
console.log(a.inner.m === b.inner.m);
