// `declare enum E` ahead of `enum E` does not make E a global of the host.
declare const console: { log(...a: unknown[]): void };
declare enum E { B = 1 }
enum E { A = 0 }
console.log(Object.keys(E).join());
