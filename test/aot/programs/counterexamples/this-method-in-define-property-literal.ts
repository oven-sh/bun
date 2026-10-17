// A method that uses `this` in a literal that is handed to `Object.defineProperty`.
declare const console: { log(...a: unknown[]): void };
console.log(Object.defineProperty({ a: 1, m() { return this.a; } }, "z", { value: 1 }).m());
