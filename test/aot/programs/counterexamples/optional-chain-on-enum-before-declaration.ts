// `E?.A` ahead of the declaration of the enum is undefined, not the constant.
declare const console: { log(...a: unknown[]): void };
const early = () => E?.A;
console.log(early());
enum E { A }
