// `proxy instanceof C` runs the `getPrototypeOf` trap.
declare const console: { log(...a: unknown[]): void };
class C {}
console.log(new Proxy({}, { getPrototypeOf: () => C.prototype }) instanceof C);
