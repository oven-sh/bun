// A function of the program that is typed `typeof Object.assign` is called, not taken for the built-in.
declare const console: { log(...a: unknown[]): void };
const mine: typeof Object.assign = (target: object) => target;
console.log(Object.keys(mine({ a: 1 }, { b: 2 })).join());
