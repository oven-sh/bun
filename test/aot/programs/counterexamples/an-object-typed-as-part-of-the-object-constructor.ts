// A `seal` of the program's own, on an object typed `Pick<ObjectConstructor, "seal">`, is called.
declare const console: { log(...a: unknown[]): void };
const x = { n: 1 };
const mine: Pick<ObjectConstructor, "seal"> = { seal<T>(o: T): T { return { ...o }; } };
console.log(mine.seal(x) === x);
