// `K["A"]` of a const enum is the constant.
declare const console: { log(...a: unknown[]): void };
const enum K { A = 1 }
console.log(K["A"]);
