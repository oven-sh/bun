// `new (new Proxy(C, {}))()` makes an instance of C.
declare const console: { log(...a: unknown[]): void };
class C { a = 1; }
console.log(new (new Proxy(C, {}))().a);
