// A getter that uses `this` in a literal that begins with a spread.
declare const console: { log(...a: unknown[]): void };
console.log({ ...{ q: 1 }, get g(): number { return this.q; } }.g);
