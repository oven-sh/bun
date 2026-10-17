// An enum that is declared twice is one object.
declare const console: { log(...a: unknown[]): void };
enum E { A }
const e = E;
enum E { B = 1 }
console.log(e === E);
