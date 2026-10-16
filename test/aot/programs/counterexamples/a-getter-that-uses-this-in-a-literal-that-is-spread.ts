// A getter that uses `this` in a literal that is only spread.
declare const console: { log(...a: unknown[]): void };
console.log({ ...{ a: 1, get g() { return this.a + 1; } } }.g);
